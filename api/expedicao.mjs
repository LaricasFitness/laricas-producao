// Vercel Function — Expedição: baixa dos pedidos enviados.
// Para cada pedido lido na expedição: Shopify → marca como enviado (com rastreio) e arquiva;
// Bling → muda a situação de "Em aberto" para "Atendido". Tudo fica registrado em expedicao_envios.
//
// Variáveis de ambiente (Vercel › Settings › Environment Variables):
//   BLING_CLIENT_ID, BLING_CLIENT_SECRET   app privado do Bling (Central de Extensões › Área do integrador)
//                                          com "Link de redirecionamento" = https://<site>/api/expedicao?acao=callback
//   SUPABASE_SERVICE_ROLE_KEY              guarda os tokens do Bling na tabela integracao_tokens (fechada ao navegador)
//   SHOPIFY_LOJA, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET  (as mesmas do faturamento; o app precisa dos escopos
//                                          write_orders e write_merchant_managed_fulfillment_orders)
//
// GET  ?acao=status      Bling conectado? Shopify configurada?
// GET  ?acao=conectar    abre a autorização do Bling (uma vez; o acesso se renova sozinho por 30 dias a cada uso)
// GET  ?acao=callback    volta da autorização do Bling
// GET  ?acao=pedidos     pedidos "Em aberto" (lista rápida)
// GET  ?acao=diagnostico  só leitura, sem dados de cliente: naturezas de operação, logísticas e quantas NFs
//                        dos últimos 60 dias saíram com cada natureza por loja (base das regras de NF)
// GET  ?acao=pedidos&lista=atendidos   pedidos "Atendido" dos últimos dias (B2B, venda direta etc. ficam
//                        Atendido ao emitir a nota: a tela só avisa que não precisam de baixa)
// POST {acao:'detalhes', ids}   rastreio, CEP, transportadora e NF de até 30 pedidos
// POST {acao:'baixar', ids, notificar, operador}   baixa de até 8 pedidos
// POST {acao:'rascunhoNF', numero}   gera a NF de UM pedido como pendente (NÃO transmite) e confere a natureza
// POST {acao:'historico', parte, ...}   só leitura: NFs, pedidos, descontos e cupons do período (regras de natureza)
// POST {acao:'picking', numeros}   pedidos completos (itens, envio, observações) pelo nº no Bling, até 20

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { exigirSessao } from './_sessao.mjs'

export const config = { maxDuration: 60 }

const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]
const BLING = 'https://api.bling.com.br/Api/v3'
const SHOPIFY_VERSAO = '2026-07'
const DIAS_LISTA = 45          // pedidos em aberto dos últimos 45 dias
const DIAS_ATENDIDOS = 10      // pedidos já atendidos dos últimos 10 dias

const dormir = ms => new Promise(ok => setTimeout(ok, ms))

class ErroConexao extends Error {}

function banco() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel.')
  return createClient(url, chave, { auth: { persistSession: false } })
}

// ───────────── Bling ─────────────

function basicBling() {
  const { BLING_CLIENT_ID: id, BLING_CLIENT_SECRET: seg } = process.env
  if (!id || !seg) throw new Error('BLING_CLIENT_ID e BLING_CLIENT_SECRET não configurados no Vercel.')
  return 'Basic ' + Buffer.from(`${id}:${seg}`).toString('base64')
}

async function pedirToken(params) {
  const r = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0', Authorization: basicBling(), 'enable-jwt': '1' },
    body: new URLSearchParams(params),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new ErroConexao(`O Bling recusou o acesso (${r.status}${j.error?.description ? ': ' + j.error.description : ''}).`)
  return j
}

async function salvarTokens(db, j) {
  const { error } = await db.from('integracao_tokens').upsert({
    servico: 'bling', access_token: j.access_token, refresh_token: j.refresh_token,
    expira_em: new Date(Date.now() + (Number(j.expires_in) || 21600) * 1000 - 5 * 60000).toISOString(),
    atualizado_em: new Date().toISOString(),
  })
  if (error) throw new Error('Não consegui guardar o acesso do Bling: ' + error.message)
}

async function tokenBling(db) {
  const { data, error } = await db.from('integracao_tokens').select('*').eq('servico', 'bling').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ErroConexao('O Bling ainda não foi conectado.')
  if (new Date(data.expira_em) > new Date()) return data.access_token
  try {
    const j = await pedirToken({ grant_type: 'refresh_token', refresh_token: data.refresh_token })
    await salvarTokens(db, j)
    return j.access_token
  } catch (e) {
    // outra chamada pode ter renovado ao mesmo tempo: usa o token novo, se houver
    const { data: d2 } = await db.from('integracao_tokens').select('*').eq('servico', 'bling').maybeSingle()
    if (d2 && d2.refresh_token !== data.refresh_token && new Date(d2.expira_em) > new Date()) return d2.access_token
    throw new ErroConexao('O acesso ao Bling expirou. Conecte o Bling de novo.')
  }
}

// Limite do Bling: 3 requisições por segundo por conta
const ultimas = []
async function vez() {
  for (;;) {
    const agora = Date.now()
    while (ultimas.length && agora - ultimas[0] > 1050) ultimas.shift()
    if (ultimas.length < 3) { ultimas.push(agora); return }
    await dormir(1060 - (agora - ultimas[0]))
  }
}

async function bling(tk, caminho, opc = {}) {
  for (let t = 0; t < 4; t++) {
    await vez()
    const r = await fetch(BLING + caminho, {
      ...opc,
      headers: { Authorization: `Bearer ${tk}`, 'enable-jwt': '1', Accept: 'application/json', ...(opc.body ? { 'Content-Type': 'application/json' } : {}) },
    })
    if (r.status === 429) { await dormir(1200); continue }
    if (r.status === 401) throw new ErroConexao('O acesso ao Bling expirou. Conecte o Bling de novo.')
    if (r.status === 204) return null
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error('Bling: ' + (j.error?.fields?.[0]?.msg || j.error?.description || j.error?.message || `erro ${r.status}`))
    return j
  }
  throw new Error('Bling: limite de requisições. Tente de novo em instantes.')
}

// IDs das situações "Em aberto" e "Atendido" do módulo de Vendas (padrão do Bling: 6 e 9).
// Consultar as situações pede o escopo "Gerenciador de transições"; sem ele, ficam os IDs padrão.
// Nome das lojas (canais de venda) do Bling: { id: 'Shopify Laricas' }. Pede o escopo "Canais de venda"
// no app do Bling; sem ele, volta vazio e a tela deduz o nome (Shopify pelo nº da loja).
let LOJAS = null, LOJAS_EM = 0
async function lojas(tk) {
  if (LOJAS && Date.now() - LOJAS_EM < 3600e3) return LOJAS
  const mapa = {}
  try {
    const dados = (await bling(tk, '/canais-venda?limite=100'))?.data || []
    for (const c of dados) mapa[c.id] = c.descricao || c.tipo || ''
  } catch (e) {
    if (e instanceof ErroConexao) throw e
  }
  LOJAS = mapa; LOJAS_EM = Date.now()
  return mapa
}

let SITUACOES = null
async function situacoes(tk) {
  if (SITUACOES) return SITUACOES
  let lista = []
  try {
    const mods = (await bling(tk, '/situacoes/modulos'))?.data || []
    const mod = mods.find(m => /^vendas$/i.test(m.nome?.trim())) || mods.find(m => /pedidos? de venda/i.test(m.descricao || ''))
    if (mod) lista = (await bling(tk, `/situacoes/modulos/${mod.id}`))?.data || []
  } catch (e) {
    if (e instanceof ErroConexao) throw e
  }
  const achar = nome => lista.find(s => s.nome?.trim().toLowerCase() === nome)?.id
  SITUACOES = { aberto: achar('em aberto') ?? 6, atendido: achar('atendido') ?? 9 }
  return SITUACOES
}

const soDigitos = v => String(v || '').replace(/\D/g, '')

// Pedido do Bling → o que a expedição precisa
function resumo(d) {
  const vols = d.transporte?.volumes || []
  return {
    id: d.id,
    numero: String(d.numero ?? ''),
    numeroLoja: String(d.numeroLoja ?? ''),
    data: d.data || '',
    cliente: d.contato?.nome || '',
    lojaId: d.loja?.id || null,
    total: d.total ?? null,
    situacaoId: d.situacao?.id ?? null,
    nf: !!d.notaFiscal?.id,
    transportadora: d.transporte?.contato?.nome || '',
    servico: vols.map(v => v.servico).find(Boolean) || '',
    rastreios: [...new Set(vols.map(v => String(v.codigoRastreamento || '').replace(/\s/g, '').toUpperCase()).filter(Boolean))],
    cep: soDigitos(d.transporte?.etiqueta?.cep),
    cidade: d.transporte?.etiqueta?.municipio || '',
    uf: d.transporte?.etiqueta?.uf || '',
    // para o picking (só vêm no pedido completo)
    itens: (d.itens || []).map(i => ({ codigo: i.codigo || '', descricao: i.descricao || '', quantidade: Number(i.quantidade) || 0 })),
    obs: d.observacoes || '',
    obsInterna: d.observacoesInternas || '',
    detalhado: !!d.transporte,
  }
}

async function listarPedidos(tk, atendidos = false) {
  const sit = await situacoes(tk)
  const inicio = new Date(Date.now() - (atendidos ? DIAS_ATENDIDOS : DIAS_LISTA) * 864e5).toISOString().slice(0, 10)
  // só até hoje (horário de Brasília): pedidos com data futura ficam de fora
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const lista = []
  for (let pagina = 1; pagina <= 10; pagina++) {
    const q = new URLSearchParams({ pagina, limite: 100, 'idsSituacoes[]': atendidos ? sit.atendido : sit.aberto, dataInicial: inicio, dataFinal: hoje })
    const dados = (await bling(tk, `/pedidos/vendas?${q}`))?.data || []
    lista.push(...dados.map(resumo))
    if (dados.length < 100) break
  }
  return lista.filter(p => !p.data || p.data.slice(0, 10) <= hoje)
}

// Picking: acha cada pedido pelo número no Bling (o da planilha do planejamento) e traz o pedido completo
async function porNumero(tk, numeros) {
  const pedidos = [], faltando = []
  for (let i = 0; i < numeros.length; i += 3) {
    const lote = await Promise.all(numeros.slice(i, i + 3).map(async n => {
      try {
        const lista = (await bling(tk, `/pedidos/vendas?${new URLSearchParams({ numero: n, limite: 5 })}`))?.data || []
        const achado = lista.find(p => String(p.numero) === String(n))
        if (!achado) return { n }
        return { p: resumo((await bling(tk, `/pedidos/vendas/${achado.id}`))?.data) }
      } catch (e) {
        if (e instanceof ErroConexao) throw e
        return { n }
      }
    }))
    for (const r of lote) r.p ? pedidos.push(r.p) : faltando.push(String(r.n))
  }
  await notasShopify(pedidos)
  return { pedidos, faltando }
}

// Obs. do cliente no picking = a nota que o cliente deixou no pedido da Shopify (o Bling não traz).
// A observação do pedido no Bling não vai para o picking; a observação interna continua.
async function notasShopify(pedidos) {
  for (const p of pedidos) p.obs = ''
  const daShopify = pedidos.filter(p => /^\d{10,}$/.test(p.numeroLoja || ''))
  if (!daShopify.length) return
  try {
    const gql = await shopify()
    const d = await gql(`query Notas($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id note } } }`,
      { ids: daShopify.map(p => `gid://shopify/Order/${p.numeroLoja}`) })
    const nota = Object.fromEntries((d?.nodes || []).filter(Boolean).map(o => [o.id.split('/').pop(), (o.note || '').trim()]))
    for (const p of daShopify) p.obs = nota[p.numeroLoja] || ''
  } catch { /* sem a nota da Shopify o picking sai do mesmo jeito */ }
}

// Diagnóstico para desenhar a emissão de NF e etiquetas: só leitura e só totais (nenhum nome de cliente).
// Cada parte pede um escopo no app do Bling; a que faltar volta com o erro, sem derrubar as outras.
async function diagnostico(tk) {
  const parte = async f => { try { return await f() } catch (e) { if (e instanceof ErroConexao) throw e; return { erro: e.message } } }
  const naturezas = await parte(async () => ((await bling(tk, '/naturezas-operacoes?limite=100'))?.data || [])
    .map(n => ({ id: n.id, descricao: n.descricao, padrao: n.padrao, situacao: n.situacao })))
  const logisticas = await parte(async () => ((await bling(tk, '/logisticas?limite=100'))?.data || [])
    .map(l => ({ id: l.id, descricao: l.descricao, tipoIntegracao: l.tipoIntegracao, integracaoNativa: l.integracaoNativa, situacao: l.situacao,
      servicos: (l.servicos || []).map(s => s.descricao || s.codigo || s.id) })))
  const notas = await parte(async () => {
    const inicio = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
    const nomesNat = Object.fromEntries((Array.isArray(naturezas) ? naturezas : []).map(n => [n.id, n.descricao]))
    const nomesLoja = await lojas(tk)
    const cont = {}
    let total = 0
    for (let pagina = 1; pagina <= 5; pagina++) {
      const q = new URLSearchParams({ pagina, limite: 100, tipo: 1, dataEmissaoInicial: `${inicio} 00:00:00` })
      const dados = (await bling(tk, `/nfe?${q}`))?.data || []
      for (const nf of dados) {
        const nat = nomesNat[nf.naturezaOperacao?.id] || `natureza ${nf.naturezaOperacao?.id ?? '?'}`
        const loja = nomesLoja[nf.loja?.id] || (nf.loja?.id ? `loja ${nf.loja.id}` : 'sem loja')
        const k = `${loja} → ${nat}`
        cont[k] = (cont[k] || 0) + 1; total++
      }
      if (dados.length < 100) break
    }
    return { desde: inicio, total, porLojaENatureza: Object.fromEntries(Object.entries(cont).sort((a, b) => b[1] - a[1])) }
  })
  return { naturezas, logisticas, notas }
}

// Histórico para desenhar as regras de natureza da NF (só leitura), em partes que cabem nos 60 s da função:
//   parte 'nfs'      uma página (100) de NFs de saída do período: natureza, loja, cliente
//   parte 'pedidos'  uma página (100) de pedidos de venda do período
//   parte 'detalhes' até 90 pedidos: desconto, NF ligada, frete, observação interna
//   parte 'shopify'  até 50 pedidos da Shopify: cupons, desconto, tags
// ───────────── Natureza da NF ─────────────
// Regras combinadas com a Laricas em 17/11/2026 (ver README › Emissão de NF). A natureza não vem no
// pedido: o Bling escolhe ao gerar a nota. O sistema gera a nota pendente, lê a natureza que o Bling
// pôs e compara com a regra; só nota que confere pode ser transmitida.

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const NAT = {
  consumidor: 'VENDA DE MERCADORIA PARA CONSUMIDOR FINAL',
  venda: 'VENDA DE MERCADORIA',
  bonificacao: 'BONIFICACAO',
  reposicao: 'REPOSICAO DE MERCADORIA',
  presente: 'ENTREGA DE PRESENTE - LARICAS EXPERIENCE',
}
// Revenda/venda direta: vale a natureza do cadastro do cliente no Bling (PJ, PF, ST...), desde que seja de venda
const ehNaturezaDeVenda = n => /^VENDA/.test(semAcento(n)) && !/ENTREGA FUTURA/.test(semAcento(n))

let NATUREZAS = null, NATUREZAS_EM = 0
async function naturezas(tk) {
  if (NATUREZAS && Date.now() - NATUREZAS_EM < 3600e3) return NATUREZAS
  const d = (await bling(tk, '/naturezas-operacoes?limite=100'))?.data || []
  NATUREZAS = Object.fromEntries(d.map(n => [n.id, n.descricao])); NATUREZAS_EM = Date.now()
  return NATUREZAS
}

// Dados da Shopify que decidem a natureza: total pago e cupons
async function shopifyDosPedidos(numerosLoja) {
  const nums = [...new Set(numerosLoja.filter(n => /^\d{10,}$/.test(n || '')))]
  if (!nums.length) return {}
  const gql = await shopify()
  const saida = {}
  for (let i = 0; i < nums.length; i += 50) {
    const d = await gql(`query Nat($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id discountCodes
      totalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } } } }`,
      { ids: nums.slice(i, i + 50).map(n => `gid://shopify/Order/${n}`) })
    for (const o of d?.nodes || []) if (o) saida[o.id.split('/').pop()] = {
      total: Number(o.totalPriceSet?.shopMoney?.amount || 0), desconto: Number(o.totalDiscountsSet?.shopMoney?.amount || 0), cupons: o.discountCodes || [] }
  }
  return saida
}

// → { esperada: 'NOME' | null, aceita: fn(nome) → bool, motivo, manual: bool }
function regraNatureza(loja, numeroLoja, shp) {
  const L = semAcento(loja)
  const fixa = (nat, motivo) => ({ esperada: nat, aceita: n => semAcento(n) === nat, motivo, manual: false })
  if (/SHOPIFY/.test(L) || /^\d{10,}$/.test(numeroLoja || '')) {
    if (!shp) return { ...fixa(NAT.consumidor, 'Shopify: não achei o pedido na Shopify para conferir o pagamento'), manual: true }
    const vouchers = shp.cupons.filter(c => /^voucher/i.test(c))
    if (shp.total <= 0.009 && vouchers.length) return fixa(NAT.bonificacao, `Shopify: ${vouchers.join(', ')} cobre 100% (nada pago)`)
    if (shp.total <= 0.009) return { ...fixa(NAT.bonificacao, 'Shopify: total R$ 0 sem cupom de voucher'), manual: true }
    return fixa(NAT.consumidor, `Shopify: pago R$ ${shp.total.toFixed(2).replace('.', ',')}${shp.cupons.length ? ` (cupom ${shp.cupons.join(', ')})` : ''}`)
  }
  if (/CLUBE|RITS|MERCADO LIVRE/.test(L)) return fixa(NAT.consumidor, `${loja}: venda ao consumidor final`)
  if (/MARKETING|BONIFICACAO/.test(L)) return fixa(NAT.bonificacao, `${loja}: bonificação`)
  if (/REENVIO/.test(L)) return fixa(NAT.reposicao, 'Reenvio: reposição de mercadoria')
  if (/EXPERIENCE/.test(L)) return fixa(NAT.presente, 'Laricas Experience: entrega de presente')
  if (/REVENDA|VENDA DIRETA/.test(L))
    return { esperada: null, aceita: ehNaturezaDeVenda, motivo: `${loja}: a natureza de venda do cadastro do cliente no Bling (consignação: escolher à mão)`, manual: false }
  return { esperada: null, aceita: () => false, motivo: `${loja || 'Pedido sem loja'}: sem regra, escolha manual`, manual: true }
}

async function pedidoPorNumero(tk, numero) {
  const lista = (await bling(tk, `/pedidos/vendas?${new URLSearchParams({ numero, limite: 5 })}`))?.data || []
  const achado = lista.find(p => String(p.numero) === String(numero))
  return achado ? (await bling(tk, `/pedidos/vendas/${achado.id}`))?.data : null
}

async function lerNota(tk, id, nomesNat) {
  const n = (await bling(tk, `/nfe/${id}`))?.data || {}
  return { id: n.id, numero: n.numero, serie: n.serie, situacao: n.situacao, valor: n.valorNota,
    naturezaId: n.naturezaOperacao?.id || null, natureza: nomesNat[n.naturezaOperacao?.id] || '' }
}

// Gera a NF de UM pedido como rascunho (pendente no Bling, NÃO transmite) e confere a natureza.
// Se o pedido já tem NF, só confere a existente.
async function rascunhoNF(tk, numero) {
  const d = await pedidoPorNumero(tk, numero)
  if (!d) throw new Error(`Pedido ${numero} não encontrado no Bling.`)
  const [nomesLoja, nomesNat] = await Promise.all([lojas(tk), naturezas(tk)])
  const loja = nomesLoja[d.loja?.id] || ''
  const numeroLoja = String(d.numeroLoja || '')
  const shp = /^\d{10,}$/.test(numeroLoja) ? (await shopifyDosPedidos([numeroLoja]))[numeroLoja] || null : null
  const regra = regraNatureza(loja, numeroLoja, shp)
  let nota, gerada = false
  if (d.notaFiscal?.id) nota = await lerNota(tk, d.notaFiscal.id, nomesNat)
  else {
    const g = await bling(tk, `/pedidos/vendas/${d.id}/gerar-nfe`, { method: 'POST' })
    const idNota = g?.data?.idNotaFiscal || g?.idNotaFiscal
    if (!idNota) throw new Error('O Bling não devolveu o ID da nota gerada.')
    nota = await lerNota(tk, idNota, nomesNat); gerada = true
  }
  // Gerar a NF pela API muda o pedido para "Atendido". Na rotina da Laricas o pedido só fica Atendido na
  // baixa da Expedição (que também marca o envio na Shopify): com a nota ainda pendente, volta para "Em aberto".
  const sit = await situacoes(tk)
  let situacao = gerada ? (await bling(tk, `/pedidos/vendas/${d.id}`))?.data?.situacao?.id : d.situacao?.id
  if (nota.situacao === 1 && situacao === sit.atendido) {
    await bling(tk, `/pedidos/vendas/${d.id}/situacoes/${sit.aberto}`, { method: 'PATCH' })
    situacao = sit.aberto
  }
  return {
    situacaoPedido: situacao === sit.aberto ? 'Em aberto' : situacao === sit.atendido ? 'Atendido' : String(situacao ?? ''),
    pedido: { id: d.id, numero: String(d.numero), loja, cliente: d.contato?.nome || '', total: d.total, numeroLoja },
    shopify: shp, regra: { esperada: regra.esperada, motivo: regra.motivo, manual: regra.manual },
    nota, gerada, confere: !regra.manual && regra.aceita(nota.natureza),
  }
}

const dataOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
async function historico(tk, b) {
  const pagina = Math.max(1, Math.min(200, Number(b.pagina) || 1))
  if (b.parte === 'nfs' || b.parte === 'pedidos') {
    if (!dataOk(b.desde) || !dataOk(b.ate)) throw new Error('Informe desde e ate (AAAA-MM-DD).')
    const nomesLoja = await lojas(tk)
    if (b.parte === 'nfs') {
      const q = new URLSearchParams({ pagina, limite: 100, tipo: 1, dataEmissaoInicial: `${b.desde} 00:00:00`, dataEmissaoFinal: `${b.ate} 23:59:59` })
      return ((await bling(tk, `/nfe?${q}`))?.data || []).map(nf => ({
        id: nf.id, numero: nf.numero, data: nf.dataEmissao, situacao: nf.situacao, natureza: nf.naturezaOperacao?.id,
        loja: nomesLoja[nf.loja?.id] || (nf.loja?.id ? String(nf.loja.id) : ''), numeroLoja: nf.loja?.numero || '',
        cliente: nf.contato?.nome || '', tipoPessoa: nf.contato?.tipoPessoa || '', contribuinte: nf.contato?.contribuinte ?? null,
        uf: nf.contato?.endereco?.uf || '',
      }))
    }
    const q = new URLSearchParams({ pagina, limite: 100, dataInicial: b.desde, dataFinal: b.ate })
    return ((await bling(tk, `/pedidos/vendas?${q}`))?.data || []).map(p => ({
      id: p.id, numero: p.numero, numeroLoja: p.numeroLoja || '', data: p.data, total: p.total, totalProdutos: p.totalProdutos,
      situacao: p.situacao?.id, loja: nomesLoja[p.loja?.id] || (p.loja?.id ? String(p.loja.id) : ''), cliente: p.contato?.nome || '',
    }))
  }
  if (b.parte === 'detalhes') {
    const ids = [...new Set((b.ids || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 90)
    const saida = []
    for (const id of ids) {
      try {
        const d = (await bling(tk, `/pedidos/vendas/${id}`))?.data || {}
        saida.push({ id, nf: d.notaFiscal?.id || null, desconto: d.desconto || null, frete: d.transporte?.frete ?? null,
          outrasDespesas: d.outrasDespesas ?? null, obsInterna: String(d.observacoesInternas || '').slice(0, 200),
          naturezasItens: [...new Set((d.itens || []).map(i => i.naturezaOperacao?.id).filter(Boolean))] })
      } catch (e) { if (e instanceof ErroConexao) throw e; saida.push({ id, erro: e.message }) }
    }
    return saida
  }
  if (b.parte === 'shopify') {
    const nums = [...new Set((b.numeros || []).map(String).filter(n => /^\d{10,}$/.test(n)))].slice(0, 50)
    if (!nums.length) return []
    const gql = await shopify()
    const d = await gql(`query Hist($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id name discountCodes tags sourceName
      subtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } } } } }`,
      { ids: nums.map(n => `gid://shopify/Order/${n}`) })
    return (d?.nodes || []).filter(Boolean).map(o => ({
      numeroLoja: o.id.split('/').pop(), nome: o.name, cupons: o.discountCodes || [], tags: o.tags || [], origem: o.sourceName || '',
      subtotal: Number(o.subtotalPriceSet?.shopMoney?.amount || 0), desconto: Number(o.totalDiscountsSet?.shopMoney?.amount || 0),
      total: Number(o.totalPriceSet?.shopMoney?.amount || 0),
    }))
  }
  throw new Error('Parte inválida.')
}

async function detalhes(tk, ids) {
  const saida = []
  for (let i = 0; i < ids.length; i += 3) {
    saida.push(...await Promise.all(ids.slice(i, i + 3).map(id =>
      bling(tk, `/pedidos/vendas/${id}`).then(j => resumo(j.data)).catch(e => ({ id, erro: e.message })))))
  }
  return saida
}

// ───────────── Shopify ─────────────

async function shopify() {
  const loja = process.env.SHOPIFY_LOJA
  if (!loja || !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET)
    throw new Error('Shopify não configurada no Vercel (SHOPIFY_LOJA, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET).')
  const r = await fetch(`https://${loja}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`A Shopify recusou o acesso (${r.status}${j.error ? ': ' + j.error : ''}).`)
  const tk = j.access_token
  return async (query, variables) => {
    for (let t = 0; t < 4; t++) {
      const r = await fetch(`https://${loja}/admin/api/${SHOPIFY_VERSAO}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tk },
        body: JSON.stringify({ query, variables }),
      })
      const j = await r.json().catch(() => ({}))
      if ((j.errors || []).some(e => e.extensions?.code === 'THROTTLED')) { await dormir(1500); continue }
      if (!r.ok || j.errors) {
        const msg = (Array.isArray(j.errors) ? j.errors.map(e => e.message).join('; ') : j.errors) || `erro ${r.status}`
        throw new Error('Shopify: ' + (/access|scope|denied/i.test(msg) ? msg + ' (falta permissão no app da Shopify)' : msg))
      }
      return j.data
    }
    throw new Error('Shopify: limite de requisições. Tente de novo em instantes.')
  }
}

const Q_PEDIDO = `query Pedido($id: ID!) {
  order(id: $id) { id name closed fulfillmentOrders(first: 10) { nodes { id status deliveryMethod { methodType } } } }
}`
const M_ENVIO = `mutation Envio($f: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $f) { fulfillment { id status } userErrors { field message } }
}`
// Retirada na loja: "pronto para retirada" (a Shopify avisa o cliente sozinha)
const M_RETIRADA = `mutation Retirada($i: FulfillmentOrderLineItemsPreparedForPickupInput!) {
  fulfillmentOrderLineItemsPreparedForPickup(input: $i) { userErrors { field message } }
}`
const M_ARQUIVAR = `mutation Arquivar($i: OrderCloseInput!) {
  orderClose(input: $i) { order { id closed } userErrors { field message } }
}`

// Nome da transportadora como a Shopify conhece (para o link de rastreio no e-mail do cliente)
function transportadoraShopify(p) {
  const t = `${p.transportadora} ${p.servico}`
  if (/correios|sedex|\bpac\b/i.test(t)) return 'Correios'
  if (/j\s*&\s*t|jet express/i.test(t)) return 'J&T Express'
  if (/lalamove/i.test(t)) return 'Lalamove'
  if (/loggi/i.test(t)) return 'Loggi'
  return p.transportadora || undefined
}

const errosShopify = r => (r?.userErrors || []).map(e => e.message).join('; ')

async function baixarShopify(gql, p, notificar) {
  if (!/^\d{6,}$/.test(p.numeroLoja)) return null              // não veio da Shopify
  const o = (await gql(Q_PEDIDO, { id: `gid://shopify/Order/${p.numeroLoja}` }))?.order
  if (!o) return null                                            // número de outra loja (Mercado Livre etc.)
  const nos = o.fulfillmentOrders?.nodes || []
  const espera = nos.find(f => f.status === 'ON_HOLD')
  if (espera) throw new Error(`Shopify: pedido ${o.name} está em espera (retido). Libere na Shopify.`)
  const abertos = nos.filter(f => f.status === 'OPEN' || f.status === 'IN_PROGRESS')
  const retirada = abertos.filter(f => f.deliveryMethod?.methodType === 'PICK_UP')
  if (retirada.length) {
    // o pedido fica aberto até o cliente retirar (aí marca "Retirado" na Shopify)
    const r = (await gql(M_RETIRADA, { i: { lineItemsByFulfillmentOrder: retirada.map(f => ({ fulfillmentOrderId: f.id })) } }))?.fulfillmentOrderLineItemsPreparedForPickup
    if (errosShopify(r)) throw new Error(`Shopify (${o.name}): ${errosShopify(r)}`)
  }
  for (const fo of abertos.filter(f => !retirada.includes(f))) {
    const f = { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id }], notifyCustomer: !!notificar }
    const empresa = transportadoraShopify(p)
    if (p.rastreios.length > 1) f.trackingInfo = { company: empresa, numbers: p.rastreios }
    else if (p.rastreios.length) f.trackingInfo = { company: empresa, number: p.rastreios[0] }
    else if (empresa) f.trackingInfo = { company: empresa }
    const r = (await gql(M_ENVIO, { f }))?.fulfillmentCreate
    if (errosShopify(r)) throw new Error(`Shopify (${o.name}): ${errosShopify(r)}`)
  }
  if (retirada.length) return { nome: o.name, retirada: true }
  if (!o.closed) {
    const r = (await gql(M_ARQUIVAR, { i: { id: o.id } }))?.orderClose
    if (errosShopify(r)) throw new Error(`Shopify (${o.name}): ${errosShopify(r)}`)
  }
  return { nome: o.name, retirada: false }
}

// Um pedido: Shopify primeiro (se falhar, o pedido continua "Em aberto" no Bling e dá para tentar de novo)
async function baixarPedido(ctx, id, notificar, operador) {
  const reg = { bling_id: id, operador: operador || null, ok_bling: false, ok_shopify: null }
  try {
    const d = (await bling(ctx.tk, `/pedidos/vendas/${id}`))?.data
    if (!d) throw new Error('Pedido não encontrado no Bling.')
    const p = resumo(d)
    Object.assign(reg, { numero: p.numero, numero_loja: p.numeroLoja || null, cliente: p.cliente, transportadora: p.transportadora || null, rastreio: p.rastreios.join(', ') || null })
    if (/^\d{6,}$/.test(p.numeroLoja)) {
      try {
        ctx.gql ??= await shopify()
        const sh = await baixarShopify(ctx.gql, p, notificar)
        reg.ok_shopify = sh ? true : null
        if (sh) reg.pedido_shopify = sh.nome
        if (sh?.retirada) reg.transportadora = 'Retirada: pronto para coleta na Shopify'
      } catch (e) { reg.ok_shopify = false; throw e }
    }
    if (p.situacaoId !== ctx.sit.atendido) await bling(ctx.tk, `/pedidos/vendas/${id}/situacoes/${ctx.sit.atendido}`, { method: 'PATCH' })
    reg.ok_bling = true
  } catch (e) {
    reg.erro = e.message || String(e)
  }
  const { pedido_shopify, ...linha } = reg
  await ctx.db.from('expedicao_envios').insert(linha)
  return reg
}

// ───────────── Rotas ─────────────

const site = req => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`
const cookie = (req, nome) => (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(([k]) => k === nome)?.[1]

export default async function handler(req, res) {
  const acao = req.method === 'POST' ? req.body?.acao : req.query.acao
  try {
    // Tudo exige estar logado no sistema, menos a volta do Bling (protegida pelo state que só o
    // "conectar", já logado, grava)
    if (acao !== 'callback' && !(await exigirSessao(req, res))) return

    // Autorização do Bling (navegação normal, fora do fetch do sistema)
    if (acao === 'conectar') {
      const state = crypto.randomBytes(16).toString('hex')
      const url = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(process.env.BLING_CLIENT_ID || '')}&state=${state}`
      res.setHeader('Set-Cookie', `bling_state=${state}; Path=/api/expedicao; HttpOnly; Secure; SameSite=Lax; Max-Age=600`)
      res.writeHead(302, { Location: url }); return res.end()
    }
    if (acao === 'callback') {
      const { code, state } = req.query
      if (!code || !state || state !== cookie(req, 'bling_state')) {
        res.writeHead(302, { Location: `${site(req)}/?expedicao=erro` }); return res.end()
      }
      const db = banco()
      await salvarTokens(db, await pedirToken({ grant_type: 'authorization_code', code }))
      SITUACOES = null
      res.setHeader('Set-Cookie', 'bling_state=; Path=/api/expedicao; Max-Age=0')
      res.writeHead(302, { Location: `${site(req)}/?expedicao=conectado` }); return res.end()
    }

    // Daqui para baixo, só o próprio sistema (além da sessão, a origem tem de ser o site)
    const origem = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '')
    if (req.method === 'POST' ? !ORIGENS.some(r => r.test(origem)) : (origem && !ORIGENS.some(r => r.test(origem))))
      return res.status(403).json({ erro: 'Origem não autorizada' })

    const db = banco()
    if (acao === 'status') {
      const { data } = await db.from('integracao_tokens').select('atualizado_em').eq('servico', 'bling').maybeSingle()
      return res.status(200).json({
        bling: !!data, bling_desde: data?.atualizado_em || null,
        shopify: !!(process.env.SHOPIFY_LOJA && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
      })
    }
    const tk = await tokenBling(db)
    if (acao === 'diagnostico') return res.status(200).json(await diagnostico(tk))
    if (acao === 'pedidos') {
      const pedidos = await listarPedidos(tk, req.query.lista === 'atendidos')
      return res.status(200).json({ pedidos, lojas: req.query.lista === 'atendidos' ? {} : await lojas(tk) })
    }

    const ids = [...new Set((req.body?.ids || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))]
    if (acao === 'picking') {
      const numeros = [...new Set((req.body?.numeros || []).map(n => String(n).trim().replace(/^#/, '')).filter(n => /^\d+$/.test(n)))]
      if (!numeros.length || numeros.length > 20) return res.status(400).json({ erro: 'Envie de 1 a 20 números de pedido.' })
      return res.status(200).json({ ...await porNumero(tk, numeros), lojas: await lojas(tk) })
    }
    if (acao === 'rascunhoNF') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      const numero = String(req.body?.numero || '').trim().replace(/^#/, '')
      if (!/^\d+$/.test(numero)) return res.status(400).json({ erro: 'Informe o número do pedido.' })
      return res.status(200).json(await rascunhoNF(tk, numero))
    }
    if (acao === 'historico') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      return res.status(200).json({ dados: await historico(tk, req.body || {}) })
    }
    if (acao === 'detalhes') {
      if (!ids.length || ids.length > 30) return res.status(400).json({ erro: 'Envie de 1 a 30 pedidos.' })
      return res.status(200).json({ pedidos: await detalhes(tk, ids) })
    }
    if (acao === 'baixar') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      if (!ids.length || ids.length > 8) return res.status(400).json({ erro: 'Envie de 1 a 8 pedidos por vez.' })
      const ctx = { db, tk, sit: await situacoes(tk), gql: null }
      const resultados = []
      for (const id of ids) resultados.push(await baixarPedido(ctx, id, req.body.notificar !== false, String(req.body.operador || '').slice(0, 80)))
      return res.status(200).json({ resultados })
    }
    return res.status(400).json({ erro: 'Ação inválida' })
  } catch (e) {
    if (acao === 'callback') { res.writeHead(302, { Location: `${site(req)}/?expedicao=erro` }); return res.end() }
    if (e instanceof ErroConexao) return res.status(401).json({ erro: e.message, reconectar: true })
    return res.status(502).json({ erro: e.message || String(e) })
  }
}
