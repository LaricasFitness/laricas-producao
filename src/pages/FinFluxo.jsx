import { useState, useEffect } from 'react'
import { carregarFluxo, fmtR, fmtData } from '../lib/financeiro'
import { RefreshCw } from 'lucide-react'

function fmt(n) { return (n||0).toLocaleString('pt-BR') }

export default function FinFluxo() {
  const hoje = new Date()
  const [ini, setIni] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10) })
  const [fim, setFim] = useState(() => { const d = new Date(); d.setMonth(d.getMonth()+1,0); return d.toISOString().slice(0,10) })
  const [fluxo, setFluxo] = useState([])
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    setLoading(true)
    carregarFluxo(ini, fim).then(d => { setFluxo(d); setLoading(false) })
  }, [ini, fim])

  const maxVal = Math.max(...fluxo.map(d => Math.max(d.entradas, d.saidas)), 1)
  const saldoFinal = fluxo.length ? fluxo[fluxo.length-1].saldo : 0
  const totalEntradas = fluxo.reduce((s,d) => s + d.entradas, 0)
  const totalSaidas = fluxo.reduce((s,d) => s + d.saidas, 0)

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e => setIni(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e => setFim(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { l: 'Este mês', fn: () => { const d=new Date(); setIni(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`); setFim(new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10)) }},
              { l: 'Próx. 30d', fn: () => { const a=new Date(),b=new Date(); b.setDate(b.getDate()+30); setIni(a.toISOString().slice(0,10)); setFim(b.toISOString().slice(0,10)) }},
              { l: '3 meses', fn: () => { const d=new Date(); d.setDate(1); const f=new Date(d); f.setMonth(f.getMonth()+3,0); setIni(d.toISOString().slice(0,10)); setFim(f.toISOString().slice(0,10)) }},
            ].map(a => <button key={a.l} className="btn btn-ghost btn-sm" onClick={a.fn}>{a.l}</button>)}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-row">
        <div className="kpi ok"><div className="kpi-label">📈 Entradas previstas</div><div className="kpi-value" style={{ fontSize:20, color:'var(--ok)' }}>{fmtR(totalEntradas)}</div></div>
        <div className="kpi danger"><div className="kpi-label">📉 Saídas previstas</div><div className="kpi-value" style={{ fontSize:20, color:'var(--danger)' }}>{fmtR(totalSaidas)}</div></div>
        <div className={`kpi ${saldoFinal >= 0 ? 'ok' : 'danger'}`}>
          <div className="kpi-label">💰 Saldo projetado</div>
          <div className="kpi-value" style={{ fontSize:20, color: saldoFinal >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{fmtR(saldoFinal)}</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">📅 Dias no período</div>
          <div className="kpi-value">{fluxo.length}</div>
        </div>
      </div>

      {/* Gráfico de barras */}
      {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : (
        <div className="card card-pad">
          <div className="card-title">Fluxo diário — Entradas vs Saídas</div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 160, paddingBottom: 24, minWidth: fluxo.length * 22 }}>
              {fluxo.map((d, i) => {
                const hE = Math.max(4, (d.entradas/maxVal)*136)
                const hS = Math.max(4, (d.saidas/maxVal)*136)
                const isHoy = d.dia === hoje.toISOString().slice(0,10)
                return (
                  <div key={d.dia} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1, flex:'0 0 auto', width:18 }}
                    onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
                    <div style={{ display:'flex', gap:1, alignItems:'flex-end' }}>
                      {d.entradas > 0 && <div style={{ width:8, height:hE, background:'var(--ok)', borderRadius:'2px 2px 0 0', opacity: isHoy?1:.7 }} />}
                      {d.saidas > 0 && <div style={{ width:8, height:hS, background:'var(--danger)', borderRadius:'2px 2px 0 0', opacity: isHoy?1:.7 }} />}
                    </div>
                    <span style={{ fontSize:8, color: isHoy?'var(--purple)':'var(--gray-300)', fontWeight: isHoy?700:400, transform:'rotate(-45deg)', transformOrigin:'top left', whiteSpace:'nowrap', marginTop:4 }}>
                      {new Date(d.dia+'T12:00:00').getDate()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ display:'flex', gap:16, fontSize:12, marginTop:4 }}>
            <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10,height:10,background:'var(--ok)',borderRadius:2,display:'inline-block'}} /> Entradas</span>
            <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10,height:10,background:'var(--danger)',borderRadius:2,display:'inline-block'}} /> Saídas</span>
          </div>

          {hover && (
            <div style={{ marginTop:10, background:'var(--gray-50)', borderRadius:8, padding:'10px 14px', fontSize:13 }}>
              <strong>{fmtData(hover.dia)}</strong> —
              <span style={{ color:'var(--ok)', marginLeft:8 }}>Entradas: {fmtR(hover.entradas)}</span>
              <span style={{ color:'var(--danger)', marginLeft:12 }}>Saídas: {fmtR(hover.saidas)}</span>
              <span style={{ color:'var(--purple)', marginLeft:12, fontWeight:700 }}>Saldo acum.: {fmtR(hover.saldo)}</span>
            </div>
          )}
        </div>
      )}

      {/* Tabela detalhada — só dias com movimento */}
      <div className="card">
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-200)', fontWeight:700, fontSize:14 }}>
          Detalhamento por dia
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th style={{ textAlign:'right' }}>Entradas prev.</th>
                <th style={{ textAlign:'right' }}>Saídas prev.</th>
                <th style={{ textAlign:'right' }}>Saldo acumulado</th>
              </tr>
            </thead>
            <tbody>
              {fluxo.filter(d => d.entradas > 0 || d.saidas > 0).map(d => (
                <tr key={d.dia} style={{ background: d.dia === hoje.toISOString().slice(0,10) ? 'var(--purple-ghost)' : undefined }}>
                  <td style={{ fontWeight: d.dia === hoje.toISOString().slice(0,10) ? 800 : 400 }}>
                    {fmtData(d.dia)}
                    {d.dia === hoje.toISOString().slice(0,10) && <span className="pill purple" style={{ marginLeft:8, fontSize:10 }}>Hoje</span>}
                  </td>
                  <td style={{ textAlign:'right', color:'var(--ok)', fontWeight:600 }}>{d.entradas > 0 ? fmtR(d.entradas) : '—'}</td>
                  <td style={{ textAlign:'right', color:'var(--danger)', fontWeight:600 }}>{d.saidas > 0 ? fmtR(d.saidas) : '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:800, color: d.saldo >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{fmtR(d.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
