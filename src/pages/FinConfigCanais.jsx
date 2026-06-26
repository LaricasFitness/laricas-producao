import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Pencil, Save, RefreshCw, ChevronRight, ChevronDown, Trash2 } from 'lucide-react'

const CORES = ['#e74c3c','#c0392b','#a93226','#f39c12','#d68910','#9b59b6','#2980b9','#27ae60','#1abc9c','#7f8c8d','#673f7c','#16a085','#e67e22','#2c3e50']

function ModalCanal({ canal, canais, onClose, onSaved }) {
  const isNew = !canal?.id
  const [f, setF] = useState({
    nome:      canal?.nome || '',
    cor:       canal?.cor || '#7f8c8d',
    ordem:     canal?.ordem || 99,
    nivel:     canal?.nivel || 3,
    tipo:      canal?.tipo || 'canal_final',
    parent_id: canal?.parent_id || '',
    ativo:     canal?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  const pais = canais.filter(c => c.nivel < f.nivel)

  async function salvar() {
    setSaving(true)
    const payload = { ...f, parent_id: f.parent_id || null }
    if (isNew) await supabase.from('fin_canais').insert(payload)
    else await supabase.from('fin_canais').update(payload).eq('id', canal.id)
    onSaved(); setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:400}}>
        <div className="modal-header">
          <div className="modal-title">{isNew?'Novo canal':'Editar canal'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input className="form-input" value={f.nome} onChange={e=>set('nome',e.target.value)} autoFocus/>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Nível</label>
              <select className="form-input" value={f.nivel} onChange={e=>set('nivel',parseInt(e.target.value))}>
                <option value={1}>1 — Agrupador</option>
                <option value={2}>2 — Região</option>
                <option value={3}>3 — Canal final</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Canal pai</label>
              <select className="form-input" value={f.parent_id} onChange={e=>set('parent_id',e.target.value)}>
                <option value="">Raiz</option>
                {pais.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Cor</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
              {CORES.map(cor=>(
                <div key={cor} onClick={()=>set('cor',cor)}
                  style={{width:22,height:22,borderRadius:5,background:cor,cursor:'pointer',
                    border:f.cor===cor?'2px solid #333':'2px solid transparent',boxSizing:'border-box'}}/>
              ))}
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Ordem</label>
              <input type="number" className="form-input" value={f.ordem} onChange={e=>set('ordem',parseInt(e.target.value)||99)}/>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input" value={f.ativo?'ativo':'inativo'} onChange={e=>set('ativo',e.target.value==='ativo')}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
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

function CanalNode({ canal, todos, nivel=0, onEdit, onAdd, onDelete }) {
  const [exp, setExp] = useState(nivel < 2)
  const filhos = todos.filter(c=>c.parent_id===canal.id).sort((a,b)=>a.ordem-b.ordem)

  return (
    <div>
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        padding:`8px 14px 8px ${14+nivel*20}px`,
        borderBottom:'1px solid var(--gray-100)',
        background: nivel===0?'var(--gray-50)':nivel===1?'var(--white)':'#fafafa',
        opacity: canal.ativo?1:.5,
      }}>
        {filhos.length>0
          ? <button onClick={()=>setExp(!exp)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:0,width:16}}>
              {exp?<ChevronDown size={13}/>:<ChevronRight size={13}/>}
            </button>
          : <span style={{width:16}}/>
        }
        <span style={{width:10,height:10,borderRadius:2,background:canal.cor,flexShrink:0}}/>
        <span style={{flex:1,fontWeight:nivel===0?800:nivel===1?600:400,fontSize:nivel===2?12:13}}>
          {canal.nome}
        </span>
        <span style={{fontSize:10,color:'var(--gray-400)',marginRight:4}}>
          {['Agrupador','Região','Canal final'][canal.nivel-1]}
        </span>
        <div style={{display:'flex',gap:4}}>
          <button className="btn btn-ghost btn-xs" onClick={()=>onEdit(canal)} title="Editar"><Pencil size={11}/></button>
          <button className="btn btn-ghost btn-xs" onClick={()=>onAdd(canal)} title="Adicionar filho"><Plus size={11}/></button>
          <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}} title="Excluir"
            onClick={()=>onDelete(canal)}>✕</button>
        </div>
      </div>
      {exp && filhos.map(f=>(
        <CanalNode key={f.id} canal={f} todos={todos} nivel={nivel+1} onEdit={onEdit} onAdd={onAdd} onDelete={onDelete}/>
      ))}
    </div>
  )
}

export default function FinConfigCanais() {
  const [canais, setCanais] = useState([])
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const {data} = await supabase.from('fin_canais').select('*').order('nivel').order('ordem')
    setCanais(data||[])
    setLoading(false)
  }
  useEffect(()=>{load()},[])

  async function excluir(canal) {
    const filhos = canais.filter(c=>c.parent_id===canal.id)
    if (filhos.length>0) { alert(`Este canal tem ${filhos.length} canal(is) filho(s). Exclua primeiro os filhos.`); return }
    if (!window.confirm(`Excluir "${canal.nome}"?`)) return
    await supabase.from('fin_canais').delete().eq('id', canal.id)
    load()
  }

  const raiz = canais.filter(c=>!c.parent_id).sort((a,b)=>a.ordem-b.ordem)

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:14}}>Hierarquia de canais</div>
        <button className="btn btn-primary btn-sm" onClick={()=>setModal({nivel:1,tipo:'agrupador'})}>
          <Plus size={13}/> Novo agrupador
        </button>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <div className="card" style={{overflow:'hidden'}}>
          {raiz.map(c=>(
            <CanalNode key={c.id} canal={c} todos={canais} nivel={0}
              onEdit={setModal}
              onAdd={pai=>setModal({ nivel:Math.min(3,pai.nivel+1), parent_id:pai.id, tipo:pai.nivel>=2?'canal_final':'regiao' })}
              onDelete={excluir}/>
          ))}
          {raiz.length===0 && <div style={{padding:20,color:'var(--gray-400)',textAlign:'center',fontSize:13}}>Nenhum canal cadastrado</div>}
        </div>
      )}

      {modal && (
        <ModalCanal canal={modal?.id?modal:null} canais={canais}
          onClose={()=>setModal(null)}
          onSaved={()=>{setModal(null);load()}}/>
      )}

      <div style={{fontSize:12,color:'var(--gray-400)',marginTop:10}}>
        Nível 1 = Agrupador (ex: Delivery) · Nível 2 = Região (ex: Bela Vista) · Nível 3 = Canal final onde os lançamentos são feitos
      </div>
    </>
  )
}
