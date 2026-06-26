import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Pencil, Save, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import FinConfigCanais from './FinConfigCanais'
import FinConfigDRE from './FinConfigDRE'

const CORES = ['#e74c3c','#9b59b6','#2980b9','#27ae60','#f39c12','#1abc9c','#e67e22','#8e44ad','#16a085','#7f8c8d','#673f7c','#eab782','#c0392b','#2c3e50','#1abc9c']

// ── Categorias com subcategorias ─────────────────────────────────────────────
function ModalCategoria({ cat, categorias, onClose, onSaved }) {
  const isNew = !cat?.id
  const [f, setF] = useState({
    nome: cat?.nome || '',
    tipo: cat?.tipo || 'despesa',
    cor: cat?.cor || '#7f8c8d',
    ordem: cat?.ordem || 99,
    parent_id: cat?.parent_id || '',
    nivel: cat?.nivel || 1,
    ativo: cat?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  const pais = categorias.filter(c => c.nivel < f.nivel && c.tipo === f.tipo)
  const nivelLabel = ['Grupo principal','Subcategoria','Sub-subcategoria'][f.nivel-1] || 'Categoria'

  async function salvar() {
    setSaving(true)
    const payload = { ...f, parent_id: f.parent_id || null, nivel: f.parent_id ? 2 : 1 }
    if (isNew) await supabase.from('fin_categorias').insert(payload)
    else await supabase.from('fin_categorias').update(payload).eq('id', cat.id)
    onSaved(); setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:440}}>
        <div className="modal-header">
          <div className="modal-title">{isNew?'Nova categoria':'Editar categoria'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input className="form-input" value={f.nome} onChange={e=>set('nome',e.target.value)} autoFocus
              placeholder={`Nome d${f.nivel===1?'o grupo':f.nivel===2?'a subcategoria':'a sub-subcategoria'}`}/>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select className="form-input" value={f.tipo} onChange={e=>set('tipo',e.target.value)} disabled={!!f.parent_id}>
                <option value="receita">Receita</option>
                <option value="despesa">Despesa</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Nível</label>
              <select className="form-input" value={f.nivel} onChange={e=>set('nivel',parseInt(e.target.value))} disabled={!!f.parent_id}>
                <option value={1}>1 — Grupo principal</option>
                <option value={2}>2 — Subcategoria</option>
                <option value={3}>3 — Sub-subcategoria</option>
              </select>
            </div>
          </div>
          {f.nivel > 1 && (
            <div className="form-group">
              <label className="form-label">Categoria pai *</label>
              <select className="form-input" value={f.parent_id||''} onChange={e=>set('parent_id',e.target.value)}>
                <option value="">Selecione...</option>
                {pais.map(p=>(
                  <option key={p.id} value={p.id}>
                    {'  '.repeat(p.nivel-1)}{p.nivel>1?'└ ':''}{p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Cor</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
              {CORES.map(cor=>(
                <div key={cor} onClick={()=>set('cor',cor)}
                  style={{width:24,height:24,borderRadius:6,background:cor,cursor:'pointer',
                    border:f.cor===cor?'2px solid #333':'2px solid transparent',boxSizing:'border-box'}}/>
              ))}
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Ordem</label>
              <input type="number" className="form-input" value={f.ordem} onChange={e=>set('ordem',parseInt(e.target.value)||99)} />
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
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving?<RefreshCw size={14} className="spin"/>:<Save size={14}/>} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function CatNode({ cat, todos, nivel=1, onEdit, onAdd, onDelete }) {
  const [exp, setExp] = useState(nivel <= 1)
  const filhos = todos.filter(c=>c.parent_id===cat.id).sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))
  const indent = 14 + (nivel-1)*20

  return (
    <div>
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        padding:`8px 14px 8px ${indent}px`,
        borderTop: nivel>1?'1px solid var(--gray-100)':undefined,
        background: nivel===1?'var(--gray-50)':nivel===2?'var(--white)':'#fafafa',
        opacity: cat.ativo?1:.5,
      }}>
        {filhos.length>0
          ? <button onClick={()=>setExp(!exp)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:0,width:14,flexShrink:0}}>
              {exp?<ChevronDown size={13}/>:<ChevronRight size={13}/>}
            </button>
          : <span style={{width:14,flexShrink:0}}/>
        }
        <span style={{width:nivel===1?12:nivel===2?9:7,height:nivel===1?12:nivel===2?9:7,borderRadius:nivel===1?3:2,background:cat.cor,flexShrink:0}}/>
        <span style={{flex:1,fontWeight:nivel===1?700:nivel===2?600:400,fontSize:nivel===1?13:12,color:nivel===3?'var(--gray-600)':'var(--gray-800)'}}>
          {cat.nome}
        </span>
        <span style={{fontSize:10,color:'var(--gray-300)'}}>N{nivel}</span>
        {!cat.ativo && <span className="pill neutral" style={{fontSize:9}}>Inativo</span>}
        <div style={{display:'flex',gap:3}}>
          <button className="btn btn-ghost btn-xs" onClick={()=>onEdit(cat)} title="Editar"><Pencil size={11}/></button>
          {nivel < 3 && (
            <button className="btn btn-ghost btn-xs" title="Adicionar subcategoria"
              onClick={()=>onAdd({tipo:cat.tipo, parent_id:cat.id, nivel:nivel+1, cor:cat.cor})}>
              <Plus size={11}/>
            </button>
          )}
          <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}} title="Excluir"
            onClick={()=>onDelete(cat)}>✕</button>
        </div>
      </div>
      {exp && filhos.map(f=>(
        <CatNode key={f.id} cat={f} todos={todos} nivel={nivel+1} onEdit={onEdit} onAdd={onAdd} onDelete={onDelete}/>
      ))}
    </div>
  )
}

function CategoriasSecao({ tipo }) {
  const [cats, setCats] = useState([])
  const [modal, setModal] = useState(null)

  async function load() {
    const {data} = await supabase.from('fin_categorias').select('*').eq('tipo',tipo).order('nivel').order('ordem').order('nome')
    setCats(data||[])
  }
  useEffect(()=>{load()},[tipo])

  async function excluir(cat) {
    const filhos = cats.filter(c=>c.parent_id===cat.id)
    if (filhos.length>0) { alert(`"${cat.nome}" tem ${filhos.length} subcategoria(s). Exclua primeiro.`); return }
    if (!window.confirm(`Excluir "${cat.nome}"?`)) return
    await supabase.from('fin_categorias').delete().eq('id',cat.id)
    load()
  }

  const raiz = cats.filter(c=>!c.parent_id).sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))

  return (
    <div style={{marginBottom:24}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontWeight:800,fontSize:14,color:tipo==='receita'?'var(--ok)':'var(--danger)'}}>
          {tipo==='receita'?'📈 Receitas':'📉 Despesas'}
        </div>
        <button className="btn btn-primary btn-sm" onClick={()=>setModal({tipo, nivel:1})}>
          <Plus size={13}/> Novo grupo
        </button>
      </div>
      <div style={{border:'1px solid var(--gray-200)',borderRadius:8,overflow:'hidden'}}>
        {raiz.map(g=>(
          <CatNode key={g.id} cat={g} todos={cats} nivel={1}
            onEdit={setModal}
            onAdd={setModal}
            onDelete={excluir}/>
        ))}
        {raiz.length===0 && (
          <div style={{padding:20,textAlign:'center',color:'var(--gray-400)',fontSize:13}}>
            Nenhum grupo cadastrado. Clique em "+ Novo grupo" para começar.
          </div>
        )}
      </div>
      {modal && (
        <ModalCategoria
          cat={modal?.id ? modal : { tipo:modal.tipo, nivel:modal.nivel||1, parent_id:modal.parent_id||null, cor:modal.cor||'#7f8c8d' }}
          categorias={cats}
          onClose={()=>setModal(null)}
          onSaved={()=>{setModal(null);load()}}
        />
      )}
    </div>
  )
}

// ── Seção genérica ────────────────────────────────────────────────────────────
function SecaoSimples({ titulo, tabela, campos, defaults, orderBy = 'nome' }) {
  const [items, setItems] = useState([])
  const [editId, setEditId] = useState(null)
  const [adicionando, setAdicionando] = useState(false)

  async function load() {
    const {data} = await supabase.from(tabela).select('*').order(orderBy)
    setItems(data||[])
  }
  useEffect(()=>{load()},[])

  async function salvar(item) {
    if (item.id) await supabase.from(tabela).update(item).eq('id',item.id)
    else await supabase.from(tabela).insert({...defaults,...item})
    setEditId(null); setAdicionando(false); load()
  }

  async function excluir(item) {
    if (!window.confirm(`Excluir "${item.nome}"? Esta ação não pode ser desfeita.`)) return
    await supabase.from(tabela).delete().eq('id', item.id)
    load()
  }

  function RowEdit({item,onSave,onCancel}) {
    const [f,setF] = useState({...item})

    function handleSave() {
      // Converte campos numéricos antes de salvar
      const converted = {...f}
      for (const c of campos) {
        if (c.type === 'number' && converted[c.key] !== undefined) {
          converted[c.key] = parseFloat(converted[c.key]) || 0
        }
      }
      onSave(converted)
    }

    return (
      <tr style={{background:'var(--purple-ghost)'}}>
        {campos.map(c=>(
          <td key={c.key} style={{padding:'6px 10px'}}>
            {c.key==='ativo'
              ? <input type="checkbox" checked={!!f[c.key]} onChange={e=>setF(p=>({...p,[c.key]:e.target.checked}))} style={{accentColor:'var(--purple)'}}/>
              : c.options
              ? <select className="form-input" style={{padding:'4px 8px',fontSize:12}} value={f[c.key]||''} onChange={e=>setF(p=>({...p,[c.key]:e.target.value}))}>
                  {c.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              : <input className="form-input" style={{padding:'4px 8px',fontSize:12}}
                  type={c.type||'text'}
                  value={f[c.key]??''} onChange={e=>setF(p=>({...p,[c.key]:e.target.value}))}/>}
          </td>
        ))}
        <td style={{padding:'6px 10px'}}>
          <div style={{display:'flex',gap:4}}>
            <button className="btn btn-primary btn-xs" onClick={handleSave}><Save size={11}/></button>
            <button className="btn btn-ghost btn-xs" onClick={onCancel}>✕</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="card" style={{marginBottom:16}}>
      <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:700,fontSize:14}}>{titulo}</div>
        <button className="btn btn-primary btn-sm" onClick={()=>setAdicionando(true)}><Plus size={13}/> Adicionar</button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead><tr>{campos.map(c=><th key={c.key}>{c.label}</th>)}<th></th></tr></thead>
          <tbody>
            {adicionando && <RowEdit item={defaults} onSave={salvar} onCancel={()=>setAdicionando(false)}/>}
            {items.map(item=>editId===item.id
              ? <RowEdit key={item.id} item={item} onSave={salvar} onCancel={()=>setEditId(null)}/>
              : (
                <tr key={item.id} style={{opacity:item.ativo===false?.5:1}}>
                  {campos.map(c=>(
                    <td key={c.key} style={{fontSize:13}}>
                      {c.key==='cor'
                        ? <span style={{width:14,height:14,borderRadius:3,background:item.cor,display:'inline-block'}}/>
                        : c.key==='ativo'
                        ? <span className={`pill ${item.ativo?'ok':'neutral'}`} style={{fontSize:10}}>{item.ativo?'Ativo':'Inativo'}</span>
                        : c.options
                        ? c.options.find(o=>o.value===item[c.key])?.label||item[c.key]||'—'
                        : String(item[c.key]??'—')}
                    </td>
                  ))}
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>setEditId(item.id)}><Pencil size={11}/></button>
                      <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}}
                        onClick={()=>excluir(item)} title="Excluir">✕</button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function FinConfig() {
  const [aba, setAba] = useState('categorias')
  return (
    <>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[
          {id:'categorias',label:'📂 Categorias'},
          {id:'canais',label:'🏷️ Canais'},
          {id:'contas',label:'🏦 Contas'},
          {id:'formas',label:'💳 Formas de Pagamento'},
          {id:'fornecedores',label:'🏭 Fornecedores'},
          {id:'dre',label:'📋 Cascata DRE'},
        ].map(t=>(
          <button key={t.id} className={`btn ${aba===t.id?'btn-primary':'btn-ghost'}`} style={{fontSize:13}} onClick={()=>setAba(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {aba==='categorias' && (
        <>
          <CategoriasSecao tipo="receita"/>
          <CategoriasSecao tipo="despesa"/>
        </>
      )}

      {aba==='canais' && <FinConfigCanais/>}

      {aba==='contas' && (
        <SecaoSimples titulo="🏦 Contas bancárias / Caixas" tabela="fin_contas"
          campos={[
            {key:'nome',label:'Nome'},
            {key:'tipo',label:'Tipo',options:[
              {value:'corrente',label:'Conta Corrente'},
              {value:'poupanca',label:'Poupança'},
              {value:'caixa',label:'Caixa'},
              {value:'cartao',label:'Cartão'},
              {value:'investimento',label:'Investimento'},
            ]},
            {key:'descricao',label:'Descrição'},
            {key:'saldo_inicial',label:'Saldo inicial',type:'number'},
            {key:'ativo',label:'Ativo'},
          ]}
          defaults={{nome:'',tipo:'corrente',descricao:'',saldo_inicial:0,ativo:true}}
        />
      )}

      {aba==='formas' && (
        <SecaoSimples titulo="💳 Formas de Pagamento" tabela="fin_formas_pagamento" orderBy="ordem"
          campos={[
            {key:'nome',label:'Nome'},
            {key:'tipo',label:'Tipo',options:[
              {value:'pix',label:'PIX'},
              {value:'boleto',label:'Boleto'},
              {value:'cartao_credito',label:'Cartão Crédito'},
              {value:'cartao_debito',label:'Cartão Débito'},
              {value:'ted',label:'TED/DOC'},
              {value:'dinheiro',label:'Dinheiro'},
              {value:'outros',label:'Outros'},
            ]},
            {key:'ordem',label:'Ordem'},
            {key:'ativo',label:'Ativo'},
          ]}
          defaults={{nome:'',tipo:'outros',ordem:99,ativo:true}}
        />
      )}

      {aba==='fornecedores' && (
        <SecaoSimples titulo="🏭 Fornecedores" tabela="fin_fornecedores"
          campos={[
            {key:'razao_social',label:'Razão Social'},
            {key:'nome_fantasia',label:'Nome Fantasia'},
            {key:'cnpj',label:'CNPJ'},
            {key:'cidade',label:'Cidade'},
            {key:'uf',label:'UF'},
            {key:'ativo',label:'Ativo'},
          ]}
          defaults={{razao_social:'',nome_fantasia:'',cnpj:'',cidade:'',uf:'SP',ativo:true}}
        />
      )}

      {aba==='dre' && <FinConfigDRE/>}
    </>
  )
}
