import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, Save, Plus, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const GRUPOS = [
  { key:'receita', label:'RECEITAS',  tipo:'receita', cats:['Vendas Shopify','Vendas Delivery','Vendas B2B','Laricas Club','Outras Receitas'] },
  { key:'cmv',     label:'CMV',       tipo:'despesa', cats:['CMV - ECOM','CMV - Delivery','CMV - B2B','CMV - Outros'] },
  { key:'dvc',     label:'DESP. VAR. COMERCIAIS', tipo:'despesa', cats:['Taxas/Comissões','Logística/Entrega','Comissões Comerciais','Deduções/Descontos','Impostos'] },
  { key:'dvm',     label:'MARKETING', tipo:'despesa', cats:['Marketing Digital','Marketing Offline'] },
  { key:'fixas',   label:'FIXAS',     tipo:'despesa', cats:['Aluguel','Pessoal/RH','Sistemas/Ferramentas','Contador/Jurídico','Outras Despesas Fixas'] },
]

function StatusBadge({ pct }) {
  if (pct===null) return <span style={{color:'var(--gray-300)',fontSize:11}}>—</span>
  const Icon = pct>110 ? TrendingUp : pct<90 ? TrendingDown : Minus
  const cor = pct>105?'var(--danger)':pct<80?'var(--warning)':'var(--ok)'
  return <span style={{fontSize:11,fontWeight:700,color:cor,display:'inline-flex',alignItems:'center',gap:2}}><Icon size={11}/> {pct.toFixed(0)}%</span>
}

export default function FinOrcamento() {
  const hoje = new Date()
  const [anoMes, setAnoMes] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`)
  const [revisoes, setRevisoes] = useState([])      // lista de revisões do mês
  const [revisaoAtiva, setRevisaoAtiva] = useState(0) // índice da revisão selecionada
  const [orcamentos, setOrcamentos] = useState({})   // { catNome: valor }
  const [realizado, setRealizado] = useState({})
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [editado, setEditado] = useState({})
  const [criarRevisao, setCriarRevisao] = useState(false)
  const [nomeRevisao, setNomeRevisao] = useState('')

  useEffect(() => {
    supabase.from('fin_categorias').select('*').eq('ativo',true).order('ordem')
      .then(({data})=>setCategorias(data||[]))
  },[])

  useEffect(() => { if(anoMes) carregar() }, [anoMes])

  async function carregar() {
    setLoading(true)
    const ini=anoMes+'-01', fim=anoMes+'-31'

    const [{ data: parc }, { data: orc }] = await Promise.all([
      supabase.from('fin_parcelas')
        .select('valor, fin_lancamentos(fin_categorias(nome))')
        .gte('data_vencimento',ini).lte('data_vencimento',fim).eq('status','pago'),
      supabase.from('fin_orcamento')
        .select('*, fin_categorias(nome)')
        .eq('ano_mes',anoMes)
        .order('revisao'),
    ])

    // Agrupa revisões únicas
    const revSet = {}
    for (const o of (orc||[])) {
      const key = o.revisao
      if (!revSet[key]) revSet[key] = { revisao:o.revisao, label:o.revisao_label||`R${o.revisao}`, itens:{} }
      if (o.fin_categorias?.nome) revSet[key].itens[o.fin_categorias.nome] = o.valor
    }
    const revList = Object.values(revSet).sort((a,b)=>a.revisao-b.revisao)
    if (revList.length===0) revList.push({ revisao:0, label:'Original', itens:{} })
    setRevisoes(revList)

    // Usa a revisão ativa ou a última
    const idx = Math.min(revisaoAtiva, revList.length-1)
    setOrcamentos(revList[idx]?.itens || {})

    const realMap = {}
    for (const p of (parc||[])) {
      const cat = p.fin_lancamentos?.fin_categorias?.nome
      if(cat) realMap[cat]=(realMap[cat]||0)+p.valor
    }
    setRealizado(realMap)
    setEditado({})
    setLoading(false)
  }

  function setOrc(cat, val) { setEditado(prev=>({...prev,[cat]:val})) }

  async function salvar() {
    setSalvando(true)
    const rev = revisoes[revisaoAtiva] || revisoes[0]
    for (const [catNome, valor] of Object.entries(editado)) {
      const cat = categorias.find(c=>c.nome===catNome)
      if(!cat) continue
      const valAnterior = orcamentos[catNome] || 0
      const { data: saved } = await supabase.from('fin_orcamento').upsert(
        { ano_mes:anoMes, categoria_id:cat.id, valor:parseFloat(valor)||0,
          revisao:rev.revisao, revisao_label:rev.label,
          criado_por:JSON.parse(sessionStorage.getItem('usuario')||'{}').nome },
        { onConflict:'ano_mes,categoria_id,revisao' }
      ).select().single()
      // Log da alteração
      if (saved && Math.abs(valAnterior - (parseFloat(valor)||0)) > 0.01) {
        await supabase.from('fin_orcamento_log').insert({
          orcamento_id:saved.id, valor_anterior:valAnterior,
          valor_novo:parseFloat(valor)||0,
          alterado_por:JSON.parse(sessionStorage.getItem('usuario')||'{}').nome,
        })
      }
    }
    setOrcamentos(prev=>({...prev,...Object.fromEntries(Object.entries(editado).map(([k,v])=>[k,parseFloat(v)||0]))}))
    setEditado({})
    setSalvando(false)
  }

  async function criarNovaRevisao() {
    if (!nomeRevisao.trim()) return
    const novaRev = revisoes.length
    const revAtual = revisoes[revisaoAtiva]
    // Copia os valores da revisão atual para a nova
    for (const [catNome, valor] of Object.entries(revAtual?.itens||{})) {
      const cat = categorias.find(c=>c.nome===catNome)
      if(!cat) continue
      await supabase.from('fin_orcamento').upsert(
        { ano_mes:anoMes, categoria_id:cat.id, valor, revisao:novaRev, revisao_label:nomeRevisao.trim(),
          criado_por:JSON.parse(sessionStorage.getItem('usuario')||'{}').nome },
        { onConflict:'ano_mes,categoria_id,revisao' }
      )
    }
    setNomeRevisao(''); setCriarRevisao(false)
    setRevisaoAtiva(novaRev)
    await carregar()
  }

  const totOrc = cat => editado[cat]!==undefined?(parseFloat(editado[cat])||0):(orcamentos[cat]||0)
  const totReal = cat => realizado[cat]||0
  const execPct = cat => totOrc(cat)>0?(totReal(cat)/totOrc(cat))*100:null
  const temEdicao = Object.keys(editado).length>0

  return (
    <>
      <div className="card card-pad">
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div className="form-group">
            <label className="form-label">Mês</label>
            <input type="month" className="form-input" value={anoMes} onChange={e=>{setAnoMes(e.target.value);setRevisaoAtiva(0)}}/>
          </div>

          {/* Seletor de revisão */}
          <div className="form-group">
            <label className="form-label">Revisão</label>
            <div style={{ display:'flex', gap:4 }}>
              {revisoes.map((r,i)=>(
                <button key={r.revisao}
                  className={`btn btn-sm ${revisaoAtiva===i?'btn-primary':'btn-ghost'}`}
                  onClick={()=>{ setRevisaoAtiva(i); setOrcamentos(r.itens||{}); setEditado({}) }}>
                  {r.label}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={()=>setCriarRevisao(true)} title="Nova revisão">
                <Plus size={12}/>
              </button>
            </div>
          </div>

          <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
          {temEdicao && (
            <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
              {salvando?<RefreshCw size={14} className="spin"/>:<Save size={14}/>} Salvar
            </button>
          )}
        </div>

        {criarRevisao && (
          <div style={{ marginTop:12, display:'flex', gap:8, alignItems:'center' }}>
            <input className="form-input" style={{ width:200 }} placeholder="Ex: R1 — Revisão Junho"
              value={nomeRevisao} onChange={e=>setNomeRevisao(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&criarNovaRevisao()} autoFocus/>
            <button className="btn btn-primary btn-sm" onClick={criarNovaRevisao} disabled={!nomeRevisao.trim()}>Criar</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setCriarRevisao(false);setNomeRevisao('')}}>Cancelar</button>
          </div>
        )}

        <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:8 }}>
          💡 Crie revisões (R1, R2...) para manter o orçamento original intacto e comparar cenários.
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <div className="card">
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', padding:'10px 14px', minWidth:200, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Categoria</th>
                  <th style={{ textAlign:'right', padding:'10px 14px', minWidth:140, background:'var(--purple-pale)', borderBottom:'2px solid var(--purple)', color:'var(--purple)', fontWeight:800 }}>
                    Orçado — {revisoes[revisaoAtiva]?.label}
                  </th>
                  <th style={{ textAlign:'right', padding:'10px 14px', minWidth:140, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Realizado</th>
                  <th style={{ textAlign:'right', padding:'10px 14px', minWidth:100, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Diferença</th>
                  <th style={{ textAlign:'center', padding:'10px 14px', minWidth:80, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Exec.</th>
                  <th style={{ minWidth:120, padding:'10px 14px', background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>Barra</th>
                </tr>
              </thead>
              <tbody>
                {GRUPOS.map((grupo,gi)=>{
                  const totGO = grupo.cats.reduce((s,c)=>s+totOrc(c),0)
                  const totGR = grupo.cats.reduce((s,c)=>s+totReal(c),0)
                  const totGP = totGO>0?(totGR/totGO)*100:null
                  return [
                    <tr key={`g-${gi}`}>
                      <td colSpan={6} style={{ background:grupo.tipo==='receita'?'var(--ok-pale)':'var(--danger-pale)', padding:'6px 14px', fontWeight:800, fontSize:11, color:grupo.tipo==='receita'?'var(--ok)':'var(--danger)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                        {grupo.label}
                        {totGO>0&&<span style={{ float:'right', fontWeight:400, fontSize:11 }}>{fmtR(totGR)} / {fmtR(totGO)} — <StatusBadge pct={totGP}/></span>}
                      </td>
                    </tr>,
                    ...grupo.cats.map(cat=>{
                      const o=totOrc(cat), r=totReal(cat)
                      const dif=o>0?r-o:0
                      const ep=execPct(cat)
                      const difCor=grupo.tipo==='receita'?(dif>=0?'var(--ok)':'var(--danger)'):(dif<=0?'var(--ok)':'var(--danger)')
                      const barPct=o>0?Math.min(150,(r/o)*100):0
                      const barCor=ep===null?'var(--gray-200)':ep>110?'var(--danger)':ep>100?'var(--warning)':'var(--ok)'
                      return (
                        <tr key={cat} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                          <td style={{ padding:'8px 14px 8px 24px', color:'var(--gray-700)' }}>{cat}</td>
                          <td style={{ padding:'6px 14px', textAlign:'right' }}>
                            <input type="number" min={0} step={100}
                              value={editado[cat]!==undefined?editado[cat]:(orcamentos[cat]||'')}
                              onChange={e=>setOrc(cat,e.target.value)}
                              placeholder="0,00"
                              style={{ width:110, padding:'5px 8px', fontSize:13, fontWeight:600, textAlign:'right', border:`1.5px solid ${editado[cat]!==undefined?'var(--purple)':'var(--gray-200)'}`, borderRadius:6, outline:'none', background:editado[cat]!==undefined?'var(--purple-ghost)':'var(--white)' }}/>
                          </td>
                          <td style={{ textAlign:'right', padding:'8px 14px', fontWeight:r>0?600:400, color:r>0?'var(--gray-800)':'var(--gray-300)' }}>
                            {r>0?fmtR(r):'—'}
                          </td>
                          <td style={{ textAlign:'right', padding:'8px 14px', fontWeight:700, color:o>0?difCor:'var(--gray-300)', fontSize:12 }}>
                            {o>0?(dif>=0?'+':'')+fmtR(dif):'—'}
                          </td>
                          <td style={{ textAlign:'center', padding:'8px 14px' }}><StatusBadge pct={ep}/></td>
                          <td style={{ padding:'8px 14px' }}>
                            {o>0?(
                              <div style={{ height:14, background:'var(--gray-100)', borderRadius:3, overflow:'hidden' }}>
                                <div style={{ height:'100%', width:`${Math.min(100,barPct)}%`, background:barCor, borderRadius:3, transition:'width .3s' }}/>
                              </div>
                            ):<div style={{ height:14, background:'var(--gray-100)', borderRadius:3 }}/>}
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
            ✅ Exec. &lt; 100% = abaixo do orçado · &gt; 100% = estourou · Para receitas: &gt; 100% é positivo
          </div>
        </div>
      )}
    </>
  )
}
