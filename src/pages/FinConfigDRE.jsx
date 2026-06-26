import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Save, RefreshCw, ChevronUp, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'

const CORES = ['#166534','#991b1b','#7f1d1d','#5b21b6','#b45309','#0f766e','#1e40af','#374151','#6b21a8','#9f1239','#0369a1','#065f46']

function ModalGrupo({ grupo, grupos, onClose, onSaved }) {
  const isNew = !grupo?.id
  const [f, setF] = useState({
    nome:          grupo?.nome || '',
    operacao:      grupo?.operacao || '-',
    ordem:         grupo?.ordem || 99,
    cor:           grupo?.cor || '#374151',
    parent_id:     grupo?.parent_id || '',
    nivel:         grupo?.nivel || 1,
    subtotal_label:grupo?.subtotal_label || '',
    subtotal_key:  grupo?.subtotal_key || '',
    base_pct:      grupo?.base_pct || 'fl',
    ativo:         grupo?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  const paisPossiveis = grupos.filter(g => !g.parent_id && g.id !== grupo?.id)

  async function salvar() {
    setSaving(true)
    const payload = {
      ...f,
      parent_id: f.parent_id || null,
      nivel: f.parent_id ? 2 : 1,
      subtotal_label: f.subtotal_label || null,
      subtotal_key: f.subtotal_key || null,
    }
    if (isNew) await supabase.from('fin_dre_grupos').insert(payload)
    else await supabase.from('fin_dre_grupos').update(payload).eq('id', grupo.id)
    onSaved(); setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:440}}>
        <div className="modal-header">
          <div className="modal-title">{isNew?'Nova linha DRE':'Editar linha'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input className="form-input" value={f.nome} onChange={e=>set('nome',e.target.value)} autoFocus
              placeholder="Ex: Promoções Delivery, iFood BV, CMV Insumos..."/>
          </div>
          <div className="form-group">
            <label className="form-label">Grupo pai (deixe vazio para grupo principal)</label>
            <select className="form-input" value={f.parent_id} onChange={e=>set('parent_id',e.target.value)}>
              <option value="">— Grupo principal (nível 1)</option>
              {paisPossiveis.map(g=><option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
          </div>
          {!f.parent_id && (
            <>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Operação</label>
                  <select className="form-input" value={f.operacao} onChange={e=>set('operacao',e.target.value)}>
                    <option value="+">+ Soma ao resultado</option>
                    <option value="-">- Subtrai do resultado</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">% sobre</label>
                  <select className="form-input" value={f.base_pct} onChange={e=>set('base_pct',e.target.value)}>
                    <option value="fb">Faturamento Bruto</option>
                    <option value="fl">Faturamento Líquido</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Label do subtotal (após este grupo)</label>
                <input className="form-input" value={f.subtotal_label} onChange={e=>set('subtotal_label',e.target.value)}
                  placeholder="Ex: Lucro Bruto, Margem de Contribuição..."/>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Chave do subtotal</label>
                  <input className="form-input" value={f.subtotal_key} onChange={e=>set('subtotal_key',e.target.value)}
                    placeholder="lb, mc, mcm, res..."/>
                </div>
                <div className="form-group">
                  <label className="form-label">Ordem</label>
                  <input type="number" className="form-input" value={f.ordem} onChange={e=>set('ordem',parseInt(e.target.value)||99)}/>
                </div>
              </div>
            </>
          )}
          <div className="form-group">
            <label className="form-label">Cor</label>
            <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:4}}>
              {CORES.map(cor=>(
                <div key={cor} onClick={()=>set('cor',cor)}
                  style={{width:22,height:22,borderRadius:5,background:cor,cursor:'pointer',
                    border:f.cor===cor?'2px solid #333':'2px solid transparent',boxSizing:'border-box'}}/>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!f.nome.trim()}>
            {saving?<RefreshCw size={14} className="spin"/>:<Save size={14}/>} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function GrupoNode({ grupo, todos, categorias, vinculos, gi, total, onEdit, onAdd, onAddCat, onRemoveCat, onDelete, onMover }) {
  const [exp, setExp] = useState(true)
  const filhos = todos.filter(g=>g.parent_id===grupo.id).sort((a,b)=>a.ordem-b.ordem||a.nome.localeCompare(b.nome))
  const cats = vinculos[grupo.id]||[]
  const [catNova, setCatNova] = useState('')
  const catsSemVinculo = categorias.filter(c=>!cats.find(x=>x.id===c.id) && c.nivel===1)

  return (
    <div style={{marginBottom: grupo.nivel===1?12:4}}>
      {/* Header do grupo */}
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        padding: grupo.nivel===1?'10px 14px':'7px 14px 7px '+(14+16)+'px',
        background: grupo.nivel===1?'var(--gray-50)':'var(--white)',
        borderLeft: `4px solid ${grupo.cor||'var(--gray-300)'}`,
        borderBottom:'1px solid var(--gray-100)',
        borderTop: grupo.nivel===1?'1px solid var(--gray-200)':undefined,
        borderRadius: grupo.nivel===1?'8px 8px 0 0':undefined,
      }}>
        <button onClick={()=>setExp(!exp)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:0,width:14,flexShrink:0}}>
          {exp?'▼':'▶'}
        </button>
        <span style={{width:10,height:10,borderRadius:2,background:grupo.cor,flexShrink:0}}/>
        <span style={{flex:1,fontWeight:grupo.nivel===1?800:600,fontSize:grupo.nivel===1?13:12,color:grupo.nivel===1?grupo.cor:'var(--gray-700)'}}>
          {grupo.nome}
        </span>
        {grupo.nivel===1 && grupo.operacao && (
          <span className="pill neutral" style={{fontSize:10}}>{grupo.operacao==='+'?'soma':'subtrai'}</span>
        )}
        {grupo.subtotal_label && <span className="pill purple" style={{fontSize:9}}>→ {grupo.subtotal_label}</span>}
        <div style={{display:'flex',gap:3}}>
          {grupo.nivel===1 && (
            <>
              <button className="btn btn-ghost btn-xs" disabled={gi===0} onClick={()=>onMover(grupo,-1)}><ChevronUp size={11}/></button>
              <button className="btn btn-ghost btn-xs" disabled={gi===total-1} onClick={()=>onMover(grupo,1)}><ChevronDown size={11}/></button>
            </>
          )}
          <button className="btn btn-ghost btn-xs" onClick={()=>onEdit(grupo)} title="Editar"><Pencil size={11}/></button>
          <button className="btn btn-ghost btn-xs" onClick={()=>onAdd(grupo)} title="Adicionar sub-linha"><Plus size={11}/></button>
          <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}} onClick={()=>onDelete(grupo)} title="Excluir">✕</button>
        </div>
      </div>

      {exp && (
        <div style={{
          border:'1px solid var(--gray-200)',
          borderTop:'none',
          borderRadius: grupo.nivel===1?'0 0 8px 8px':undefined,
          overflow:'hidden',
        }}>
          {/* Sub-grupos */}
          {filhos.map((f,fi)=>(
            <GrupoNode key={f.id} grupo={f} todos={todos} categorias={categorias} vinculos={vinculos}
              gi={fi} total={filhos.length}
              onEdit={onEdit} onAdd={onAdd} onAddCat={onAddCat} onRemoveCat={onRemoveCat}
              onDelete={onDelete} onMover={onMover}/>
          ))}

          {/* Categorias vinculadas */}
          {cats.length > 0 && (
            <div style={{padding:'8px 14px',background:'#fafafa',borderTop:filhos.length>0?'1px solid var(--gray-200)':undefined}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--gray-400)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.05em'}}>
                Categorias vinculadas
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {cats.map(c=>(
                  <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:4,background:'var(--purple-pale)',color:'var(--purple)',padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:600}}>
                    {c.nome}
                    <button onClick={()=>onRemoveCat(c.vincId)}
                      style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:0,lineHeight:1,fontSize:11}}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Adicionar categoria */}
          <div style={{padding:'8px 14px',borderTop:'1px solid var(--gray-100)',display:'flex',gap:8,alignItems:'center'}}>
            <select className="form-input" style={{flex:1,padding:'4px 8px',fontSize:12}}
              value={catNova} onChange={e=>setCatNova(e.target.value)}>
              <option value="">Vincular categoria existente...</option>
              {catsSemVinculo.map(c=><option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>)}
            </select>
            <button className="btn btn-primary btn-xs" disabled={!catNova}
              onClick={()=>{ onAddCat(grupo.id, catNova); setCatNova('') }}>
              <Plus size={11}/> Vincular
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FinConfigDRE() {
  const [grupos, setGrupos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [vinculos, setVinculos] = useState({})
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const [{data:gs},{data:cats},{data:vs}] = await Promise.all([
      supabase.from('fin_dre_grupos').select('*').eq('ativo',true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_categorias').select('*').eq('ativo',true).order('nome'),
      supabase.from('fin_dre_grupo_cats').select('*, fin_categorias(nome)'),
    ])
    setGrupos(gs||[])
    setCategorias(cats||[])
    const vmap = {}
    for (const v of (vs||[])) {
      if (!vmap[v.grupo_id]) vmap[v.grupo_id] = []
      vmap[v.grupo_id].push({ id:v.categoria_id, nome:v.fin_categorias?.nome, vincId:v.id })
    }
    setVinculos(vmap)
    setLoading(false)
  }
  useEffect(()=>{load()},[])

  async function excluir(g) {
    const filhos = grupos.filter(x=>x.parent_id===g.id)
    if (filhos.length>0) { alert(`"${g.nome}" tem sub-linhas. Exclua primeiro.`); return }
    if (!window.confirm(`Excluir "${g.nome}"?`)) return
    await supabase.from('fin_dre_grupos').delete().eq('id',g.id)
    load()
  }

  async function mover(g, dir) {
    const raiz = grupos.filter(x=>!x.parent_id).sort((a,b)=>a.ordem-b.ordem)
    const idx = raiz.findIndex(x=>x.id===g.id)
    const alvo = raiz[idx+dir]
    if (!alvo) return
    await Promise.all([
      supabase.from('fin_dre_grupos').update({ordem:alvo.ordem}).eq('id',g.id),
      supabase.from('fin_dre_grupos').update({ordem:g.ordem}).eq('id',alvo.id),
    ])
    load()
  }

  async function addCat(grupoId, catId) {
    await supabase.from('fin_dre_grupo_cats').upsert(
      {grupo_id:grupoId, categoria_id:catId},
      {onConflict:'grupo_id,categoria_id'}
    )
    load()
  }

  async function removeCat(vincId) {
    await supabase.from('fin_dre_grupo_cats').delete().eq('id',vincId)
    load()
  }

  const raiz = grupos.filter(g=>!g.parent_id).sort((a,b)=>a.ordem-b.ordem)

  if (loading) return <div className="loading"><RefreshCw size={14} className="spin"/></div>

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div>
          <div style={{fontWeight:700,fontSize:14}}>Cascata da DRE</div>
          <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>
            Monte os grupos, sub-grupos e linhas. Use ➕ para adicionar sub-linhas dentro de um grupo.
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={()=>setModal({nivel:1})}>
          <Plus size={13}/> Novo grupo principal
        </button>
      </div>

      {raiz.map((g,gi)=>(
        <GrupoNode key={g.id} grupo={g} todos={grupos} categorias={categorias} vinculos={vinculos}
          gi={gi} total={raiz.length}
          onEdit={setModal}
          onAdd={pai=>setModal({parent_id:pai.id, nivel:2, cor:pai.cor, operacao:pai.operacao, base_pct:pai.base_pct})}
          onAddCat={addCat}
          onRemoveCat={removeCat}
          onDelete={excluir}
          onMover={mover}/>
      ))}

      {raiz.length===0 && (
        <div className="card card-pad empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhum grupo configurado</div>
          <div className="empty-sub">Clique em "+ Novo grupo principal" para começar a montar a cascata</div>
        </div>
      )}

      {modal!==null && (
        <ModalGrupo
          grupo={modal?.id?modal:null}
          grupos={grupos}
          onClose={()=>setModal(null)}
          onSaved={()=>{setModal(null);load()}}/>
      )}

      <div style={{fontSize:12,color:'var(--gray-400)',marginTop:12}}>
        💡 Grupos principais definem a cascata (operação +/−, subtotais). Sub-linhas são apenas linhas de detalhe dentro de cada grupo — você digita os valores manualmente na DRE.
      </div>
    </>
  )
}
