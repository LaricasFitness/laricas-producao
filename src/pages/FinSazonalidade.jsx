import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR } from '../lib/financeiro'
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function Seta({ atual, anterior }) {
  if (!anterior || !atual) return null
  const pct = ((atual-anterior)/anterior)*100
  const cor = pct >= 0 ? 'var(--ok)' : 'var(--danger)'
  const Icon = Math.abs(pct) < 2 ? Minus : pct > 0 ? TrendingUp : TrendingDown
  return <span style={{ fontSize:10, color:cor, marginLeft:4, fontWeight:700 }}><Icon size={10}/> {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
}

export default function FinSazonalidade() {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const [anos, setAnos] = useState([anoAtual-1, anoAtual])
  const [metrica, setMetrica] = useState('receita')   // receita | despesa | resultado | margem
  const [dados, setDados] = useState({})   // { ano: { mes(1-12): valor } }
  const [loading, setLoading] = useState(true)

  useEffect(() => { carregar() }, [anos, metrica])

  async function carregar() {
    setLoading(true)
    const ini = `${Math.min(...anos)}-01-01`
    const fim = `${Math.max(...anos)}-12-31`

    const { data } = await supabase.from('fin_parcelas')
      .select('valor, data_vencimento, fin_lancamentos(tipo)')
      .gte('data_vencimento', ini).lte('data_vencimento', fim).eq('status','pago')

    const mapa = {}
    for (const p of (data||[])) {
      const ano = parseInt(p.data_vencimento.slice(0,4))
      const mes = parseInt(p.data_vencimento.slice(5,7))
      const tipo = p.fin_lancamentos?.tipo
      if (!mapa[ano]) mapa[ano] = {}
      if (!mapa[ano][mes]) mapa[ano][mes] = { receita:0, despesa:0 }
      if (tipo === 'receita') mapa[ano][mes].receita += p.valor
      else mapa[ano][mes].despesa += p.valor
    }

    // Calcula resultado e margem
    for (const ano of Object.keys(mapa)) {
      for (const mes of Object.keys(mapa[ano])) {
        const d = mapa[ano][mes]
        d.resultado = d.receita - d.despesa
        d.margem = d.receita > 0 ? (d.resultado/d.receita)*100 : 0
      }
    }

    setDados(mapa)
    setLoading(false)
  }

  const getVal = (ano, mes) => dados[ano]?.[mes]?.[metrica] || 0
  const isMargem = metrica === 'margem'

  // Máximo para escala visual
  const allVals = anos.flatMap(a => Array.from({length:12},(_,i)=>Math.abs(getVal(a,i+1))))
  const maxVal = Math.max(...allVals, 1)

  // Médias por mês (todos os anos)
  const mediasMes = Array.from({length:12},(_,i)=>{
    const vals = anos.map(a=>getVal(a,i+1)).filter(v=>v!==0)
    return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0
  })

  // Melhor e pior mês de cada ano
  const bestWorst = anos.map(ano => {
    const vals = Array.from({length:12},(_,i)=>({ mes:i+1, val:getVal(ano,i+1) })).filter(x=>x.val!==0)
    return {
      best: vals.reduce((b,x)=>x.val>b.val?x:b, {mes:0,val:-Infinity}),
      worst: vals.reduce((w,x)=>x.val<w.val?x:w, {mes:0,val:Infinity}),
    }
  })

  return (
    <>
      <div className="card card-pad">
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div className="form-group">
            <label className="form-label">Anos</label>
            <div style={{ display:'flex', gap:6 }}>
              {[anoAtual-2, anoAtual-1, anoAtual].map(a => (
                <label key={a} style={{ display:'flex', alignItems:'center', gap:4, fontSize:13, cursor:'pointer' }}>
                  <input type="checkbox" checked={anos.includes(a)}
                    onChange={e=>setAnos(prev=>e.target.checked?[...prev,a].sort():prev.filter(x=>x!==a))}
                    style={{accentColor:'var(--purple)'}}/>
                  {a}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Métrica</label>
            <select className="form-input" value={metrica} onChange={e=>setMetrica(e.target.value)}>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
              <option value="resultado">Resultado</option>
              <option value="margem">Margem %</option>
            </select>
          </div>
          <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <>
          {/* Gráfico de barras lado a lado por mês */}
          <div className="card card-pad">
            <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>
              {metrica.charAt(0).toUpperCase()+metrica.slice(1)} mensal — comparativo por ano
            </div>
            <div style={{ display:'flex', gap:12, marginBottom:10 }}>
              {anos.map((a,i) => (
                <div key={a} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                  <div style={{ width:12, height:12, borderRadius:2, background: i===0?'var(--purple)':i===1?'var(--ok)':'var(--warning)' }}/>
                  {a}
                </div>
              ))}
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, marginLeft:8 }}>
                <div style={{ width:12, height:2, background:'var(--gray-300)', borderRadius:1 }}/>
                Média
              </div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'flex-end', height:200, overflowX:'auto' }}>
              {Array.from({length:12},(_,mi)=>{
                const mes = mi+1
                const cores = ['var(--purple)','var(--ok)','var(--warning)']
                return (
                  <div key={mes} style={{ display:'flex', gap:2, alignItems:'flex-end', flex:'0 0 auto', width: anos.length * 22 + 10, flexDirection:'column' }}>
                    <div style={{ display:'flex', gap:2, alignItems:'flex-end', width:'100%' }}>
                      {anos.map((a,i) => {
                        const v = getVal(a,mes)
                        const h = maxVal>0 ? Math.max(2,(Math.abs(v)/maxVal)*160) : 2
                        return (
                          <div key={a} title={`${a} ${MESES_PT[mi]}: ${isMargem?v.toFixed(1)+'%':fmtR(v)}`}
                            style={{ flex:1, height:h, background:v<0?'#ff8080':cores[i], borderRadius:'3px 3px 0 0', opacity:.85, cursor:'default' }}/>
                        )
                      })}
                    </div>
                    {/* Linha de média */}
                    <div style={{ fontSize:9, color:'var(--gray-400)', textAlign:'center', width:'100%', marginTop:2 }}>
                      {MESES_PT[mi]}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tabela detalhada */}
          <div className="card">
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)', minWidth:60 }}>Mês</th>
                    {anos.map(a=>(
                      <th key={a} style={{ textAlign:'right', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)', minWidth:120 }}>{a}</th>
                    ))}
                    {anos.length > 1 && (
                      <th style={{ textAlign:'right', padding:'10px 14px', background:'var(--purple-pale)', borderBottom:'2px solid var(--purple)', color:'var(--purple)', minWidth:100 }}>Média</th>
                    )}
                    <th style={{ textAlign:'center', padding:'10px 14px', background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)', minWidth:80 }}>Tendência</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({length:12},(_,mi)=>{
                    const mes = mi+1
                    const vals = anos.map(a=>getVal(a,mes))
                    const media = mediasMes[mi]
                    const melhorAno = anos[vals.indexOf(Math.max(...vals))]
                    return (
                      <tr key={mes} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                        <td style={{ padding:'9px 14px', fontWeight:700, color:mes===hoje.getMonth()+1&&anos.includes(anoAtual)?'var(--purple)':'var(--gray-700)' }}>
                          {MESES_PT[mi]}
                          {mes===hoje.getMonth()+1&&anos.includes(anoAtual)&&<span className="pill purple" style={{marginLeft:6,fontSize:9}}>Atual</span>}
                        </td>
                        {anos.map((a,i)=>{
                          const v = getVal(a,mes)
                          const ant = i>0 ? getVal(anos[i-1],mes) : null
                          return (
                            <td key={a} style={{ textAlign:'right', padding:'9px 14px', fontWeight:v!==0?600:400, color:v!==0?'var(--gray-800)':'var(--gray-300)' }}>
                              {v!==0 ? (isMargem?v.toFixed(1)+'%':fmtR(v)) : '—'}
                              {ant && v!==0 && <Seta atual={v} anterior={ant}/>}
                            </td>
                          )
                        })}
                        {anos.length > 1 && (
                          <td style={{ textAlign:'right', padding:'9px 14px', fontWeight:600, color:'var(--purple)' }}>
                            {media!==0 ? (isMargem?media.toFixed(1)+'%':fmtR(media)) : '—'}
                          </td>
                        )}
                        <td style={{ textAlign:'center', padding:'9px 14px' }}>
                          {vals.some(v=>v!==0) && (
                            <span className="pill purple" style={{ fontSize:10 }}>{melhorAno}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Totais anuais */}
                  <tr style={{ borderTop:'2px solid var(--purple)', background:'var(--purple-pale)' }}>
                    <td style={{ padding:'10px 14px', fontWeight:800, color:'var(--purple)' }}>Total ano</td>
                    {anos.map(a=>{
                      const tot = Array.from({length:12},(_,i)=>getVal(a,i+1)).reduce((s,v)=>s+v,0)
                      return <td key={a} style={{ textAlign:'right', padding:'10px 14px', fontWeight:800, color:'var(--purple)', fontSize:14 }}>{isMargem?(tot/12).toFixed(1)+'%':fmtR(tot)}</td>
                    })}
                    {anos.length > 1 && <td style={{ textAlign:'right', padding:'10px 14px', fontWeight:800, color:'var(--purple)' }}>—</td>}
                    <td/>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Insights */}
          <div className="card card-pad">
            <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>💡 Insights de sazonalidade</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
              {anos.map((a,i)=>{
                const bw = bestWorst[i]
                const tot = Array.from({length:12},(_,mi)=>getVal(a,mi+1)).reduce((s,v)=>s+v,0)
                return (
                  <div key={a} style={{ background:'var(--gray-50)', borderRadius:8, padding:'12px 14px' }}>
                    <div style={{ fontWeight:800, fontSize:13, marginBottom:8 }}>{a}</div>
                    <div style={{ fontSize:12, color:'var(--gray-600)', marginBottom:4 }}>
                      🏆 Melhor mês: <strong>{bw.best.mes>0?MESES_PT[bw.best.mes-1]:'—'}</strong>
                      {bw.best.mes>0&&<span style={{ color:'var(--ok)', marginLeft:4 }}>{isMargem?bw.best.val.toFixed(1)+'%':fmtR(bw.best.val)}</span>}
                    </div>
                    <div style={{ fontSize:12, color:'var(--gray-600)', marginBottom:4 }}>
                      📉 Pior mês: <strong>{bw.worst.mes>0&&bw.worst.val!==Infinity?MESES_PT[bw.worst.mes-1]:'—'}</strong>
                      {bw.worst.mes>0&&bw.worst.val!==Infinity&&<span style={{ color:'var(--danger)', marginLeft:4 }}>{isMargem?bw.worst.val.toFixed(1)+'%':fmtR(bw.worst.val)}</span>}
                    </div>
                    <div style={{ fontSize:12, color:'var(--purple)', fontWeight:700, marginTop:8 }}>
                      Total: {isMargem?((tot/12)).toFixed(1)+'% média':fmtR(tot)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
