import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, Edit3, Check, X } from 'lucide-react'

function pct(v,base) { return base>0?(v/base)*100:0 }
function fmtPct(v) { return v.toFixed(1)+'%' }

function CelulaEditavel({ valor, onSave }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef()

  function iniciar() {
    setDraft(valor > 0 ? valor.toFixed(2) : '')
    setEditando(true)
    setTimeout(() => inputRef.current?.select(), 50)
  }
  function salvar() { onSave(parseFloat(draft.replace(',','.')) || 0); setEditando(false) }

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
    <div onClick={iniciar} style={{cursor:'pointer',display:'flex',alignItems:'center',gap:4,justifyContent:'flex-end'}} title="Clique para editar">
      <span style={{color:valor>0?'var(--gray-800)':'var(--gray-300)',fontWeight:valor>0?600:400}}>
        {valor>0?fmtR(valor):'—'}
      </span>
      {valor===0 && <Edit3 size={10} style={{opacity:.3}}/>}
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
  const [categorias, setCategorias] = useState([])
  const [grupos, setGrupos] = useState([])
  const [grupoCats, setGrupoCats] = useState({})
  const [ajustesMap, setAjustesMap] = useState({}) // { mes__grupoId: valor }
  const [dadosLanc, setDadosLanc] = useState({})   // { mes: { catNome: valor } } — de lançamentos reais
  const [expandidos, setExpandidos] = useState(new Set())
  const [loading, setLoading] = useState(true)

  const [configLoaded, setConfigLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('fin_categorias').select('*').eq('ativo',true),
      supabase.from('fin_dre_grupos').select('*').eq('ativo',true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_dre_grupo_cats').select('*, fin_categorias(id,nome)'),
    ]).then(([{data:cats},{data:gs},{data:gcs}]) => {
      setCategorias(cats||[])
      setGrupos(gs||[])
      const gcMap = {}
      for (const gc of (gcs||[])) {
        if (!gcMap[gc.grupo_id]) gcMap[gc.grupo_id] = []
        gcMap[gc.grupo_id].push({ id:gc.categoria_id, nome:gc.fin_categorias?.nome })
      }
      setGrupoCats(gcMap)
      setConfigLoaded(true)
    })
  }, [])

  useEffect(() => { if(configLoaded) carregar() }, [anoMesIni, anoMesFim, regime, configLoaded])

  async function carregar() {
    setLoading(true)
    const ini = anoMesIni+'-01', fim = anoMesFim+'-31'
    const campoData = regime==='caixa'?'data_pagamento':'data_vencimento'

    const [{data:parcelas},{data:ajustesDb}] = await Promise.all([
      supabase.from('fin_parcelas')
        .select('valor, valor_pago, data_competencia, data_vencimento, data_pagamento, status, fin_lancamentos!inner(tipo, is_transferencia, fin_categorias(nome))')
        .gte(campoData, ini).lte(campoData, fim)
        .in('status',['pago','em_aberto','agendado','vencido','pendente']),
      supabase.from('fin_dre_ajustes')
        .select('*, fin_categorias(nome)')
        .gte('ano_mes', anoMesIni).lte('ano_mes', anoMesFim),
    ])

    // Dados de lançamentos reais agrupados por mês/categoria
    const mapa = {}
    for (const p of (parcelas||[])) {
      const l = p.fin_lancamentos
      if (l?.is_transferencia) continue
      if (p.status !== 'pago' && !(p.valor_pago > 0)) continue // só inclui pagos ou parcialmente pagos
      const mes = (regime==='caixa'?p.data_pagamento:p.data_competencia||p.data_vencimento)?.slice(0,7)
      const cat = l?.fin_categorias?.nome
      if (!mes||!cat) continue
      if (!mapa[mes]) mapa[mes] = {}
      const vlr = (p.valor_pago > 0 && p.status !== 'pago') ? p.valor_pago : p.valor
      mapa[mes][cat] = (mapa[mes][cat]||0) + vlr
    }
    setDadosLanc(mapa)

    // Ajustes manuais: por grupo (sub-linha) ou por categoria (total)
    const ajMap = {}
    for (const aj of (ajustesDb||[])) {
      const mes = aj.ano_mes
      const key = `${mes}__${aj.grupo_id||'cat__'+aj.categoria_id}`
      ajMap[key] = aj.valor
    }
    setAjustesMap(ajMap)
    setLoading(false)
  }

  // Gera meses do período selecionado sempre, independente de ter dados
  const meses = (() => {
    const result = []
    const [anoIni, mesIni] = anoMesIni.split('-').map(Number)
    const [anoFim, mesFim] = anoMesFim.split('-').map(Number)
    let ano = anoIni, mes = mesIni
    while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
      result.push(`${ano}-${String(mes).padStart(2,'0')}`)
      mes++; if (mes > 12) { mes = 1; ano++ }
    }
    return result
  })()

  // Soma categoria + todos os descendentes dos lançamentos
  function somaCategoria(mes, catId) {
    const cat = categorias.find(c=>c.id===catId)
    if (!cat) return 0
    let v = dadosLanc[mes]?.[cat.nome] || 0
    categorias.filter(c=>c.parent_id===catId).forEach(f => {
      v += dadosLanc[mes]?.[f.nome] || 0
      categorias.filter(c=>c.parent_id===f.id).forEach(n => {
        v += dadosLanc[mes]?.[n.nome] || 0
      })
    })
    return v
  }

  // Valor de uma linha: ajuste manual se existir, senão soma de lançamentos
  function valorLinha(mes, grupoId, catNomes=[]) {
    const ajGrupo = ajustesMap[`${mes}__${grupoId}`]
    if (ajGrupo !== undefined) return ajGrupo
    // Soma via categorias vinculadas (inclui subcategorias)
    const cats = grupoCats[grupoId]||[]
    return cats.reduce((s,c) => s + somaCategoria(mes, c.id), 0)
  }

  // Total de um grupo = soma dos filhos se tiver, senão valor direto
  function totalGrupo(mes, grupo) {
    const filhos = grupos.filter(g=>g.parent_id===grupo.id)
    if (filhos.length > 0) {
      return filhos.reduce((s,f)=>s+totalGrupo(mes,f), 0)
    }
    return valorLinha(mes, grupo.id)
  }

  // Calcula subtotais
  function calcSubtotais(mes) {
    const st = {fb:0,fl:0,lb:0,mc:0,mcm:0,res:0,lair:0,ll:0}
    let acum = 0
    for (const g of grupos.filter(x=>!x.parent_id).sort((a,b)=>a.ordem-b.ordem)) {
      const val = totalGrupo(mes, g)
      if (g.operacao==='+') acum += val
      else acum -= val
      if (g.subtotal_key) st[g.subtotal_key] = acum
    }
    return st
  }

  const totSub = meses.reduce((acc,m)=>{
    const s=calcSubtotais(m)
    Object.entries(s).forEach(([k,v])=>{acc[k]=(acc[k]||0)+v})
    return acc
  },{fb:0,fl:0,lb:0,mc:0,mcm:0,res:0,lair:0,ll:0})

  async function salvarAjuste(mes, grupoId, valor) {
    const usuario = JSON.parse(sessionStorage.getItem('usuario')||'{}').nome
    await supabase.from('fin_dre_ajustes').upsert(
      { ano_mes:mes, grupo_id:grupoId, categoria_id:null, canal_id:null, valor, criado_por:usuario },
      { onConflict:'ano_mes,categoria_id,grupo_id,canal_id' }
    )
    const key = `${mes}__${grupoId}`
    setAjustesMap(prev=>({...prev,[key]:valor}))
  }

  // Expande todos os grupos quando carregados
  useEffect(() => {
    if (grupos.length > 0) {
      setExpandidos(new Set(grupos.map(g=>g.id)))
    }
  }, [grupos])

  function toggleExp(id) {
    setExpandidos(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
  }

  // Renderiza grupo e filhos recursivamente — sempre mostra todos, mesmo com zero
  function renderGrupo(grupo, nivel=1) {
    const filhos = grupos.filter(g=>g.parent_id===grupo.id).sort((a,b)=>a.ordem-b.ordem||a.nome.localeCompare(b.nome))
    const temFilhos = filhos.length > 0
    // Por padrão grupos raiz e nível 2 começam expandidos
    const expandido = expandidos.size === 0 ? true : expandidos.has(grupo.id)
    const indent = 14 + (nivel-1)*18
    const bg = nivel===1?'var(--white)':nivel===2?'#fafafa':'#f5f5f5'
    const fw = nivel===1?600:nivel===2?500:400
    const fs = nivel===1?13:nivel===2?12:11

    const linhas = []

    linhas.push(
      <tr key={grupo.id} style={{borderBottom:(expandido&&temFilhos)?'none':'1px solid var(--gray-100)'}}>
        <td style={{padding:`7px ${indent}px 7px ${indent}px`,position:'sticky',left:0,background:bg}}>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            {temFilhos
              ? <button onClick={()=>toggleExp(grupo.id)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:'0 1px',fontSize:11,lineHeight:1,flexShrink:0}}>
                  {expandido?'▼':'▶'}
                </button>
              : <span style={{width:14,flexShrink:0}}/>
            }
            <span style={{width:8,height:8,borderRadius:2,background:grupo.cor||'var(--gray-400)',flexShrink:0}}/>
            <span style={{fontWeight:fw,fontSize:fs,color:nivel===1?'var(--gray-700)':'var(--gray-600)'}}>{grupo.nome}</span>
          </div>
        </td>
        {meses.map(m => {
          const v = totalGrupo(m, grupo)
          const s = calcSubtotais(m)
          const basePct = (grupo.base_pct||'fl')
          const base = s[basePct]||s.fb||1
          return (
            <td key={m} style={{padding:'7px 10px',textAlign:'right',background:bg}}>
              {!temFilhos
                ? <CelulaEditavel valor={v} onSave={val=>salvarAjuste(m, grupo.id, val)}/>
                : <span style={{fontWeight:600,color:v!==0?'var(--gray-700)':'var(--gray-300)',fontSize:fs}}>
                    {fmtR(v)}
                  </span>
              }
              {mostrarPct && base>0 && <div style={{fontSize:10,color:'var(--gray-400)'}}>{fmtPct(pct(v,base))}</div>}
            </td>
          )
        })}
        <td style={{textAlign:'right',padding:'7px 10px',fontWeight:nivel===1?700:600,fontSize:fs,color:'var(--gray-600)',background:bg}}>
          {fmtR(meses.reduce((s,m)=>s+totalGrupo(m,grupo),0))}
        </td>
      </tr>
    )

    if (expandido && temFilhos) {
      for (const f of filhos) linhas.push(...renderGrupo(f, nivel+1))
      linhas.push(<tr key={`${grupo.id}__sep`}><td colSpan={meses.length+2} style={{height:1,background:'var(--gray-200)'}}/></tr>)
    }

    return linhas
  }

  const gruposRaiz = grupos.filter(g=>!g.parent_id).sort((a,b)=>a.ordem-b.ordem)

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
          <button className="btn btn-ghost" onClick={carregar} style={{marginBottom:6}}><RefreshCw size={14}/></button>
        </div>
        <div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>
          💡 Clique em qualquer valor para editá-lo manualmente · ▶ expande sub-linhas · Configure a estrutura em Config → Cascata DRE
        </div>
      </div>

      {loading && <div className="loading"><RefreshCw size={14} className="spin"/></div>}

      {gruposRaiz.length === 0 && (
        <div className="card card-pad empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhuma cascata configurada</div>
          <div className="empty-sub">Vá em Config → Cascata DRE para montar a estrutura</div>
        </div>
      )}

      {(gruposRaiz.length > 0) && (
        <div className="card">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',padding:'10px 14px',minWidth:220,background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)',position:'sticky',left:0,zIndex:2}}>
                    Categoria / Linha
                  </th>
                  {meses.map(m=>(
                    <th key={m} style={{textAlign:'right',padding:'10px 10px',minWidth:120,background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)',fontWeight:700,fontSize:12}}>
                      {mesLabel(m)}
                    </th>
                  ))}
                  <th style={{textAlign:'right',padding:'10px 10px',minWidth:120,background:'var(--purple-pale)',borderBottom:'2px solid var(--purple)',fontWeight:800,color:'var(--purple)',fontSize:12}}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {gruposRaiz.map(grupo => {
                  const linhas = []
                  // Header do grupo principal
                  linhas.push(
                    <tr key={`header-${grupo.id}`}>
                      <td colSpan={meses.length+2} style={{
                        background:grupo.operacao==='+'?'var(--ok-pale)':'var(--danger-pale)',
                        padding:'6px 14px',fontWeight:800,fontSize:11,
                        color:grupo.cor||'var(--gray-700)',textTransform:'uppercase',letterSpacing:'.05em'
                      }}>
                        {grupo.nome}
                      </td>
                    </tr>
                  )
                  // Sub-grupos e linhas
                  const filhos = grupos.filter(g=>g.parent_id===grupo.id).sort((a,b)=>a.ordem-b.ordem||a.nome.localeCompare(b.nome))
                  if (filhos.length > 0) {
                    for (const f of filhos) linhas.push(...renderGrupo(f, 1))
                  } else {
                    // Grupo sem filhos = linha editável diretamente
                    linhas.push(...renderGrupo(grupo, 1).slice(1)) // pula o header que já renderizamos
                  }

                  // Subtotal
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
                          const s=calcSubtotais(m)
                          const v=s[chave]||0
                          const base=s[grupo.base_pct]||s.fb||1
                          return (
                            <td key={m} style={{textAlign:'right',padding:'10px 10px',fontWeight:800,fontSize:13,color:v>=0?(isRes?'var(--purple)':'var(--ok)'):'var(--danger)'}}>
                              {fmtR(v)}
                              {mostrarPct&&base>0&&<div style={{fontSize:10,fontWeight:400,color:'var(--gray-400)'}}>{fmtPct(pct(v,base))}</div>}
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
