import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, Save, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const GRUPOS = [
  { key:'receita', label:'RECEITAS',  tipo:'receita', cats:['Vendas Shopify','Vendas Delivery','Vendas B2B','Laricas Club','Outras Receitas'] },
  { key:'cmv',     label:'CMV',       tipo:'despesa', cats:['CMV - ECOM','CMV - Delivery','CMV - B2B','CMV - Outros'] },
  { key:'dvc',     label:'DESP. VAR. COMERCIAIS', tipo:'despesa', cats:['Taxas/Comissões','Logística/Entrega','Comissões Comerciais','Deduções/Descontos','Impostos'] },
  { key:'dvm',     label:'MARKETING', tipo:'despesa', cats:['Marketing Digital','Marketing Offline'] },
  { key:'fixas',   label:'FIXAS',     tipo:'despesa', cats:['Aluguel','Pessoal/RH','Sistemas/Ferramentas','Contador/Jurídico','Outras Despesas Fixas'] },
]

function StatusBadge({ pct }) {
  if (pct === null) return <span style={{ color:'var(--gray-300)', fontSize:11 }}>—</span>
  const ok = pct <= 100
  const Icon = pct > 110 ? TrendingUp : pct < 90 ? TrendingDown : Minus
  const cor = pct > 105 ? 'var(--danger)' : pct < 80 ? 'var(--warning)' : 'var(--ok)'
  return (
    <span style={{ fontSize:11, fontWeight:700, color:cor, display:'inline-flex', alignItems:'center', gap:2 }}>
      <Icon size={11}/> {pct.toFixed(0)}%
    </span>
  )
}

export default function FinOrcamento() {
  const hoje = new Date()
  const [anoMes, setAnoMes] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`)
  const [orcamentos, setOrcamentos] = useState({})   // { catNome: valor }
  const [realizado, setRealizado] = useState({})     // { catNome: valor }
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [editado, setEditado] = useState({})

  useEffect(() => {
    supabase.from('fin_categorias').select('*').eq('ativo',true).order('ordem')
      .then(({data}) => setCategorias(data||[]))
  }, [])

  useEffect(() => { if (anoMes) carregar() }, [anoMes])

  async function carregar() {
    setLoading(true)
    const ini = anoMes+'-01', fim = anoMes+'-31'

    const [{ data: parc }, { data: orc }] = await Promise.all([
      supabase.from('fin_parcelas')
        .select('valor, fin_lancamentos(fin_categorias(nome))')
        .gte('data_vencimento', ini).lte('data_vencimento', fim).eq('status','pago'),
      supabase.from('fin_orcamento')
        .select('*, fin_categorias(nome)')
        .eq('ano_mes', anoMes),
    ])

    const realMap = {}
    for (const p of (parc||[])) {
      const cat = p.fin_lancamentos?.fin_categorias?.nome
      if (cat) realMap[cat] = (realMap[cat]||0) + p.valor
    }

    const orcMap = {}
    for (const o of (orc||[])) {
      if (o.fin_categorias?.nome) orcMap[o.fin_categorias.nome] = o.valor
    }

    setRealizado(realMap)
    setOrcamentos(orcMap)
    setEditado({})
    setLoading(false)
  }

  function setOrc(cat, val) {
    setEditado(prev => ({ ...prev, [cat]: val }))
  }

  async function salvar() {
    setSalvando(true)
    for (const [catNome, valor] of Object.entries(editado)) {
      const cat = categorias.find(c=>c.nome===catNome)
      if (!cat) continue
      await supabase.from('fin_orcamento').upsert(
        { ano_mes:anoMes, categoria_id:cat.id, valor:parseFloat(valor)||0,
          criado_por: JSON.parse(sessionStorage.getItem('usuario')||'{}').nome },
        { onConflict:'ano_mes,categoria_id' }
      )
    }
    setOrcamentos(prev => ({ ...prev, ...Object.fromEntries(Object.entries(editado).map(([k,v])=>[k,parseFloat(v)||0])) }))
    setEditado({})
    setSalvando(false)
  }

  // Totais
  const totOrc = cat => editado[cat] !== undefined ? (parseFloat(editado[cat])||0) : (orcamentos[cat]||0)
  const totReal = cat => realizado[cat] || 0
  const execPct = cat => totOrc(cat) > 0 ? (totReal(cat)/totOrc(cat))*100 : null

  const temEdicao = Object.keys(editado).length > 0

  return (
    <>
      <div className="card card-pad">
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div className="form-group">
            <label className="form-label">Mês</label>
            <input type="month" className="form-input" value={anoMes} onChange={e=>setAnoMes(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
          {temEdicao && (
            <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
              {salvando?<RefreshCw size={14} className="spin"/>:<Save size={14}/>} Salvar orçamento
            </button>
          )}
          <div style={{ marginLeft:'auto', fontSize:12, color:'var(--gray-400)' }}>
            {mesLabel(anoMes+'-01')} · Digite os valores orçados e compare com o realizado
          </div>
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <div className="card">
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', padding:'10px 14px', minWidth:200, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Categoria</th>
                  <th style={{ textAlign:'right', padding:'10px 14px', minWidth:140, background:'var(--purple-pale)', borderBottom:'2px solid var(--purple)', color:'var(--purple)', fontWeight:800 }}>Orçado</th>
                  <th style={{ textAlign:'right', padding:'10px 14px', minWidth:140, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Realizado</th>
                  <th style={{ textAlign:'right', padding:'10px 14px', minWidth:100, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Diferença</th>
                  <th style={{ textAlign:'center', padding:'10px 14px', minWidth:80, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Exec.</th>
                  <th style={{ minWidth:120, padding:'10px 14px', background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Barra</th>
                </tr>
              </thead>
              <tbody>
                {GRUPOS.map((grupo,gi) => {
                  const totGrupoOrc = grupo.cats.reduce((s,cat)=>s+totOrc(cat),0)
                  const totGrupoReal = grupo.cats.reduce((s,cat)=>s+totReal(cat),0)
                  const totDif = totGrupoOrc > 0 ? totGrupoReal - totGrupoOrc : 0
                  const totPct = totGrupoOrc > 0 ? (totGrupoReal/totGrupoOrc)*100 : null
                  return [
                    <tr key={`g-${gi}`}>
                      <td colSpan={6} style={{ background:grupo.tipo==='receita'?'var(--ok-pale)':'var(--danger-pale)', padding:'6px 14px', fontWeight:800, fontSize:11, color:grupo.tipo==='receita'?'var(--ok)':'var(--danger)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                        {grupo.label}
                        {totGrupoOrc > 0 && (
                          <span style={{ float:'right', fontWeight:400, fontSize:11 }}>
                            {fmtR(totGrupoReal)} / {fmtR(totGrupoOrc)} — <StatusBadge pct={totPct}/>
                          </span>
                        )}
                      </td>
                    </tr>,
                    ...grupo.cats.map(cat => {
                      const o = totOrc(cat)
                      const r = totReal(cat)
                      const dif = o > 0 ? r - o : 0
                      const ep = execPct(cat)
                      const difCor = grupo.tipo==='receita'
                        ? (dif >= 0 ? 'var(--ok)' : 'var(--danger)')
                        : (dif <= 0 ? 'var(--ok)' : 'var(--danger)')
                      const barPct = o > 0 ? Math.min(150, (r/o)*100) : 0
                      const barCor = ep === null ? 'var(--gray-200)' : ep > 110 ? 'var(--danger)' : ep > 100 ? 'var(--warning)' : 'var(--ok)'
                      return (
                        <tr key={cat} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                          <td style={{ padding:'8px 14px 8px 24px', color:'var(--gray-700)' }}>{cat}</td>
                          <td style={{ padding:'6px 14px', textAlign:'right' }}>
                            <input
                              type="number" min={0} step={100}
                              value={editado[cat] !== undefined ? editado[cat] : (orcamentos[cat] || '')}
                              onChange={e => setOrc(cat, e.target.value)}
                              placeholder="0,00"
                              style={{ width:110, padding:'5px 8px', fontSize:13, fontWeight:600, textAlign:'right', border:`1.5px solid ${editado[cat]!==undefined?'var(--purple)':'var(--gray-200)'}`, borderRadius:6, outline:'none', background: editado[cat]!==undefined?'var(--purple-ghost)':'var(--white)' }}
                            />
                          </td>
                          <td style={{ textAlign:'right', padding:'8px 14px', fontWeight:r>0?600:400, color:r>0?'var(--gray-800)':'var(--gray-300)' }}>
                            {r>0?fmtR(r):'—'}
                          </td>
                          <td style={{ textAlign:'right', padding:'8px 14px', fontWeight:700, color:o>0?difCor:'var(--gray-300)', fontSize:12 }}>
                            {o>0 ? (dif>=0?'+':'')+fmtR(dif) : '—'}
                          </td>
                          <td style={{ textAlign:'center', padding:'8px 14px' }}>
                            <StatusBadge pct={ep}/>
                          </td>
                          <td style={{ padding:'8px 14px' }}>
                            {o > 0 ? (
                              <div style={{ height:14, background:'var(--gray-100)', borderRadius:3, overflow:'hidden', position:'relative' }}>
                                <div style={{ height:'100%', width:`${Math.min(100,barPct)}%`, background:barCor, borderRadius:3, transition:'width .3s' }}/>
                                {barPct > 100 && (
                                  <div style={{ position:'absolute', right:0, top:0, height:'100%', width:`${Math.min(50,barPct-100)}%`, background:'rgba(231,76,60,.4)', borderRadius:'0 3px 3px 0' }}/>
                                )}
                              </div>
                            ) : <div style={{ height:14, background:'var(--gray-100)', borderRadius:3 }}/>}
                          </td>
                        </tr>
                      )
                    }),
                  ]
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding:'10px 20px', borderTop:'1px solid var(--gray-200)', fontSize:11, color:'var(--gray-400)' }}>
            ✅ Exec. &lt; 100% = abaixo do orçado · Exec. &gt; 100% = estourou · Para receitas: &gt;100% é positivo
          </div>
        </div>
      )}
    </>
  )
}
