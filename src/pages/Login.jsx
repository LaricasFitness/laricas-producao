import { useState } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Eye, EyeOff } from 'lucide-react'

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [showSenha, setShowSenha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  async function entrar() {
    if (!email.trim() || !senha.trim()) { setErro('Preencha e-mail e senha.'); return }
    setLoading(true); setErro('')
    try {
      const hash = await sha256(senha)
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', email.trim().toLowerCase())
        .eq('senha_hash', hash)
        .eq('ativo', true)
        .single()

      if (error || !data) { setErro('E-mail ou senha incorretos.'); setLoading(false); return }

      // Atualiza último acesso
      await supabase.from('usuarios').update({ ultimo_acesso: new Date().toISOString() }).eq('id', data.id)

      // Salva sessão no sessionStorage
      sessionStorage.setItem('usuario', JSON.stringify(data))
      onLogin(data)
    } catch(e) {
      setErro('Erro ao conectar. Tente novamente.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--purple-dark) 0%, var(--purple) 100%)',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--white)', borderRadius: 16, padding: '40px 36px',
        width: '100%', maxWidth: 380,
        boxShadow: '0 20px 60px rgba(42,31,40,0.3)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, background: 'var(--purple-dark)', borderRadius: 14,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14,
          }}>
            <span style={{ color: 'var(--gold)', fontSize: 26, fontWeight: 900 }}>L</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--purple-dark)', lineHeight: 1.2 }}>
            Laricas Fitness
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 4 }}>
            Sistema de Produção
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">E-mail</label>
            <input
              className="form-input"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && entrar()}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Senha</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                type={showSenha ? 'text' : 'password'}
                placeholder="••••••••"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && entrar()}
                style={{ paddingRight: 40, width: '100%' }}
              />
              <button
                type="button"
                onClick={() => setShowSenha(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 4 }}
              >
                {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {erro && (
            <div className="alert-banner" style={{ background: 'var(--danger-pale)', color: 'var(--danger)', border: '1px solid #f5c6c3', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>
              {erro}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={entrar}
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '12px', marginTop: 4 }}
          >
            {loading ? <><RefreshCw size={15} className="spin" /> Entrando...</> : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
