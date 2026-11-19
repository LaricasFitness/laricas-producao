// Conexão com o Bling (API v3) usada pelas funções do Vercel (arquivo com "_" não vira rota).
// Tokens em integracao_tokens (RLS sem política: só a service_role lê). O refresh token vale 30 dias
// e se renova a cada uso. Limite do Bling: 3 requisições por segundo por conta.

import { createClient } from '@supabase/supabase-js'

export const BLING = 'https://api.bling.com.br/Api/v3'

const dormir = ms => new Promise(ok => setTimeout(ok, ms))

export class ErroConexao extends Error {}

export function banco() {
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

export async function pedirToken(params) {
  const r = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0', Authorization: basicBling(), 'enable-jwt': '1' },
    body: new URLSearchParams(params),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new ErroConexao(`O Bling recusou o acesso (${r.status}${j.error?.description ? ': ' + j.error.description : ''}).`)
  return j
}

export async function salvarTokens(db, j) {
  const { error } = await db.from('integracao_tokens').upsert({
    servico: 'bling', access_token: j.access_token, refresh_token: j.refresh_token,
    expira_em: new Date(Date.now() + (Number(j.expires_in) || 21600) * 1000 - 5 * 60000).toISOString(),
    atualizado_em: new Date().toISOString(),
  })
  if (error) throw new Error('Não consegui guardar o acesso do Bling: ' + error.message)
}

export async function tokenBling(db) {
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

// O Bling recusou por excesso de requisições mesmo depois de esperar
export class ErroLimite extends Error {}

// 429: espera cada vez mais (1,2 s, 2,5 s, 5 s) antes de desistir
const ESPERAS_429 = [1200, 2500, 5000]

export async function bling(tk, caminho, opc = {}) {
  for (let t = 0; t <= ESPERAS_429.length; t++) {
    await vez()
    const r = await fetch(BLING + caminho, {
      ...opc,
      headers: { Authorization: `Bearer ${tk}`, 'enable-jwt': '1', Accept: 'application/json', ...(opc.body ? { 'Content-Type': 'application/json' } : {}) },
    })
    if (r.status === 429) { if (t < ESPERAS_429.length) await dormir(ESPERAS_429[t]); continue }
    if (r.status === 401) throw new ErroConexao('O acesso ao Bling expirou. Conecte o Bling de novo.')
    if (r.status === 204) return null
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error('Bling: ' + (j.error?.fields?.[0]?.msg || j.error?.description || j.error?.message || `erro ${r.status}`))
    return j
  }
  throw new ErroLimite('Bling: limite de requisições. Tente de novo em instantes.')
}
