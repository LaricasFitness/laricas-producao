import { useState, useEffect } from 'react'
import Dashboard from './Dashboard'
import Pedidos from './Pedidos'
import Compras from './Compras'
import LogGeral from './LogGeral'
import { supabase } from '../supabase'
import { calcularEstoqueCronologico } from '../lib/data'
import { RefreshCw, Save, CheckCircle, Pencil } from 'lucide-react'

function fmt(n, d=0) { return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}) }

// ── Conferência de Estoque ────────────────────────────────────────────────────
function ConferenciaEstoque({ onSalvo }) {
  const [embs, setEmbs] = useState([])
  const [contagens, setContagens] = useState({}) // id → valor contado
  const [responsavel, setResponsavel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [historico, setHistorico] = useState([])
  const [aba, setAba] = useState('conferir')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('embalagens')
      .select('id, codigo, nome, categoria, tipo')
      .eq('ativo', true)
      .order('tipo').order('categoria').order('nome')

    if (!data) { setLoading(false); return }

    const estoques = await Promise.all(data.map(e => calcularEstoqueCronologico(e.id)))
    setEmbs(data.map((e, i) => ({ ...e, estoque_sistema: estoques[i] })))
    setLoading(false)
  }

  async function loadHistorico() {
    const { data } = await supabase.from('conferencia_estoque')
      .select('*, embalagens(nome, codigo, categoria)')
      .order('criado_em', { ascending: false })
      .limit(100)
    setHistorico(data || [])
  }

  useEffect(() => { load(); loadHistorico() }, [])

  async function confirmarConferencia() {
    const itensComDivergencia = embs.filter(e => contagens[e.id] !== undefined && contagens[e.id] !== '')
    if (!itensComDivergencia.length) { alert('Nenhuma contagem lançada.'); return }
    setSaving(true)

    for (const emb of itensComDivergencia) {
      const contado = parseInt(contagens[emb.id])
      const sistema = emb.estoque_sistema

      // Registra conferência
      await supabase.from('conferencia_estoque').insert({
        embalagem_id: emb.id,
        data_conferencia: new Date().toISOString().slice(0, 10),
        estoque_sistema: sistema,
        estoque_contado: contado,
        responsavel: responsavel || null,
        ajuste_aplicado: true,
      })

      // Aplica ajuste via inventário para TODOS os itens conferidos (não só divergentes)
      const { error: invErr } = await supabase.from('inventarios').insert({
        embalagem_id: emb.id,
        quantidade: contado,
        data_inventario: new Date().toISOString().slice(0, 10),
        observacao: `Conferência física — sistema: ${sistema}, contado: ${contado}${responsavel ? ` — ${responsavel}` : ''}`,
      })
      if (invErr) console.error('Erro ao inserir inventário:', invErr)
    }

    setSaving(false)
    setContagens({})
    await load()
    await loadHistorico()
    setAba('historico')
    onSalvo?.() // atualiza situação com novos estoques
  }

  const [editando, setEditando] = useState(null) // registro de conferência sendo editado
  const [editQtd, setEditQtd] = useState('')

  async function salvarEdicao() {
    if (!editando || editQtd === '') return
    const novaQtd = parseInt(editQtd)

    // Atualiza conferencia_estoque
    await supabase.from('conferencia_estoque')
      .update({ estoque_contado: novaQtd })
      .eq('id', editando.id)

    // Atualiza o inventário correspondente
    await supabase.from('inventarios')
      .update({ quantidade: novaQtd })
      .eq('embalagem_id', editando.embalagem_id)
      .eq('data_inventario', editando.data_conferencia)
      .gte('criado_em', editando.criado_em)

    setEditando(null)
    setEditQtd('')
    await loadHistorico()
    onSalvo?.()
  }

  async function excluirConferencia(c) {
    if (!window.confirm(`Excluir conferência de ${new Date(c.data_conferencia+'T12:00:00').toLocaleDateString('pt-BR')} — ${c.embalagens?.nome}?\n\nO inventário ajustado será removido e o estoque voltará ao valor anterior.`)) return

    await supabase.from('inventarios')
      .delete()
      .eq('embalagem_id', c.embalagem_id)
      .eq('data_inventario', c.data_conferencia)
      .gte('criado_em', c.criado_em)

    await supabase.from('conferencia_estoque').delete().eq('id', c.id)

    await loadHistorico()
    onSalvo?.()
  }

  const itensLancados = embs.filter(e => contagens[e.id] !== undefined && contagens[e.id] !== '')
  const comDivergencia = itensLancados.filter(e => parseInt(contagens[e.id]) !== e.estoque_sistema)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Abas internas */}
      <div style={{display:'flex',gap:6}}>
        <button className={`btn btn-sm ${aba==='conferir'?'btn-primary':'btn-ghost'}`} onClick={()=>setAba('conferir')}>
          🔍 Conferir estoque
        </button>
        <button className={`btn btn-sm ${aba==='historico'?'btn-primary':'btn-ghost'}`} onClick={()=>setAba('historico')}>
          📋 Histórico de conferências
        </button>
      </div>

      {aba === 'conferir' && (
        <>
          {/* Cabeçalho */}
          <div className="card card-pad" style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
            <div>
              <div style={{fontWeight:800,fontSize:14}}>🔍 Conferência de Estoque</div>
              <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>
                Digite a contagem física. Apenas os itens preenchidos serão ajustados.
              </div>
            </div>
            <div style={{flex:1}}/>
            <input className="form-input" placeholder="Responsável pela contagem"
              value={responsavel} onChange={e=>setResponsavel(e.target.value)}
              style={{width:220,fontSize:13}}/>
            <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
          </div>

          {/* KPIs */}
          {itensLancados.length > 0 && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {[
                {label:'Itens conferidos',valor:itensLancados.length,cor:'var(--purple)'},
                {label:'Com divergência',valor:comDivergencia.length,cor:comDivergencia.length>0?'var(--danger)':'var(--ok)'},
                {label:'Sem divergência',valor:itensLancados.length-comDivergencia.length,cor:'var(--ok)'},
              ].map(k=>(
                <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
                  <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>{k.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
                </div>
              ))}
            </div>
          )}

          {/* Lista de embalagens */}
          {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
            <div className="card">
              {[...new Set(embs.map(e=>e.categoria))].map(cat => {
                const grupo = embs.filter(e=>e.categoria===cat)
                return (
                  <div key={cat}>
                    <div style={{padding:'8px 20px',background:'var(--gray-50)',borderTop:'1px solid var(--gray-200)',
                      fontWeight:800,fontSize:12,color:'var(--gray-600)',textTransform:'uppercase',letterSpacing:'.05em'}}>
                      {cat}
                    </div>
                    {grupo.map((e,i) => {
                      const contado = contagens[e.id]
                      const temContagem = contado !== undefined && contado !== ''
                      const diff = temContagem ? parseInt(contado) - e.estoque_sistema : null
                      const diverge = diff !== null && diff !== 0
                      return (
                        <div key={e.id} style={{
                          padding:'10px 20px',
                          display:'grid',gridTemplateColumns:'1fr 120px 130px 130px',
                          gap:12,alignItems:'center',
                          borderTop:'1px solid var(--gray-100)',
                          background: diverge?'#fff5f5':temContagem&&!diverge?'#f0faf0':i%2===0?'#fff':'#fafafa',
                        }}>
                          <div>
                            <div style={{fontWeight:600,fontSize:13}}>{e.nome}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>
                              {e.codigo}
                              <span style={{marginLeft:6,padding:'1px 6px',borderRadius:8,fontSize:10,fontWeight:700,
                                background:e.tipo==='rotulo'?'#f0eaff':'#e8f5e9',
                                color:e.tipo==='rotulo'?'var(--purple)':'#2e7d32'}}>
                                {e.tipo==='rotulo'?'Rótulo':'Embalagem'}
                              </span>
                            </div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Sistema</div>
                            <div style={{fontWeight:700,fontSize:14}}>{fmt(e.estoque_sistema)}</div>
                          </div>
                          <div>
                            <input type="number" min={0}
                              value={contagens[e.id]||''}
                              onChange={ev=>setContagens(p=>({...p,[e.id]:ev.target.value}))}
                              placeholder="Contagem física"
                              style={{
                                width:'100%',padding:'6px 10px',fontSize:13,textAlign:'right',
                                border:`1.5px solid ${diverge?'var(--danger)':temContagem?'var(--ok)':'var(--gray-200)'}`,
                                borderRadius:6,outline:'none',
                                background:diverge?'#fff0f0':temContagem?'#f0faf0':'#fff',
                              }}/>
                          </div>
                          <div style={{textAlign:'center'}}>
                            {diff !== null && (
                              <span style={{
                                fontWeight:800,fontSize:14,
                                color:diff>0?'var(--ok)':diff<0?'var(--danger)':'var(--gray-400)'
                              }}>
                                {diff>0?'+':''}{fmt(diff)} un
                                {!diverge && <span style={{fontSize:11}}> ✓</span>}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* Botão confirmar */}
          {itensLancados.length > 0 && (
            <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>setContagens({})}>Limpar</button>
              <button className="btn btn-primary" onClick={confirmarConferencia} disabled={saving}>
                {saving
                  ? <><RefreshCw size={14} className="spin"/> Salvando...</>
                  : <><CheckCircle size={14}/> Confirmar e ajustar estoque ({itensLancados.length} itens)</>
                }
              </button>
            </div>
          )}
        </>
      )}

      {aba === 'historico' && (
        <>
          {/* Modal de edição inline */}
          {editando && (
            <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditando(null)}>
              <div className="modal" style={{maxWidth:400}}>
                <div className="modal-header">
                  <div>
                    <div className="modal-title">✏️ Editar Contagem</div>
                    <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>{editando.embalagens?.nome}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setEditando(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div style={{display:'flex',gap:16,marginBottom:16,padding:'10px 14px',background:'var(--purple-pale)',borderRadius:8,fontSize:13}}>
                    <div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>Sistema na época</div>
                      <div style={{fontWeight:700}}>{editando.estoque_sistema}</div>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>Contado anteriormente</div>
                      <div style={{fontWeight:700}}>{editando.estoque_contado}</div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nova contagem física</label>
                    <input type="number" className="form-input" value={editQtd} min={0}
                      onChange={e=>setEditQtd(e.target.value)} autoFocus/>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-ghost" onClick={()=>setEditando(null)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={salvarEdicao} disabled={editQtd===''}>
                    <Save size={14}/> Salvar
                  </button>
                </div>
              </div>
            </div>
          )}
          {historico.length > 0 && (() => {
            const porDia = {}
            for (const c of historico) {
              const d = c.data_conferencia
              if (!porDia[d]) porDia[d] = { data: d, itens: 0, divergentes: 0, sistema: 0, contado: 0, impacto: 0 }
              const sis = parseFloat(c.estoque_sistema) || 0
              const con = parseFloat(c.estoque_contado) || 0
              const pu  = parseFloat(c.embalagens?.custo_unitario) || 0
              porDia[d].itens++
              if (Math.abs(con - sis) > 0.001) porDia[d].divergentes++
              porDia[d].sistema += sis * pu
              porDia[d].contado += con * pu
              porDia[d].impacto += (con - sis) * pu
            }
            const dias = Object.values(porDia).sort((a, b) => b.data.localeCompare(a.data))
            const totalImpacto = dias.reduce((s, d) => s + d.impacto, 0)
            return (
              <div className="card" style={{marginBottom:12}}>
                <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15}}>📊 Comparação por dia</div>
                    <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2}}>previsto pelo sistema × contado, valorizado ao custo do rótulo</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Impacto acumulado</div>
                    <div style={{fontSize:20,fontWeight:800,color: Math.abs(totalImpacto) < 0.01 ? 'var(--gray-400)' : totalImpacto < 0 ? 'var(--danger)' : 'var(--ok)'}}>
                      {totalImpacto >= 0 ? '+' : '−'}R$ {fmt(Math.abs(totalImpacto),2)}
                    </div>
                  </div>
                </div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                      <th style={{padding:'8px 14px',textAlign:'left'}}>Data</th>
                      <th style={{padding:'8px 10px',textAlign:'center'}}>Itens</th>
                      <th style={{padding:'8px 10px',textAlign:'center'}}>Divergentes</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>Previsto (R$)</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>Realizado (R$)</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>Diferença</th>
                      <th style={{padding:'8px 14px',textAlign:'right'}}>Impacto R$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dias.map((d, i) => {
                      const pctD = d.sistema > 0 ? (d.impacto / d.sistema * 100) : 0
                      const cor = Math.abs(pctD) < 0.5 ? 'var(--gray-400)' : Math.abs(pctD) > 5 ? 'var(--danger)' : d.impacto < 0 ? 'var(--warning)' : 'var(--ok)'
                      return (
                        <tr key={d.data} style={{borderTop:'1px solid var(--gray-100)',background:i%2?'#fafafa':'#fff'}}>
                          <td style={{padding:'8px 14px',fontWeight:600}}>
                            {new Date(d.data+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'})}
                            <div style={{fontSize:10,color:'var(--gray-400)'}}>{new Date(d.data+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long'})}</div>
                          </td>
                          <td style={{padding:'8px 10px',textAlign:'center',color:'var(--gray-600)'}}>{d.itens}</td>
                          <td style={{padding:'8px 10px',textAlign:'center'}}>
                            <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,fontWeight:700,background: d.divergentes ? '#fff0f0' : '#f0faf0',color: d.divergentes ? 'var(--danger)' : 'var(--ok)'}}>{d.divergentes}</span>
                          </td>
                          <td style={{padding:'8px 10px',textAlign:'right',color:'var(--gray-600)'}}>R$ {fmt(d.sistema,2)}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700}}>R$ {fmt(d.contado,2)}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:800,color:cor}}>{pctD >= 0 ? '+' : '−'}{fmt(Math.abs(pctD),1)}%</td>
                          <td style={{padding:'8px 14px',textAlign:'right',fontWeight:800,color:cor}}>{d.impacto >= 0 ? '+' : '−'}R$ {fmt(Math.abs(d.impacto),2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--purple)'}}>
                      <td colSpan={6} style={{padding:'10px 14px',fontWeight:800,color:'#fff'}}>Impacto total no estoque</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:800,color:'var(--gold)',fontSize:15}}>{totalImpacto >= 0 ? '+' : '−'}R$ {fmt(Math.abs(totalImpacto),2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })()}

          <div className="card">
          <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:800,fontSize:15}}>
            📋 Lançamentos detalhados
          </div>
          {historico.length === 0 ? (
            <div style={{padding:40,textAlign:'center',color:'var(--gray-300)'}}>Nenhuma conferência registrada ainda.</div>
          ) : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                  <th style={{padding:'9px 14px',textAlign:'left'}}>Data</th>
                  <th style={{padding:'9px 14px',textAlign:'left'}}>Embalagem</th>
                  <th style={{padding:'9px 10px',textAlign:'right'}}>Sistema</th>
                  <th style={{padding:'9px 10px',textAlign:'right'}}>Contado</th>
                  <th style={{padding:'9px 10px',textAlign:'right'}}>Diferença</th>
                  <th style={{padding:'9px 14px',textAlign:'left'}}>Responsável</th>
                  <th style={{padding:'9px 10px',width:40}}></th>
                </tr>
              </thead>
              <tbody>
                {historico.map((c,i) => {
                  const diff = c.estoque_contado - c.estoque_sistema
                  return (
                    <tr key={c.id} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                      <td style={{padding:'8px 14px',color:'var(--gray-500)',fontSize:12}}>
                        {new Date(c.data_conferencia+'T12:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td style={{padding:'8px 14px'}}>
                        <div style={{fontWeight:600}}>{c.embalagens?.nome}</div>
                        <div style={{fontSize:11,color:'var(--gray-400)'}}>{c.embalagens?.codigo}</div>
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right'}}>{fmt(c.estoque_sistema)}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700}}>{fmt(c.estoque_contado)}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontWeight:800,
                        color:diff>0?'var(--ok)':diff<0?'var(--danger)':'var(--gray-400)'}}>
                        {diff>0?'+':''}{fmt(diff)}
                      </td>
                      <td style={{padding:'8px 14px',color:'var(--gray-500)'}}>{c.responsavel||'—'}</td>
                      <td style={{padding:'8px 10px',textAlign:'center'}}>
                        <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                          <button className="btn btn-ghost btn-sm"
                            onClick={()=>{setEditando(c);setEditQtd(String(c.estoque_contado))}}
                            title="Editar contagem">
                            <Pencil size={11}/>
                          </button>
                          <button className="btn btn-ghost btn-sm"
                            onClick={()=>excluirConferencia(c)}
                            style={{color:'var(--danger)'}} title="Excluir conferência">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        </>
      )}
    </div>
  )
}

export default function Embalagens() {
  const [sub, setSub] = useState('situacao')
  const [novoPedidoFlag, setNovoPedidoFlag] = useState(false)
  const [tipo, setTipo] = useState(() => localStorage.getItem('emb_tipo') || 'rotulo')
  const [refreshKey, setRefreshKey] = useState(0)

  function mudarTipo(t) {
    setTipo(t)
    localStorage.setItem('emb_tipo', t)
  }

  function irParaSituacao() {
    setRefreshKey(k => k + 1)
    setSub('situacao')
  }

  return (
    <>
      {/* Seletor de tipo */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <button
          className={`btn ${tipo==='rotulo'?'btn-primary':'btn-ghost'}`}
          onClick={()=>mudarTipo('rotulo')}>
          🏷️ Rótulos
        </button>
        <button
          className={`btn ${tipo==='embalagem'?'btn-primary':'btn-ghost'}`}
          onClick={()=>mudarTipo('embalagem')}>
          📦 Embalagens
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'situacao' ? ' active' : ''}`} onClick={irParaSituacao}>📊 Situação</button>
        <button className={`tab${sub === 'pedidos' ? ' active' : ''}`} onClick={() => setSub('pedidos')}>🛒 Pedidos</button>
        <button className={`tab${sub === 'compras' ? ' active' : ''}`} onClick={() => setSub('compras')}>💰 Compras</button>
        <button className={`tab${sub === 'conferencia' ? ' active' : ''}`} onClick={() => setSub('conferencia')}>🔍 Conferência</button>
        <button className={`tab${sub === 'acoes' ? ' active' : ''}`} onClick={() => setSub('acoes')}>🕓 Minhas ações</button>
      </div>
      {sub === 'situacao'    && <Dashboard key={`${tipo}-${refreshKey}`} tipo={tipo} onNovoPedido={() => { setSub('pedidos'); setNovoPedidoFlag(true) }} />}
      {sub === 'pedidos'     && <Pedidos tipo={tipo} abrirNovo={novoPedidoFlag} onNovoClosed={() => setNovoPedidoFlag(false)} />}
      {sub === 'compras'     && <Compras tipo={tipo} />}
      {sub === 'conferencia' && <ConferenciaEstoque onSalvo={irParaSituacao} />}
      {sub === 'acoes'       && <div className="card card-pad"><LogGeral /></div>}
    </>
  )
}
