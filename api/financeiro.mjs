// Vercel Function — Financeiro: lê no Bling os lançamentos que alimentam o DRE. Só leitura no Bling:
// nada de baixa, lançamento ou alteração lá. Quem grava nas tabelas do DRE é o navegador, com as mesmas
// regras da importação por arquivo (substitui o mês, respeita o cadeado). Só administradores.
//
// POST {acao:'bling', fonte, de, ate, cursor, completo}
//   fonte 'caixa'    lançamentos de Caixas e Bancos com data entre de e ate (AAAA-MM-DD)
//   fonte 'pagar'    contas a pagar com competência entre de e ate
//   fonte 'receber'  contas a receber com competência entre de e ate
// Cada chamada trabalha até ~40 s: enquanto não termina devolve {cursor, progresso} e o navegador chama
// de novo com o cursor. No fim devolve {pronto: true, itens}.
//
// Caixa: a lista não traz a categoria, mas filtra por ela; então busca a lista do período e depois a de
// cada categoria. Lançamento que não aparece em nenhuma categoria tem o detalhe lido um a um.
// Contas a pagar/receber: a lista não filtra por competência nem traz competência, categoria e histórico
// (só o detalhe de cada conta). A lista pega as contas com vencimento de 1 mês antes a 3 meses depois do
// período e as emitidas de 1 mês antes até o fim do período (parcelas distantes) e o detalhe fica em bling_contas
// (bling_contas.sql, só a função lê). O detalhe é lido de novo quando o valor ou o vencimento mudam, ou
// com `completo` (para pegar categoria/competência alteradas no Bling). A situação vem sempre da lista.
//
// POST {acao:'pedidos', mes:'AAAA-MM'}  pedidos de venda do mês no Bling (Em aberto + Atendido) por loja, sem os
//   sem loja ("nenhuma"): quantidade, total e total dos produtos. Base do nº de pedidos (embalagem de envio)
//   e da receita de Revenda e Venda direta pelas vendas do Bling. Também lista os pedidos de produto para
//   marketing (lojas Bonificação, Ativação - Premiação, Ativação - Degustação, Marketing e Shopify com voucher de metade ou mais).
// POST {acao:'itens', ids:[...]}  itens (código, quantidade) de até 40 pedidos; `faltam` se o Bling pediu pausa.
// POST {acao:'resumoCaixa', mes}  extrato do Bling do mês (id, data, valor, conta) para conferir o caixa do sistema.
// POST {acao:'pagas', tipo:'pagar'|'receber', de, ate}  contas pagas no período (prova da competência).
// POST {acao:'mercadopago', mes}  vendas do mês no Mercado Pago (API, MP_ACCESS_TOKEN), no formato do relatório .csv.
// POST {acao:'melhorenvio', mes}  etiquetas do mês no Melhor Envio (API, MELHORENVIO_TOKEN).
// POST {acao:'lalamove', mes}  corridas da Lalamove chamadas pelo sistema no mês (lalamove_corridas).
//
// Escopos do app do Bling: Caixas e Bancos, Contas a Pagar, Contas a Receber,
// Categorias - Receitas e Despesas e Contatos (mudar escopo derruba o acesso: reconectar na Expedição).

import { exigirSessao } from './_sessao.mjs'
import { ErroConexao, ErroLimite, banco, tokenBling, bling } from './_bling.mjs'
import { lojas, situacoes } from './expedicao.mjs'
import { lalamove } from './lalamove.mjs'

export const config = { maxDuration: 60 }

const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]
const FOLGA_MS = 40000   // para de chamar o Bling depois disso e devolve o cursor
const DATA = /^\d{4}-\d{2}-\d{2}$/

const addMes = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
const ultimoDia = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10)
const digitos = s => String(s || '').replace(/\D/g, '') || null
const dataOk = s => (DATA.test(String(s || '')) && !String(s).startsWith('0000')) ? s : null

// Query string do Bling (arrays como chave[]=a&chave[]=b)
function qs(o) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) for (const x of v) p.append(k, x)
    else p.append(k, v)
  }
  return p.toString()
}

let CATS = null, CATS_EM = 0
async function categorias(tk) {
  if (CATS && Date.now() - CATS_EM < 600e3) return CATS
  const lista = []
  for (let pg = 1; pg < 50; pg++) {
    const d = (await bling(tk, `/categorias/receitas-despesas?${qs({ pagina: pg, limite: 100, tipo: 0, situacao: 0 })}`))?.data || []
    for (const c of d) lista.push({ id: c.id, descricao: (c.descricao || '').trim() })
    if (d.length < 100) break
  }
  CATS = lista; CATS_EM = Date.now()
  return lista
}

// ───────────── Caixas e Bancos ─────────────

function baseCaixa(l) {
  return {
    id_bling: String(l.id), data: l.data, credito: String(l.debCred || '').toUpperCase() === 'C',
    valor: Math.abs(Number(l.valor) || 0), nome: (l.contato?.nome || '').trim(), cnpj: digitos(l.contato?.cnpj),
    // "Histórico" do extrato = observações; a "descricao" da API repete o nome da categoria
    historico: (l.observacoes || '').trim(), banco: (l.contaFinanceira?.descricao || '').trim(),
    categoria: null,
  }
}

async function passoCaixa(tk, c, de, ate, fim) {
  const base = { pagina: undefined, dataInicial: de, dataFinal: ate, situacao: 'R' }
  while (Date.now() < fim) {
    if (c.fase === 'lista') {
      const d = (await bling(tk, `/caixas?${qs({ ...base, pagina: c.pg })}`))?.data || []
      const novos = d.filter(l => !c.itens[l.id])
      for (const l of novos) if (l.data >= de && l.data <= ate) c.itens[l.id] = baseCaixa(l)
      c.tam = Math.max(c.tam, d.length)
      // página vazia ou repetida (nenhum lançamento novo) = fim da lista
      if (novos.length) { c.pg++; continue }
      if (!c.tam) { c.fase = 'fim'; break }
      c.cats = (await categorias(tk)).map(x => [x.id, x.descricao]); c.ci = 0; c.pg = 1; c.fase = 'cats'
    } else if (c.fase === 'cats') {
      if (c.ci >= c.cats.length) { c.resto = Object.keys(c.itens).filter(id => c.itens[id].categoria === null); c.ri = 0; c.fase = 'resto'; continue }
      const [idCat, nomeCat] = c.cats[c.ci]
      const d = (await bling(tk, `/caixas?${qs({ ...base, pagina: c.pg, 'idsCategorias[]': [idCat] })}`))?.data || []
      for (const l of d) {
        if (!(l.data >= de && l.data <= ate)) continue
        if (!c.itens[l.id]) c.itens[l.id] = baseCaixa(l)
        c.itens[l.id].categoria = nomeCat
      }
      if (d.length < c.tam || c.pg >= 50) { c.ci++; c.pg = 1 } else c.pg++
    } else if (c.fase === 'resto') {
      if (c.ri >= c.resto.length) { c.fase = 'fim'; break }
      const id = c.resto[c.ri++]
      const j = await bling(tk, `/caixas/${id}`)
      const d = j?.data || j || {}
      if (d.situacao && d.situacao !== 'R') { delete c.itens[id]; continue }
      c.itens[id].categoria = (d.categoria?.descricao || '').trim()
        || (d.saldo === 'S' ? 'Ajuste de saldo' : d.transferencia === 'S' ? 'Transferências' : '')
    } else break
  }
  const feito = c.fase === 'lista' ? 0 : c.fase === 'cats' ? c.ci : c.fase === 'resto' ? c.ri : 1
  const total = c.fase === 'cats' ? c.cats.length : c.fase === 'resto' ? c.resto.length : 1
  const texto = c.fase === 'lista' ? `lendo o extrato (página ${c.pg})`
    : c.fase === 'cats' ? `categorias ${c.ci} de ${c.cats.length}`
    : c.fase === 'resto' ? `lançamentos sem categoria ${c.ri} de ${c.resto.length}` : 'pronto'
  return { feito, total, texto }
}

// ───────────── Contas a pagar e a receber ─────────────

function linhaCache(fonte, d) {
  return {
    id_bling: String(d.id), tipo: fonte, situacao: Number(d.situacao) || null,
    vencimento: dataOk(d.vencimento), valor: Number(d.valor) || 0,
    competencia: dataOk(d.competencia) || dataOk(d.dataEmissao) || dataOk(d.vencimento),
    categoria_id: d.categoria?.id || null, contato_id: d.contato?.id || null,
    contato_nome: (d.contato?.nome || '').trim() || null, contato_doc: digitos(d.contato?.numeroDocumento),
    historico: (d.historico || '').trim(), origem_id: d.origem?.id ? String(d.origem.id) : null,
    detalhe_em: new Date().toISOString(),
  }
}

async function passoContas(tk, db, fonte, c, de, ate, completo, fim) {
  // Duas listas: por vencimento (1 mês antes a 3 depois) e por emissão (1 mês antes até o fim do período).
  // A de emissão pega as parcelas de vencimento distante (venda parcelada: todas emitidas no mesmo dia).
  const ini = `${addMes(de.slice(0, 7), -1)}-01`
  const filtros = [[ini, ultimoDia(addMes(ate.slice(0, 7), 3)), 'V'], [ini, ate, 'E']]
  let novos = []
  const gravar = async () => {
    if (!novos.length) return
    const { error } = await db.from('bling_contas').upsert(novos, { onConflict: 'id_bling' })
    if (error) throw new Error('Não consegui guardar o detalhe das contas (aplicou o bling_contas.sql?): ' + error.message)
    novos = []
  }
  try {
    while (Date.now() < fim) {
      if (c.fase === 'lista') {
        const [fIni, fFim, tipo] = filtros[c.f || 0]
        const q = fonte === 'receber'
          ? { pagina: c.pg, limite: 100, tipoFiltroData: tipo, dataInicial: fIni, dataFinal: fFim }
          : tipo === 'V' ? { pagina: c.pg, limite: 100, dataVencimentoInicial: fIni, dataVencimentoFinal: fFim }
          : { pagina: c.pg, limite: 100, dataEmissaoInicial: fIni, dataEmissaoFinal: fFim }
        const d = (await bling(tk, `/contas/${fonte}?${qs(q)}`))?.data || []
        const vistos = new Set(c.lista.map(x => x[0]))
        for (const x of d) if (!vistos.has(String(x.id))) c.lista.push([String(x.id), Number(x.situacao) || null, dataOk(x.vencimento), Number(x.valor) || 0])
        // página curta ou igual à anterior = fim desta lista; depois da última, vai para o cache
        const repetida = d.length && String(d[0].id) === c.prim
        c.prim = d.length ? String(d[0].id) : null
        if (d.length < 100 || repetida) {
          c.f = (c.f || 0) + 1; c.pg = 1; c.prim = null
          if (c.f >= filtros.length) c.fase = 'cache'
        } else c.pg++
      } else if (c.fase === 'cache') {
        const ids = c.lista.map(x => x[0]), cache = {}
        for (let i = 0; i < ids.length; i += 300) {
          const { data, error } = await db.from('bling_contas').select('id_bling, vencimento, valor').in('id_bling', ids.slice(i, i + 300))
          if (error) throw new Error('Tabela bling_contas não encontrada: aplique o bling_contas.sql no Supabase. (' + error.message + ')')
          for (const r of data || []) cache[r.id_bling] = r
        }
        c.pend = c.lista.filter(([id, , venc, valor]) => completo || !cache[id] || cache[id].vencimento !== venc
          || Math.abs(Number(cache[id].valor) - valor) > 0.004).map(x => x[0])
        c.pi = 0; c.fase = 'detalhe'
      } else if (c.fase === 'detalhe') {
        if (c.pi >= c.pend.length) { await gravar(); c.fase = 'contatos'; continue }
        const id = c.pend[c.pi]
        try {
          const d = (await bling(tk, `/contas/${fonte}/${id}`))?.data
          if (d) novos.push(linhaCache(fonte, d))
        } catch (e) {
          if (e instanceof ErroConexao) throw e
          if (!/não encontrad|not found|404/i.test(e.message)) throw e   // conta apagada entre a lista e o detalhe
        }
        c.pi++
        if (novos.length >= 25) await gravar()
      } else if (c.fase === 'contatos') {
        // contas a pagar trazem só o id do fornecedor: busca os nomes em lote
        if (!c.contatos) {
          const ids = c.lista.map(x => x[0]), falta = new Set()
          for (let i = 0; i < ids.length; i += 300) {
            const { data } = await db.from('bling_contas').select('contato_id').in('id_bling', ids.slice(i, i + 300))
              .not('contato_id', 'is', null).is('contato_nome', null)
            for (const r of data || []) falta.add(String(r.contato_id))
          }
          c.contatos = [...falta]
        }
        if (!c.contatos.length) { c.fase = 'fim'; break }
        const lote = c.contatos.splice(0, 100)
        const d = (await bling(tk, `/contatos?${qs({ pagina: 1, limite: 100, 'idsContatos[]': lote })}`))?.data || []
        for (const x of d) {
          const { error } = await db.from('bling_contas')
            .update({ contato_nome: (x.nome || '').trim() || '(sem nome)', contato_doc: digitos(x.numeroDocumento) })
            .eq('contato_id', x.id).is('contato_nome', null)
          if (error) throw new Error(error.message)
        }
      } else break
    }
  } finally { await gravar() }

  const total = c.fase === 'detalhe' ? c.pend.length : 1
  const feito = c.fase === 'detalhe' ? c.pi : c.fase === 'fim' ? 1 : 0
  const texto = c.fase === 'lista' ? `lista de contas (página ${c.pg})`
    : c.fase === 'detalhe' ? `detalhe das contas ${c.pi} de ${c.pend.length}`
    : c.fase === 'contatos' ? 'nomes dos fornecedores' : 'pronto'
  return { feito, total, texto }
}

// Contas do período, com a situação da lista e o detalhe guardado
async function itensContas(tk, db, fonte, c, de, ate) {
  const sit = Object.fromEntries(c.lista.map(([id, s, venc, valor]) => [id, { s, venc, valor }]))
  const ids = Object.keys(sit), cats = Object.fromEntries((await categorias(tk)).map(x => [String(x.id), x.descricao]))
  const itens = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('bling_contas').select('*').in('id_bling', ids.slice(i, i + 300))
      .gte('competencia', de).lte('competencia', ate)
    if (error) throw new Error(error.message)
    for (const r of data || []) {
      const l = sit[r.id_bling]
      itens.push({
        id_bling: r.id_bling, competencia: r.competencia, vencimento: l.venc, valor: l.valor, situacao: l.s,
        categoria: r.categoria_id ? (cats[String(r.categoria_id)] ?? '') : '',
        nome: r.contato_nome || '', cnpj: r.contato_doc || null, historico: r.historico || '', origem_id: r.origem_id,
      })
    }
  }
  return itens
}

// ───────────── Pedidos do mês ─────────────
async function pedidosDoMes(tk, mes) {
  const sit = await situacoes(tk), nomes = await lojas(tk)
  const q0 = { limite: 100, dataInicial: mes + '-01', dataFinal: ultimoDia(mes), 'idsSituacoes[]': [sit.aberto, sit.atendido] }
  const porLoja = {}, vistos = new Set(), marketing = []
  for (let pg = 1; pg <= 80; pg++) {
    const d = (await bling(tk, `/pedidos/vendas?${qs({ ...q0, pagina: pg })}`))?.data || []
    let novos = 0
    for (const p of d) {
      if (vistos.has(p.id)) continue
      vistos.add(p.id); novos++
      const id = p.loja?.id || 0
      if (!id) continue                              // loja "nenhuma": fora da contagem
      const l = porLoja[id] ||= { lojaId: id, nome: nomes[id] || String(id), pedidos: 0, total: 0, totalProdutos: 0 }
      l.pedidos++; l.total += Number(p.total) || 0; l.totalProdutos += Number(p.totalProdutos) || 0
      // produto que saiu sem venda: lojas de marketing e pedidos da Shopify pagos com voucher
      const tipo = LOJAS_MKT.find(([re]) => re.test(l.nome))?.[1]
        || ((/shopify/i.test(l.nome) || /^\d{10,}$/.test(p.numeroLoja || '')) && (Number(p.totalProdutos) || 0) > 0
          && (Number(p.total) || 0) <= VOUCHER_MIN * Number(p.totalProdutos) ? 'voucher' : null)
      if (tipo) marketing.push({ id: p.id, numero: p.numero, tipo, loja: l.nome })
    }
    if (d.length < 100 || !novos) break
  }
  const lista = Object.values(porLoja).map(l => ({ ...l, total: Math.round(l.total * 100) / 100, totalProdutos: Math.round(l.totalProdutos * 100) / 100 }))
    .sort((a, b) => b.pedidos - a.pedidos)
  return { mes, lojas: lista, pedidos: lista.reduce((t, l) => t + l.pedidos, 0), lidos: vistos.size, marketing }
}
// ───────────── Mercado Pago (só leitura): vendas do mês no formato do relatório de Vendas (.csv) ─────────────
// Mesmas colunas que src/lib/relatorioMercadoPago.js lê; "description" é o nome da loja (Point/QR), como no relatório.
const MP_COLS = ['date_created', 'status', 'transaction_amount', 'mercadopago_fee', 'marketplace_fee', 'coupon_fee',
  'net_received_amount', 'amount_refunded', 'financing_fee', 'marketplace', 'description', 'payment_type', 'reason']
async function mp(caminho) {
  const r = await fetch('https://api.mercadopago.com' + caminho, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Mercado Pago: ${j.message || r.status}`)
  return j
}
async function vendasMercadoPago(mes) {
  const eu = await mp('/users/me')
  const lojas = {}
  try { for (const s of (await mp(`/users/${eu.id}/stores/search?limit=100`)).results || []) lojas[String(s.id)] = s.name } catch { /* sem lojas cadastradas */ }
  const ini = `${mes}-01T00:00:00.000-03:00`, fim = `${ultimoDia(mes)}T23:59:59.999-03:00`
  const linhas = []
  for (let offset = 0; offset < 10000; offset += 100) {
    const j = await mp(`/v1/payments/search?${qs({ sort: 'date_created', criteria: 'asc', range: 'date_created', begin_date: ini, end_date: fim, limit: 100, offset })}`)
    for (const p of j.results || []) {
      const fee = t => (p.fee_details || []).filter(f => f.type === t).reduce((s, f) => s + (Number(f.amount) || 0), 0)
      const dc = String(p.date_created || '')   // 2026-10-05T10:03:45.000-03:00 → 05/10/2026 10:03:45 (horário de Brasília)
      linhas.push([`${dc.slice(8, 10)}/${dc.slice(5, 7)}/${dc.slice(0, 4)} ${dc.slice(11, 19)}`, p.status, p.transaction_amount, fee('mercadopago_fee'),
        fee('application_fee'), p.coupon_amount || 0, p.transaction_details?.net_received_amount || 0, p.transaction_amount_refunded || 0,
        fee('financing_fee'), p.marketplace || '', lojas[String(p.store_id || '')] || '', p.payment_type_id || '', p.description || ''])
    }
    if (!j.results || j.results.length < 100) break
  }
  return { mes, cab: MP_COLS, linhas }
}

// ───────────── Melhor Envio (só leitura): etiquetas do mês, para os fretes por competência ─────────────
async function enviosMelhorEnvio(mes) {
  const envios = []
  for (let pg = 1; pg <= 50; pg++) {
    const r = await fetch(`https://www.melhorenvio.com.br/api/v2/me/orders?page=${pg}`, {
      headers: { Authorization: `Bearer ${process.env.MELHORENVIO_TOKEN}`, Accept: 'application/json', 'User-Agent': 'Laricas Producao (financeiro)' } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Melhor Envio: ${j.message || r.status}`)
    const d = j.data || []
    for (const o of d) {
      const data = String(o.created_at || '').slice(0, 10)
      if (data.slice(0, 7) !== mes) continue
      envios.push({ codigo: o.protocol || o.id, data, status: o.status, preco: Number(o.price) || 0,
        transportadora: o.service?.company?.name || '', servico: o.service?.name || '', cidade: o.to?.city || '' })
    }
    // a lista vem da mais nova para a mais antiga: parou de ter envio do mês ou acabou
    const maisAntigo = d.map(o => String(o.created_at || '').slice(0, 7)).sort()[0]
    if (!d.length || pg >= (j.last_page || 1) || (maisAntigo && maisAntigo < mes)) break
  }
  return { mes, envios }
}

// Lojas do Bling cujos pedidos são produto para marketing (o nome da loja decide)
const LOJAS_MKT = [[/bonifica/i, 'bonificacao'], [/premia/i, 'premiacao'], [/degusta/i, 'degustacao'], [/marketing/i, 'marketing']]
// Shopify: pedido em que o cliente pagou no máximo metade dos produtos (voucher de influenciador/presente).
// A parte paga pelo voucher sai do CMV; cupom comum (10%, 20%) continua desconto de venda.
const VOUCHER_MIN = 0.5

// Itens (código e quantidade) de até 40 pedidos. Limite do Bling no meio: devolve o que leu e os que faltam.
async function itensDosPedidos(tk, ids) {
  const pedidos = []
  for (let i = 0; i < ids.length; i++) {
    try {
      const d = (await bling(tk, `/pedidos/vendas/${ids[i]}`))?.data
      pedidos.push({ id: ids[i], itens: (d?.itens || []).map(it => ({ codigo: it.codigo || '', descricao: it.descricao || '', quantidade: Number(it.quantidade) || 0 })),
        totalProdutos: Number(d?.totalProdutos) || 0, total: Number(d?.total) || 0, frete: Number(d?.transporte?.frete) || 0 })
    } catch (e) {
      if (e instanceof ErroLimite) return { pedidos, faltam: ids.slice(i) }
      throw e
    }
  }
  return { pedidos, faltam: [] }
}

// ───────────── Rota ─────────────

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
    if (!(await exigirSessao(req, res, { admin: true }))) return
    const origem = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '')
    if (!ORIGENS.some(r => r.test(origem))) return res.status(403).json({ erro: 'Origem não autorizada' })

    const { acao, fonte, de, ate, completo } = req.body || {}
    if (acao === 'pedidos') {
      const mes = String(req.body.mes || '')
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: 'Mês inválido' })
      const db = banco(), tk = await tokenBling(db)
      return res.status(200).json(await pedidosDoMes(tk, mes))
    }
    if (acao === 'itens') {
      const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(String).filter(x => /^\d+$/.test(x)).slice(0, 40)
      const db = banco(), tk = await tokenBling(db)
      return res.status(200).json(await itensDosPedidos(tk, ids))
    }
    if (acao === 'resumoCaixa') {
      // extrato do Bling de um mês (só a lista: id, data, valor, entrada/saída, conta) para conferir com o sistema
      const mes = String(req.body.mes || '')
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: 'Mês inválido' })
      const db = banco(), tk = await tokenBling(db)
      const de = `${mes}-01`, ate = ultimoDia(mes), itens = {}
      try {
        for (let pg = 1; pg <= 60; pg++) {
          const d = (await bling(tk, `/caixas?${qs({ pagina: pg, dataInicial: de, dataFinal: ate, situacao: 'R' })}`))?.data || []
          const novos = d.filter(l => !itens[l.id])
          for (const l of novos) if (l.data >= de && l.data <= ate) { const b = baseCaixa(l); itens[b.id_bling] = { id: b.id_bling, data: b.data, valor: b.valor, credito: b.credito, banco: b.banco, nome: b.nome } }
          if (!novos.length) break
        }
      } catch (e) {
        if (e instanceof ErroLimite) return res.status(200).json({ mes, pausa: true })
        throw e
      }
      return res.status(200).json({ mes, lancamentos: Object.values(itens) })
    }
    if (acao === 'mercadopago') {
      const mes = String(req.body.mes || '')
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: 'Mês inválido' })
      if (!process.env.MP_ACCESS_TOKEN) return res.status(400).json({ erro: 'Falta configurar MP_ACCESS_TOKEN na Vercel (Mercado Pago › Suas integrações › Credenciais de produção › Access Token).' })
      return res.status(200).json(await vendasMercadoPago(mes))
    }
    if (acao === 'lalamove') {
      // corridas chamadas pelo sistema (Expedição › baixa), em produção, no mês (horário de Brasília)
      const mes = String(req.body.mes || '')
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: 'Mês inválido' })
      const prox = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 1)).toISOString().slice(0, 7)
      const { data, error } = await banco().from('lalamove_corridas').select('order_id, status, preco, criado_em, rota_label')
        .eq('ambiente', 'producao').gte('criado_em', `${mes}-01T03:00:00Z`).lt('criado_em', `${prox}-01T03:00:00Z`)
      if (error) throw error
      // valor final cobrado (com ajustes e paradas extras) e situação de cada corrida, direto da Lalamove
      const corridas = data || [], db = banco()
      for (let i = 0; i < corridas.length; i += 5) {
        await Promise.all(corridas.slice(i, i + 5).map(async c => {
          if (!/^\d+$/.test(c.order_id || '')) return
          try {
            const o = await lalamove('GET', `/v3/orders/${c.order_id}`)
            const preco = Number(o.priceBreakdown?.total ?? 0) || null
            c.status = o.status || c.status; if (preco) { c.preco = preco; c.final = true }
            await db.from('lalamove_corridas').update({ status: c.status, ...(preco ? { preco } : {}) }).eq('order_id', c.order_id)
          } catch { /* fica o que está gravado */ }
        }))
      }
      return res.status(200).json({ mes, corridas })
    }
    if (acao === 'melhorenvio') {
      const mes = String(req.body.mes || '')
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: 'Mês inválido' })
      if (!process.env.MELHORENVIO_TOKEN) return res.status(400).json({ erro: 'Falta configurar MELHORENVIO_TOKEN na Vercel (Melhor Envio › Integrações › Permissões de acesso › gerar token, com leitura de envios).' })
      return res.status(200).json(await enviosMelhorEnvio(mes))
    }
    if (acao === 'pagas') {
      // contas a pagar (ou a receber) PAGAS entre duas datas: as que estavam em aberto no fim de um mês e foram
      // pagas depois. Junto com as que continuam em aberto, dá o saldo a pagar/receber de qualquer data passada.
      const tipo = req.body.tipo === 'receber' ? 'receber' : 'pagar'
      const de = String(req.body.de || ''), ate = String(req.body.ate || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return res.status(400).json({ erro: 'Datas inválidas' })
      const db = banco(), tk = await tokenBling(db)
      const contas = [], vistos = new Set()
      for (let pg = 1; pg <= 40; pg++) {
        const d = (await bling(tk, `/contas/${tipo}?${qs({ pagina: pg, limite: 100, dataPagamentoInicial: de, dataPagamentoFinal: ate })}`))?.data || []
        let novos = 0
        for (const c of d) if (!vistos.has(String(c.id))) { vistos.add(String(c.id)); novos++; contas.push({ id: String(c.id), valor: Number(c.valor) || 0, situacao: Number(c.situacao) || null }) }
        if (d.length < 100 || !novos) break
      }
      return res.status(200).json({ tipo, de, ate, contas })
    }
    if (acao !== 'bling') return res.status(400).json({ erro: 'Ação inválida' })
    if (!['caixa', 'pagar', 'receber'].includes(fonte)) return res.status(400).json({ erro: 'Fonte inválida' })
    if (!DATA.test(de || '') || !DATA.test(ate || '') || de > ate) return res.status(400).json({ erro: 'Período inválido' })

    const fim = Date.now() + FOLGA_MS
    const db = banco()
    const tk = await tokenBling(db)
    const c = req.body.cursor || (fonte === 'caixa' ? { fase: 'lista', pg: 1, tam: 0, itens: {} } : { fase: 'lista', pg: 1, lista: [] })
    let progresso
    try {
      progresso = fonte === 'caixa' ? await passoCaixa(tk, c, de, ate, fim) : await passoContas(tk, db, fonte, c, de, ate, !!completo, fim)
    } catch (e) {
      // o Bling segurou as requisições: devolve o que já foi lido e o navegador continua depois de uma pausa
      if (e instanceof ErroLimite) return res.status(200).json({ cursor: c, pausa: true, progresso: { texto: 'o Bling pediu uma pausa, continuando…' } })
      throw e
    }
    if (c.fase !== 'fim') return res.status(200).json({ cursor: c, progresso })
    if (fonte === 'caixa') return res.status(200).json({ pronto: true, itens: Object.values(c.itens) })
    return res.status(200).json({ pronto: true, itens: await itensContas(tk, db, fonte, c, de, ate) })
  } catch (e) {
    if (e instanceof ErroConexao) return res.status(401).json({ erro: e.message, reconectar: true })
    return res.status(502).json({ erro: e.message || String(e) })
  }
}
