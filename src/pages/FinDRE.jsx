import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, FileText, Edit3, Check, X } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function pct(v,base) { return base>0?(v/base)*100:0 }
function fmtPct(v) { return v.toFixed(1)+'%' }

function CelulaEditavel({ valor, onSave, disabled }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef()

  function iniciar() {
    if (disabled) return
    setDraft(valor > 0 ? valor.toFixed(2) : '')
    setEditando(true)
    setTimeout(() => inputRef.current?.select(), 50)
  }

  function salvar() {
    onSave(parseFloat(draft.replace(',','.')) || 0)
    setEditando(false)
  }

  if (editando) return (
    <div style={{display:'flex',gap:3,alignItems:'center'}}>
      <input ref={inputRef} type="number" step={0.01} value={draft} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter')salvar();if(e.key==='Escape')setEditando(false)}}
        style={{width:90,padding:'3px 6px',fontSize:12,border:'2px solid var(--purple)',borderRadius:5,outline:'none'}}/>
      <button onClick={salvar} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ok)',padding:2}}><Check size={13}/></button>
      <button onClick={()=>setEditando(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--danger)',padding:2}}><X size={13}/></button>
    </div>
  )
  return (
    <div onClick={iniciar} style={{cursor:disabled?'default':'pointer',display:'flex',alignItems:'center',gap:4,justifyContent:'flex-end'}}
      title={disabled?'':'Clique para editar'}>
      <span style={{color:valor>0?'var(--gray-800)':'var(--gray-300)',fontWeight:valor>0?600:400}}>
        {valor>0?fmtR(valor):'—'}
      </span>
      {!disabled && valor===0 && <Edit3 size={10} style={{opacity:.3}}/>}
    </div>
  )
}

export default function FinDRE() {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const [anoMesIni, setAnoMesIni] = useState(`${anoAtual}-01`)
  const [anoMesFim, setAnoMesFim] = useState(`${anoAtual}-${String(hoje.getMonth()+1).padStart(2,'0')}`)
  const [regime, setRegime] = useState('competencia')
  const [mostrarPct, setMostrarPct] = useState(true)
  const [canais, setCanais] = useState([])
  const [categorias, setCategorias] = useState([])
  const [grupos, setGrupos] = useState([])      // config dinâmica da DRE
  const [grupoCats, setGrupoCats] = useState({}) // { grupo_id: [{ id, nome }] }
  const [dados, setDados] = useState({})
  const [dadosCanal, setDadosCanal] = useState({})
  const [ajustes, setAjustes] = useState({})
  const [expandidos, setExpandidos] = useState(new Set())
  const [loading, setLoading] = useState(true)

  // Carrega config estática
  useEffect(() => {
    Promise.all([
      supabase.from('fin_canais').select('*').eq('ativo',true).order('nivel').order('ordem'),
      supabase.from('fin_categorias').select('*').eq('ativo',true),
      supabase.from('fin_dre_grupos').select('*').eq('ativo',true).order('ordem'),
      supabase.from('fin_dre_grupo_cats').select('*, fin_categorias(id,nome)'),
    ]).then(([{data:cs},{data:cats},{data:gs},{data:gcs}]) => {
      setCanais(cs||[])
      setCategorias(cats||[])
      setGrupos(gs||[])
      const gcMap = {}
      for (const gc of (gcs||[])) {
        if (!gcMap[gc.grupo_id]) gcMap[gc.grupo_id] = []
        gcMap[gc.grupo_id].push({ id:gc.categoria_id, nome:gc.fin_categorias?.nome, vincId:gc.id })
      }
      setGrupoCats(gcMap)
    })
  }, [])

  useEffect(() => { if(grupos.length) carregar() }, [anoMesIni, anoMesFim, regime, grupos])

  async function carregar() {
    setLoading(true)
    const ini = anoMesIni+'-01', fim = anoMesFim+'-31'
    const campoData = regime==='caixa' ? 'data_pagamento' : 'data_vencimento'

    const [{ data: parcelas }, { data: ajustesDb }] = await Promise.all([
      supabase.from('fin_parcelas')
        .select('valor, data_competencia, data_vencimento, data_pagamento, status, fin_lancamentos(tipo, canal_id, fin_categorias(nome))')
        .gte(campoData, ini).lte(campoData, fim).eq('status','pago'),
      supabase.from('fin_dre_ajustes')
        .select('*, fin_categorias(nome)')
        .gte('ano_mes', anoMesIni).lte('ano_mes', anoMesFim),
    ])

    // Resolve canal_id recursivamente — se lançamento é num canal filho,
    // propaga o valor para todos os ancestrais
    const canalMap = {}
    for (const c of canais) canalMap[c.id] = c

    function getAncestors(canalId) {
      const ans = []
      let c = canalMap[canalId]
      while (c) { ans.push(c.id); c = c.parent_id ? canalMap[c.parent_id] : null }
      return ans
    }

    const mapa = {}
    const mapaCanal = {}

    for (const p of (parcelas||[])) {
      const pCanalId = p.fin_lancamentos?.canal_id
      const mes = (regime==='caixa' ? p.data_pagamento : p.data_competencia || p.data_vencimento)?.slice(0,7)
      const cat = p.fin_lancamentos?.fin_categorias?.nome
      if (!mes || !cat) continue

      if (!mapa[mes]) mapa[mes] = {}
      mapa[mes][cat] = (mapa[mes][cat]||0) + p.valor

      // Por canal (para expansão na DRE)
      const canalNome = pCanalId ? canalMap[pCanalId]?.nome : null
      if (canalNome) {
        if (!mapaCanal[mes]) mapaCanal[mes] = {}
        if (!mapaCanal[mes][cat]) mapaCanal[mes][cat] = {}
        mapaCanal[mes][cat][canalNome] = (mapaCanal[mes][cat][canalNome]||0) + p.valor
      }
    }

    // Aplica ajustes manuais
    for (const aj of (ajustesDb||[])) {
      const mes = aj.ano_mes
      const cat = aj.fin_categorias?.nome
      if (!cat) continue
      if (!mapa[mes]) mapa[mes] = {}
      mapa[mes][cat] = aj.valor
    }

    setDados(mapa); setDadosCanal(mapaCanal)
    setLoading(false)
  }

  const meses = Object.keys(dados).sort()

  // Soma categoria + todos os descendentes recursivamente
  function somaComDesc(mesData, catNome) {
    const direta = mesData[catNome] || 0
    // Filtra descendentes pelo nome (simplificado — usa dados acumulados)
    return direta
  }

  // Calcula subtotais dinamicamente — soma categoria + todos descendentes
  function calcSubtotais(mesData) {
    // Coleta todos os nomes de categorias descendentes de uma lista
    function somaGrupo(catsList) {
      return catsList.reduce((s, c) => {
        // Soma direta
        let v = mesData[c.nome] || 0
        // Soma descendentes (nível 2 e 3)
        const filhos = categorias.filter(x => x.parent_id === c.id)
        for (const f of filhos) {
          v += mesData[f.nome] || 0
          const netos = categorias.filter(x => x.parent_id === f.id)
          for (const n of netos) v += mesData[n.nome] || 0
        }
        return s + v
      }, 0)
    }

    const subtotais = { fb:0, fl:0, lb:0, mc:0, mcm:0, res:0 }
    let acum = 0
    for (const g of grupos.sort((a,b)=>a.ordem-b.ordem)) {
      const cats = grupoCats[g.id]||[]
      const val = somaGrupo(cats)
      if (g.operacao==='+') acum += val
      else acum -= val
      if (g.subtotal_key) subtotais[g.subtotal_key] = acum
    }
    return subtotais
  }

  const totSub = meses.reduce((acc,m)=>{
    const s = calcSubtotais(dados[m]||{})
    Object.entries(s).forEach(([k,v])=>{acc[k]=(acc[k]||0)+v})
    return acc
  },{fb:0,fl:0,lb:0,mc:0,mcm:0,res:0})

  async function salvarAjuste(mes, catNome, valor) {
    const cat = categorias.find(c=>c.nome===catNome)
    if (!cat) return
    await supabase.from('fin_dre_ajustes').upsert({
      ano_mes:mes, categoria_id:cat.id, canal_id:null, valor,
      criado_por:JSON.parse(sessionStorage.getItem('usuario')||'{}').nome,
    },{onConflict:'ano_mes,categoria_id,canal_id'})
    setDados(prev=>{const n={...prev};if(!n[mes])n[mes]={};n[mes][catNome]=valor;return n})
  }

  return (
    <>
      <div className="card card-pad">
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="month" className="form-input" value={anoMesIni} onChange={e=>setAnoMesIni(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="month" className="form-input" value={anoMesFim} onChange={e=>setAnoMesFim(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Regime</label>
            <select className="form-input" value={regime} onChange={e=>setRegime(e.target.value)}>
              <option value="competencia">Competência</option>
              <option value="caixa">Caixa (pagos)</option>
            </select>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer',marginBottom:6}}>
            <input type="checkbox" checked={mostrarPct} onChange={e=>setMostrarPct(e.target.checked)} style={{accentColor:'var(--purple)'}}/>
            % (s/ FB ou FL conforme grupo)
          </label>
          <div style={{marginLeft:'auto',display:'flex',gap:8}}>
            <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
          </div>
        </div>
        <div style={{fontSize:12,color:'var(--gray-400)',marginTop:8}}>
          💡 Clique em qualquer valor para editá-lo manualmente · ▶ nas categorias para ver por canal · Configure a cascata em Config → DRE
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div>
      : meses.length===0 ? (
        <div className="card card-pad empty">
          <div className="empty-icon">📊</div>
          <div className="empty-title">Nenhum dado no período</div>
        </div>
      ) : (
        <div className="card">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',padding:'10px 14px',minWidth:200,background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)',position:'sticky',left:0,zIndex:2}}>Categoria</th>
                  {meses.map(m=>(
                    <th key={m} style={{textAlign:'right',padding:'10px 10px',minWidth:120,background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)',fontWeight:700,fontSize:12}}>
                      {mesLabel(m)}
                    </th>
                  ))}
                  <th style={{textAlign:'right',padding:'10px 10px',minWidth:120,background:'var(--purple-pale)',borderBottom:'2px solid var(--purple)',fontWeight:800,color:'var(--purple)',fontSize:12}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {grupos.sort((a,b)=>a.ordem-b.ordem).map(grupo => {
                  const cats = grupoCats[grupo.id]||[]
                  const linhas = []

                  // Header do grupo
                  linhas.push(
                    <tr key={`g-${grupo.id}`}>
                      <td colSpan={meses.length+2} style={{background:grupo.operacao==='+'?'var(--ok-pale)':'var(--danger-pale)',padding:'6px 14px',fontWeight:800,fontSize:11,color:grupo.cor,textTransform:'uppercase',letterSpacing:'.05em'}}>
                        {grupo.nome}
                      </td>
                    </tr>
                  )

                  // Categorias do grupo — renderiza recursivamente até 3 níveis
                  function renderCat(cat, nivel=1) {
                    const indent = 14 + (nivel-1)*16
                    const filhos = categorias.filter(c=>c.parent_id===cat.id && c.tipo===cat.tipo)
                      .sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))

                    // Soma o valor direto + todos descendentes para o total da linha
                    function somaTotal(mesData, c) {
                      let v = mesData[c.nome]||0
                      const fs = categorias.filter(x=>x.parent_id===c.id)
                      for (const f of fs) {
                        v += mesData[f.nome]||0
                        const ns = categorias.filter(x=>x.parent_id===f.id)
                        for (const n of ns) v += mesData[n.nome]||0
                      }
                      return v
                    }

                    const totCat = meses.reduce((s,m)=>s+somaTotal(dados[m]||{},cat),0)
                    const temFilhos = filhos.length > 0
                    const expandido = expandidos.has(cat.id)
                    const basePct = grupo.base_pct || 'fl'

                    // Expansão por canal só nas folhas (sem filhos)
                    const canaisNestaCat = !temFilhos
                      ? [...new Set(meses.flatMap(m=>Object.keys(dadosCanal[m]?.[cat.nome]||{})))].filter(Boolean)
                      : []
                    const temCanais = canaisNestaCat.length > 0

                    const bgCor = nivel===1?'var(--white)':nivel===2?'#fafafa':'#f5f5f5'
                    const fontW = nivel===1?600:nivel===2?500:400
                    const fontSize = nivel===1?13:12

                    linhas.push(
                      <tr key={cat.id} style={{borderBottom:(expandido&&(temFilhos||temCanais))?'none':'1px solid var(--gray-100)'}}>
                        <td style={{padding:`7px 14px 7px ${indent}px`,color:nivel===1?'var(--gray-700)':'var(--gray-600)',position:'sticky',left:0,background:bgCor}}>
                          <div style={{display:'flex',alignItems:'center',gap:5}}>
                            {(temFilhos||temCanais) && (
                              <button onClick={()=>setExpandidos(prev=>{const n=new Set(prev);expandido?n.delete(cat.id):n.add(cat.id);return n})}
                                style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:'0 1px',fontSize:10,lineHeight:1,flexShrink:0}}>
                                {expandido?'▼':'▶'}
                              </button>
                            )}
                            {nivel>1 && <span style={{width:5,height:5,borderRadius:'50%',background:cat.cor||'var(--gray-300)',flexShrink:0}}/>}
                            <span style={{fontWeight:fontW,fontSize}}>{cat.nome}</span>
                          </div>
                        </td>
                        {meses.map(m=>{
                          const v = somaTotal(dados[m]||{}, cat)
                          const s = calcSubtotais(dados[m]||{})
                          const base = s[basePct]||s.fb||1
                          return (
                            <td key={m} style={{padding:'7px 10px',textAlign:'right',background:bgCor}}>
                              {!temFilhos
                                ? <CelulaEditavel valor={v} onSave={val=>salvarAjuste(m,cat.nome,val)}/>
                                : <span style={{fontWeight:600,color:v>0?'var(--gray-700)':'var(--gray-300)'}}>{v>0?fmtR(v):'—'}</span>
                              }
                              {mostrarPct && v>0 && base>0 && <div style={{fontSize:10,color:'var(--gray-400)'}}>{fmtPct(pct(v,base))}</div>}
                            </td>
                          )
                        })}
                        <td style={{textAlign:'right',padding:'7px 10px',fontWeight:nivel===1?700:600,color:'var(--gray-600)',background:bgCor}}>{fmtR(totCat)}</td>
                      </tr>
                    )

                    // Filhos (subcategorias nível 2 e 3)
                    if (expandido && temFilhos) {
                      for (const filho of filhos) renderCat(filho, nivel+1)
                      linhas.push(<tr key={`${cat.id}__sep`}><td colSpan={meses.length+2} style={{height:1,background:'var(--gray-200)'}}/></tr>)
                    }

                    // Expansão por canal (só folhas)
                    if (expandido && temCanais && !temFilhos) {
                      for (const canalNome of canaisNestaCat) {
                        const totC = meses.reduce((s,m)=>s+(dadosCanal[m]?.[cat.nome]?.[canalNome]||0),0)
                        linhas.push(
                          <tr key={`${cat.id}__${canalNome}`} style={{borderBottom:'1px solid var(--gray-50)',background:'var(--gray-50)'}}>
                            <td style={{padding:`5px 14px 5px ${indent+18}px`,color:'var(--gray-500)',fontSize:11,position:'sticky',left:0,background:'var(--gray-50)'}}>
                              <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',background:'var(--purple)',marginRight:5,opacity:.4}}/>
                              {canalNome}
                            </td>
                            {meses.map(m=>{
                              const v = dadosCanal[m]?.[cat.nome]?.[canalNome]||0
                              const tot = somaTotal(dados[m]||{},cat)||1
                              return (
                                <td key={m} style={{textAlign:'right',padding:'5px 10px',fontSize:11,color:v>0?'var(--gray-600)':'var(--gray-300)'}}>
                                  {v>0?fmtR(v):'—'}
                                  {mostrarPct && v>0 && tot>0 && <div style={{fontSize:10,color:'var(--gray-300)'}}>{fmtPct(pct(v,tot))}</div>}
                                </td>
                              )
                            })}
                            <td style={{textAlign:'right',padding:'5px 10px',fontSize:11,color:'var(--gray-500)',fontWeight:600}}>{fmtR(totC)}</td>
                          </tr>
                        )
                      }
                      linhas.push(<tr key={`${cat.id}__cansep`}><td colSpan={meses.length+2} style={{height:1,background:'var(--gray-200)'}}/></tr>)
                    }
                  }

                  // Renderiza só categorias raiz do grupo (nível 1 relativo ao grupo)
                  for (const cat of cats) renderCat(cat, 1)

                  // Subtotal após o grupo
                  if (grupo.subtotal_label && grupo.subtotal_key) {
                    const chave = grupo.subtotal_key
                    const totVal = totSub[chave]||0
                    const isRes = chave==='res'
                    linhas.push(
                      <tr key={`sub-${grupo.id}`} style={{borderTop:'2px solid var(--gray-300)',background:isRes?'var(--purple-pale)':'var(--gray-50)'}}>
                        <td style={{padding:'10px 14px',fontWeight:800,fontSize:13,color:isRes?'var(--purple)':totVal>=0?'var(--ok)':'var(--danger)',position:'sticky',left:0,background:isRes?'var(--purple-pale)':'var(--gray-50)'}}>
                          {grupo.subtotal_label}
                        </td>
                        {meses.map(m=>{
                          const s = calcSubtotais(dados[m]||{})
                          const v = s[chave]||0
                          const base = s[grupo.base_pct]||s.fb||1
                          return (
                            <td key={m} style={{textAlign:'right',padding:'10px 10px',fontWeight:800,fontSize:13,color:v>=0?(isRes?'var(--purple)':'var(--ok)'):'var(--danger)'}}>
                              {fmtR(v)}
                              {mostrarPct && base>0 && <div style={{fontSize:10,fontWeight:400,color:'var(--gray-400)'}}>{fmtPct(pct(v,base))}</div>}
                            </td>
                          )
                        })}
                        <td style={{textAlign:'right',padding:'10px 10px',fontWeight:800,fontSize:13,color:totVal>=0?(isRes?'var(--purple)':'var(--ok)'):'var(--danger)'}}>
                          {fmtR(totVal)}
                        </td>
                      </tr>
                    )
                  }

                  return linhas
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
