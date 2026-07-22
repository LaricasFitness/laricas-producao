import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { diasPorCategoria } from '../lib/data'
import { registrarAcao } from '../lib/log'
import { Plus, Pencil, Trash2, RefreshCw, Save } from 'lucide-react'
import Usuarios from './Usuarios'

const CATEGORIAS = [
  'Pão de Mel 100g','Mini Pão de Mel 30g','Lata Mini 240g',
  'Potinho 60g','Potão 280g','Barra 180g','Bombom','Outros'
]

function ModalEmb({ emb, onClose, onSaved }) {
  const isNew = !emb?.id
  const [f, setF] = useState({
    codigo: emb?.codigo || '',
    nome: emb?.nome || '',
    tipo: emb?.tipo || 'rotulo',
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
    if (!f.nome.trim()) { setErr('Nome é obrigatório.'); return }
    if (f.tipo === 'rotulo' && !f.codigo.trim()) { setErr('Código (SKU) é obrigatório para rótulos.'); return }
    setSaving(true)
    const payload = {
      ...f,
      codigo: f.codigo.toUpperCase().trim(),
      margem_seguranca: parseFloat(f.margem_seguranca),
      dias_producao: parseInt(f.dias_producao),
      estoque_atual: parseInt(f.estoque_atual || 0),
      unidade_minima_grafica: parseInt(f.unidade_minima_grafica),
    }
    const { data: savedRows, error } = isNew
      ? await supabase.from('embalagens').insert(payload).select()
      : await supabase.from('embalagens').update(payload).eq('id', emb.id).select()
    if (error) { setErr(error.message); setSaving(false); return }

    // Se editou o estoque atual, cria um snapshot em inventarios para refletir no cálculo cronológico
    const embId = isNew ? savedRows?.[0]?.id : emb.id
    const hoje = new Date().toISOString().slice(0,10)
    if (isNew && parseInt(f.estoque_atual || 0) > 0 && embId) {
      await supabase.from('inventarios').insert({
        embalagem_id: embId, quantidade: parseInt(f.estoque_atual || 0), data_inventario: hoje,
      })
    } else if (!isNew && parseInt(f.estoque_atual || 0) !== (emb.estoque_atual || 0)) {
      await supabase.from('inventarios').insert({
        embalagem_id: emb.id, quantidade: parseInt(f.estoque_atual || 0), data_inventario: hoje,
      })
    }

    if (!isNew) {
      await registrarAcao({
        acao: 'editar_embalagem',
        descricao: `Editou embalagem "${emb.nome}" (${emb.codigo})`,
        tabela: 'embalagens',
        registroId: emb.id,
        dadosAnteriores: { nome: emb.nome, codigo: emb.codigo, categoria: emb.categoria, dias_producao: emb.dias_producao, margem_seguranca: emb.margem_seguranca },
        dadosNovos: payload,
      })
    }
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
          <div className="form-group">
            <label className="form-label">Tipo *</label>
            <div style={{ display:'flex', gap:8 }}>
              {[{v:'rotulo',l:'🏷️ Rótulo'},{v:'embalagem',l:'📦 Embalagem'}].map(opt=>(
                <button key={opt.v} type="button"
                  className={`btn btn-sm ${f.tipo===opt.v?'btn-primary':'btn-ghost'}`}
                  onClick={()=>set('tipo',opt.v)}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Código (SKU) {f.tipo === 'rotulo' ? '*' : '(opcional)'}</label>
              <input className="form-input" value={f.codigo}
                onChange={e => set('codigo', e.target.value.toUpperCase())}
                placeholder={f.tipo === 'rotulo' ? 'PM_BRI_100' : 'Ex: VID_60G'} />
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
    const anterior = emb.estoque_atual || 0

    // Calcula o valor absoluto do novo estoque
    const novoEstoque = tipo === 'entrada' ? anterior + n : n

    // Salva como inventário (ponto de referência datado)
    const hoje = new Date().toISOString().slice(0, 10)
    const u = JSON.parse(sessionStorage.getItem('usuario') || '{}')
    await supabase.from('inventarios').insert({
      embalagem_id: emb.id,
      quantidade: novoEstoque,
      data_inventario: hoje,
      observacao: obs || (tipo === 'entrada' ? `Entrada manual de ${n} un` : `Ajuste de estoque para ${n} un`),
      registrado_por: u.nome || 'Admin',
    })

    await registrarAcao({
      acao: 'ajuste_estoque',
      descricao: tipo === 'entrada'
        ? `Entrada de ${n} un em "${emb.nome}" (${anterior} → ${novoEstoque})`
        : `Estoque de "${emb.nome}" ajustado para ${novoEstoque} un (era ${anterior})`,
      tabela: 'inventarios',
      registroId: emb.id,
      dadosAnteriores: { estoque_atual: anterior },
      dadosNovos: { estoque_atual: novoEstoque },
    })
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

function AdminCatEmbalagem() {
  const [vinculos, setVinculos] = useState({})   // { categoria: embalagem_id }
  const [embalagens, setEmbalagens] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('categoria_embalagem').select('*'),
      supabase.from('embalagens').select('id,nome,codigo').eq('tipo','embalagem').eq('ativo',true).order('nome'),
    ]).then(([{data:v},{data:e}]) => {
      const map = {}
      for (const r of (v||[])) map[r.categoria] = r.embalagem_id
      setVinculos(map)
      setEmbalagens(e||[])
    })
  }, [])

  async function salvar() {
    setSaving(true)
    for (const cat of CATEGORIAS) {
      const embId = vinculos[cat] || null
      await supabase.from('categoria_embalagem').upsert(
        { categoria: cat, embalagem_id: embId },
        { onConflict: 'categoria' }
      )
    }
    setMsg('Vínculos salvos!')
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <div className="card card-pad">
      <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>📦 Embalagem Primária por Categoria</div>
      <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:16 }}>
        Vincule uma embalagem a cada categoria de produto. A produção descontará automaticamente o estoque.
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {CATEGORIAS.map(cat => (
          <div key={cat} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--gray-50)', borderRadius:8 }}>
            <div style={{ fontWeight:600, fontSize:13, minWidth:160 }}>{cat}</div>
            <div style={{ fontSize:20 }}>→</div>
            <select className="form-input" style={{ flex:1, maxWidth:280 }}
              value={vinculos[cat] || ''}
              onChange={e => setVinculos(prev => ({ ...prev, [cat]: e.target.value || null }))}>
              <option value="">Sem embalagem vinculada</option>
              {embalagens.map(e => (
                <option key={e.id} value={e.id}>{e.nome} ({e.codigo})</option>
              ))}
            </select>
            {vinculos[cat] && (
              <span className="pill ok" style={{ fontSize:11 }}>✓ vinculado</span>
            )}
          </div>
        ))}
      </div>
      {msg && <div className="alert-banner ok" style={{ marginTop:12 }}>✅ {msg}</div>}
      <div style={{ marginTop:16 }}>
        <button className="btn btn-primary" onClick={salvar} disabled={saving}>
          {saving ? <RefreshCw size={14} className="spin"/> : <Save size={14}/>} Salvar vínculos
        </button>
      </div>
    </div>
  )
}

// ── Componente de Previsão de Delivery ───────────────────────────────────────
function AdminDeliveryPrevisao() {
  const DIAS = ['seg','ter','qua','qui','sex','sab','dom']
  const DIAS_LABEL = { seg:'Seg',ter:'Ter',qua:'Qua',qui:'Qui',sex:'Sex',sab:'Sáb',dom:'Dom' }
  const [dados, setDados] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editados, setEditados] = useState(new Set())

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('delivery_previsao').select('*').order('nome')
    const map = {}
    for (const r of (data || [])) {
      if (!map[r.sku]) map[r.sku] = { sku: r.sku, nome: r.nome, seg:0,ter:0,qua:0,qui:0,sex:0,sab:0,dom:0 }
      map[r.sku][r.dia_semana] = r.quantidade
    }
    setDados(Object.values(map))
    setEditados(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function atualizar(sku, dia, valor) {
    setDados(prev => prev.map(r => r.sku === sku ? { ...r, [dia]: parseInt(valor) || 0 } : r))
    setEditados(prev => new Set([...prev, sku]))
  }

  async function salvar() {
    setSaving(true)
    for (const r of dados.filter(r => editados.has(r.sku))) {
      for (const dia of DIAS) {
        await supabase.from('delivery_previsao')
          .update({ quantidade: r[dia], nome: r.nome })
          .eq('sku', r.sku).eq('dia_semana', dia)
      }
    }
    setEditados(new Set())
    setSaving(false)
  }

  const totalSemana = r => DIAS.reduce((s, d) => s + (r[d]||0), 0)
  const totalSexta  = r => (r.sex||0)+(r.sab||0)+(r.dom||0)+(r.seg||0)

  return (
    <div className="card">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', borderBottom:'1px solid var(--gray-200)' }}>
        <div>
          <div style={{ fontWeight:800, fontSize:15 }}>📊 Previsão de Delivery por Dia da Semana</div>
          <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:3 }}>
            Valores usados para pré-preencher a coluna Delivery no Planejamento · Sexta = Sex+Sáb+Dom+Seg acumulado
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {editados.size > 0 && (
            <span style={{ fontSize:12, color:'var(--gold)', fontWeight:700 }}>
              {editados.size} SKU(s) editado(s)
            </span>
          )}
          <button className="btn btn-primary" onClick={salvar} disabled={saving || editados.size === 0}>
            {saving ? <><RefreshCw size={14} className="spin"/> Salvando...</> : <><Save size={14}/> Salvar alterações</>}
          </button>
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={14}/></button>
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--gray-50)' }}>
                <th style={{ padding:'10px 14px', textAlign:'left', minWidth:220 }}>Produto / SKU</th>
                {DIAS.map(d => (
                  <th key={d} style={{ padding:'10px 8px', textAlign:'center', minWidth:70,
                    background: d==='sex' ? '#f0eaff' : undefined,
                    color: d==='sex' ? 'var(--purple)' : 'var(--gray-600)', fontWeight:700, fontSize:12 }}>
                    {DIAS_LABEL[d]}
                    {d==='sex' && <div style={{fontSize:9, fontWeight:400}}>+Sáb+Dom+Seg</div>}
                  </th>
                ))}
                <th style={{ padding:'10px 8px', textAlign:'center', color:'var(--gray-400)', fontSize:12 }}>Semana</th>
                <th style={{ padding:'10px 8px', textAlign:'center', color:'var(--purple)', fontSize:12 }}>Sex→Seg</th>
              </tr>
            </thead>
            <tbody>
              {dados.map((r, i) => (
                <tr key={r.sku} style={{ borderTop:'1px solid var(--gray-100)', background: editados.has(r.sku)?'#fffbf0': i%2===0?'#fff':'#fafafa' }}>
                  <td style={{ padding:'8px 14px' }}>
                    <div style={{ fontWeight:600 }}>{r.nome}</div>
                    <div style={{ fontSize:11, color:'var(--gray-400)', fontFamily:'monospace' }}>{r.sku}</div>
                    {editados.has(r.sku) && <span style={{ fontSize:10, color:'var(--gold)', fontWeight:700 }}>● editado</span>}
                  </td>
                  {DIAS.map(d => (
                    <td key={d} style={{ padding:'5px 5px', textAlign:'center', background: d==='sex'?'#f9f5ff':undefined }}>
                      <input type="number" min={0} value={r[d]||0}
                        onChange={e => atualizar(r.sku, d, e.target.value)}
                        style={{ width:56, textAlign:'center', padding:'5px 4px', fontSize:13, fontWeight:600,
                          border:'1.5px solid var(--gray-200)', borderRadius:6, outline:'none',
                          background: d==='sex'?'#ede8fa':'transparent',
                          color: d==='sex'?'var(--purple)':'inherit' }} />
                    </td>
                  ))}
                  <td style={{ padding:'8px 8px', textAlign:'center', fontWeight:700, color:'var(--gray-500)' }}>{totalSemana(r)}</td>
                  <td style={{ padding:'8px 8px', textAlign:'center', fontWeight:800, color:'var(--purple)' }}>{totalSexta(r)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop:'2px solid var(--gray-200)', background:'var(--gray-50)' }}>
                <td style={{ padding:'10px 14px', fontWeight:800, color:'var(--gray-600)' }}>Total por dia</td>
                {DIAS.map(d => (
                  <td key={d} style={{ padding:'10px 8px', textAlign:'center', fontWeight:800,
                    color: d==='sex'?'var(--purple)':'var(--gray-700)', background: d==='sex'?'#f0eaff':undefined }}>
                    {dados.reduce((s, r) => s + (r[d]||0), 0)}
                  </td>
                ))}
                <td style={{ padding:'10px 8px', textAlign:'center', fontWeight:800, color:'var(--gray-500)' }}>
                  {dados.reduce((s, r) => s + totalSemana(r), 0)}
                </td>
                <td style={{ padding:'10px 8px', textAlign:'center', fontWeight:800, color:'var(--purple)' }}>
                  {dados.reduce((s, r) => s + totalSexta(r), 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Admin() {
  const [tab, setTab] = useState('embalagens')
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Tabs */}
      <div className="tabs">
        <button className={`tab${tab === 'embalagens' ? ' active' : ''}`} onClick={() => setTab('embalagens')}>⚙️ Embalagens</button>
        <button className={`tab${tab === 'cat_embalagem' ? ' active' : ''}`} onClick={() => setTab('cat_embalagem')}>📦 Emb. por Categoria</button>
        <button className={`tab${tab === 'delivery_previsao' ? ' active' : ''}`} onClick={() => setTab('delivery_previsao')}>📊 Previsão Delivery</button>
        <button className={`tab${tab === 'usuarios' ? ' active' : ''}`} onClick={() => setTab('usuarios')}>👥 Usuários e Acessos</button>
      </div>

      {tab === 'usuarios' && <Usuarios />}

      {tab === 'cat_embalagem' && <AdminCatEmbalagem />}

      {tab === 'delivery_previsao' && <AdminDeliveryPrevisao />}

      {tab === 'embalagens' && <div className="card">
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
    </div>}
    </div>
  )
}
