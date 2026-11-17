import { useState } from 'react'
import { entrar as entrarNoServidor } from '../lib/sessao'
import { RefreshCw, Eye, EyeOff } from 'lucide-react'

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
      // A senha é conferida no servidor, que devolve o usuário (sem senha) e grava o cookie de sessão
      const data = await entrarNoServidor(email.trim(), senha)
      sessionStorage.setItem('usuario', JSON.stringify(data))
      onLogin(data)
    } catch(e) {
      setErro(/incorret/i.test(e.message) ? 'E-mail ou senha incorretos.' : (e.message || 'Erro ao conectar. Tente novamente.'))
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--purple-dark)',
      padding: 20, overflowY: 'auto',
    }}>
      <div style={{
        background: 'var(--white)', borderRadius: 18, padding: '40px 32px',
        width: '100%', maxWidth: 380,
        boxShadow: '0 24px 60px rgba(20,5,16,0.35)',
      }}>
        {/* Marca */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-brand)', fontSize: 40, fontWeight: 600, letterSpacing: '.04em',
            color: 'var(--purple-dark)', lineHeight: 1 }}>
            LARC
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--gray-500)', marginTop: 10 }}>
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
