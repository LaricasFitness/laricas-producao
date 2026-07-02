import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData, STATUS_LABEL } from '../lib/financeiro'
import { RefreshCw, TrendingDown, TrendingUp, Eye, EyeOff } from 'lucide-react'

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtDia(iso) {
  if (!iso) return '—'
  const d = new Date(iso+'T12:00:00')
  const dow = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()]
  return `${dow} ${String(d.getDate()).padStart(2,'0')}/${MESES_PT[d.getMonth()]}`
}

export default function FinFluxo() {
  const hoje = new Date()
  const hojeStr = hoje.toISOString().slice(0,10)

  // Período padrão: 30 dias atrás até 60 dias à frente
  const [ini, setIni] = useState(() => {
    const d = new Date(hoje); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10)
  })
  const [fim, setFim] = useState(() => {
    const d = new Date(hoje); d.setDate(d.getDate()+60); return d.toISOString().slice(0,10)
  })

  const [linhas, setLinhas] = useState([])
  const [saldoBase, setSaldoBase] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('todos') // 'todos' | 'realizado' | 'projetado'
  const [expandidos, setExpandidos] = useState(new Set()) // datas expandidas

  const carregar = useCallback(async () => {
    setLoading(true)

    // 1. Saldo atual das contas (base real do caixa)
    const { data: contas } = await supabase
      .from('fin_contas').select('saldo_atual, saldo_inicial, nome').eq('ativo', true)
    const saldo = (contas||[]).reduce((s,c) => s + (c.saldo_atual ?? c.saldo_inicial ?? 0), 0)
    setSaldoBase(saldo)

    // 2. Todos os lançamentos do período (pagos + pendentes), exceto transferências
    const { data: parcelas } = await supabase
      .from('fin_parcelas')
      .select(`
        id, valor, valor_pago, status, data_vencimento, data_pagamento,
        fin_lancamentos!inner(
          id, tipo, descricao, total_parcelas, is_transferencia,
          fin_categorias(nome, cor),
          fin_canais(nome),
          fin_formas_pagamento(nome)
        )
      `)
      .in('status', ['pendente','em_aberto','agendado','pago','vencido'])
      .gte('data_vencimento', ini)
      .lte('data_vencimento', fim)
      .order('data_vencimento')

    // 3. Agrupa por data (exclui transferências no cliente)
    const mapa = {}
    for (const p of (parcelas||[])) {
      const l = p.fin_lancamentos
      if (!l || l.is_transferencia) continue
      const data = p.data_vencimento
      if (!mapa[data]) mapa[data] = { data, itens: [], entradas: 0, saidas: 0, recPago: 0, desPago: 0 }
      const vlr = (p.valor_pago != null && p.valor_pago > 0) ? p.valor_pago : p.valor
      const isPago = p.status === 'pago'
      mapa[data].itens.push({ ...p, _vlr: vlr, _isPago: isPago })
      if (l.tipo === 'receita') {
        mapa[data].entradas += p.valor
        if (isPago) mapa[data].recPago += vlr
      } else {
        mapa[data].saidas += p.valor
        if (isPago) mapa[data].desPago += vlr
      }
    }

    // 4. Ordena datas e calcula saldo acumulado
    const datas = Object.keys(mapa).sort()
    let acumulado = saldo
    // Para dias passados: usa o realizado. Para futuros: usa o previsto.
    const resultado = datas.map(data => {
      const dia = mapa[data]
      const isPassado = data <= hojeStr
      const deltaRealizado = dia.recPago - dia.desPago
      const deltaPrevisto  = dia.entradas - dia.saidas
      const delta = isPassado ? deltaRealizado : deltaPrevisto
      acumulado += delta
      return { ...dia, isPassado, isHoje: data === hojeStr, deltaRealizado, deltaPrevisto, saldoAcumulado: acumulado }
    })

    setLinhas(resultado)
    setLoading(false)
  }, [ini, fim])

  useEffect(() => { carregar() }, [carregar])

  const linhasFiltradas = linhas.filter(l => {
    if (filtro === 'realizado') return l.isPassado
    if (filtro === 'projetado') return !l.isPassado
    return true
  })

  // KPIs
  const totalRecebido   = linhas.reduce((s,l) => s + l.recPago, 0)
  const totalPago       = linhas.reduce((s,l) => s + l.desPago, 0)
  const totalPrevRec    = linhas.filter(l=>!l.isPassado).reduce((s,l) => s + l.entradas, 0)
  const totalPrevDes    = linhas.filter(l=>!l.isPassado).reduce((s,l) => s + l.saidas, 0)
  const saldoFinal      = linhas.length ? linhas[linhas.length-1].saldoAcumulado : saldoBase
  const menorSaldo      = linhas.length ? Math.min(...linhas.map(l=>l.saldoAcumulado)) : saldoBase
  const temRuptura      = menorSaldo < 0

  function toggleExpandido(data) {
    setExpandidos(prev => {
      const n = new Set(prev)
      n.has(data) ? n.delete(data) : n.add(data)
      return n
    })
  }

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad" style={{marginBottom:12}}>
        <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e=>setIni(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e=>setFim(e.target.value)}/>
          </div>
          <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>

          {/* Filtro realizado/projetado */}
          <div style={{display:'flex',border:'1px solid var(--gray-200)',borderRadius:6,overflow:'hidden',marginLeft:'auto'}}>
            {[['todos','Todos'],['realizado','✓ Realizado'],['projetado','📅 Projetado']].map(([v,l])=>(
              <button key={v} className={`btn btn-xs ${filtro===v?'btn-primary':'btn-ghost'}`}
                style={{borderRadius:0}} onClick={()=>setFiltro(v)}>{l}</button>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginTop:14}}>
          <div style={{padding:'10px 12px',background:'var(--gray-50)',borderRadius:8,borderLeft:'3px solid var(--gray-300)'}}>
            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Saldo Atual</div>
            <div style={{fontWeight:800,fontSize:16,color:saldoBase>=0?'var(--ok)':'var(--danger)'}}>{fmtR(saldoBase)}</div>
          </div>
          <div style={{padding:'10px 12px',background:'#f0fdf4',borderRadius:8,borderLeft:'3px solid var(--ok)'}}>
            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Recebido</div>
            <div style={{fontWeight:800,fontSize:16,color:'var(--ok)'}}>{fmtR(totalRecebido)}</div>
          </div>
          <div style={{padding:'10px 12px',background:'#fff5f5',borderRadius:8,borderLeft:'3px solid var(--danger)'}}>
            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Pago</div>
            <div style={{fontWeight:800,fontSize:16,color:'var(--danger)'}}>{fmtR(totalPago)}</div>
          </div>
          <div style={{padding:'10px 12px',background:'#f8f5ff',borderRadius:8,borderLeft:'3px solid var(--purple)'}}>
            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Projetado Rec.</div>
            <div style={{fontWeight:800,fontSize:16,color:'var(--purple)'}}>{fmtR(totalPrevRec)}</div>
            <div style={{fontSize:10,color:'var(--gray-400)'}}>a receber</div>
          </div>
          <div style={{padding:'10px 12px',background:saldoFinal>=0?'#f0fdf4':'#fff5f5',borderRadius:8,borderLeft:`3px solid ${saldoFinal>=0?'var(--ok)':'var(--danger)'}`}}>
            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Saldo Projetado</div>
            <div style={{fontWeight:800,fontSize:16,color:saldoFinal>=0?'var(--ok)':'var(--danger)'}}>{fmtR(saldoFinal)}</div>
            <div style={{fontSize:10,color:'var(--gray-400)'}}>no fim do período</div>
          </div>
        </div>

        {temRuptura && (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#fff0f0',borderRadius:6,marginTop:10,fontSize:13,color:'var(--danger)',fontWeight:600}}>
            <TrendingDown size={14}/> Saldo projeta ficar negativo (mínimo {fmtR(menorSaldo)}) — verifique o caixa
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="card" style={{overflowX:'auto'}}>
        {loading ? (
          <div className="loading"><RefreshCw size={14} className="spin"/></div>
        ) : linhasFiltradas.length === 0 ? (
          <div style={{padding:32,textAlign:'center',color:'var(--gray-400)'}}>Nenhum lançamento no período</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--gray-50)',position:'sticky',top:0,zIndex:2}}>
                <th style={{padding:'8px 14px',textAlign:'left',width:130}}>Data</th>
                <th style={{padding:'8px 14px',textAlign:'right',width:120}}>Entradas</th>
                <th style={{padding:'8px 14px',textAlign:'right',width:120}}>Saídas</th>
                <th style={{padding:'8px 14px',textAlign:'right',width:140}}>Saldo Acumulado</th>
                <th style={{padding:'8px 14px',textAlign:'center',width:32}}></th>
              </tr>
            </thead>
            <tbody>
              {/* Linha de saldo inicial */}
              {filtro !== 'projetado' && (
                <tr style={{background:'var(--purple-pale)',fontWeight:700}}>
                  <td style={{padding:'8px 14px',color:'var(--purple)'}}>Saldo inicial</td>
                  <td colSpan={2} style={{padding:'8px 14px',textAlign:'center',fontSize:12,color:'var(--gray-500)'}}>
                    saldo atual de todas as contas
                  </td>
                  <td style={{padding:'8px 14px',textAlign:'right',fontSize:15,color:saldoBase>=0?'var(--ok)':'var(--danger)',fontWeight:800}}>
                    {fmtR(saldoBase)}
                  </td>
                  <td/>
                </tr>
              )}

              {linhasFiltradas.map(dia => {
                const isHoje = dia.isHoje
                const isPassado = dia.isPassado
                const exp = expandidos.has(dia.data)
                const entradas = isPassado ? dia.recPago   : dia.entradas
                const saidas   = isPassado ? dia.desPago   : dia.saidas
                const saldoCor = dia.saldoAcumulado >= 0 ? 'var(--ok)' : 'var(--danger)'

                return [
                  <tr key={dia.data}
                    style={{
                      borderTop: isHoje ? '2px solid var(--purple)' : '1px solid var(--gray-100)',
                      background: isHoje ? '#f5f0ff' : isPassado ? '#fafffe' : 'var(--white)',
                      cursor:'pointer',
                    }}
                    onClick={()=>toggleExpandido(dia.data)}
                  >
                    <td style={{padding:'9px 14px'}}>
                      <div style={{fontWeight:isHoje?800:600,color:isHoje?'var(--purple)':'inherit'}}>
                        {isHoje && <span style={{fontSize:10,background:'var(--purple)',color:'#fff',borderRadius:4,padding:'1px 5px',marginRight:5}}>HOJE</span>}
                        {fmtDia(dia.data)}
                      </div>
                      {!isPassado && <div style={{fontSize:10,color:'var(--gray-400)',marginTop:1}}>📅 projetado</div>}
                    </td>
                    <td style={{padding:'9px 14px',textAlign:'right',fontWeight:700,color:entradas>0?'var(--ok)':'var(--gray-300)'}}>
                      {entradas > 0 ? `+ ${fmtR(entradas)}` : '—'}
                    </td>
                    <td style={{padding:'9px 14px',textAlign:'right',fontWeight:700,color:saidas>0?'var(--danger)':'var(--gray-300)'}}>
                      {saidas > 0 ? `- ${fmtR(saidas)}` : '—'}
                    </td>
                    <td style={{padding:'9px 14px',textAlign:'right',fontWeight:800,fontSize:14,color:saldoCor}}>
                      {fmtR(dia.saldoAcumulado)}
                    </td>
                    <td style={{padding:'9px 8px',textAlign:'center',color:'var(--gray-400)',fontSize:12}}>
                      {exp ? '▲' : '▼'}
                    </td>
                  </tr>,

                  // Expandido: lista os lançamentos do dia
                  exp && (
                    <tr key={dia.data+'-detail'}>
                      <td colSpan={5} style={{padding:0,background:'var(--gray-50)'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                          <tbody>
                            {dia.itens.map((p,i) => {
                              const l = p.fin_lancamentos
                              const isRec = l?.tipo === 'receita'
                              const scfg = STATUS_LABEL[p.status] || STATUS_LABEL.em_aberto
                              return (
                                <tr key={p.id} style={{borderTop:'1px solid var(--gray-100)'}}>
                                  <td style={{padding:'6px 28px',width:32,color:'var(--gray-300)'}}>└</td>
                                  <td style={{padding:'6px 8px',flex:1}}>
                                    <span style={{fontWeight:600}}>{l?.descricao}</span>
                                    {l?.fin_categorias && (
                                      <span style={{fontSize:10,color:l.fin_categorias.cor||'var(--gray-400)',marginLeft:8}}>
                                        ● {l.fin_categorias.nome}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{padding:'6px 8px',width:100,textAlign:'right',color:isRec?'var(--ok)':'var(--danger)',fontWeight:600}}>
                                    {isRec ? '+' : '-'} {fmtR(p._vlr)}
                                  </td>
                                  <td style={{padding:'6px 8px',width:90}}>
                                    <span className={`pill ${scfg.cls}`} style={{fontSize:10}}>{scfg.label}</span>
                                  </td>
                                  <td style={{padding:'6px 14px',width:100,color:'var(--gray-400)',fontSize:11}}>
                                    {l?.fin_formas_pagamento?.nome || ''}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
