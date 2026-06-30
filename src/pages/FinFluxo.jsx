import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData } from '../lib/financeiro'
import { RefreshCw, AlertTriangle, TrendingDown } from 'lucide-react'

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtDia(iso) {
  const d = new Date(iso+'T12:00:00')
  return `${String(d.getDate()).padStart(2,'0')}/${MESES_PT[d.getMonth()]}`
}

export default function FinFluxo() {
  const hoje = new Date()
  const hojeStr = hoje.toISOString().slice(0,10)

  const [ini, setIni] = useState(hojeStr)
  const [fim, setFim] = useState(() => {
    const d = new Date(hoje); d.setDate(d.getDate()+60)
    return d.toISOString().slice(0,10)
  })
  const [fluxo, setFluxo] = useState([])
  const [saldoInicial, setSaldoInicial] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState(null)
  const [rupturas, setRupturas] = useState([])

  useEffect(() => { carregar() }, [ini, fim])

  async function carregar() {
    setLoading(true)

    // 1. Saldo atual de todas as contas (base do caixa)
    const { data: contas } = await supabase.from('fin_contas').select('*').eq('ativo',true)
    const { data: pagas } = await supabase.from('fin_parcelas')
      .select('valor, conta_id, fin_lancamentos(tipo)')
      .eq('status','pago')

    let saldo = 0
    const saldoContas = {}
    for (const c of (contas||[])) saldoContas[c.id] = c.saldo_inicial||0
    for (const p of (pagas||[])) {
      if (p.conta_id && saldoContas[p.conta_id] !== undefined) {
        if (p.fin_lancamentos?.tipo==='receita') saldoContas[p.conta_id] += p.valor
        else saldoContas[p.conta_id] -= p.valor
      }
    }
    saldo = Object.values(saldoContas).reduce((s,v)=>s+v,0)
    setSaldoInicial(saldo)

    // 2. Lançamentos futuros pendentes/agendados no período
    const { data: pendentes } = await supabase.from('fin_parcelas')
      .select('valor, data_vencimento, status, fin_lancamentos(tipo, descricao)')
      .gte('data_vencimento', ini)
      .lte('data_vencimento', fim)
      .in('status', ['pendente','em_aberto','agendado','vencido'])
      .order('data_vencimento')

    // 3. Monta mapa diário
    const mapa = {}
    const d = new Date(ini+'T00:00:00')
    const fimD = new Date(fim+'T00:00:00')
    while (d <= fimD) {
      const k = d.toISOString().slice(0,10)
      mapa[k] = { entradas:[], saidas:[], totalEntradas:0, totalSaidas:0 }
      d.setDate(d.getDate()+1)
    }

    for (const p of (pendentes||[])) {
      const k = p.data_vencimento
      if (!mapa[k]) continue
      if (p.fin_lancamentos?.tipo==='receita') {
        mapa[k].entradas.push(p)
        mapa[k].totalEntradas += p.valor
      } else {
        mapa[k].saidas.push(p)
        mapa[k].totalSaidas += p.valor
      }
    }

    // 4. Acumula saldo projetado
    let saldoAcc = saldo
    const dias = Object.entries(mapa).map(([dia, v]) => {
      saldoAcc += v.totalEntradas - v.totalSaidas
      return { dia, ...v, saldoProjetado: saldoAcc, isHoje: dia === hojeStr, isPast: dia < hojeStr }
    })

    // 5. Detecta rupturas (saldo negativo)
    const rups = dias.filter(d => d.saldoProjetado < 0 && (d.totalEntradas > 0 || d.totalSaidas > 0))
    setRupturas(rups)
    setFluxo(dias)
    setLoading(false)
  }

  const diasComMovimento = fluxo.filter(d => d.totalEntradas > 0 || d.totalSaidas > 0)
  const maxVal = Math.max(...fluxo.map(d=>Math.max(d.totalEntradas,d.totalSaidas)), 1)
  const saldoFinal = fluxo.length ? fluxo[fluxo.length-1].saldoProjetado : saldoInicial
  const totalEntradas = fluxo.reduce((s,d)=>s+d.totalEntradas,0)
  const totalSaidas = fluxo.reduce((s,d)=>s+d.totalSaidas,0)

  // Primeira ruptura
  const primeiraRuptura = rupturas[0]

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad">
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e=>setIni(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e=>setFim(e.target.value)}/>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[
              { l:'30d', d:30 },{ l:'60d', d:60 },{ l:'90d', d:90 },{ l:'6m', d:180 },
            ].map(p=>(
              <button key={p.l} className="btn btn-ghost btn-sm" onClick={()=>{
                const f=new Date(hoje); f.setDate(f.getDate()+p.d)
                setIni(hojeStr); setFim(f.toISOString().slice(0,10))
              }}>{p.l}</button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
        </div>
      </div>

      {/* Alerta de ruptura */}
      {primeiraRuptura && (
        <div style={{ background:'#fef2f2', border:'2px solid var(--danger)', borderRadius:10, padding:'16px 20px', display:'flex', gap:14, alignItems:'flex-start' }}>
          <AlertTriangle size={22} color="var(--danger)" style={{flexShrink:0, marginTop:2}}/>
          <div>
            <div style={{ fontWeight:800, fontSize:15, color:'var(--danger)', marginBottom:4 }}>
              ⚠️ Risco de ruptura de caixa detectado
            </div>
            <div style={{ fontSize:13, color:'#7f1d1d', marginBottom:8 }}>
              O saldo projetado fica negativo em <strong>{fmtDia(primeiraRuptura.dia)}</strong> ({fmtR(primeiraRuptura.saldoProjetado)}).
              {rupturas.length > 1 && ` Há mais ${rupturas.length-1} dia${rupturas.length>2?'s':''} em risco.`}
            </div>
            <div style={{ fontSize:12, color:'#991b1b' }}>
              💡 Antecipe recebimentos, adie pagamentos ou garanta aporte de caixa antes dessa data.
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12 }}>
        {[
          { label:'💰 Caixa hoje',      val:saldoInicial,  cor:'var(--purple)',  bold:true },
          { label:'📈 Entradas previstas', val:totalEntradas, cor:'var(--ok)' },
          { label:'📉 Saídas previstas',   val:totalSaidas,   cor:'var(--danger)' },
          { label:`💼 Saldo em ${fmtDia(fim)}`, val:saldoFinal, cor:saldoFinal>=0?'var(--ok)':'var(--danger)', bold:true },
        ].map(k=>(
          <div key={k.label} style={{ background:'var(--white)', borderRadius:10, padding:'14px 16px', borderTop:`3px solid ${k.cor}`, boxShadow:'var(--shadow-sm)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:4 }}>{k.label}</div>
            <div style={{ fontSize:k.bold?22:18, fontWeight:900, color:k.cor }}>{fmtR(k.val)}</div>
          </div>
        ))}
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <>
          {/* Gráfico */}
          <div className="card card-pad">
            <div style={{ fontWeight:700, fontSize:13, marginBottom:12 }}>
              Saldo projetado diário
              {rupturas.length > 0 && <span style={{ marginLeft:8, color:'var(--danger)', fontSize:12 }}>⚠️ {rupturas.length} dia{rupturas.length>1?'s':''} em risco</span>}
            </div>
            <div style={{ overflowX:'auto' }}>
              <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:140, minWidth: diasComMovimento.length * 28 }}>
                {diasComMovimento.map((d,i) => {
                  const hE = maxVal>0 ? Math.max(2,(d.totalEntradas/maxVal)*120) : 2
                  const hS = maxVal>0 ? Math.max(2,(d.totalSaidas/maxVal)*120) : 2
                  const ruptura = d.saldoProjetado < 0
                  return (
                    <div key={d.dia} style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:'0 0 auto', width:24 }}
                      onMouseEnter={()=>setHover(d)} onMouseLeave={()=>setHover(null)}>
                      <div style={{ display:'flex', gap:1, alignItems:'flex-end', marginBottom:2 }}>
                        {d.totalEntradas>0 && <div style={{ width:10, height:hE, background:'var(--ok)', borderRadius:'2px 2px 0 0', opacity:.8 }}/>}
                        {d.totalSaidas>0 && <div style={{ width:10, height:hS, background: ruptura?'var(--danger)':'#f97316', borderRadius:'2px 2px 0 0', opacity:.8 }}/>}
                      </div>
                      {ruptura && <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--danger)', marginBottom:1 }}/>}
                      <span style={{ fontSize:8, color:d.isHoje?'var(--purple)':ruptura?'var(--danger)':'var(--gray-300)', fontWeight:d.isHoje||ruptura?700:400, transform:'rotate(-45deg)', transformOrigin:'top left', whiteSpace:'nowrap', marginTop:4 }}>
                        {fmtDia(d.dia)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {hover && (
              <div style={{ marginTop:10, background:'var(--gray-50)', borderRadius:8, padding:'10px 14px', fontSize:13 }}>
                <strong>{fmtDia(hover.dia)}</strong>
                {hover.totalEntradas>0 && <span style={{ color:'var(--ok)', marginLeft:10 }}>+{fmtR(hover.totalEntradas)}</span>}
                {hover.totalSaidas>0 && <span style={{ color:'#f97316', marginLeft:10 }}>-{fmtR(hover.totalSaidas)}</span>}
                <span style={{ marginLeft:10, fontWeight:700, color:hover.saldoProjetado>=0?'var(--purple)':'var(--danger)' }}>
                  Saldo: {fmtR(hover.saldoProjetado)}
                </span>
                {hover.saldoProjetado < 0 && <span style={{ marginLeft:8, color:'var(--danger)', fontWeight:700 }}>⚠️ RUPTURA</span>}
              </div>
            )}

            <div style={{ display:'flex', gap:16, fontSize:11, marginTop:8 }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10,height:10,background:'var(--ok)',borderRadius:2,display:'inline-block' }}/> Entradas previstas</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10,height:10,background:'#f97316',borderRadius:2,display:'inline-block' }}/> Saídas previstas</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:6,height:6,borderRadius:'50%',background:'var(--danger)',display:'inline-block' }}/> Ruptura de caixa</span>
            </div>
          </div>

          {/* Tabela detalhada */}
          <div className="card">
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--gray-200)', fontWeight:700, fontSize:13 }}>
              Detalhamento por dia
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'8px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', minWidth:90 }}>Data</th>
                    <th style={{ textAlign:'right', padding:'8px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', minWidth:130 }}>Entradas</th>
                    <th style={{ textAlign:'right', padding:'8px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', minWidth:130 }}>Saídas</th>
                    <th style={{ textAlign:'right', padding:'8px 14px', background:'var(--purple-pale)', borderBottom:'1px solid var(--gray-200)', minWidth:130, color:'var(--purple)', fontWeight:800 }}>Saldo projetado</th>
                    <th style={{ padding:'8px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)' }}>Lançamentos</th>
                  </tr>
                </thead>
                <tbody>
                  {diasComMovimento.map(d => {
                    const ruptura = d.saldoProjetado < 0
                    return (
                      <tr key={d.dia} style={{ borderBottom:'1px solid var(--gray-100)', background: d.isHoje?'var(--purple-ghost)':ruptura?'#fff1f1':'var(--white)' }}>
                        <td style={{ padding:'9px 14px', fontWeight:d.isHoje?800:400 }}>
                          {fmtDia(d.dia)}
                          {d.isHoje && <span className="pill purple" style={{ marginLeft:6, fontSize:9 }}>Hoje</span>}
                          {ruptura && <span className="pill danger" style={{ marginLeft:6, fontSize:9 }}>⚠️ Ruptura</span>}
                        </td>
                        <td style={{ textAlign:'right', padding:'9px 14px', color:'var(--ok)', fontWeight:600 }}>
                          {d.totalEntradas>0 ? fmtR(d.totalEntradas) : '—'}
                        </td>
                        <td style={{ textAlign:'right', padding:'9px 14px', color:ruptura?'var(--danger)':'#f97316', fontWeight:600 }}>
                          {d.totalSaidas>0 ? fmtR(d.totalSaidas) : '—'}
                        </td>
                        <td style={{ textAlign:'right', padding:'9px 14px', fontWeight:800, color:ruptura?'var(--danger)':'var(--purple)', fontSize:14 }}>
                          {fmtR(d.saldoProjetado)}
                        </td>
                        <td style={{ padding:'9px 14px' }}>
                          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                            {[...d.entradas,...d.saidas].slice(0,3).map((p,i)=>(
                              <div key={i} style={{ fontSize:11, color:'var(--gray-500)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:200 }}>
                                <span style={{ color:p.fin_lancamentos?.tipo==='receita'?'var(--ok)':'var(--danger)', marginRight:4 }}>
                                  {p.fin_lancamentos?.tipo==='receita'?'↑':'↓'}
                                </span>
                                {p.fin_lancamentos?.descricao} — {fmtR(p.valor)}
                              </div>
                            ))}
                            {(d.entradas.length+d.saidas.length) > 3 && (
                              <div style={{ fontSize:10, color:'var(--gray-400)' }}>+{d.entradas.length+d.saidas.length-3} mais</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
