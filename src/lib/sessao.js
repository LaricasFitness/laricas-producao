// Sessão do sistema: o login é conferido no servidor (/api/sessao), que grava um cookie HttpOnly.
// O sessionStorage 'usuario' guarda só os dados de exibição (nome, perfil, abas) — sem senha.
// Se qualquer chamada a /api responder "sessão expirada", o App volta para a tela de login.

const EVENTO = 'larc-sessao-expirada'

async function postar(corpo) {
  const r = await fetch('/api/sessao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  return { r, j }
}

// Rodando só com o Vite (sem as funções do Vercel) não há /api: entra pelo jeito antigo
async function entrarSemServidor(email, senha) {
  const { supabase } = await import('../supabase')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(senha))
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  const { data } = await supabase.from('usuarios').select('id, nome, email, perfil, abas_permitidas, ativo')
    .eq('email', email.trim().toLowerCase()).eq('senha_hash', hash).eq('ativo', true).maybeSingle()
  if (!data) throw new Error('E-mail ou senha incorretos.')
  return data
}

export async function entrar(email, senha) {
  const { r, j } = await postar({ acao: 'entrar', email, senha })
  if (r.status === 404 && import.meta.env.DEV) return entrarSemServidor(email, senha)
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
  return j.usuario
}

export async function sair() {
  try { await postar({ acao: 'sair' }) } catch { /* sem rede: o cookie some ao fechar o navegador */ }
}

// Confere o cookie ao abrir o sistema: devolve o usuário atualizado, null (sem sessão) ou undefined (sem servidor)
export async function conferirSessao() {
  try {
    const r = await fetch('/api/sessao', { cache: 'no-store' })
    if (r.status === 401) return null
    if (!r.ok) return undefined
    return (await r.json()).usuario || null
  } catch { return undefined }
}

// Chamadas do cadastro de usuários (só admin)
export async function adminUsuarios(corpo) {
  const { r, j } = await postar(corpo)
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
  return j
}

// Avisa o App quando alguma rota /api disser que a sessão expirou
export function vigiarSessao(aoExpirar) {
  const original = window.fetch
  if (!original.__larc) {
    const embrulho = async (...args) => {
      const r = await original(...args)
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
      if (r.status === 401 && r.headers.get('X-Sessao') === 'expirada' && /^\/api\/|\/\/[^/]+\/api\//.test(url) && !/\/api\/sessao/.test(url))
        window.dispatchEvent(new Event(EVENTO))
      return r
    }
    embrulho.__larc = true
    window.fetch = embrulho
  }
  window.addEventListener(EVENTO, aoExpirar)
  return () => window.removeEventListener(EVENTO, aoExpirar)
}
