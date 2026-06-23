import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { diasPorCategoria } from '../lib/data'
import { Plus, Pencil, Trash2, RefreshCw, Save } from 'lucide-react'

const CATEGORIAS = [
  'Pão de Mel 100g','Mini Pão de Mel 30g','Lata Mini 240g',
  'Potinho 60g','Potão 280g','Barra 180g','Bombom','Outros'
]

function ModalEmb({ emb, onClose, onSaved }) {
  const isNew = !emb?.id
  const [f, setF] = useState({
    codigo: emb?.codigo || '',
    nome: emb?.nome || '',
    categoria: emb?.categoria || 'Pão de Mel 100g',
    dias_producao: emb?.dias_producao || 15,
    estoque_atual: emb?.estoque_atual || 0,
    unidade_minima_grafica: emb?.unidade_minima_grafica || 100,
    margem_seguranca: emb?.margem_seguranca || 0.10,
    ativo: emb?.ativo ?? true,
    visivel_producao: emb?.visivel_producao ?? true,
    visivel_estoque: emb?.visivel_estoque ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  function onCatChange(cat) {
    set('categoria', cat)
    // Auto-define dias baseado na categoria
    const dias15 = ['Pão de Mel 100g','Mini Pão de Mel 30g','Barra 180g']
    set('dias_producao', dias15.includes(cat) ? 15 : 7)
  }

  async function salvar() {
    if (!f.codigo.trim() || !f.nome.trim()) { setErr('Código e nome são obrigatórios.'); return }
    setSaving(true)
    const payload = {
      ...f,
      codigo: f.codigo.toUpperCase().trim(),
      margem_seguranca: parseFloat(f.margem_seguranca),
      dias_producao: parseInt(f.dias_producao),
      estoque_atual: parseInt(f.estoque_atual || 0),
      unidade_minima_grafica: parseInt(f.unidade_minima_grafica),
    }
    const { error } = isNew
      ? await supabase.from('embalagens').insert(payload)
      : await supabase.from('embalagens').update(payload).eq('id', emb.id)
    if (error) { setErr(error.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{isNew ? 'Nova embalagem' : 'Editar embalagem'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="alert alert-danger">{err}</div>}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Código (SKU) *</label>
              <input className="form-input" value={f.codigo}
                onChange={e => set('codigo', e.target.value.toUpperCase())}
                placeholder="PM_BRI_100" />
            </div>
            <div className="form-group">
              <label className="form-label">Categoria</label>
              <select className="form-input" value={f.categoria} onChange={e => onCatChange(e.target.value)}>
                {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Nome do produto / embalagem *</label>
            <input className="form-input" value={f.nome}
              onChange={e => set('nome', e.target.value)}
              placeholder="Ex: Pão de Mel de Brigadeiro" />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Estoque atual (un)</label>
              <input type="number" min={0} className="form-input" value={f.estoque_atual}
                onChange={e => set('estoque_atual', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Unid. mínima gráfica</label>
              <input type="number" min={1} className="form-input" value={f.unidade_minima_grafica}
                onChange={e => set('unidade_minima_grafica', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Dias de antecedência</label>
              <input type="number" min={1} className="form-input" value={f.dias_producao}
                onChange={e => set('dias_producao', e.target.value)} />
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>Barras/Pães de Mel = 15, resto = 7</span>
            </div>
            <div className="form-group">
              <label className="form-label">Margem de segurança</label>
              <select className="form-input" value={f.margem_seguranca}
                onChange={e => set('margem_seguranca', e.target.value)}>
                <option value={0.10}>10% (padrão)</option>
                <option value={0.15}>15%</option>
                <option value={0.20}>20%</option>
              </select>
            </div>
          </div>
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
              Visibilidade
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { key: 'visivel_producao', label: '📋 Formulário de produção', sub: 'Aparece para a líder preencher diariamente' },
                { key: 'visivel_estoque',  label: '📦 Dashboard de estoque',   sub: 'Aparece nos alertas e sugestões de pedido' },
              ].map(opt => (
                <label key={opt.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={f[opt.key]} onChange={e => set(opt.key, e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--purple)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{opt.sub}</div>
                  </div>
                </label>
              ))}
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--gray-200)' }}>
                ℹ️ A aba Análise sempre considera todos os produtos independente dessas configurações.
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : isNew ? <><Plus size={14} /> Criar</> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalAjuste({ emb, onClose, onSaved }) {
  const [qtd, setQtd] = useState('')
  const [tipo, setTipo] = useState('entrada')
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)

  async function salvar() {
    const n = parseInt(qtd)
    if (isNaN(n) || n < 0) { alert('Quantidade inválida.'); return }
    setSaving(true)
    const novo = tipo === 'entrada' ? (emb.estoque_atual || 0) + n : n
    await supabase.from('embalagens').update({ estoque_atual: novo, atualizado_em: new Date().toISOString() }).eq('id', emb.id)
    if (tipo === 'entrada') {
      await supabase.from('entradas_embalagem').insert({ embalagem_id: emb.id, quantidade: n, observacao: obs || null })
    }
    onSaved()
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <div className="modal-title">📦 Ajustar estoque</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{emb.nome}</div>
          <div style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 4 }}>
            Estoque atual: <strong>{(emb.estoque_atual || 0).toLocaleString('pt-BR')} un</strong>
          </div>
          <div className="form-group">
            <label className="form-label">Tipo</label>
            <select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="entrada">Entrada (chegou pedido da gráfica)</option>
              <option value="ajuste">Ajuste manual (corrigir valor)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{tipo === 'entrada' ? 'Quantidade recebida' : 'Novo valor do estoque'}</label>
            <input type="number" min={0} className="form-input" value={qtd} onChange={e => setQtd(e.target.value)} autoFocus />
          </div>
          {tipo === 'entrada' && (
            <div className="form-group">
              <label className="form-label">Observação (opcional)</label>
              <input className="form-input" value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex: Pedido GRF-2506-01" />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalExcluir({ emb, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  async function excluir() {
    setSaving(true)
    // Soft delete — só desativa
    await supabase.from('embalagens').update({ ativo: false }).eq('id', emb.id)
    onSaved()
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <div className="modal-title">🗑 Desativar embalagem</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-warning">
            ⚠️ A embalagem <strong>{emb.nome}</strong> será desativada e não aparecerá mais no formulário de produção. O histórico será mantido.
          </div>
          <p style={{ fontSize: 14, color: 'var(--gray-600)' }}>Se quiser reativar no futuro, edite a embalagem e mude o status para "Ativo".</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-danger" onClick={excluir} disabled={saving} style={{ background: 'var(--danger)', color: '#fff' }}>
            {saving ? <RefreshCw size={14} className="spin" /> : <><Trash2 size={14} /> Desativar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  const [embs, setEmbs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [ajuste, setAjuste] = useState(null)
  const [excluir, setExcluir] = useState(null)
  const [filtro, setFiltro] = useState('todos')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('embalagens').select('*').order('categoria').order('nome')
    setEmbs(data || [])
    setLoading(false)
  }

  async function toggleVisibilidade(id, campo, valor) {
    await supabase.from('embalagens').update({ [campo]: valor }).eq('id', id)
    setEmbs(prev => prev.map(e => e.id === id ? { ...e, [campo]: valor } : e))
  }

  useEffect(() => { load() }, [])

  const filtered = embs.filter(e => filtro === 'todos' ? true : filtro === 'ativo' ? e.ativo : !e.ativo)

  const porCategoria = filtered.reduce((acc, e) => {
    const cat = e.categoria || 'Outros'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(e)
    return acc
  }, {})

  function Toggle({ value, onChange, title }) {
    return (
      <button
        title={title}
        onClick={onChange}
        style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: value ? 'var(--ok)' : 'var(--gray-300)',
          position: 'relative', transition: 'background .2s', flexShrink: 0,
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3,
          left: value ? 19 : 3,
          transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </button>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>⚙️ Administração de Embalagens</div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal('new')}>
          <Plus size={14} /> Nova embalagem
        </button>
      </div>
      <div className="card-desc">Gerencie embalagens e controle onde cada uma aparece no sistema.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['todos','ativo','inativo'].map(f => (
          <button key={f} className={`btn btn-sm ${filtro === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todas' : f === 'ativo' ? 'Ativas' : 'Inativas'}
          </button>
        ))}
      </div>

      {loading ? <div className="loading">Carregando...</div> : (
        Object.entries(porCategoria).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-light)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid var(--purple-pale)' }}>
              {cat} <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>({items.length})</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>Estoque</th>
                  <th>Dias</th>
                  <th title="Aparece no formulário de produção">📋 Produção</th>
                  <th title="Aparece no dashboard de estoque e alertas">📦 Estoque</th>
                  <th title="Aparece nos gráficos e análises">📈 Análise</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(e => (
                  <tr key={e.id} style={{ opacity: (e.visivel_producao || e.visivel_estoque || e.visivel_analise) ? 1 : 0.45 }}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray-400)' }}>{e.codigo}</td>
                    <td style={{ fontWeight: 600 }}>{e.nome}</td>
                    <td style={{ fontWeight: 700 }}>{(e.estoque_atual || 0).toLocaleString('pt-BR')} un</td>
                    <td style={{ fontSize: 13, color: 'var(--gray-600)' }}>{e.dias_producao}d</td>
                    <td>
                      <Toggle
                        value={e.visivel_producao !== false}
                        onChange={() => toggleVisibilidade(e.id, 'visivel_producao', !(e.visivel_producao !== false))}
                        title={e.visivel_producao !== false ? 'Visível na produção — clique para ocultar' : 'Oculto da produção — clique para mostrar'}
                      />
                    </td>
                    <td>
                      <Toggle
                        value={e.visivel_estoque !== false}
                        onChange={() => toggleVisibilidade(e.id, 'visivel_estoque', !(e.visivel_estoque !== false))}
                        title={e.visivel_estoque !== false ? 'Visível no estoque — clique para ocultar' : 'Oculto do estoque — clique para mostrar'}
                      />
                    </td>
                    <td>
                      <Toggle
                        value={e.visivel_analise !== false}
                        onChange={() => toggleVisibilidade(e.id, 'visivel_analise', !(e.visivel_analise !== false))}
                        title={e.visivel_analise !== false ? 'Visível na análise — clique para ocultar' : 'Oculto da análise — clique para mostrar'}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setAjuste(e)} title="Ajustar estoque">📦</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setModal(e)} title="Editar"><Pencil size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {modal && <ModalEmb emb={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
      {ajuste && <ModalAjuste emb={ajuste} onClose={() => setAjuste(null)} onSaved={() => { setAjuste(null); load() }} />}
    </div>
  )
}
