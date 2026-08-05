import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, RefreshCw, Save, ChevronDown, ChevronUp, Pencil } from 'lucide-react'

function fmt(n, d=2) { return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}) }

// Recalcula média dos últimos 10 e atualiza a preparação
async function recalcularMedia(preparacao_id) {
  const { data: hist } = await supabase
    .from('preparacao_rendimento')
    .select('rendimento_por_receita')
    .eq('preparacao_id', preparacao_id)
    .order('criado_em', { ascending: false })
    .limit(10)
  if (!hist?.length) {
    await supabase.from('preparacoes').update({ rendimento_real_medio: null }).eq('id', preparacao_id)
    return
  }
  const media = hist.reduce((s,r) => s + parseFloat(r.rendimento_por_receita||0), 0) / hist.length
  await supabase.from('preparacoes').update({ rendimento_real_medio: media, atualizado_em: new Date().toISOString() }).eq('id', preparacao_id)
}

// ── Modal: registrar ou editar rendimento ────────────────────────────────────
function ModalRendimento({ prep, registro, onClose, onSaved }) {
  const isEdit = !!registro
  const [form, setForm] = useState({
    num_receitas:    registro ? String(registro.num_receitas) : '1',
    rendimento_total: registro ? String(registro.rendimento_total) : '',
    data_producao:   registro ? registro.data_producao : new Date().toISOString().slice(0,10),
    responsavel:     registro?.responsavel || 'Virgínia',
    observacao:      registro?.observacao || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const rendPorReceita = form.num_receitas && form.rendimento_total
    ? parseFloat(form.rendimento_total) / parseFloat(form.num_receitas) : null
  const rendEstimado = parseFloat(prep.rendimento_estimado) || 0
  const variacao = rendPorReceita && rendEstimado
    ? ((rendPorReceita - rendEstimado) / rendEstimado) * 100 : null

  async function salvar() {
    if (!form.num_receitas || !form.rendimento_total) return
    setSaving(true)
    const numRec = parseFloat(form.num_receitas)
    const rendTotal = parseFloat(form.rendimento_total)
    const payload = {
      preparacao_id: prep.id,
      num_receitas: numRec,
      rendimento_total: rendTotal,
      data_producao: form.data_producao,
      responsavel: form.responsavel,
      observacao: form.observacao || null,
    }
    if (isEdit) {
      await supabase.from('preparacao_rendimento').update(payload).eq('id', registro.id)
    } else {
      await supabase.from('preparacao_rendimento').insert(payload)
    }
    await recalcularMedia(prep.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:460}}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{isEdit ? '✏️ Editar' : '📊 Registrar'} Rendimento Real</div>
            <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>{prep.nome}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{padding:'10px 14px',background:'var(--purple-pale)',borderRadius:8,marginBottom:16,fontSize:13}}>
            <div style={{fontWeight:700,color:'var(--purple)',marginBottom:4}}>Referência da ficha técnica</div>
            <div style={{display:'flex',gap:20}}>
              <div>
                <div style={{fontSize:11,color:'var(--gray-400)'}}>Estimado por receita</div>
                <div style={{fontWeight:800}}>{fmt(rendEstimado,1)} {prep.unidade_rendimento}</div>
              </div>
              {prep.rendimento_real_medio && (
                <div>
                  <div style={{fontSize:11,color:'var(--gray-400)'}}>Média real atual (últimos 10)</div>
                  <div style={{fontWeight:800,color:'var(--ok)'}}>{fmt(prep.rendimento_real_medio,1)} {prep.unidade_rendimento}</div>
                </div>
              )}
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Nº de receitas feitas *</label>
              <input type="number" className="form-input" value={form.num_receitas}
                onChange={e=>set('num_receitas',e.target.value)} min={0.5} step={0.5} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Rendimento total ({prep.unidade_rendimento}) *</label>
              <input type="number" className="form-input" value={form.rendimento_total}
                onChange={e=>set('rendimento_total',e.target.value)} min={0} step={0.1}
                placeholder={`ex: ${fmt(rendEstimado * parseFloat(form.num_receitas||1), 0)}`} />
            </div>
          </div>

          {rendPorReceita !== null && (
            <div style={{
              padding:'10px 14px', borderRadius:8, marginBottom:12,
              background: variacao !== null && Math.abs(variacao) > 10 ? '#fff8f0' : '#f0faf0',
              border: `1.5px solid ${variacao !== null && Math.abs(variacao) > 10 ? 'var(--warning)' : 'var(--ok)'}`,
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:11,color:'var(--gray-400)'}}>Rendimento por receita</div>
                  <div style={{fontSize:18,fontWeight:800,color:'var(--purple)'}}>
                    {fmt(rendPorReceita,1)} {prep.unidade_rendimento}
                  </div>
                </div>
                {variacao !== null && (
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:11,color:'var(--gray-400)'}}>vs. estimado</div>
                    <div style={{fontSize:16,fontWeight:800,
                      color: Math.abs(variacao)<=5?'var(--ok)':Math.abs(variacao)<=15?'var(--warning)':'var(--danger)'}}>
                      {variacao>0?'+':''}{fmt(variacao,1)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Data da produção</label>
              <input type="date" className="form-input" value={form.data_producao}
                onChange={e=>set('data_producao',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Responsável</label>
              <input className="form-input" value={form.responsavel}
                onChange={e=>set('responsavel',e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={form.observacao}
              onChange={e=>set('observacao',e.target.value)}
              placeholder="Ex: massa ficou mais firme que o habitual" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}
            disabled={saving||!form.num_receitas||!form.rendimento_total}>
            {saving ? <><RefreshCw size={14} className="spin"/> Salvando...</> : <><Save size={14}/> {isEdit?'Salvar alterações':'Registrar'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Rendimentos() {
  const [preps, setPreps] = useState([])
  const [historico, setHistorico] = useState({})
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // { prep, registro? }
  const [expandido, setExpandido] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [excluindo, setExcluindo] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: prepsData }, { data: histData }] = await Promise.all([
      supabase.from('preparacoes').select('*').eq('ativo',true).order('tipo').order('nome'),
      supabase.from('preparacao_rendimento').select('*').order('data_producao', { ascending: false }).order('criado_em', { ascending: false }),
    ])
    setPreps(prepsData||[])
    const map = {}
    for (const r of (histData||[])) {
      if (!map[r.preparacao_id]) map[r.preparacao_id] = []
      map[r.preparacao_id].push(r)
    }
    setHistorico(map)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function excluir(r, prep) {
    if (!window.confirm(`Excluir registro de ${new Date(r.data_producao+'T12:00:00').toLocaleDateString('pt-BR')} — ${fmt(r.rendimento_total,1)} ${prep.unidade_rendimento}?`)) return
    setExcluindo(r.id)
    await supabase.from('preparacao_rendimento').delete().eq('id', r.id)
    await recalcularMedia(prep.id)
    setExcluindo(null)
    load()
  }

  function afterSave() { setModal(null); load() }

  const TIPO_ICON = { massa:'🍞', recheio:'🥄', creme:'🍮', cobertura:'🍫', cha:'🍵', outro:'📦' }
  const filtradas = preps.filter(p => !filtro || p.nome.toLowerCase().includes(filtro.toLowerCase()))

  const comHistorico = preps.filter(p => (historico[p.id]||[]).length > 0).length
  const comMedia = preps.filter(p => p.rendimento_real_medio).length
  const totalRegistros = Object.values(historico).reduce((s,h) => s+h.length, 0)

  return (
    <>
      {modal && <ModalRendimento prep={modal.prep} registro={modal.registro||null} onClose={()=>setModal(null)} onSaved={afterSave} />}

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:12}}>
        {[
          {label:'Registros de rendimento',valor:totalRegistros,sub:'lançamentos históricos',cor:'var(--purple)'},
          {label:'Preparações com histórico',valor:comHistorico,sub:`de ${preps.length} preparações`,cor:'var(--ok)'},
          {label:'Com média calculada',valor:comMedia,sub:'usadas na precificação',cor:'#0a7c4e'},
        ].map(k=>(
          <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
            <div style={{fontSize:11,color:'var(--gray-400)'}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center'}}>
          <div style={{fontWeight:800,fontSize:15}}>📊 Rendimentos por Preparação</div>
          <div style={{flex:1}}/>
          <input className="form-input" placeholder="Filtrar..." value={filtro}
            onChange={e=>setFiltro(e.target.value)} style={{width:200,fontSize:13}}/>
          <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={14}/></button>
        </div>

        {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
          <div style={{display:'flex',flexDirection:'column'}}>
            {filtradas.map((p,i) => {
              const hist = historico[p.id] || []
              const exp = expandido === p.id
              const rendEst = parseFloat(p.rendimento_estimado)||0
              const rendMedio = parseFloat(p.rendimento_real_medio)||0
              const variacao = rendMedio && rendEst ? ((rendMedio-rendEst)/rendEst*100) : null

              return (
                <div key={p.id} style={{borderTop: i>0?'1px solid var(--gray-100)':undefined}}>
                  <div style={{
                    padding:'11px 20px', display:'grid',
                    gridTemplateColumns:'32px 1fr 140px 140px 120px 100px auto',
                    gap:10, alignItems:'center',
                    background: i%2===0?'#fff':'#fafafa',
                    cursor: hist.length>0 ? 'pointer' : 'default',
                  }} onClick={()=>hist.length>0 && setExpandido(exp?null:p.id)}>
                    <div style={{fontSize:18}}>{TIPO_ICON[p.tipo]||'📦'}</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{p.nome}</div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>{p.tipo} · {hist.length} registros</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Estimado</div>
                      <div style={{fontWeight:700}}>{fmt(rendEst,1)} {p.unidade_rendimento}</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Média real</div>
                      {rendMedio > 0
                        ? <div style={{fontWeight:800,color:'var(--ok)'}}>{fmt(rendMedio,1)} {p.unidade_rendimento}</div>
                        : <div style={{color:'var(--gray-300)',fontSize:12}}>sem dados</div>}
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Variação</div>
                      {variacao !== null
                        ? <div style={{fontWeight:800,
                            color:Math.abs(variacao)<=5?'var(--ok)':Math.abs(variacao)<=15?'var(--warning)':'var(--danger)'}}>
                            {variacao>0?'+':''}{fmt(variacao,1)}%
                          </div>
                        : <div style={{color:'var(--gray-300)',fontSize:12}}>—</div>}
                    </div>
                    <div style={{textAlign:'center'}}>
                      <span style={{
                        fontSize:11,padding:'3px 10px',borderRadius:12,fontWeight:700,
                        background: hist.length>0?'var(--purple-pale)':'var(--gray-100)',
                        color: hist.length>0?'var(--purple)':'var(--gray-400)',
                      }}>{hist.length} reg.</span>
                    </div>
                    <div style={{display:'flex',gap:4,alignItems:'center'}}>
                      <button className="btn btn-primary btn-sm"
                        onClick={e=>{e.stopPropagation();setModal({prep:p})}}>
                        <Plus size={12}/> Registrar
                      </button>
                      {hist.length>0 && (exp
                        ? <ChevronUp size={14} style={{color:'var(--gray-400)'}}/>
                        : <ChevronDown size={14} style={{color:'var(--gray-400)'}}/>)}
                    </div>
                  </div>

                  {/* Histórico expandido */}
                  {exp && hist.length > 0 && (
                    <div style={{background:'#f8f5ff',borderTop:'1px solid var(--gray-100)',padding:'0 20px 12px'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:10}}>
                        <thead>
                          <tr style={{background:'var(--gray-50)'}}>
                            <th style={{padding:'6px 12px',textAlign:'left',fontWeight:600,color:'var(--gray-500)'}}>Data</th>
                            <th style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-500)'}}>Receitas</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>Total rendido</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--purple)'}}>Por receita</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>vs. estimado</th>
                            <th style={{padding:'6px 12px',textAlign:'left',fontWeight:600,color:'var(--gray-500)'}}>Responsável</th>
                            <th style={{padding:'6px 12px',textAlign:'left',fontWeight:600,color:'var(--gray-500)'}}>Obs.</th>
                            <th style={{padding:'6px 10px',width:60}}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {hist.map((r,ri) => {
                            const rPorRec = parseFloat(r.rendimento_por_receita)||0
                            const rendEst2 = parseFloat(p.rendimento_estimado)||0
                            const var2 = rendEst2>0 ? ((rPorRec-rendEst2)/rendEst2*100) : null
                            return (
                              <tr key={r.id} style={{borderTop:'1px solid var(--gray-100)',background:ri%2===0?'#fff':'#f8f5ff'}}>
                                <td style={{padding:'6px 12px',color:'var(--gray-500)'}}>
                                  {new Date(r.data_producao+'T12:00:00').toLocaleDateString('pt-BR')}
                                </td>
                                <td style={{padding:'6px 10px',textAlign:'center'}}>{fmt(r.num_receitas,1)}</td>
                                <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(r.rendimento_total,1)} {p.unidade_rendimento}</td>
                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>{fmt(rPorRec,1)} {p.unidade_rendimento}</td>
                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600,
                                  color:var2===null?'var(--gray-300)':Math.abs(var2)<=5?'var(--ok)':Math.abs(var2)<=15?'var(--warning)':'var(--danger)'}}>
                                  {var2!==null ? `${var2>0?'+':''}${fmt(var2,1)}%` : '—'}
                                </td>
                                <td style={{padding:'6px 12px',color:'var(--gray-500)'}}>{r.responsavel||'—'}</td>
                                <td style={{padding:'6px 12px',color:'var(--gray-400)',fontStyle:'italic'}}>{r.observacao||'—'}</td>
                                <td style={{padding:'6px 10px',textAlign:'center'}}>
                                  <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                                    <button className="btn btn-ghost btn-sm"
                                      onClick={e=>{e.stopPropagation();setModal({prep:p,registro:r})}}
                                      title="Editar">
                                      <Pencil size={11}/>
                                    </button>
                                    <button className="btn btn-ghost btn-sm"
                                      onClick={e=>{e.stopPropagation();excluir(r,p)}}
                                      disabled={excluindo===r.id}
                                      style={{color:'var(--danger)'}} title="Excluir">
                                      {excluindo===r.id ? <RefreshCw size={11} className="spin"/> : '✕'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
