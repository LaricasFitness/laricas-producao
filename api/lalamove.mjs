// Vercel Function — Lalamove: chamar a corrida de uma rota do planejamento direto da Expedição (baixa).
//
// Variáveis de ambiente (Vercel › Settings › Environment Variables), geradas no Partner Portal da Lalamove
// (partnerportal.lalamove.com, mercado Brazil › API KEYS):
//   LALAMOVE_API_KEY, LALAMOVE_API_SECRET
//   LALAMOVE_AMBIENTE   'sandbox' (teste, não cobra) ou 'producao'
//   SUPABASE_SERVICE_ROLE_KEY   grava as corridas em lalamove_corridas (lalamove_corridas.sql)
//
// POST {acao:'status'}                         Lalamove configurada? ambiente
// POST {acao:'corridas', pedidos}              corridas dos últimos 3 dias com algum desses pedidos
// POST {acao:'cotar', rota, paradas}           cotação em moto, paradas na ordem da rota (não cobra nada)
// POST {acao:'pedir', cotacao, rota, paradas}  cria a corrida (COBRA na conta da Lalamove em produção)
//
// paradas: [{ numero, nome, tel, rua, numero_end, complemento, bairro, cidade, uf, cep }] (da rota salva em
// logistica_historico). A Lalamove exige latitude/longitude: o endereço é convertido pelo OpenStreetMap.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { exigirSessao } from './_sessao.mjs'

export const config = { maxDuration: 60 }

const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]
const PICKUP = { nome: 'Fabio Gabriel', tel: '11934157853', rua: 'Rua Pedroso', numero_end: '258', complemento: 'BOX 8',
  bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', cep: '01322010', obs: 'LARICAS FITNESS' }
const dormir = ms => new Promise(ok => setTimeout(ok, ms))

function banco() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel.')
  return createClient(url, chave, { auth: { persistSession: false } })
}

const ambiente = () => (process.env.LALAMOVE_AMBIENTE || 'sandbox').toLowerCase().startsWith('prod') ? 'producao' : 'sandbox'
const base = () => ambiente() === 'producao' ? 'https://rest.lalamove.com' : 'https://rest.sandbox.lalamove.com'
const configurada = () => !!(process.env.LALAMOVE_API_KEY && process.env.LALAMOVE_API_SECRET)

// Assinatura HMAC da API v3: "{tempo}\r\n{MÉTODO}\r\n{caminho}\r\n\r\n{corpo}"
async function lalamove(metodo, caminho, dados) {
  if (!configurada()) throw new Error('Lalamove não configurada no Vercel (LALAMOVE_API_KEY e LALAMOVE_API_SECRET).')
  const corpo = dados ? JSON.stringify({ data: dados }) : ''
  const tempo = Date.now().toString()
  const assinatura = crypto.createHmac('sha256', process.env.LALAMOVE_API_SECRET)
    .update(`${tempo}\r\n${metodo}\r\n${caminho}\r\n\r\n${corpo}`).digest('hex')
  for (let t = 0; t < 3; t++) {
    const r = await fetch(base() + caminho, {
      method: metodo,
      headers: {
        Authorization: `hmac ${process.env.LALAMOVE_API_KEY}:${tempo}:${assinatura}`,
        Market: 'BR', 'Request-ID': crypto.randomUUID(), 'Content-Type': 'application/json', Accept: 'application/json',
      },
      ...(corpo ? { body: corpo } : {}),
    })
    if (r.status === 429) { await dormir(1500); continue }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const e = (j.errors || [])[0] || {}
      throw new Error(`Lalamove (${r.status}): ${e.message || e.id || j.message || 'erro'}${e.detail ? ' · ' + e.detail : ''}`)
    }
    return j.data ?? j
  }
  throw new Error('Lalamove: limite de requisições. Tente de novo em instantes.')
}

// Serviço de moto da cidade (a chave varia por mercado: pega a que a Lalamove lista para São Paulo)
let SERVICO = null
async function servicoMoto() {
  if (SERVICO) return SERVICO
  const cidades = await lalamove('GET', '/v3/cities')
  const lista = Array.isArray(cidades) ? cidades : []
  const sp = lista.find(c => /SAO|SÃO|SP/i.test(`${c.locode} ${c.name}`)) || lista[0]
  const servs = sp?.services || []
  const moto = servs.find(s => /MOTORCYCLE/i.test(s.key)) || servs.find(s => /MOTO|LALAGO|BIKE/i.test(`${s.key} ${s.description || ''}`))
  SERVICO = moto?.key || 'MOTORCYCLE'
  return SERVICO
}

// ── Endereço → coordenadas (OpenStreetMap/Nominatim: 1 consulta por segundo) ──
const CACHE_GEO = new Map()
let ultimaGeo = 0
async function nominatim(params) {
  const espera = 1100 - (Date.now() - ultimaGeo)
  if (espera > 0) await dormir(espera)
  ultimaGeo = Date.now()
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'json', countrycodes: 'br', limit: '1', ...params }),
    { headers: { 'User-Agent': 'larc-expedicao/1.0', 'Accept-Language': 'pt-BR' } })
  if (!r.ok) return null
  const [a] = await r.json().catch(() => [])
  return a ? { lat: String(a.lat), lng: String(a.lon) } : null
}
const soDigitos = v => String(v || '').replace(/\D/g, '')
const enderecoTexto = p => [`${p.rua || ''}, ${p.numero_end || ''}`, p.complemento, p.bairro, `${p.cidade || ''}/${p.uf || ''}`, soDigitos(p.cep)]
  .filter(s => s && s.trim() && s.trim() !== ',').join(' - ')
async function geocodificar(p) {
  const chave = `${p.rua}|${p.numero_end}|${p.cidade}|${soDigitos(p.cep)}`.toLowerCase()
  if (CACHE_GEO.has(chave)) return CACHE_GEO.get(chave)
  const cep = soDigitos(p.cep)
  let c = await nominatim({ street: `${p.numero_end || ''} ${p.rua || ''}`.trim(), city: p.cidade || '', state: p.uf || '', country: 'Brasil' })
  let precisao = 'endereço'
  if (!c && cep.length === 8) { c = await nominatim({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}`, country: 'Brasil' }); precisao = 'CEP' }
  if (!c) { c = await nominatim({ q: `${p.rua || ''} ${p.numero_end || ''}, ${p.bairro || ''}, ${p.cidade || ''}, ${p.uf || ''}` }); precisao = 'aproximado' }
  const out = c ? { ...c, precisao } : null
  CACHE_GEO.set(chave, out)
  return out
}

// Telefone no formato da Lalamove: +55DDDNÚMERO
function telefone(t) {
  let d = soDigitos(t)
  if (!d) return ''
  if (!d.startsWith('55') || d.length <= 11) d = '55' + d.replace(/^0+/, '')
  return '+' + d
}

function validarParadas(paradas) {
  if (!Array.isArray(paradas) || !paradas.length) throw new Error('A rota não tem paradas.')
  if (paradas.length > 15) throw new Error('Máximo de 15 paradas por corrida.')
  for (const p of paradas) {
    if (!/^\d+$/.test(String(p.numero || ''))) throw new Error('Parada sem número de pedido.')
    if (!p.rua || !p.cidade) throw new Error(`Pedido ${p.numero}: endereço incompleto na rota.`)
    if (!telefone(p.tel)) throw new Error(`Pedido ${p.numero}: sem telefone do destinatário (a Lalamove exige).`)
  }
}

async function cotar(paradas) {
  validarParadas(paradas)
  const todos = [PICKUP, ...paradas]
  const geo = []
  for (const p of todos) {
    const g = await geocodificar(p)
    if (!g) throw new Error(p === PICKUP ? 'Não achei a coordenada do endereço de coleta.' : `Pedido ${p.numero}: não achei o endereço no mapa (${enderecoTexto(p)}).`)
    geo.push(g)
  }
  const servico = await servicoMoto()
  const q = await lalamove('POST', '/v3/quotations', {
    serviceType: servico, language: 'pt_BR', isRouteOptimized: false, specialRequests: [],
    stops: todos.map((p, i) => ({ coordinates: { lat: geo[i].lat, lng: geo[i].lng }, address: enderecoTexto(p) })),
  })
  return {
    cotacao: q.quotationId, expiraEm: q.expiresAt, servico,
    preco: Number(q.priceBreakdown?.total ?? 0), moeda: q.priceBreakdown?.currency || 'BRL',
    distancia: Number(q.distance?.value ?? 0), unidade: q.distance?.unit || 'm',
    stops: (q.stops || []).map(s => s.stopId),
    precisao: paradas.map((p, i) => ({ numero: String(p.numero), precisao: geo[i + 1].precisao })),
    ambiente: ambiente(),
  }
}

async function pedir(db, { cotacao, stops, rota, paradas }, usuario) {
  validarParadas(paradas)
  if (!cotacao || !Array.isArray(stops) || stops.length !== paradas.length + 1) throw new Error('Cotação inválida. Cote de novo.')
  // Não chamar duas vezes a mesma entrega
  const numeros = paradas.map(p => String(p.numero))
  const { data: ja } = await db.from('lalamove_corridas').select('order_id, pedidos, status')
    .overlaps('pedidos', numeros).gte('criado_em', new Date(Date.now() - 3 * 864e5).toISOString())
  const ativa = (ja || []).find(c => c.order_id && !/CANCEL|REJECT|EXPIRE/i.test(c.status || ''))
  if (ativa) throw new Error(`Já existe corrida (${ativa.order_id}) para os pedidos ${ativa.pedidos.filter(n => numeros.includes(n)).join(', ')}.`)

  const o = await lalamove('POST', '/v3/orders', {
    quotationId: cotacao,
    sender: { stopId: stops[0], name: PICKUP.nome, phone: telefone(PICKUP.tel) },
    recipients: paradas.map((p, i) => ({ stopId: stops[i + 1], name: String(p.nome || '').slice(0, 60) || `Pedido ${p.numero}`,
      phone: telefone(p.tel), remarks: `Pedido ${p.numero} · ${PICKUP.obs}` })),
    isPODEnabled: false,
    metadata: { rota: String(rota?.code || ''), pedidos: numeros.join(',') },
  })
  const linha = {
    ambiente: ambiente(), rota_code: rota?.code || null, rota_label: rota?.label || null,
    historico_id: /^[0-9a-f-]{36}$/i.test(rota?.historicoId || '') ? rota.historicoId : null,
    pedidos: numeros, quotation_id: cotacao, order_id: o.orderId, share_link: o.shareLink || null, status: o.status || null,
    preco: Number(o.priceBreakdown?.total ?? 0) || null, moeda: o.priceBreakdown?.currency || null,
    distancia_m: Number(o.distance?.value ?? 0) || null, criado_por: usuario?.nome || null,
  }
  const { error } = await db.from('lalamove_corridas').insert(linha)
  return { ...linha, aviso: error ? `A corrida foi criada, mas não consegui guardar no sistema: ${error.message}` : '' }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const usuario = await exigirSessao(req, res)
    if (!usuario) return
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
    if (!ORIGENS.some(r => r.test(req.headers.origin || ''))) return res.status(403).json({ erro: 'Origem não autorizada' })
    const b = req.body || {}

    if (b.acao === 'status') return res.status(200).json({ configurada: configurada(), ambiente: ambiente() })
    const db = banco()
    if (b.acao === 'corridas') {
      const numeros = [...new Set((b.pedidos || []).map(String).filter(n => /^\d+$/.test(n)))].slice(0, 200)
      if (!numeros.length) return res.status(200).json({ corridas: [] })
      const { data, error } = await db.from('lalamove_corridas').select('*').overlaps('pedidos', numeros)
        .gte('criado_em', new Date(Date.now() - 3 * 864e5).toISOString()).order('criado_em', { ascending: false })
      if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Aplique o lalamove_corridas.sql no Supabase.' : error.message)
      return res.status(200).json({ corridas: data || [] })
    }
    if (b.acao === 'cotar') return res.status(200).json(await cotar(b.paradas))
    if (b.acao === 'pedir') return res.status(200).json(await pedir(db, b, usuario))
    return res.status(400).json({ erro: 'Ação inválida' })
  } catch (e) {
    return res.status(502).json({ erro: e.message || String(e) })
  }
}
