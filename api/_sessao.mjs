// Sessão do sistema nas funções do Vercel (arquivo com "_" não vira rota).
// O login é conferido aqui no servidor (tabela usuarios, fechada ao navegador) e vira um cookie
// HttpOnly assinado com HMAC. Toda rota em /api chama exigirSessao() antes de fazer qualquer coisa.
// A chave da assinatura deriva da SUPABASE_SERVICE_ROLE_KEY (já configurada no Vercel): não há
// segredo novo para cadastrar. Trocar a senha ou desativar o usuário derruba as sessões dele.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const COOKIE = 'larc_sessao'
const DURACAO = 7 * 864e5      // a sessão vale 7 dias (e some quando o navegador fecha)
const CAMPOS = 'id, nome, email, perfil, abas_permitidas, ativo, ultimo_acesso, senha_hash'

export function bancoServico() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel.')
  return createClient(url, chave, { auth: { persistSession: false } })
}

const chave = () => crypto.createHash('sha256').update('larc-sessao:' + (process.env.SUPABASE_SERVICE_ROLE_KEY || '')).digest()
const b64 = b => Buffer.from(b).toString('base64url')
const assinar = txt => crypto.createHmac('sha256', chave()).update(txt).digest('base64url')
export const sha256 = txt => crypto.createHash('sha256').update(String(txt)).digest('hex')
// "versão" da senha dentro do token: trocar a senha invalida as sessões antigas
const versao = hash => sha256('v:' + (hash || '')).slice(0, 12)

export function publico(u) {
  if (!u) return null
  const { senha_hash, ...resto } = u
  return resto
}

function lerCookie(req) {
  return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || ''
}

function token(u) {
  const corpo = b64(JSON.stringify({ id: u.id, v: versao(u.senha_hash), exp: Date.now() + DURACAO }))
  return `${corpo}.${assinar(corpo)}`
}

export function gravarSessao(res, u) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token(u)}; Path=/api; HttpOnly; Secure; SameSite=Lax`)
}
export function apagarSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
}

// Usuário da sessão (sem a senha) ou null
export async function usuarioDaSessao(req, db) {
  const t = lerCookie(req)
  const [corpo, ass] = t.split('.')
  if (!corpo || !ass) return null
  const esperado = assinar(corpo)
  if (ass.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(ass), Buffer.from(esperado))) return null
  let d
  try { d = JSON.parse(Buffer.from(corpo, 'base64url').toString()) } catch { return null }
  if (!d?.id || !(d.exp > Date.now())) return null
  const { data: u } = await (db || bancoServico()).from('usuarios').select(CAMPOS).eq('id', d.id).maybeSingle()
  if (!u || !u.ativo || versao(u.senha_hash) !== d.v) return null
  return publico(u)
}

// Guarda das rotas: devolve o usuário ou responde 401 (o navegador volta para a tela de login)
export async function exigirSessao(req, res, { admin = false } = {}) {
  let u = null
  try { u = await usuarioDaSessao(req) } catch (e) { res.status(500).json({ erro: e.message }); return null }
  if (!u) {
    res.setHeader('X-Sessao', 'expirada')
    res.status(401).json({ erro: 'Sua sessão expirou. Entre de novo no sistema.', login: true })
    return null
  }
  if (admin && u.perfil !== 'admin') { res.status(403).json({ erro: 'Só administradores.' }); return null }
  return u
}

export async function conferirLogin(db, email, senha) {
  const { data: u } = await db.from('usuarios').select(CAMPOS)
    .eq('email', String(email || '').trim().toLowerCase()).eq('ativo', true).maybeSingle()
  const hash = sha256(senha || '')
  if (!u?.senha_hash || u.senha_hash.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(u.senha_hash), Buffer.from(hash))) return null
  return u
}
