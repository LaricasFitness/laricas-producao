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
// POST {acao:'verificar', paradas}             confere cada parada: telefone, localização exata, endereço comercial
// POST {acao:'cotar', rota, paradas}           cotação em moto, paradas na ordem da rota (não cobra nada); se alguma
//                                              parada não tem localização exata, volta { problemas } sem cotar
// POST {acao:'servicos'}                       serviços da Lalamove por cidade (conferir qual é a moto)
// POST {acao:'adiar', numero, cliente, motivo, rota}   deixa o pedido para amanhã (lembrete de manhã na Expedição)
// POST {acao:'lembretes'}                      pedidos adiados para hoje (ou antes) ainda não resolvidos
// POST {acao:'resolver', numero}               tira o lembrete
// POST {acao:'pedir', cotacao, rota, paradas}  cria a corrida (COBRA na conta da Lalamove em produção)
//
// paradas: [{ numero, nome, tel, rua, numero_end, complemento, bairro, cidade, uf, cep }] (da rota salva em
// logistica_historico). A Lalamove exige latitude/longitude: só vale o ponto exato do número (Google, se houver
// GOOGLE_MAPS_API_KEY no Vercel; senão OpenStreetMap). Sem localização exata, a parada fica bloqueada.

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
  const nome = c => String(c.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  const sp = lista.find(c => nome(c).includes('SAO PAULO')) || lista.find(c => /SAO|SP/i.test(c.locode || '')) || lista[0]
  const servs = sp?.services || []
  const moto = servs.find(s => /MOTORCYCLE/i.test(s.key)) || servs.find(s => /MOTO|LALAGO|BIKE/i.test(`${s.key} ${s.description || ''}`))
  SERVICO = moto?.key || 'MOTORCYCLE'
  return SERVICO
}

// ── Endereço → coordenadas EXATAS (entrega na casa do cliente: nada de localização aproximada) ──
// Vale só o ponto do número da rua. Com GOOGLE_MAPS_API_KEY no Vercel, usa o Google (mais completo em SP);
// senão, o OpenStreetMap (Nominatim, 1 consulta por segundo). Sem o número exato, a parada fica bloqueada.
const CACHE_GEO = new Map()
let ultimaGeo = 0
const soDigitos = v => String(v || '').replace(/\D/g, '')
const numeroRua = p => (String(p.numero_end || '').match(/^\s*(\d+)/) || [])[1] || ''
const enderecoTexto = p => [`${p.rua || ''}, ${p.numero_end || ''}`, p.complemento, p.bairro, `${p.cidade || ''}/${p.uf || ''}`, soDigitos(p.cep)]
  .filter(s => s && s.trim() && s.trim() !== ',').join(' - ')

async function porGoogle(p, num) {
  const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?' + new URLSearchParams({
    address: `${p.rua}, ${num} - ${p.bairro || ''}, ${p.cidade} - ${p.uf}, ${soDigitos(p.cep)}`, region: 'br', language: 'pt-BR',
    key: process.env.GOOGLE_MAPS_API_KEY }))
  const j = await r.json().catch(() => ({}))
  const a = (j.results || [])[0]
  if (!a) return null
  const nr = a.address_components?.find(c => c.types.includes('street_number'))?.long_name
  if (!['ROOFTOP', 'RANGE_INTERPOLATED'].includes(a.geometry?.location_type) || soDigitos(nr) !== num) return null
  return { lat: String(a.geometry.location.lat), lng: String(a.geometry.location.lng), fonte: 'Google' }
}
async function porNominatim(p, num) {
  const espera = 1100 - (Date.now() - ultimaGeo)
  if (espera > 0) await dormir(espera)
  ultimaGeo = Date.now()
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'json', countrycodes: 'br', limit: '3',
    addressdetails: '1', street: `${num} ${p.rua}`, city: p.cidade || '', state: p.uf || '', country: 'Brasil' }),
    { headers: { 'User-Agent': 'larc-expedicao/1.0', 'Accept-Language': 'pt-BR' } })
  if (!r.ok) return null
  const lista = await r.json().catch(() => [])
  const a = lista.find(x => soDigitos(x.address?.house_number) === num)
  return a ? { lat: String(a.lat), lng: String(a.lon), fonte: 'OpenStreetMap' } : null
}
// → { lat, lng, fonte } ou { problema }
async function geocodificar(p) {
  const num = numeroRua(p)
  if (!p.rua || !p.cidade) return { problema: 'endereço incompleto (sem rua ou cidade)' }
  if (!num) return { problema: `sem o número do prédio/casa (veio "${p.numero_end || ''}")` }
  const chave = `${p.rua}|${num}|${p.cidade}`.toLowerCase()
  if (CACHE_GEO.has(chave)) return CACHE_GEO.get(chave)
  let c = null
  if (process.env.GOOGLE_MAPS_API_KEY) c = await porGoogle(p, num).catch(() => null)
  if (!c) c = await porNominatim(p, num).catch(() => null)
  const out = c || { problema: `não achei "${p.rua}, ${num}" no mapa com o número exato` }
  CACHE_GEO.set(chave, out)
  return out
}

// Telefone no formato da Lalamove: +55DDDNÚMERO
function telefone(t) {
  let d = soDigitos(t)
  if (!d) return ''
  if (!d.startsWith('55') || d.length <= 11) d = '55' + d.replace(/^0+/, '')
  return d.length >= 12 ? '+' + d : ''
}

// Endereço comercial (entrega em escritório pode não ter quem receba): sala, conjunto, andar, loja, CNPJ...
const COMERCIAL = /\b(sala|sl|salas|cj|cjto|conj|conjunto|andar|escrit[oó]rio|loja|lj|comercial|empresarial|corporate|coworking|recep[cç][aã]o|portaria comercial)\b|\d+\s*[ºo°]\s*andar/i
function comercial(p) {
  const texto = `${p.complemento || ''} ${p.numero_end || ''} ${p.rua || ''}`
  const m = texto.match(COMERCIAL)
  if (m) return `endereço comercial (${(p.complemento || m[0]).trim()})`
  if (soDigitos(p.cpfCnpj).length === 14 || /\b(ltda|eireli|s\/?a|me|epp)\b\.?$/i.test(String(p.nome || '').trim())) return 'destinatário é empresa'
  return null
}

// Confere cada parada antes de cotar: { numero, problema?, comercial?, lat, lng }
async function verificar(paradas) {
  if (!Array.isArray(paradas) || !paradas.length) throw new Error('A rota não tem paradas.')
  if (paradas.length > 15) throw new Error('Máximo de 15 paradas por corrida.')
  const saida = []
  for (const p of paradas) {
    const item = { numero: String(p.numero || ''), comercial: comercial(p) }
    if (!/^\d+$/.test(item.numero)) { saida.push({ ...item, problema: 'parada sem número de pedido' }); continue }
    if (!telefone(p.tel)) { saida.push({ ...item, problema: 'sem telefone do destinatário (a Lalamove exige)' }); continue }
    const g = await geocodificar(p)
    saida.push(g.problema ? { ...item, problema: g.problema } : { ...item, lat: g.lat, lng: g.lng, fonte: g.fonte })
  }
  return saida
}

async function cotar(paradas) {
  const v = await verificar(paradas)
  const problemas = v.filter(x => x.problema)
  if (problemas.length) return { problemas }
  const coleta = await geocodificar(PICKUP)
  if (coleta.problema) throw new Error('Não achei a coordenada do endereço de coleta: ' + coleta.problema)
  const servico = await servicoMoto()
  const todos = [{ ...PICKUP, ...coleta }, ...paradas.map((p, i) => ({ ...p, lat: v[i].lat, lng: v[i].lng }))]
  const q = await lalamove('POST', '/v3/quotations', {
    serviceType: servico, language: 'pt_BR', isRouteOptimized: false, specialRequests: [],
    stops: todos.map(p => ({ coordinates: { lat: p.lat, lng: p.lng }, address: enderecoTexto(p) })),
  })
  return {
    cotacao: q.quotationId, expiraEm: q.expiresAt, servico,
    preco: Number(q.priceBreakdown?.total ?? 0), moeda: q.priceBreakdown?.currency || 'BRL',
    distancia: Number(q.distance?.value ?? 0), unidade: q.distance?.unit || 'm',
    stops: (q.stops || []).map(s => s.stopId), ambiente: ambiente(),
  }
}

// Serviços da Lalamove em São Paulo (para conferir qual é a moto)
async function servicos() {
  const cidades = await lalamove('GET', '/v3/cities')
  return (Array.isArray(cidades) ? cidades : []).map(c => ({ cidade: c.name, locode: c.locode,
    servicos: (c.services || []).map(s => ({ chave: s.key, descricao: s.description, carga: s.load, dimensoes: s.dimensions })) }))
}

// ── Pedidos deixados para o dia seguinte (expedicao_adiamentos) ──
const hojeSP = (dias = 0) => new Date(Date.now() + dias * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
async function adiar(db, b, usuario) {
  const numero = String(b.numero || '')
  if (!/^\d+$/.test(numero)) throw new Error('Informe o número do pedido.')
  await db.from('expedicao_adiamentos').update({ resolvido_em: new Date().toISOString(), resolvido_por: 'substituído' })
    .eq('pedido', numero).is('resolvido_em', null)
  const { error } = await db.from('expedicao_adiamentos').insert({
    pedido: numero, cliente: String(b.cliente || '').slice(0, 120) || null, motivo: String(b.motivo || '').slice(0, 200) || null,
    rota: String(b.rota || '').slice(0, 60) || null, lembrar_em: hojeSP(1), criado_por: usuario?.nome || null })
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Aplique o expedicao_adiamentos.sql no Supabase.' : error.message)
  return { ok: true, lembrarEm: hojeSP(1) }
}
async function lembretes(db) {
  const { data, error } = await db.from('expedicao_adiamentos').select('*').is('resolvido_em', null).lte('lembrar_em', hojeSP())
    .order('lembrar_em')
  if (error) return []
  return data || []
}
async function resolver(db, pedidos, quem) {
  if (!pedidos.length) return
  await db.from('expedicao_adiamentos').update({ resolvido_em: new Date().toISOString(), resolvido_por: quem || null })
    .in('pedido', pedidos).is('resolvido_em', null)
}

async function pedir(db, { cotacao, stops, rota, paradas }, usuario) {
  if (!Array.isArray(paradas) || !paradas.length || paradas.some(p => !/^d+$/.test(String(p.numero || '')) || !telefone(p.tel)))
    throw new Error('Paradas inválidas. Cote de novo.')
  if (!cotacao || !Array.isArray(stops) || stops.length !== paradas.length + 1) throw new Error('Cotação inválida. Cote de novo.')
  // Não chamar duas vezes a mesma entrega
  const numeros = paradas.map(p => String(p.numero))
  const { data: ja } = await db.from('lalamove_corridas').select('order_id, pedidos, status')
    .overlaps('pedidos', numeros).eq('ambiente', ambiente()).gte('criado_em', new Date(Date.now() - 3 * 864e5).toISOString())
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
  await resolver(db, numeros, 'corrida Lalamove ' + o.orderId).catch(() => {})
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
      const { data, error } = await db.from('lalamove_corridas').select('*').overlaps('pedidos', numeros).eq('ambiente', ambiente())
        .gte('criado_em', new Date(Date.now() - 3 * 864e5).toISOString()).order('criado_em', { ascending: false })
      if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Aplique o lalamove_corridas.sql no Supabase.' : error.message)
      return res.status(200).json({ corridas: data || [] })
    }
    if (b.acao === 'verificar') return res.status(200).json({ paradas: await verificar(b.paradas) })
    if (b.acao === 'cotar') return res.status(200).json(await cotar(b.paradas))
    if (b.acao === 'servicos') return res.status(200).json({ cidades: await servicos() })
    if (b.acao === 'adiar') return res.status(200).json(await adiar(db, b, usuario))
    if (b.acao === 'lembretes') return res.status(200).json({ lembretes: await lembretes(db) })
    if (b.acao === 'resolver') {
      await resolver(db, [String(b.numero || '')].filter(n => /^d+$/.test(n)), usuario?.nome)
      return res.status(200).json({ ok: true })
    }
    if (b.acao === 'pedir') return res.status(200).json(await pedir(db, b, usuario))
    return res.status(400).json({ erro: 'Ação inválida' })
  } catch (e) {
    return res.status(502).json({ erro: e.message || String(e) })
  }
}
