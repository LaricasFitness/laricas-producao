import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Pencil, Save, RefreshCw } from 'lucide-react'

const CORES = ['#e74c3c','#9b59b6','#2980b9','#27ae60','#f39c12','#1abc9c','#e67e22','#8e44ad','#16a085','#7f8c8d','#673f7c','#eab782']

function RowEdit({ item, campos, onSave, onCancel }) {
  const [f, setF] = useState({ ...item })
  return (
    <tr style={{ background:'var(--purple-ghost)' }}>
      {campos.map(c => (
        <td key={c.key}>
          {c.key === 'cor' ? (
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              {CORES.map(cor => (
                <div key={cor} onClick={() => setF(p=>({...p,cor}))}
                  style={{ width:20,height:20,borderRadius:4,background:cor,cursor:'pointer',border:f.cor===cor?'2px solid #333':'2px solid transparent' }} />
              ))}
            </div>
          ) : c.key === 'tipo' ? (
            <select className="form-input" style={{ padding:'4px 8px',fontSize:12 }} value={f[c.key]||''} onChange={e=>setF(p=>({...p,[c.key]:e.target.value}))}>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
            </select>
          ) : c.key === 'ativo' ? (
            <input type="checkbox" checked={f[c.key]||false} onChange={e=>setF(p=>({...p,[c.key]:e.target.checked}))} style={{ accentColor:'var(--purple)' }} />
          ) : (
            <input className="form-input" style={{ padding:'4px 8px',fontSize:12 }} value={f[c.key]||''} onChange={e=>setF(p=>({...p,[c.key]:e.target.value}))} />
          )}
        </td>
      ))}
      <td>
        <div style={{ display:'flex', gap:4 }}>
          <button className="btn btn-primary btn-xs" onClick={() => onSave(f)}><Save size={11} /></button>
          <button className="btn btn-ghost btn-xs" onClick={onCancel}>✕</button>
        </div>
      </td>
    </tr>
  )
}

function Secao({ titulo, tabela, campos, defaults }) {
  const [items, setItems] = useState([])
  const [editId, setEditId] = useState(null)
  const [adicionando, setAdicionando] = useState(false)

  async function load() {
    const { data } = await supabase.from(tabela).select('*').order('ordem')
    setItems(data || [])
  }
  useEffect(() => { load() }, [])

  async function salvar(item) {
    if (item.id) {
      await supabase.from(tabela).update(item).eq('id', item.id)
    } else {
      await supabase.from(tabela).insert({ ...defaults, ...item })
    }
    setEditId(null); setAdicionando(false); load()
  }

  return (
    <div className="card" style={{ marginBottom:16 }}>
      <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--gray-200)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontWeight:700, fontSize:14 }}>{titulo}</div>
        <button className="btn btn-primary btn-sm" onClick={() => setAdicionando(true)}><Plus size={13} /> Adicionar</button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              {campos.map(c => <th key={c.key}>{c.label}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {adicionando && (
              <RowEdit item={defaults} campos={campos} onSave={salvar} onCancel={() => setAdicionando(false)} />
            )}
            {items.map(item => editId === item.id ? (
              <RowEdit key={item.id} item={item} campos={campos} onSave={salvar} onCancel={() => setEditId(null)} />
            ) : (
              <tr key={item.id} style={{ opacity: item.ativo===false ? .5 : 1 }}>
                {campos.map(c => (
                  <td key={c.key}>
                    {c.key === 'cor' ? <span style={{ width:16,height:16,borderRadius:4,background:item.cor,display:'inline-block' }} />
                    : c.key === 'ativo' ? <span className={`pill ${item.ativo?'ok':'neutral'}`} style={{ fontSize:10 }}>{item.ativo?'Ativo':'Inativo'}</span>
                    : String(item[c.key] ?? '—')}
                  </td>
                ))}
                <td><button className="btn btn-ghost btn-xs" onClick={() => setEditId(item.id)}><Pencil size={11} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function FinConfig() {
  return (
    <>
      <Secao titulo="📂 Categorias" tabela="fin_categorias"
        campos={[
          { key:'nome', label:'Nome' },
          { key:'tipo', label:'Tipo' },
          { key:'cor', label:'Cor' },
          { key:'ordem', label:'Ordem' },
          { key:'ativo', label:'Ativo' },
        ]}
        defaults={{ nome:'', tipo:'despesa', cor:'#7f8c8d', ordem:99, ativo:true }}
      />
      <Secao titulo="🏷️ Canais / Origens" tabela="fin_canais"
        campos={[
          { key:'nome', label:'Nome' },
          { key:'cor', label:'Cor' },
          { key:'ordem', label:'Ordem' },
          { key:'ativo', label:'Ativo' },
        ]}
        defaults={{ nome:'', cor:'#7f8c8d', ordem:99, ativo:true }}
      />
      <Secao titulo="🏦 Contas bancárias / Caixas" tabela="fin_contas"
        campos={[
          { key:'nome', label:'Nome' },
          { key:'tipo', label:'Tipo' },
          { key:'saldo_inicial', label:'Saldo inicial' },
          { key:'ativo', label:'Ativo' },
        ]}
        defaults={{ nome:'', tipo:'corrente', saldo_inicial:0, ativo:true }}
      />
    </>
  )
}
