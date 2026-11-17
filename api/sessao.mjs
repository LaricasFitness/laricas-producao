// Vercel Function — login do sistema e cadastro de usuários (a tabela usuarios fica fechada ao navegador)
//
// GET                                  usuário da sessão atual (401 se não houver)
// POST {acao:'entrar', email, senha}   confere a senha e grava o cookie de sessão
// POST {acao:'sair'}                   apaga o cookie
// Só admin:
// POST {acao:'listar'}                 usuários (sem senha)
// POST {acao:'salvar', usuario}        cria/edita { id?, nome, email, perfil, abas_permitidas, ativo, senha? }
// POST {acao:'senha', id, senha}       redefine a senha

import { bancoServico, exigirSessao, usuarioDaSessao, gravarSessao, apagarSessao, conferirLogin, publico, sha256 } from './_sessao.mjs'

const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]
const dormir = ms => new Promise(ok => setTimeout(ok, ms))
const LISTA = 'id, nome, email, perfil, abas_permitidas, ativo, criado_em, ultimo_acesso'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.method === 'GET') {
      const u = await usuarioDaSessao(req)
      if (!u) { res.setHeader('X-Sessao', 'expirada'); return res.status(401).json({ erro: 'Sem sessão.', login: true }) }
      return res.status(200).json({ usuario: u })
    }
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })
    const origem = req.headers.origin || ''
    if (!ORIGENS.some(r => r.test(origem))) return res.status(403).json({ erro: 'Origem não autorizada' })

    const b = req.body || {}
    const db = bancoServico()

    if (b.acao === 'entrar') {
      const u = await conferirLogin(db, b.email, b.senha)
      if (!u) { await dormir(800); return res.status(401).json({ erro: 'E-mail ou senha incorretos.' }) }
      const agora = new Date().toISOString()
      await db.from('usuarios').update({ ultimo_acesso: agora }).eq('id', u.id)
      gravarSessao(res, u)
      return res.status(200).json({ usuario: publico({ ...u, ultimo_acesso: agora }) })
    }
    if (b.acao === 'sair') { apagarSessao(res); return res.status(200).json({ ok: true }) }

    const admin = await exigirSessao(req, res, { admin: true })
    if (!admin) return

    if (b.acao === 'listar') {
      const { data, error } = await db.from('usuarios').select(LISTA).order('nome')
      if (error) throw error
      return res.status(200).json({ usuarios: data || [] })
    }
    if (b.acao === 'salvar') {
      const u = b.usuario || {}
      const nome = String(u.nome || '').trim(), email = String(u.email || '').trim().toLowerCase()
      if (!nome || !email) return res.status(400).json({ erro: 'Nome e e-mail obrigatórios.' })
      if (!u.id && !u.senha) return res.status(400).json({ erro: 'Informe uma senha para o novo usuário.' })
      if (u.senha && String(u.senha).length < 6) return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres.' })
      if (u.id === admin.id && (u.ativo === false || u.perfil !== 'admin'))
        return res.status(400).json({ erro: 'Você não pode tirar o seu próprio acesso de admin.' })
      const payload = {
        nome, email, perfil: String(u.perfil || 'operador').trim(),
        abas_permitidas: Array.isArray(u.abas_permitidas) ? u.abas_permitidas.map(String) : [],
        ativo: u.ativo !== false,
      }
      if (u.senha) payload.senha_hash = sha256(u.senha)
      const { error } = u.id
        ? await db.from('usuarios').update(payload).eq('id', u.id)
        : await db.from('usuarios').insert(payload)
      if (error) return res.status(400).json({ erro: /duplicate/i.test(error.message) ? 'Este e-mail já está cadastrado.' : error.message })
      if (u.id === admin.id && payload.senha_hash) gravarSessao(res, { id: admin.id, senha_hash: payload.senha_hash })
      return res.status(200).json({ ok: true })
    }
    if (b.acao === 'senha') {
      if (!b.id || String(b.senha || '').length < 6) return res.status(400).json({ erro: 'Mínimo 6 caracteres.' })
      const { error } = await db.from('usuarios').update({ senha_hash: sha256(b.senha) }).eq('id', b.id)
      if (error) throw error
      // quem trocou a própria senha continua logado
      if (b.id === admin.id) gravarSessao(res, { id: admin.id, senha_hash: sha256(b.senha) })
      return res.status(200).json({ ok: true })
    }
    return res.status(400).json({ erro: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ erro: e.message || String(e) })
  }
}
