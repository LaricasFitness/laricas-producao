import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR } from '../lib/financeiro'
import { RefreshCw } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts'

const hoje = new Date()
const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`

function isoMes(m) {
  return `${m}-01`
}
function fimMes(m) {
  const [a,mm] = m.split('-').map(Number)
  const ultimo = new Date(a, mm, 0).getDate()
  return `${m}-${String(ultimo).padStart(2,'0')}`
}
function labelMes(m) {
  const [a,mm] = m.split('-').map(Number)
  return new Date(a, mm-1, 1).toLocaleDateString('pt-BR', {month:'short', year:'2-digit'})
}

// Gera lista de meses entre dois YYYY-MM
function mesesEntre(ini, fim) {
  const res = []
  let [a,m] = ini.split('-').map(Number)
  const [af,mf] = fim.split('-').map(Number)
  while (a < af || (a===af && m<=mf)) {
    res.push(`${a}-${String(m).padStart(2,'0')}`)
    m++; if(m>12){m=1;a++}
  }
  return res
}

// Período anterior do mesmo tamanho
function periodoAnterior(ini, fim) {
  const meses = mesesEntre(ini, fim)
  const n = meses.length
  let [a,m] = ini.split('-').map(Number)
  for (let i=0;i<n;i++){m--;if(m<1){m=12;a--}}
  const iniAnt = `${a}-${String(m+1<=12?m+1:1).padStart(2,'0')}`
  // simpler: just subtract n months from ini
  const iniDate = new Date(ini+'-01')
  iniDate.setMonth(iniDate.getMonth()-n)
  const fimDate = new Date(ini+'-01')
  fimDate.setDate(fimDate.getDate()-1)
  const toM = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  return { ini: toM(iniDate), fim: toM(fimDate) }
}

function mesmoMesAnoAnterior(ini, fim) {
  const sub = (m,n) => { const [a,mm]=m.split('-').map(Number); return `${a-n}-${String(mm).padStart(2,'0')}` }
  return { ini: sub(ini,1), fim: sub(fim,1) }
}

export default function FinBalancete() {
  const [iniMes, setIniMes] = useState(mesAtual)
  const [fimMes2, setFimMes2] = useState(mesAtual)
  const [contaId, setContaId] = useState('todas')
  const [comparativo, setComparativo] = useState('nenhum') // nenhum | mes_ant | ano_ant | tri_ant | tri_ano
  const [contas, setContas] = useState([])
  const [categorias, setCategorias] = useState([])
  const [dados, setDados] = useState(null) // { linhas, totais, grafico }
  const [dadosComp, setDadosComp] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    Promise.all([
      supabase.from('fin_contas').select('*').eq('ativo',true).order('nome'),
      supabase.from('fin_categorias').select('*').eq('ativo',true).order('nivel').order('ordem').order('nome'),
    ]).then(([{data:cnts},{data:cats}])=>{
      setContas(cnts||[])
      setCategorias(cats||[])
    })
  },[])

  async function buscarDados(ini, fim) {
    let q = supabase.from('fin_parcelas')
      .select(`valor, valor_pago, status, data_competencia, data_vencimento, data_pagamento, conta_id,
        fin_lancamentos!inner(tipo, categoria_id, is_transferencia, fin_categorias(id,nome,tipo))`)
      .gte('data_vencimento', isoMes(ini))
      .lte('data_vencimento', fimMes(fim))
      .in('status',['pago','em_aberto','agendado','vencido','pendente'])

    const { data: parcelas } = await q

    const meses = mesesEntre(ini, fim)

    // Agrupa por categoria e mês
    const catMap = {} // { catId: { nome, tipo, meses: { [mes]: valor } } }
    const transfsMap = { entrada:{}, saida:{} } // { mes: valor }

    for (const p of (parcelas||[])) {
      const l = p.fin_lancamentos
      if (!l) continue
      const vlr = (p.valor_pago > 0) ? p.valor_pago : p.valor
      const mes = p.data_vencimento?.slice(0,7)
      if (!mes || !meses.includes(mes)) continue

      // Filtra conta
      if (contaId !== 'todas' && p.conta_id !== contaId) continue

      if (l.is_transferencia) {
        const key = l.tipo === 'receita' ? 'entrada' : 'saida'
        transfsMap[key][mes] = (transfsMap[key][mes]||0) + vlr
        continue
      }

      const catId = l.categoria_id || '__sem_cat__'
      const catNome = l.fin_categorias?.nome || 'Sem categoria'
      const catTipo = l.tipo // receita ou despesa

      if (!catMap[catId]) catMap[catId] = { nome:catNome, tipo:catTipo, parent_id: null, meses:{} }
      catMap[catId].meses[mes] = (catMap[catId].meses[mes]||0) + vlr
    }

    // Monta linhas agrupadas por tipo e categoria
    const receitas = Object.entries(catMap).filter(([,v])=>v.tipo==='receita').sort((a,b)=>a[1].nome.localeCompare(b[1].nome))
    const despesas = Object.entries(catMap).filter(([,v])=>v.tipo==='despesa').sort((a,b)=>a[1].nome.localeCompare(b[1].nome))

    // Totais por mês
    const totRec = {}, totDesp = {}, totTransfEnt = {}, totTransfSai = {}
    for (const mes of meses) {
      totRec[mes] = receitas.reduce((s,[,v])=>s+(v.meses[mes]||0),0)
      totDesp[mes] = despesas.reduce((s,[,v])=>s+(v.meses[mes]||0),0)
      totTransfEnt[mes] = transfsMap.entrada[mes]||0
      totTransfSai[mes] = transfsMap.saida[mes]||0
    }

    // Gráfico
    const grafico = meses.map(m=>({
      mes: labelMes(m),
      Receitas: totRec[m]||0,
      Despesas: totDesp[m]||0,
      'Transf. Entrada': totTransfEnt[m]||0,
      'Transf. Saída': totTransfSai[m]||0,
      Resultado: (totRec[m]||0)-(totDesp[m]||0),
    }))

    return { receitas, despesas, transfsMap, totRec, totDesp, totTransfEnt, totTransfSai, meses, grafico }
  }

  const carregar = useCallback(async () => {
    setLoading(true)
    const d = await buscarDados(iniMes, fimMes2)
    setDados(d)

    if (comparativo !== 'nenhum') {
      let { ini:ic, fim:fc } = (() => {
        if (comparativo==='mes_ant') return periodoAnterior(iniMes,fimMes2)
        if (comparativo==='ano_ant') return mesmoMesAnoAnterior(iniMes,fimMes2)
        if (comparativo==='tri_ant') {
          const p = periodoAnterior(iniMes,fimMes2)
          return { ini: p.ini, fim: p.fim }
        }
        return { ini:iniMes, fim:fimMes2 }
      })()
      const dc = await buscarDados(ic, fc)
      setDadosComp(dc)
    } else {
      setDadosComp(null)
    }
    setLoading(false)
  }, [iniMes, fimMes2, contaId, comparativo])

  useEffect(()=>{ carregar() },[carregar])

  const fmtDelta = (cur, ant) => {
    if (!ant || ant===0) return null
    const d = ((cur-ant)/Math.abs(ant))*100
    return <span style={{fontSize:11,color:d>=0?'var(--ok)':'var(--danger)',marginLeft:4}}>{d>=0?'↑':'↓'}{Math.abs(d).toFixed(1)}%</span>
  }

  if (!dados) return <div className="loading"><RefreshCw size={14} className="spin"/></div>

  const { receitas, despesas, transfsMap, totRec, totDesp, totTransfEnt, totTransfSai, meses, grafico } = dados
  const totalReceitas = meses.reduce((s,m)=>s+(totRec[m]||0),0)
  const totalDespesas = meses.reduce((s,m)=>s+(totDesp[m]||0),0)
  const resultado = totalReceitas - totalDespesas

  const COMP_LABEL = { mes_ant:'Mês anterior', ano_ant:'Mesmo período ano anterior', tri_ant:'Trimestre anterior', tri_ano:'Trimestre ano anterior' }

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad" style={{marginBottom:12}}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="month" className="form-input" value={iniMes} onChange={e=>setIniMes(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="month" className="form-input" value={fimMes2} onChange={e=>setFimMes2(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Conta</label>
            <select className="form-input" value={contaId} onChange={e=>setContaId(e.target.value)}>
              <option value="todas">Todas as contas</option>
              {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Comparativo</label>
            <select className="form-input" value={comparativo} onChange={e=>setComparativo(e.target.value)}>
              <option value="nenhum">Sem comparativo</option>
              <option value="mes_ant">Período anterior</option>
              <option value="ano_ant">Mesmo período ano anterior</option>
              <option value="tri_ant">Trimestre anterior</option>
            </select>
          </div>
          <button className="btn btn-ghost" onClick={carregar} disabled={loading}>
            {loading?<RefreshCw size={14} className="spin"/>:<RefreshCw size={14}/>}
          </button>
        </div>

        {/* KPIs */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginTop:14}}>
          {[
            {l:'Receitas',v:totalReceitas,cor:'var(--ok)',compV:dadosComp?dadosComp.meses.reduce((s,m)=>s+(dadosComp.totRec[m]||0),0):null},
            {l:'Despesas',v:totalDespesas,cor:'var(--danger)',compV:dadosComp?dadosComp.meses.reduce((s,m)=>s+(dadosComp.totDesp[m]||0),0):null},
            {l:'Resultado',v:resultado,cor:resultado>=0?'var(--ok)':'var(--danger)',compV:dadosComp?dadosComp.meses.reduce((s,m)=>s+(dadosComp.totRec[m]||0)-(dadosComp.totDesp[m]||0),0):null},
          ].map(k=>(
            <div key={k.l} style={{padding:'12px 16px',borderRadius:8,background:'var(--gray-50)',borderLeft:`3px solid ${k.cor}`}}>
              <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',marginBottom:4}}>{k.l}</div>
              <div style={{fontWeight:800,fontSize:22,color:k.cor}}>{fmtR(k.v)}</div>
              {k.compV!=null && <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>{COMP_LABEL[comparativo]}: {fmtR(k.compV)} {fmtDelta(k.v,k.compV)}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Tabela balancete — PRIMEIRO */}
      <div className="card" style={{overflowX:'auto',marginBottom:16}}>
        {loading && <div style={{padding:20,textAlign:'center'}}><RefreshCw size={14} className="spin"/></div>}
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
          <thead>
            <tr style={{background:'var(--gray-50)'}}>
              <th style={{padding:'10px 16px',textAlign:'left',minWidth:240,position:'sticky',left:0,background:'var(--gray-50)',fontSize:12,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:'.05em'}}>Categoria</th>
              {meses.map(m=>(
                <th key={m} style={{padding:'10px 12px',textAlign:'right',minWidth:130,fontSize:12,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:'.05em'}}>{labelMes(m)}</th>
              ))}
              <th style={{padding:'10px 12px',textAlign:'right',minWidth:130,color:'var(--purple)',fontWeight:800,fontSize:13}}>Total</th>
            </tr>
          </thead>
          <tbody>
            {/* RECEITAS */}
            <tr>
              <td colSpan={meses.length+2} style={{padding:'8px 16px',fontWeight:800,fontSize:12,textTransform:'uppercase',background:'#e8fdf0',color:'var(--ok)',letterSpacing:'.05em',borderTop:'2px solid var(--ok)'}}>
                Receitas
              </td>
            </tr>
            {receitas.map(([catId,cat])=>(
              <tr key={catId} style={{borderBottom:'1px solid var(--gray-100)'}}>
                <td style={{padding:'9px 16px 9px 28px',color:'var(--gray-800)',position:'sticky',left:0,background:'var(--white)',fontSize:14}}>{cat.nome}</td>
                {meses.map(m=>(
                  <td key={m} style={{padding:'9px 12px',textAlign:'right',color:cat.meses[m]?'var(--ok)':'var(--gray-300)',fontSize:14}}>
                    {cat.meses[m]?fmtR(cat.meses[m]):'—'}
                  </td>
                ))}
                <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,color:'var(--ok)',fontSize:14}}>
                  {fmtR(Object.values(cat.meses).reduce((s,v)=>s+v,0))}
                </td>
              </tr>
            ))}
            <tr style={{borderTop:'2px solid var(--ok)',background:'#e8fdf0'}}>
              <td style={{padding:'10px 16px',fontWeight:800,fontSize:14,position:'sticky',left:0,background:'#e8fdf0',color:'var(--ok)'}}>Total de receitas</td>
              {meses.map(m=><td key={m} style={{padding:'10px 12px',textAlign:'right',fontWeight:800,fontSize:14,color:'var(--ok)'}}>{fmtR(totRec[m]||0)}</td>)}
              <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,fontSize:14,color:'var(--ok)'}}>{fmtR(totalReceitas)}</td>
            </tr>

            {/* DESPESAS */}
            <tr>
              <td colSpan={meses.length+2} style={{padding:'8px 16px',fontWeight:800,fontSize:12,textTransform:'uppercase',background:'#fef2f2',color:'var(--danger)',letterSpacing:'.05em',borderTop:'2px solid var(--danger)'}}>
                Despesas
              </td>
            </tr>
            {despesas.map(([catId,cat])=>(
              <tr key={catId} style={{borderBottom:'1px solid var(--gray-100)'}}>
                <td style={{padding:'9px 16px 9px 28px',color:'var(--gray-800)',position:'sticky',left:0,background:'var(--white)',fontSize:14}}>{cat.nome}</td>
                {meses.map(m=>(
                  <td key={m} style={{padding:'9px 12px',textAlign:'right',color:cat.meses[m]?'var(--danger)':'var(--gray-300)',fontSize:14}}>
                    {cat.meses[m]?fmtR(cat.meses[m]):'—'}
                  </td>
                ))}
                <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,color:'var(--danger)',fontSize:14}}>
                  {fmtR(Object.values(cat.meses).reduce((s,v)=>s+v,0))}
                </td>
              </tr>
            ))}
            <tr style={{borderTop:'2px solid var(--danger)',background:'#fef2f2'}}>
              <td style={{padding:'10px 16px',fontWeight:800,fontSize:14,position:'sticky',left:0,background:'#fef2f2',color:'var(--danger)'}}>Total de despesas</td>
              {meses.map(m=><td key={m} style={{padding:'10px 12px',textAlign:'right',fontWeight:800,fontSize:14,color:'var(--danger)'}}>{fmtR(totDesp[m]||0)}</td>)}
              <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,fontSize:14,color:'var(--danger)'}}>{fmtR(totalDespesas)}</td>
            </tr>

            {/* TRANSFERÊNCIAS */}
            {(Object.keys(transfsMap.entrada).length > 0 || Object.keys(transfsMap.saida).length > 0) && (<>
              <tr>
                <td colSpan={meses.length+2} style={{padding:'8px 16px',fontWeight:800,fontSize:12,textTransform:'uppercase',background:'var(--gray-50)',color:'var(--gray-500)',letterSpacing:'.05em',borderTop:'2px solid var(--gray-300)'}}>
                  Transferências de entrada
                </td>
              </tr>
              <tr style={{borderBottom:'1px solid var(--gray-100)'}}>
                <td style={{padding:'9px 16px 9px 28px',position:'sticky',left:0,background:'var(--white)',fontSize:14}}>Transferências de entrada</td>
                {meses.map(m=><td key={m} style={{padding:'9px 12px',textAlign:'right',color:'var(--gray-600)',fontSize:14}}>{totTransfEnt[m]?fmtR(totTransfEnt[m]):'—'}</td>)}
                <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,fontSize:14}}>{fmtR(meses.reduce((s,m)=>s+(totTransfEnt[m]||0),0))}</td>
              </tr>
              <tr>
                <td colSpan={meses.length+2} style={{padding:'8px 16px',fontWeight:800,fontSize:12,textTransform:'uppercase',background:'var(--gray-50)',color:'var(--gray-500)',letterSpacing:'.05em'}}>
                  Transferências de saída
                </td>
              </tr>
              <tr style={{borderBottom:'1px solid var(--gray-100)'}}>
                <td style={{padding:'9px 16px 9px 28px',position:'sticky',left:0,background:'var(--white)',fontSize:14}}>Transferências de saída</td>
                {meses.map(m=><td key={m} style={{padding:'9px 12px',textAlign:'right',color:'var(--gray-600)',fontSize:14}}>{totTransfSai[m]?fmtR(totTransfSai[m]):'—'}</td>)}
                <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,fontSize:14}}>{fmtR(meses.reduce((s,m)=>s+(totTransfSai[m]||0),0))}</td>
              </tr>
            </>)}

            {/* RESULTADO */}
            <tr style={{borderTop:'3px solid var(--purple)',background:'var(--purple-pale)'}}>
              <td style={{padding:'12px 16px',fontWeight:900,fontSize:15,color:'var(--purple)',position:'sticky',left:0,background:'var(--purple-pale)'}}>Resultado (Rec. − Desp.)</td>
              {meses.map(m=>{
                const v=(totRec[m]||0)-(totDesp[m]||0)
                return <td key={m} style={{padding:'12px 12px',textAlign:'right',fontWeight:800,fontSize:15,color:v>=0?'var(--ok)':'var(--danger)'}}>{fmtR(v)}</td>
              })}
              <td style={{padding:'12px 12px',textAlign:'right',fontWeight:900,fontSize:15,color:resultado>=0?'var(--ok)':'var(--danger)'}}>{fmtR(resultado)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Gráfico — ÚLTIMO */}
      <div className="card card-pad">
        <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:'var(--gray-700)'}}>Evolução mensal</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={grafico} margin={{top:5,right:20,left:10,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
            <XAxis dataKey="mes" tick={{fontSize:12}}/>
            <YAxis tickFormatter={v=>fmtR(v).replace('R$\u00a0','')} tick={{fontSize:11}} width={90}/>
            <Tooltip formatter={(v,n)=>[fmtR(v),n]} contentStyle={{fontSize:13}}/>
            <Legend iconSize={12} wrapperStyle={{fontSize:13}}/>
            <Line type="monotone" dataKey="Receitas" stroke="var(--ok)" strokeWidth={2.5} dot={{r:4}}/>
            <Line type="monotone" dataKey="Despesas" stroke="var(--danger)" strokeWidth={2.5} dot={{r:4}}/>
            <Line type="monotone" dataKey="Resultado" stroke="var(--purple)" strokeWidth={2} dot={{r:3}} strokeDasharray="5 3"/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
