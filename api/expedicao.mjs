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
// GET  ?acao=pedidos     pedidos "Em aberto" (lista rápida). Os que já tiveram baixa e o Bling reabriu
//                        (reimportação da Shopify) voltam para "Atendido" e vêm em `recolocados`
// GET  ?acao=diagnostico  só leitura, sem dados de cliente: naturezas de operação, logísticas e quantas NFs
//                        dos últimos 60 dias saíram com cada natureza por loja (base das regras de NF)
// GET  ?acao=pedidos&lista=atendidos   pedidos "Atendido" dos últimos dias (B2B, venda direta etc. ficam
//                        Atendido ao emitir a nota: a tela só avisa que não precisam de baixa)
// POST {acao:'detalhes', ids}   rastreio, CEP, transportadora e NF de até 30 pedidos
// POST {acao:'baixar', ids, notificar, operador}   baixa de até 8 pedidos
// POST {acao:'rascunhoNF', numero}   gera a NF de UM pedido como pendente (NÃO transmite) e confere a natureza
//                        (natureza de escolha manual, ex. consignação: não gera, fica para o Bling)
// POST {acao:'etiquetas', ids, formato}   só leitura, até 10: link da etiqueta que a logística já gerou
// POST {acao:'documentos', ids}   só leitura, até 8: PDF da etiqueta (base64) + dados da DANFE simplificada
// POST {acao:'notas', numeros}   só leitura, até 10: natureza que a regra pede + nota existente de cada pedido
// POST {acao:'transmitirNF', numero}   transmite à Sefaz a nota pendente/rejeitada de UM pedido, só se a
//                        natureza conferir (conferência refeita no servidor)
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

// Pedidos que já tiveram baixa e voltaram para "Em aberto".
// Por quê: a integração Shopify do Bling reimporta o pedido a cada alteração na Shopify (envio marcado,
// arquivamento, "entregue", edição) e reaplica o mapeamento "Pago → Em aberto", por cima do "Atendido".
// Aqui eles voltam para "Atendido" (só no Bling; na Shopify nada muda) e saem da lista.
const MAX_RECOLOCAR = 20
async function recolocarAtendidos(tk, db, lista) {
  if (!lista.length) return []
  const desde = new Date(Date.now() - DIAS_LISTA * 864e5).toISOString()
  const { data, error } = await db.from('expedicao_envios').select('bling_id')
    .eq('ok_bling', true).gte('criado_em', desde).in('bling_id', lista.map(p => p.id))
  if (error) return []
  const baixados = new Set((data || []).map(r => String(r.bling_id)))
  let alvo = lista.filter(p => baixados.has(String(p.id))).slice(0, MAX_RECOLOCAR)
  // pedido cancelado na Shopify depois da baixa: não mexe (o Bling cuida do cancelamento)
  const daShopify = alvo.filter(p => /^\d{10,}$/.test(p.numeroLoja || ''))
  if (daShopify.length) {
    try {
      const gql = await shopify()
      const d = await gql(`query Canc($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id cancelledAt } } }`,
        { ids: daShopify.map(p => `gid://shopify/Order/${p.numeroLoja}`) })
      const cancelados = new Set((d?.nodes || []).filter(o => o?.cancelledAt).map(o => o.id.split('/').pop()))
      alvo = alvo.filter(p => !cancelados.has(p.numeroLoja))
    } catch { alvo = alvo.filter(p => !daShopify.includes(p)) }   // sem Shopify agora: tenta na próxima
  }
  const sit = await situacoes(tk)
  const feitos = []
  for (const p of alvo) {
    try {
      await bling(tk, `/pedidos/vendas/${p.id}/situacoes/${sit.atendido}`, { method: 'PATCH' })
      feitos.push(p.numero)
    } catch (e) { if (e instanceof ErroConexao) throw e }
  }
  return feitos
}

// Pedido da Shopify que ficou "Atendido" no Bling sem passar pela baixa (ex.: NF emitida direto no Bling, que
// fecha o pedido) e ainda não foi enviado na Shopify: marca faltaShopify, e a leitura deixa dar baixa (a baixa
// marca o envio na Shopify e não mexe no Bling, que já está Atendido).
async function marcarFaltaShopify(db, lista) {
  const daShopify = lista.filter(p => /^\d{10,}$/.test(p.numeroLoja || ''))
  if (!daShopify.length) return
  try {
    const { data } = await db.from('expedicao_envios').select('bling_id').eq('ok_shopify', true).in('bling_id', daShopify.map(p => p.id))
    const baixados = new Set((data || []).map(r => String(r.bling_id)))
    const candidatos = daShopify.filter(p => !baixados.has(String(p.id)))
    if (!candidatos.length) return
    const gql = await shopify()
    for (let i = 0; i < candidatos.length; i += 50) {
      const lote = candidatos.slice(i, i + 50)
      const d = await gql(`query Envio($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id closed cancelledAt displayFulfillmentStatus } } }`,
        { ids: lote.map(p => `gid://shopify/Order/${p.numeroLoja}`) })
      const falta = new Set((d?.nodes || []).filter(o => o && !o.closed && !o.cancelledAt &&
        ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'SCHEDULED', 'ON_HOLD'].includes(o.displayFulfillmentStatus)).map(o => o.id.split('/').pop()))
      for (const p of lote) if (falta.has(p.numeroLoja)) p.faltaShopify = true
    }
  } catch { /* sem Shopify agora: a leitura só avisa, como antes */ }
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
  // Lojas que não levam NF (combinado em 17/11/2026). Se alguém emitir uma à mão, a natureza ainda é conferida.
  if (/ATIVACAO/.test(L)) return { ...fixa(NAT.bonificacao, `${loja}: não leva NF`), semNF: true }
  if (/MARKETING|BONIFICACAO/.test(L)) return { ...fixa(NAT.bonificacao, `${loja}: não leva NF`), semNF: true }
  if (/REENVIO/.test(L)) return fixa(NAT.reposicao, 'Reenvio: reposição de mercadoria')
  if (/EXPERIENCE/.test(L)) return { ...fixa(NAT.presente, `${loja}: não leva NF`), semNF: true }
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
    naturezaId: n.naturezaOperacao?.id || null, natureza: nomesNat[n.naturezaOperacao?.id] || '',
    linkDanfe: n.linkDanfe || null, linkPDF: n.linkPDF || null }
}

const SITUACAO_NF = { 1: 'Pendente', 2: 'Cancelada', 3: 'Aguardando recibo', 4: 'Rejeitada', 5: 'Autorizada', 6: 'Emitida DANFE',
  7: 'Registrada', 8: 'Aguardando protocolo', 9: 'Denegada', 10: 'Consulta situação', 11: 'Bloqueada' }
const nomeSitPedido = (id, sit) => id === sit.aberto ? 'Em aberto' : id === sit.atendido ? 'Atendido' : String(id ?? '')

// Notas do dia (só leitura): para cada pedido, a natureza que a regra pede e a nota que já existe (se houver)
async function conferirNotas(tk, numeros) {
  const [nomesLoja, nomesNat, sit] = await Promise.all([lojas(tk), naturezas(tk), situacoes(tk)])
  const pedidos = []
  for (const n of numeros) {
    try { pedidos.push(await pedidoPorNumero(tk, n) || { numero: n, naoAchado: true }) }
    catch (e) { if (e instanceof ErroConexao) throw e; pedidos.push({ numero: n, erro: e.message }) }
  }
  let shp = {}
  try { shp = await shopifyDosPedidos(pedidos.map(d => String(d.numeroLoja || ''))) } catch { /* sem Shopify: regra fica manual */ }
  const saida = []
  for (const d of pedidos) {
    if (d.naoAchado || d.erro) { saida.push({ numero: String(d.numero), erro: d.erro || 'Pedido não encontrado no Bling.' }); continue }
    const loja = nomesLoja[d.loja?.id] || ''
    const numeroLoja = String(d.numeroLoja || '')
    const regra = regraNatureza(loja, numeroLoja, shp[numeroLoja] || null)
    let nota = null
    if (d.notaFiscal?.id) {
      try { nota = await lerNota(tk, d.notaFiscal.id, nomesNat) } catch (e) { if (e instanceof ErroConexao) throw e }
    }
    saida.push({
      pedido: { id: d.id, numero: String(d.numero), loja, cliente: d.contato?.nome || '', total: d.total, numeroLoja,
        situacao: nomeSitPedido(d.situacao?.id, sit), transportadora: d.transporte?.contato?.nome || '' },
      regra: { esperada: regra.esperada, motivo: regra.motivo, manual: regra.manual, semNF: !!regra.semNF },
      nota: nota && { ...nota, situacaoNome: SITUACAO_NF[nota.situacao] || String(nota.situacao) },
      confere: !!nota && !regra.manual && regra.aceita(nota.natureza),
    })
  }
  return saida
}

// Transmite à Sefaz a nota pendente (ou rejeitada) de UM pedido, só se a natureza conferir com a regra.
// A conferência é refeita aqui no servidor, na hora; o pedido continua na situação em que estava.
async function transmitirNF(tk, numero) {
  const d = await pedidoPorNumero(tk, numero)
  if (!d) throw new Error(`Pedido ${numero} não encontrado no Bling.`)
  if (!d.notaFiscal?.id) throw new Error(`Pedido ${numero} não tem nota. Gere o rascunho antes.`)
  const [nomesLoja, nomesNat, sit] = await Promise.all([lojas(tk), naturezas(tk), situacoes(tk)])
  const numeroLoja = String(d.numeroLoja || '')
  const shp = /^\d{10,}$/.test(numeroLoja) ? (await shopifyDosPedidos([numeroLoja]))[numeroLoja] || null : null
  const regra = regraNatureza(nomesLoja[d.loja?.id] || '', numeroLoja, shp)
  const antes = await lerNota(tk, d.notaFiscal.id, nomesNat)
  if (![1, 4].includes(antes.situacao)) throw new Error(`A nota ${antes.numero} está ${SITUACAO_NF[antes.situacao] || antes.situacao}: não há o que transmitir.`)
  if (regra.manual) throw new Error(`Pedido ${numero}: natureza é escolha manual (${regra.motivo}). Transmita pelo Bling.`)
  if (!regra.aceita(antes.natureza)) throw new Error(`Pedido ${numero}: a nota está com "${antes.natureza}", mas a regra pede ${regra.esperada || 'uma natureza de venda'}. Corrija no Bling.`)
  const sitAntes = d.situacao?.id
  await bling(tk, `/nfe/${antes.id}/enviar`, { method: 'POST' })
  const nota = await lerNota(tk, antes.id, nomesNat)
  // o pedido fica onde estava (a baixa da Expedição é que deixa Atendido)
  const sitDepois = (await bling(tk, `/pedidos/vendas/${d.id}`))?.data?.situacao?.id
  if (sitAntes === sit.aberto && sitDepois === sit.atendido)
    await bling(tk, `/pedidos/vendas/${d.id}/situacoes/${sit.aberto}`, { method: 'PATCH' })
  return { numero: String(d.numero), nota: { ...nota, situacaoNome: SITUACAO_NF[nota.situacao] || String(nota.situacao) } }
}

// Etiquetas de transporte (só leitura): o link do PDF que a logística do pedido já gerou no Bling.
// O Bling aceita um pedido por chamada. Não contrata frete nem gera etiqueta nova.
async function etiquetas(tk, ids, formato = 'PDF') {
  const saida = []
  for (const id of ids) {
    try {
      const q = new URLSearchParams({ formato }); q.append('idsVendas[]', id)
      const d = (await bling(tk, '/logisticas/etiquetas?' + q))?.data || []
      const e = d.find(x => String(x.id) === String(id)) || d[0]
      saida.push({ id, link: e?.link || null, observacao: e?.observacao || '' })
    } catch (e) {
      if (e instanceof ErroConexao) throw e
      saida.push({ id, link: null, erro: e.message })
    }
  }
  return saida
}

// Documentos de envio (só leitura), até 8 pedidos por chamada: o PDF da etiqueta que a logística já gerou
// (em base64: o S3 do Bling não deixa o navegador baixar direto) e os dados da DANFE simplificada, tirados
// do XML da nota autorizada. O PDF do dia é montado no navegador (src/lib/documentosEnvio.js).
const tag = (xml, nome) => (xml.match(new RegExp(`<${nome}[^>]*>([^<]*)</${nome}>`)) || [])[1] || ''
const bloco = (xml, nome) => (xml.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`)) || [])[1] || ''
function dadosDanfe(xml) {
  const ide = bloco(xml, 'ide'), emit = bloco(xml, 'emit'), dest = bloco(xml, 'dest'), prot = bloco(xml, 'infProt')
  return {
    chave: (xml.match(/Id="NFe(\d{44})"/) || [])[1] || tag(prot, 'chNFe'),
    tipo: tag(ide, 'tpNF'), numero: tag(ide, 'nNF'), serie: tag(ide, 'serie'), emissao: tag(ide, 'dhEmi'),
    protocolo: tag(prot, 'nProt'), autorizadaEm: tag(prot, 'dhRecbto'),
    emitente: { nome: tag(emit, 'xNome'), doc: tag(emit, 'CNPJ') || tag(emit, 'CPF'), ie: tag(emit, 'IE'), uf: tag(bloco(emit, 'enderEmit'), 'UF') },
    destinatario: { nome: tag(dest, 'xNome'), doc: tag(dest, 'CNPJ') || tag(dest, 'CPF'), ie: tag(dest, 'IE'), uf: tag(bloco(dest, 'enderDest'), 'UF') },
    valor: tag(bloco(xml, 'ICMSTot'), 'vNF'),
  }
}
async function baixar(url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`download ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}
async function documentosEnvio(tk, ids) {
  const saida = []
  for (const id of ids) {
    const item = { id, etiqueta: null, nota: null, danfe: null, avisos: [] }
    try {
      const d = (await bling(tk, `/pedidos/vendas/${id}`))?.data
      if (!d) throw new Error('Pedido não encontrado no Bling.')
      item.numero = String(d.numero)
      item.cliente = d.contato?.nome || ''
      item.transportadora = d.transporte?.contato?.nome || ''
      try {
        const q = new URLSearchParams({ formato: 'PDF' }); q.append('idsVendas[]', id)
        const e = ((await bling(tk, '/logisticas/etiquetas?' + q))?.data || [])[0]
        if (e?.link) item.etiqueta = (await baixar(e.link)).toString('base64')
        else item.avisos.push('Sem etiqueta no Bling.')
      } catch (e) {
        if (e instanceof ErroConexao) throw e
        item.avisos.push(/não foi encontrado/i.test(e.message) ? 'Sem etiqueta no Bling (Correios/Bling Envios: sai quando a NF é autorizada).' : 'Etiqueta: ' + e.message)
      }
      if (d.notaFiscal?.id) {
        const n = (await bling(tk, `/nfe/${d.notaFiscal.id}`))?.data || {}
        item.nota = { id: n.id, numero: n.numero, situacao: n.situacao }
        if ([5, 6, 7].includes(n.situacao) && n.xml) {
          try {
            const xml = /^https?:/i.test(n.xml) ? (await baixar(n.xml)).toString('utf8') : String(n.xml)
            item.danfe = dadosDanfe(xml)
            if (!item.danfe.chave || !item.danfe.protocolo) { item.danfe = null; item.avisos.push('XML da nota sem chave ou protocolo.') }
          } catch (e) { item.avisos.push('XML da nota: ' + e.message) }
        } else if (![5, 6, 7].includes(n.situacao)) item.avisos.push(`Nota ${n.numero} não autorizada (${SITUACAO_NF[n.situacao] || n.situacao}).`)
      }
    } catch (e) {
      if (e instanceof ErroConexao) throw e
      item.erro = e.message
    }
    saida.push(item)
  }
  return saida
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
  if (regra.semNF && !d.notaFiscal?.id) throw new Error(`Pedido ${numero}: ${regra.motivo}.`)
  if (regra.manual && !d.notaFiscal?.id) throw new Error(`Pedido ${numero}: natureza é escolha manual (${regra.motivo}). Emita pelo Bling.`)
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
    situacaoPedido: nomeSitPedido(situacao, sit),
    pedido: { id: d.id, numero: String(d.numero), loja, cliente: d.contato?.nome || '', total: d.total, numeroLoja, situacao: nomeSitPedido(situacao, sit) },
    shopify: shp, regra: { esperada: regra.esperada, motivo: regra.motivo, manual: regra.manual, semNF: !!regra.semNF },
    nota: { ...nota, situacaoNome: SITUACAO_NF[nota.situacao] || String(nota.situacao) }, gerada,
    confere: !regra.manual && regra.aceita(nota.natureza),
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
    if (p.lalamove) f.trackingInfo = { company: 'Lalamove', number: p.lalamove.order_id, url: p.lalamove.share_link }
    else if (p.rastreios.length > 1) f.trackingInfo = { company: empresa, numbers: p.rastreios }
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
    // Lalamove chamada pela Expedição: o link de acompanhamento vai como rastreio para a Shopify
    if (/lalamove/i.test(p.transportadora)) {
      const { data: c } = await ctx.db.from('lalamove_corridas').select('order_id, share_link, status')
        .contains('pedidos', [p.numero]).order('criado_em', { ascending: false }).limit(1)
      if (c?.[0]?.share_link && !/CANCEL|REJECT|EXPIRE/i.test(c[0].status || '')) {
        p.lalamove = c[0]
        reg.rastreio = c[0].share_link
      }
    }
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
    // Gerar e transmitir nota fiscal: só administradores
    const soAdmin = acao === 'rascunhoNF' || acao === 'transmitirNF'
    if (acao !== 'callback' && !(await exigirSessao(req, res, { admin: soAdmin }))) return

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
      if (req.query.lista === 'atendidos') {
        const pedidos = await listarPedidos(tk, true)
        await marcarFaltaShopify(db, pedidos)
        return res.status(200).json({ pedidos, lojas: {} })
      }
      let pedidos = await listarPedidos(tk)
      const recolocados = await recolocarAtendidos(tk, db, pedidos)
      if (recolocados.length) pedidos = pedidos.filter(p => !recolocados.includes(p.numero))
      return res.status(200).json({ pedidos, recolocados, lojas: await lojas(tk) })
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
    if (acao === 'etiquetas') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      if (!ids.length || ids.length > 10) return res.status(400).json({ erro: 'Envie de 1 a 10 pedidos.' })
      return res.status(200).json({ etiquetas: await etiquetas(tk, ids, req.body?.formato === 'ZPL' ? 'ZPL' : 'PDF') })
    }
    if (acao === 'documentos') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      if (!ids.length || ids.length > 8) return res.status(400).json({ erro: 'Envie de 1 a 8 pedidos.' })
      return res.status(200).json({ pedidos: await documentosEnvio(tk, ids) })
    }
    if (acao === 'notas') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      const numeros = [...new Set((req.body?.numeros || []).map(n => String(n).trim().replace(/^#/, '')).filter(n => /^\d+$/.test(n)))]
      if (!numeros.length || numeros.length > 10) return res.status(400).json({ erro: 'Envie de 1 a 10 números de pedido.' })
      return res.status(200).json({ pedidos: await conferirNotas(tk, numeros) })
    }
    if (acao === 'transmitirNF') {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
      const numero = String(req.body?.numero || '').trim().replace(/^#/, '')
      if (!/^\d+$/.test(numero)) return res.status(400).json({ erro: 'Informe o número do pedido.' })
      return res.status(200).json(await transmitirNF(tk, numero))
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
