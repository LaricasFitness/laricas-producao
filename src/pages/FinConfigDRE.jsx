import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Save, RefreshCw, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react'

const CORES_GRUPO = ['#166534','#991b1b','#7f1d1d','#5b21b6','#b45309','#0f766e','#1e40af','#374151','#6b21a8','#9f1239']

function ModalGrupo({ grupo, onClose, onSaved }) {
  const isNew = !grupo?.id
  const [f, setF] = useState({
    nome:          grupo?.nome || '',
    operacao:      grupo?.operacao || '-',
    ordem:         grupo?.ordem || 99,
    cor:           grupo?.cor || '#374151',
    subtotal_label:grupo?.subtotal_label || '',
    subtotal_key:  grupo?.subtotal_key || '',
    base_pct:      grupo?.base_pct || 'fl',
    ativo:         grupo?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  async function salvar() {
    setSaving(true)
    const payload = { ...f, subtotal_label: f.subtotal_label||null, subtotal_key: f.subtotal_key||null }
    if (isNew) await supabase.from('fin_dre_grupos').insert(payload)
    else await supabase.from('fin_dre_grupos').update(payload).eq('id', grupo.id)
    onSaved(); setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:440}}>
        <div className="modal-header">
          <div className="modal-title">{isNew?'Novo grupo DRE':'Editar grupo'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nome do grupo *</label>
            <input className="form-input" value={f.nome} onChange={e=>set('nome',e.target.value)} autoFocus
              placeholder="Ex: (-) CMV, FATURAMENTO BRUTO..."/>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Operação</label>
              <select className="form-input" value={f.operacao} onChange={e=>set('operacao',e.target.value)}>
                <option value="+">+ Soma ao resultado</option>
                <option value="-">- Subtrai do resultado</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">% calculada sobre</label>
              <select className="form-input" value={f.base_pct} onChange={e=>set('base_pct',e.target.value)}>
                <option value="fb">Faturamento Bruto</option>
                <option value="fl">Faturamento Líquido</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Label do subtotal (linha exibida após o grupo)</label>
            <input className="form-input" value={f.subtotal_label} onChange={e=>set('subtotal_label',e.target.value)}
              placeholder="Ex: Lucro Bruto, Margem de Contribuição..."/>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Chave do subtotal</label>
              <input className="form-input" value={f.subtotal_key} onChange={e=>set('subtotal_key',e.target.value)}
                placeholder="Ex: lb, mc, mcm, res"/>
              <span className="form-hint">Usada para referência interna</span>
            </div>
            <div className="form-group">
              <label className="form-label">Ordem</label>
              <input type="number" className="form-input" value={f.ordem} onChange={e=>set('ordem',parseInt(e.target.value)||99)}/>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Cor</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
              {CORES_GRUPO.map(cor=>(
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

export default function FinConfigDRE() {
  const [grupos, setGrupos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [vinculos, setVinculos] = useState({}) // { grupo_id: [cat_id...] }
  const [grupoSel, setGrupoSel] = useState(null)
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [catNova, setCatNova] = useState('')

  async function load() {
    const [{data:gs},{data:cats},{data:vs}] = await Promise.all([
      supabase.from('fin_dre_grupos').select('*').order('ordem'),
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

  async function excluirGrupo(g) {
    if (!window.confirm(`Excluir grupo "${g.nome}"? As categorias vinculadas serão desvinculadas.`)) return
    await supabase.from('fin_dre_grupos').delete().eq('id', g.id)
    load()
  }

  async function moverGrupo(g, dir) {
    const sorted = [...grupos].sort((a,b)=>a.ordem-b.ordem)
    const idx = sorted.findIndex(x=>x.id===g.id)
    const alvo = sorted[idx+dir]
    if (!alvo) return
    await Promise.all([
      supabase.from('fin_dre_grupos').update({ordem:alvo.ordem}).eq('id',g.id),
      supabase.from('fin_dre_grupos').update({ordem:g.ordem}).eq('id',alvo.id),
    ])
    load()
  }

  async function adicionarCat() {
    if (!catNova || !grupoSel) return
    await supabase.from('fin_dre_grupo_cats').upsert(
      { grupo_id:grupoSel, categoria_id:catNova },
      { onConflict:'grupo_id,categoria_id' }
    )
    setCatNova('')
    load()
  }

  async function removerVinculo(vincId) {
    await supabase.from('fin_dre_grupo_cats').delete().eq('id', vincId)
    load()
  }

  const catsSemVinculo = (grupoId) => {
    const usadas = (vinculos[grupoId]||[]).map(v=>v.id)
    return categorias.filter(c=>!usadas.includes(c.id))
  }

  if (loading) return <div className="loading"><RefreshCw size={14} className="spin"/></div>

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div>
          <div style={{fontWeight:700,fontSize:14}}>Cascata da DRE</div>
          <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>
            Configure os grupos, a ordem e quais categorias pertencem a cada grupo
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={()=>setModal({})}>
          <Plus size={13}/> Novo grupo
        </button>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {grupos.sort((a,b)=>a.ordem-b.ordem).map((g,gi,arr)=>{
          const cats = vinculos[g.id]||[]
          const isOpen = grupoSel===g.id
          return (
            <div key={g.id} style={{border:'1px solid var(--gray-200)',borderRadius:10,overflow:'hidden',borderLeft:`4px solid ${g.cor}`}}>
              {/* Header do grupo */}
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',background:'var(--gray-50)',cursor:'pointer'}}
                onClick={()=>setGrupoSel(isOpen?null:g.id)}>
                <span style={{flex:1,fontWeight:700,fontSize:13,color:g.cor}}>{g.nome}</span>
                <span style={{fontSize:11,color:'var(--gray-400)'}}>{cats.length} cat. · {g.operacao==='+'?'soma':'subtrai'}</span>
                {g.subtotal_label && <span className="pill purple" style={{fontSize:10}}>{g.subtotal_label}</span>}
                <div style={{display:'flex',gap:2}} onClick={e=>e.stopPropagation()}>
                  <button className="btn btn-ghost btn-xs" disabled={gi===0} onClick={()=>moverGrupo(g,-1)}><ChevronUp size={12}/></button>
                  <button className="btn btn-ghost btn-xs" disabled={gi===arr.length-1} onClick={()=>moverGrupo(g,1)}><ChevronDown size={12}/></button>
                  <button className="btn btn-ghost btn-xs" onClick={()=>setModal(g)}><span style={{fontSize:11}}>✏️</span></button>
                  <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}} onClick={()=>excluirGrupo(g)}>✕</button>
                </div>
              </div>

              {/* Categorias vinculadas */}
              {isOpen && (
                <div style={{padding:'10px 14px'}}>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
                    {cats.map(c=>(
                      <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:4,background:'var(--purple-pale)',color:'var(--purple)',padding:'3px 8px',borderRadius:999,fontSize:12,fontWeight:600}}>
                        {c.nome}
                        <button onClick={()=>removerVinculo(c.vincId)}
                          style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:0,lineHeight:1,fontSize:12}}>×</button>
                      </span>
                    ))}
                    {cats.length===0&&<span style={{fontSize:12,color:'var(--gray-400)'}}>Nenhuma categoria vinculada</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <select className="form-input" style={{flex:1,padding:'5px 8px',fontSize:12}}
                      value={catNova} onChange={e=>setCatNova(e.target.value)}>
                      <option value="">Adicionar categoria...</option>
                      {catsSemVinculo(g.id).map(c=><option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm" onClick={adicionarCat} disabled={!catNova}>
                      <Plus size={12}/> Adicionar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {modal!==null && (
        <ModalGrupo grupo={modal?.id?modal:null}
          onClose={()=>setModal(null)}
          onSaved={()=>{setModal(null);load()}}/>
      )}
    </>
  )
}
