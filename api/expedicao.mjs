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
// GET  ?acao=pedidos&lista=atendidos   pedidos "Atendido" dos últimos dias (B2B, venda direta etc. ficam
//                        Atendido ao emitir a nota: a tela só avisa que não precisam de baixa)
// POST {acao:'detalhes', ids}   rastreio, CEP, transportadora e NF de até 30 pedidos
// POST {acao:'baixar', ids, notificar, operador}   baixa de até 8 pedidos

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

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

    // Daqui para baixo, só o próprio sistema
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
    if (acao === 'pedidos') return res.status(200).json({ pedidos: await listarPedidos(tk, req.query.lista === 'atendidos') })

    const ids = [...new Set((req.body?.ids || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))]
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
