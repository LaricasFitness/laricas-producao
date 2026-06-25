import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Pencil, RefreshCw, Save, Key } from 'lucide-react'

const TODAS_ABAS = [
  { id: 'embalagens',  label: '📦 Embalagens (Situação + Pedidos + Compras)' },
  { id: 'producao',    label: '📋 Produção (Registro + Planejamento + Análise + Log + Histórico)' },
  { id: 'logistica',   label: '🚚 Logística' },
  { id: 'financeiro',  label: '💰 Financeiro' },
  { id: 'admin',       label: '⚙️ Admin' },
]

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function ModalUsuario({ usuario, onClose, onSaved }) {
  const isNew = !usuario?.id
  const [f, setF] = useState({
    nome: usuario?.nome || '',
    email: usuario?.email || '',
    perfil: usuario?.perfil || 'operador',
    abas_permitidas: usuario?.abas_permitidas || ['producao'],
    ativo: usuario?.ativo ?? true,
    senha: '',
    confirmar_senha: '',
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  function toggleAba(aba) {
    setF(p => ({
      ...p,
      abas_permitidas: p.abas_permitidas.includes(aba)
        ? p.abas_permitidas.filter(a => a !== aba)
        : [...p.abas_permitidas, aba]
    }))
  }

  function togglePerfil(perfil) {
    set('perfil', perfil)
    // Admin: todas as abas
    if (perfil === 'admin') set('abas_permitidas', TODAS_ABAS.map(a => a.id))
  }

  async function salvar() {
    if (!f.nome.trim() || !f.email.trim()) { setErro('Nome e e-mail obrigatórios.'); return }
    if (isNew && !f.senha) { setErro('Informe uma senha para o novo usuário.'); return }
    if (f.senha && f.senha !== f.confirmar_senha) { setErro('Senhas não conferem.'); return }
    if (f.senha && f.senha.length < 6) { setErro('Senha deve ter pelo menos 6 caracteres.'); return }

    setSaving(true); setErro('')
    try {
      const payload = {
        nome: f.nome.trim(),
        email: f.email.trim().toLowerCase(),
        perfil: f.perfil,
        abas_permitidas: f.abas_permitidas,
        ativo: f.ativo,
      }
      if (f.senha) payload.senha_hash = await sha256(f.senha)

      let error
      if (isNew) {
        ({ error } = await supabase.from('usuarios').insert(payload))
      } else {
        ({ error } = await supabase.from('usuarios').update(payload).eq('id', usuario.id))
      }
      if (error) throw error
      onSaved()
    } catch(e) {
      setErro(e.message?.includes('duplicate') ? 'Este e-mail já está cadastrado.' : e.message)
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title">{isNew ? 'Novo usuário' : 'Editar usuário'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {erro && <div className="alert-banner" style={{ background: 'var(--danger-pale)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}>{erro}</div>}

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Nome *</label>
              <input className="form-input" value={f.nome} onChange={e => set('nome', e.target.value)} placeholder="Nome completo" />
            </div>
            <div className="form-group">
              <label className="form-label">E-mail *</label>
              <input className="form-input" type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="email@exemplo.com" />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">{isNew ? 'Senha *' : 'Nova senha (deixe em branco para manter)'}</label>
              <input className="form-input" type="password" value={f.senha} onChange={e => set('senha', e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
            <div className="form-group">
              <label className="form-label">Confirmar senha</label>
              <input className="form-input" type="password" value={f.confirmar_senha} onChange={e => set('confirmar_senha', e.target.value)} placeholder="Repita a senha" />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Perfil</label>
              <input className="form-input" value={f.perfil} onChange={e => togglePerfil(e.target.value)}
                placeholder="Ex: admin, operador, lider" />
              <span className="form-hint">Digite livremente. "admin" libera todas as abas automaticamente.</span>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input" value={f.ativo ? 'ativo' : 'inativo'} onChange={e => set('ativo', e.target.value === 'ativo')}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: 10, display: 'block' }}>Abas permitidas</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TODAS_ABAS.map(aba => (
                <label key={aba.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={f.abas_permitidas.includes(aba.id)}
                    onChange={() => toggleAba(aba.id)}
                    style={{ width: 16, height: 16, accentColor: 'var(--purple)', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{aba.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : isNew ? <><Plus size={14} /> Criar usuário</> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalSenha({ usuario, onClose, onSaved }) {
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    if (senha.length < 6) { setErro('Mínimo 6 caracteres.'); return }
    if (senha !== confirmar) { setErro('Senhas não conferem.'); return }
    setSaving(true)
    const hash = await sha256(senha)
    await supabase.from('usuarios').update({ senha_hash: hash }).eq('id', usuario.id)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <div className="modal-title">Redefinir senha — {usuario.nome}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {erro && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</div>}
          <div className="form-group">
            <label className="form-label">Nova senha</label>
            <input className="form-input" type="password" value={senha} onChange={e => setSenha(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Confirmar senha</label>
            <input className="form-input" type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} onKeyDown={e => e.key === 'Enter' && salvar()} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : <><Key size={14} /> Redefinir</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [modalSenha, setModalSenha] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('usuarios').select('*').order('nome')
    setUsuarios(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>👥 Usuários e Acessos</div>
          <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>Gerencie quem pode acessar e quais abas cada um vê.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal('new')}>
          <Plus size={14} /> Novo usuário
        </button>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Abas permitidas</th>
                <th>Último acesso</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ opacity: u.ativo ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>{u.nome}</td>
                  <td style={{ color: 'var(--gray-500)', fontSize: 13 }}>{u.email}</td>
                  <td>
                    <span className={`pill ${u.perfil === 'admin' ? 'purple' : 'neutral'}`}>
                      {u.perfil}
                    </span>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(u.abas_permitidas || []).map(aba => {
                        const a = TODAS_ABAS.find(x => x.id === aba)
                        return a ? (
                          <span key={aba} style={{ fontSize: 11, background: 'var(--purple-pale)', color: 'var(--purple)', padding: '2px 7px', borderRadius: 999, fontWeight: 600 }}>
                            {a.label}
                          </span>
                        ) : null
                      })}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                    {u.ultimo_acesso
                      ? new Date(u.ultimo_acesso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : 'Nunca'}
                  </td>
                  <td>
                    <span className={`pill ${u.ativo ? 'ok' : 'neutral'}`}>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal(u)} title="Editar"><Pencil size={12} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModalSenha(u)} title="Redefinir senha"><Key size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ModalUsuario usuario={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
      {modalSenha && <ModalSenha usuario={modalSenha} onClose={() => setModalSenha(null)} onSaved={() => { setModalSenha(null); load() }} />}
    </div>
  )
}
