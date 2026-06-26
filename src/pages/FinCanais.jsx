import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react'

function pct(v, base) { return base > 0 ? (v/base)*100 : 0 }
function fmtPct(v) { return v.toFixed(1)+'%' }

function Trend({ atual, anterior }) {
  if (!anterior) return null
  const d = atual - anterior
  const p = pct(d, anterior)
  if (Math.abs(p) < 1) return <Minus size={11} color="var(--gray-400)" />
  return p > 0
    ? <TrendingUp size={11} color="var(--ok)" />
    : <TrendingDown size={11} color="var(--danger)" />
}

const CASCATA = [
  { key:'fb',   label:'Faturamento Bruto',   cor:'var(--gray-800)', bold:true  },
  { key:'ded',  label:'(-) Deduções',         cor:'var(--danger)',   bold:false },
  { key:'imp',  label:'(-) Impostos',         cor:'var(--danger)',   bold:false },
  { key:'fl',   label:'= Fat. Líquido',       cor:'var(--gray-700)', bold:true  },
  { key:'cmv',  label:'(-) CMV',              cor:'var(--danger)',   bold:false },
  { key:'lb',   label:'= Lucro Bruto',        cor:'var(--ok)',       bold:true, showPct:true },
  { key:'dvc',  label:'(-) Desp. Var. Com.',  cor:'var(--danger)',   bold:false },
  { key:'mc',   label:'= MC',                 cor:'var(--purple)',   bold:true, showPct:true },
  { key:'dvm',  label:'(-) Marketing',        cor:'var(--danger)',   bold:false },
  { key:'mcm',  label:'= MC c/ Marketing',    cor:'var(--purple)',   bold:true, showPct:true },
]

const CAT_GRUPOS = {
  fb:  ['Vendas Shopify','Vendas Delivery','Vendas B2B','Laricas Club','Outras Receitas'],
  ded: ['Deduções/Descontos'],
  imp: ['Impostos'],
  cmv: ['CMV - ECOM','CMV - Delivery','CMV - B2B','CMV - Outros'],
  dvc: ['Taxas/Comissões','Logística/Entrega','Comissões Comerciais'],
  dvm: ['Marketing Digital','Marketing Offline'],
}

function calcMetrics(catMap) {
  const soma = (keys) => keys.reduce((s,k) => s+(catMap[k]||0), 0)
  const fb  = soma(CAT_GRUPOS.fb)
  const ded = soma(CAT_GRUPOS.ded)
  const imp = soma(CAT_GRUPOS.imp)
  const fl  = fb - ded - imp
  const cmv = soma(CAT_GRUPOS.cmv)
  const lb  = fl - cmv
  const dvc = soma(CAT_GRUPOS.dvc)
  const mc  = lb - dvc
  const dvm = soma(CAT_GRUPOS.dvm)
  const mcm = mc - dvm
  return { fb, ded, imp, fl, cmv, lb, dvc, mc, dvm, mcm }
}

export default function FinCanais() {
  const hoje = new Date()
  const [anoMes, setAnoMes] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`)
  const [canais, setCanais] = useState([])
  const [dadosMes, setDadosMes] = useState({})    // { canalId: { catNome: valor } }
  const [dadosAnt, setDadosAnt] = useState({})
  const [loading, setLoading] = useState(true)
  const [selecionados, setSelecionados] = useState([])

  useEffect(() => {
    supabase.from('fin_canais').select('*').eq('ativo',true).order('ordem')
      .then(({ data }) => {
        setCanais(data||[])
        setSelecionados((data||[]).slice(0,5).map(c=>c.id))
      })
  }, [])

  useEffect(() => { if (canais.length) carregar() }, [anoMes, canais])

  async function carregar() {
    setLoading(true)
    const d = new Date(anoMes+'-01')
    const ant = new Date(d.getFullYear(), d.getMonth()-1, 1)
    const anoMesAnt = `${ant.getFullYear()}-${String(ant.getMonth()+1).padStart(2,'0')}`

    async function buscar(mes) {
      const ini = mes+'-01', fim = mes+'-31'
      const { data } = await supabase.from('fin_parcelas')
        .select('valor, canal_id:fin_lancamentos(canal_id), fin_lancamentos(tipo, canal_id, fin_categorias(nome))')
        .gte('data_vencimento', ini).lte('data_vencimento', fim).eq('status','pago')

      const mapa = {}
      for (const p of (data||[])) {
        const cid = p.fin_lancamentos?.canal_id
        const cat = p.fin_lancamentos?.fin_categorias?.nome
        if (!cid || !cat) continue
        if (!mapa[cid]) mapa[cid] = {}
        mapa[cid][cat] = (mapa[cid][cat]||0) + p.valor
      }
      return mapa
    }

    const [mes, ant2] = await Promise.all([buscar(anoMes), buscar(anoMesAnt)])
    setDadosMes(mes); setDadosAnt(ant2)
    setLoading(false)
  }

  const canaisSel = canais.filter(c => selecionados.includes(c.id))

  return (
    <>
      <div className="card card-pad">
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div className="form-group">
            <label className="form-label">Mês</label>
            <input type="month" className="form-input" value={anoMes} onChange={e=>setAnoMes(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
          <div style={{ flex:1 }}>
            <label className="form-label">Canais a comparar</label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:4 }}>
              {canais.map(c => (
                <button key={c.id}
                  className={`btn btn-sm ${selecionados.includes(c.id)?'btn-primary':'btn-ghost'}`}
                  style={{ fontSize:12, background: selecionados.includes(c.id)?c.cor:'', borderColor: c.cor }}
                  onClick={() => setSelecionados(prev =>
                    prev.includes(c.id) ? prev.filter(x=>x!==c.id) : [...prev, c.id]
                  )}>
                  {c.nome}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <div className="card">
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', padding:'10px 14px', minWidth:160, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>
                    {mesLabel(anoMes+'-01')}
                  </th>
                  {canaisSel.map(c => (
                    <th key={c.id} style={{ textAlign:'center', padding:'10px 12px', minWidth:130, background:'var(--gray-50)', borderBottom:`2px solid ${c.cor}`, borderTop:`3px solid ${c.cor}` }}>
                      <div style={{ fontWeight:800, color:c.cor }}>{c.nome}</div>
                      <div style={{ fontSize:10, color:'var(--gray-400)', fontWeight:400 }}>vs mês ant. →</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CASCATA.map(row => (
                  <tr key={row.key} style={{ borderBottom:'1px solid var(--gray-100)', background: row.bold?'var(--gray-50)':'var(--white)' }}>
                    <td style={{ padding:'9px 14px', fontWeight:row.bold?800:500, color:row.cor, fontSize:row.bold?13:12 }}>
                      {row.label}
                    </td>
                    {canaisSel.map(c => {
                      const m = calcMetrics(dadosMes[c.id]||{})
                      const a = calcMetrics(dadosAnt[c.id]||{})
                      const v = m[row.key] || 0
                      const va = a[row.key] || 0
                      const fb = m.fb || 1
                      return (
                        <td key={c.id} style={{ textAlign:'right', padding:'9px 12px', borderLeft:'1px solid var(--gray-100)' }}>
                          <div style={{ fontWeight:row.bold?800:500, color: v<0?'var(--danger)':row.bold?row.cor:'var(--gray-700)', fontSize:row.bold?14:13 }}>
                            {fmtR(v)}
                            {va !== 0 && <span style={{ marginLeft:4 }}><Trend atual={v} anterior={va}/></span>}
                          </div>
                          {row.showPct && fb > 0 && (
                            <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>
                              {fmtPct(pct(v, fb))} s/ FB
                            </div>
                          )}
                          {va !== 0 && (
                            <div style={{ fontSize:10, color:'var(--gray-300)' }}>ant: {fmtR(va)}</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ranking MC% */}
          <div style={{ padding:'14px 20px', borderTop:'1px solid var(--gray-200)' }}>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>Ranking de MC com Marketing por canal</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {canaisSel
                .map(c => { const m=calcMetrics(dadosMes[c.id]||{}); return { ...c, mcm:m.mcm, fb:m.fb, pct: m.fb>0?(m.mcm/m.fb)*100:0 } })
                .filter(c => c.fb > 0)
                .sort((a,b) => b.pct-a.pct)
                .map((c, i) => (
                  <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ width:20, fontSize:12, fontWeight:800, color:'var(--gray-400)', textAlign:'center' }}>{i+1}</span>
                    <span style={{ width:70, fontSize:13, fontWeight:700, color:c.cor }}>{c.nome}</span>
                    <div style={{ flex:1, height:20, background:'var(--gray-100)', borderRadius:4, overflow:'hidden', position:'relative' }}>
                      <div style={{ height:'100%', width:`${Math.max(0,Math.min(100,c.pct))}%`, background:c.cor, opacity:.8, borderRadius:4 }}/>
                      <span style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', fontSize:11, fontWeight:700, color:c.pct>0?'var(--gray-700)':'var(--danger)' }}>
                        {fmtPct(c.pct)}
                      </span>
                    </div>
                    <span style={{ width:90, textAlign:'right', fontSize:12, fontWeight:600 }}>{fmtR(c.mcm)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
