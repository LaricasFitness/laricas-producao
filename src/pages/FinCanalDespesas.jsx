import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, Plus, Trash2 } from 'lucide-react'
import { fmtR } from '../lib/financeiro'

export default function FinCanalDespesas() {
  const [canais, setCanais] = useState([])
  const [categorias, setCategorias] = useState([])
  const [regras, setRegras] = useState([])
  const [canalSel, setCanalSel] = useState('')
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [novaRegra, setNovaRegra] = useState({ categoria_id:'', tipo_rateio:'percentual', percentual:'', valor_fixo:'' })

  useEffect(()=>{
    Promise.all([
      supabase.from('fin_canais').select('*').eq('ativo',true).order('ordem'),
      supabase.from('fin_categorias').select('*').eq('tipo','despesa').eq('ativo',true).order('ordem'),
    ]).then(([{data:c},{data:cats}])=>{
      setCanais(c||[])
      setCategorias(cats||[])
      if (c?.length) setCanalSel(c[0].id)
    })
  },[])

  useEffect(()=>{ if(canalSel) carregarRegras() },[canalSel])

  async function carregarRegras() {
    setLoading(true)
    const {data} = await supabase.from('fin_canal_despesas')
      .select('*, fin_categorias(nome)')
      .eq('canal_id',canalSel)
      .eq('ativo',true)
      .order('criado_em')
    setRegras(data||[])
    setLoading(false)
  }

  async function adicionarRegra() {
    if (!novaRegra.categoria_id) return
    setSalvando(true)
    await supabase.from('fin_canal_despesas').upsert({
      canal_id: canalSel,
      categoria_id: novaRegra.categoria_id,
      tipo_rateio: novaRegra.tipo_rateio,
      percentual: parseFloat(novaRegra.percentual)||0,
      valor_fixo: parseFloat(novaRegra.valor_fixo)||0,
      ativo: true,
    },{ onConflict:'canal_id,categoria_id' })
    setNovaRegra({ categoria_id:'', tipo_rateio:'percentual', percentual:'', valor_fixo:'' })
    await carregarRegras()
    setSalvando(false)
  }

  async function removerRegra(id) {
    await supabase.from('fin_canal_despesas').update({ ativo:false }).eq('id',id)
    await carregarRegras()
  }

  async function atualizarRegra(id, campo, valor) {
    await supabase.from('fin_canal_despesas').update({ [campo]: parseFloat(valor)||0 }).eq('id',id)
    setRegras(prev=>prev.map(r=>r.id===id?{...r,[campo]:parseFloat(valor)||0}:r))
  }

  const canalAtivo = canais.find(c=>c.id===canalSel)
  const catsNaoUsadas = categorias.filter(c=>!regras.find(r=>r.categoria_id===c.id))

  return (
    <>
      <div className="card card-pad">
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🏷️ Despesas por Canal</div>
        <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:16 }}>
          Configure quais despesas são alocadas a cada canal e em que proporção. Usado na DRE por canal.
        </div>

        {/* Seletor de canal */}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {canais.map(c=>(
            <button key={c.id}
              className={`btn btn-sm ${canalSel===c.id?'btn-primary':'btn-ghost'}`}
              style={{ borderColor:c.cor, background:canalSel===c.id?c.cor:'' }}
              onClick={()=>setCanalSel(c.id)}>
              {c.nome}
            </button>
          ))}
        </div>
      </div>

      {canalAtivo && (
        <div className="card">
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-200)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontWeight:700, fontSize:14 }}>
              <span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:canalAtivo.cor, marginRight:6 }}/>
              {canalAtivo.nome} — Regras de despesa
            </div>
          </div>

          {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
            <>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)' }}>Categoria de despesa</th>
                    <th style={{ textAlign:'center', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', width:130 }}>Tipo</th>
                    <th style={{ textAlign:'right', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', width:130 }}>% do Fat.</th>
                    <th style={{ textAlign:'right', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', width:140 }}>Valor fixo/mês</th>
                    <th style={{ width:50, padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {regras.map(r=>(
                    <tr key={r.id} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                      <td style={{ padding:'9px 14px', fontWeight:600 }}>{r.fin_categorias?.nome}</td>
                      <td style={{ padding:'9px 14px', textAlign:'center' }}>
                        <select className="form-input" style={{ padding:'4px 8px', fontSize:12, width:120 }}
                          value={r.tipo_rateio}
                          onChange={async e=>{
                            await supabase.from('fin_canal_despesas').update({ tipo_rateio:e.target.value }).eq('id',r.id)
                            setRegras(prev=>prev.map(x=>x.id===r.id?{...x,tipo_rateio:e.target.value}:x))
                          }}>
                          <option value="percentual">% Faturamento</option>
                          <option value="fixo">Valor fixo</option>
                          <option value="ambos">Ambos</option>
                        </select>
                      </td>
                      <td style={{ padding:'9px 14px', textAlign:'right' }}>
                        {(r.tipo_rateio==='percentual'||r.tipo_rateio==='ambos') && (
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4 }}>
                            <input type="number" min={0} max={100} step={0.1}
                              defaultValue={r.percentual}
                              onBlur={e=>atualizarRegra(r.id,'percentual',e.target.value)}
                              style={{ width:70, padding:'4px 8px', fontSize:12, textAlign:'right', border:'1px solid var(--gray-200)', borderRadius:6 }}/>
                            <span style={{ fontSize:12, color:'var(--gray-500)' }}>%</span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding:'9px 14px', textAlign:'right' }}>
                        {(r.tipo_rateio==='fixo'||r.tipo_rateio==='ambos') && (
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4 }}>
                            <span style={{ fontSize:12, color:'var(--gray-500)' }}>R$</span>
                            <input type="number" min={0} step={10}
                              defaultValue={r.valor_fixo}
                              onBlur={e=>atualizarRegra(r.id,'valor_fixo',e.target.value)}
                              style={{ width:90, padding:'4px 8px', fontSize:12, textAlign:'right', border:'1px solid var(--gray-200)', borderRadius:6 }}/>
                          </div>
                        )}
                      </td>
                      <td style={{ padding:'9px 14px', textAlign:'center' }}>
                        <button className="btn btn-ghost btn-xs" style={{ color:'var(--danger)' }}
                          onClick={()=>removerRegra(r.id)}><Trash2 size={12}/></button>
                      </td>
                    </tr>
                  ))}

                  {/* Nova regra */}
                  <tr style={{ background:'var(--purple-ghost)', borderTop:'2px solid var(--gray-200)' }}>
                    <td style={{ padding:'10px 14px' }}>
                      <select className="form-input" style={{ padding:'5px 8px', fontSize:12 }}
                        value={novaRegra.categoria_id}
                        onChange={e=>setNovaRegra(prev=>({...prev,categoria_id:e.target.value}))}>
                        <option value="">Selecione uma categoria...</option>
                        {catsNaoUsadas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      <select className="form-input" style={{ padding:'5px 8px', fontSize:12, width:120 }}
                        value={novaRegra.tipo_rateio}
                        onChange={e=>setNovaRegra(prev=>({...prev,tipo_rateio:e.target.value}))}>
                        <option value="percentual">% Faturamento</option>
                        <option value="fixo">Valor fixo</option>
                        <option value="ambos">Ambos</option>
                      </select>
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'right' }}>
                      {(novaRegra.tipo_rateio==='percentual'||novaRegra.tipo_rateio==='ambos') && (
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4 }}>
                          <input type="number" min={0} max={100} step={0.1} placeholder="0"
                            value={novaRegra.percentual}
                            onChange={e=>setNovaRegra(prev=>({...prev,percentual:e.target.value}))}
                            style={{ width:70, padding:'4px 8px', fontSize:12, textAlign:'right', border:'1px solid var(--gray-200)', borderRadius:6 }}/>
                          <span style={{ fontSize:12, color:'var(--gray-500)' }}>%</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'right' }}>
                      {(novaRegra.tipo_rateio==='fixo'||novaRegra.tipo_rateio==='ambos') && (
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4 }}>
                          <span style={{ fontSize:12, color:'var(--gray-500)' }}>R$</span>
                          <input type="number" min={0} step={10} placeholder="0"
                            value={novaRegra.valor_fixo}
                            onChange={e=>setNovaRegra(prev=>({...prev,valor_fixo:e.target.value}))}
                            style={{ width:90, padding:'4px 8px', fontSize:12, textAlign:'right', border:'1px solid var(--gray-200)', borderRadius:6 }}/>
                        </div>
                      )}
                    </td>
                    <td style={{ padding:'10px 14px', textAlign:'center' }}>
                      <button className="btn btn-primary btn-sm" onClick={adicionarRegra} disabled={!novaRegra.categoria_id||salvando}>
                        <Plus size={12}/>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              {regras.length===0 && (
                <div style={{ padding:'24px', textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>
                  Nenhuma regra configurada para {canalAtivo.nome}. Adicione despesas acima.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card card-pad" style={{ background:'var(--gray-50)' }}>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>💡 Como funciona</div>
        <div style={{ fontSize:12, color:'var(--gray-600)', lineHeight:1.8 }}>
          <div><strong>% do Faturamento:</strong> Ex: iFood BV tem 15% de comissão → Taxas/Comissões = 15% do faturamento do canal</div>
          <div><strong>Valor fixo:</strong> Ex: ECOM tem R$200/mês de sistema de checkout → Sistemas = R$200 fixos</div>
          <div><strong>Ambos:</strong> Usa % do faturamento + valor fixo somados</div>
          <div style={{ marginTop:8, color:'var(--purple)', fontWeight:600 }}>As regras são usadas na DRE por canal para calcular automaticamente as despesas alocadas.</div>
        </div>
      </div>
    </>
  )
}
