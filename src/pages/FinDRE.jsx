import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, FileText, Edit3, Check, X } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const GRUPOS = [
  { key:'receita', label:'FATURAMENTO BRUTO',        tipo:'receita', cats:['Vendas Shopify','Vendas Delivery','Vendas B2B','Laricas Club','Outras Receitas'], subtotal:'Faturamento Bruto',        cor:'ok' },
  { key:'deducoes',label:'(-) DEDUÇÕES',             tipo:'despesa', cats:['Deduções/Descontos'],                                                             subtotal:'Faturamento Líquido',       cor:'danger' },
  { key:'impostos',label:'(-) IMPOSTOS (DAS)',       tipo:'despesa', cats:['Impostos'],                                                                       subtotal:null,                        cor:'danger' },
  { key:'cmv',     label:'(-) CMV',                  tipo:'despesa', cats:['CMV - ECOM','CMV - Delivery','CMV - B2B','CMV - Outros'],                         subtotal:'Lucro Bruto',               cor:'danger' },
  { key:'dvc',     label:'(-) DESP. VAR. COMERCIAIS',tipo:'despesa', cats:['Taxas/Comissões','Logística/Entrega','Comissões Comerciais'],                     subtotal:'Margem de Contribuição',    cor:'danger' },
  { key:'dvm',     label:'(-) DESP. VAR. MARKETING', tipo:'despesa', cats:['Marketing Digital','Marketing Offline'],                                          subtotal:'MC com Marketing (MCM)',    cor:'danger' },
  { key:'fixas',   label:'(-) DESPESAS FIXAS',       tipo:'despesa', cats:['Aluguel','Pessoal/RH','Sistemas/Ferramentas','Contador/Jurídico','Outras Despesas Fixas'], subtotal:'Resultado Operacional', cor:'danger' },
]

const SUB_KEYS = {
  'Faturamento Bruto':'fb', 'Faturamento Líquido':'fl', 'Lucro Bruto':'lb',
  'Margem de Contribuição':'mc', 'MC com Marketing (MCM)':'mcm', 'Resultado Operacional':'res',
}
function pct(v,base) { return base>0?(v/base)*100:0 }
function fmtPct(v) { return v.toFixed(1)+'%' }

function calcSubtotais(catMap) {
  const soma = keys => keys.reduce((s,k)=>s+(catMap[k]||0),0)
  const fb  = soma(GRUPOS[0].cats)
  const ded = soma(GRUPOS[1].cats)
  const imp = soma(GRUPOS[2].cats)
  const fl  = fb-ded-imp
  const cmv = soma(GRUPOS[3].cats)
  const lb  = fl-cmv
  const dvc = soma(GRUPOS[4].cats)
  const mc  = lb-dvc
  const dvm = soma(GRUPOS[5].cats)
  const mcm = mc-dvm
  const fix = soma(GRUPOS[6].cats)
  const res = mcm-fix
  return {fb,ded,imp,fl,cmv,lb,dvc,mc,dvm,mcm,fix,res}
}

// Célula editável inline
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
    const n = parseFloat(draft.replace(',','.')) || 0
    onSave(n)
    setEditando(false)
  }

  if (editando) return (
    <div style={{ display:'flex', gap:3, alignItems:'center' }}>
      <input ref={inputRef} type="number" step={0.01}
        value={draft} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{ if(e.key==='Enter') salvar(); if(e.key==='Escape') setEditando(false) }}
        style={{ width:90, padding:'3px 6px', fontSize:12, border:'2px solid var(--purple)', borderRadius:5, outline:'none' }}/>
      <button onClick={salvar} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ok)', padding:2 }}><Check size={13}/></button>
      <button onClick={()=>setEditando(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)', padding:2 }}><X size={13}/></button>
    </div>
  )

  return (
    <div onClick={iniciar} style={{ cursor:disabled?'default':'pointer', display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}
      title={disabled?'':'Clique para editar'}>
      <span style={{ color:valor>0?'var(--gray-800)':'var(--gray-300)', fontWeight:valor>0?600:400 }}>
        {valor>0 ? fmtR(valor) : '—'}
      </span>
      {!disabled && valor===0 && <Edit3 size={10} style={{ opacity:.3 }}/>}
    </div>
  )
}

export default function FinDRE() {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const [anoMesIni, setAnoMesIni] = useState(`${anoAtual}-01`)
  const [anoMesFim, setAnoMesFim] = useState(`${anoAtual}-${String(hoje.getMonth()+1).padStart(2,'0')}`)
  const [canalId, setCanalId] = useState('')
  const [regime, setRegime] = useState('competencia') // competencia | caixa
  const [mostrarPct, setMostrarPct] = useState(true)
  const [canais, setCanais] = useState([])
  const [categorias, setCategorias] = useState([])
  const [dados, setDados] = useState({})      // { mes: { cat: valor } }
  const [ajustes, setAjustes] = useState({})  // { mes_catNome: valor }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('fin_canais').select('*').eq('ativo',true).order('ordem'),
      supabase.from('fin_categorias').select('*').eq('ativo',true).order('nivel').order('ordem'),
    ]).then(([{data:c},{data:cats}]) => { setCanais(c||[]); setCategorias(cats||[]) })
  }, [])

  useEffect(() => { carregar() }, [anoMesIni, anoMesFim, canalId, regime])

  async function carregar() {
    setLoading(true)
    const ini = anoMesIni+'-01', fim = anoMesFim+'-31'
    const campoData = regime === 'caixa' ? 'data_pagamento' : 'data_vencimento'

    const [{ data: parcelas }, { data: ajustesDb }] = await Promise.all([
      supabase.from('fin_parcelas')
        .select(`valor, data_competencia, data_vencimento, data_pagamento, status,
                 fin_lancamentos(tipo, canal_id, fin_categorias(nome,tipo))`)
        .gte(campoData, ini).lte(campoData, fim)
        .eq('status', regime === 'caixa' ? 'pago' : 'pago'), // ambos usam pago por ora
      supabase.from('fin_dre_ajustes')
        .select('*, fin_categorias(nome)')
        .gte('ano_mes', anoMesIni).lte('ano_mes', anoMesFim),
    ])

    const mapa = {}
    for (const p of (parcelas||[])) {
      if (!canalId || p.fin_lancamentos?.canal_id === canalId) {
        const mes = (regime==='caixa' ? p.data_pagamento : p.data_competencia || p.data_vencimento)?.slice(0,7)
        const cat = p.fin_lancamentos?.fin_categorias?.nome
        if (!mes || !cat) continue
        if (!mapa[mes]) mapa[mes] = {}
        mapa[mes][cat] = (mapa[mes][cat]||0) + p.valor
      }
    }

    // Aplica ajustes manuais
    const ajMap = {}
    for (const aj of (ajustesDb||[])) {
      const key = `${aj.ano_mes}__${aj.fin_categorias?.nome}`
      ajMap[key] = aj.valor
      // Substitui no mapa principal
      if (!mapa[aj.ano_mes]) mapa[aj.ano_mes] = {}
      if (aj.fin_categorias?.nome) mapa[aj.ano_mes][aj.fin_categorias.nome] = aj.valor
    }

    setDados(mapa)
    setAjustes(ajMap)
    setLoading(false)
  }

  const meses = Object.keys(dados).sort()

  async function salvarAjuste(mes, catNome, valor) {
    const cat = categorias.find(c=>c.nome===catNome)
    if (!cat) return
    await supabase.from('fin_dre_ajustes').upsert({
      ano_mes: mes, categoria_id: cat.id,
      canal_id: canalId || null, valor,
      criado_por: JSON.parse(sessionStorage.getItem('usuario')||'{}').nome,
    }, { onConflict: 'ano_mes,categoria_id,canal_id' })
    // Atualiza local
    setDados(prev => {
      const n = { ...prev }
      if (!n[mes]) n[mes] = {}
      n[mes][catNome] = valor
      return n
    })
  }

  // Totais acumulados
  const totSub = meses.reduce((acc,m) => {
    const s = calcSubtotais(dados[m]||{})
    Object.entries(s).forEach(([k,v]) => { acc[k]=(acc[k]||0)+v })
    return acc
  }, {})

  function exportarPDF() {
    const doc = new jsPDF('l','mm','a4')
    doc.setFillColor(82,46,100); doc.rect(0,0,297,28,'F')
    doc.setTextColor(234,183,130); doc.setFontSize(14); doc.setFont(undefined,'bold')
    doc.text('Laricas Fitness — DRE Gerencial', 14, 14)
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(255,255,255)
    const cNome = canalId ? canais.find(c=>c.id===canalId)?.nome : 'Todos os canais'
    doc.text(`${mesLabel(anoMesIni+'-01')} → ${mesLabel(anoMesFim+'-01')} · ${cNome} · Regime: ${regime}`, 14, 22)
    const colHead = ['', ...meses.map(m=>mesLabel(m+'-01')), 'TOTAL']
    const body = []
    for (const grupo of GRUPOS) {
      body.push([{ content:grupo.label, colSpan:colHead.length, styles:{fillColor:grupo.tipo==='receita'?[200,240,210]:[255,220,220],fontStyle:'bold',fontSize:8} }])
      for (const cat of grupo.cats) {
        const hasDados = meses.some(m=>(dados[m]?.[cat]||0)>0)
        if (!hasDados) continue
        const tot = meses.reduce((s,m)=>s+(dados[m]?.[cat]||0),0)
        body.push([{ content:`  ${cat}`, styles:{halign:'left'} }, ...meses.map(m=>fmtR(dados[m]?.[cat]||0)), { content:fmtR(tot), styles:{fontStyle:'bold'} }])
      }
      if (grupo.subtotal) {
        const chave = SUB_KEYS[grupo.subtotal]
        if (chave) body.push([
          { content:grupo.subtotal, styles:{fontStyle:'bold',fillColor:[245,245,255]} },
          ...meses.map(m=>({ content:fmtR(calcSubtotais(dados[m]||{})[chave]||0), styles:{fontStyle:'bold',fillColor:[245,245,255]} })),
          { content:fmtR(totSub[chave]||0), styles:{fontStyle:'bold',fillColor:[240,240,255]} }
        ])
      }
    }
    autoTable(doc, { startY:34, head:[colHead], body, styles:{fontSize:7.5,cellPadding:2.5,halign:'right'}, headStyles:{fillColor:[103,63,124],textColor:255,fontStyle:'bold',halign:'center',fontSize:8}, columnStyles:{0:{halign:'left',cellWidth:52}}, margin:{left:8,right:8} })
    doc.save(`DRE_${anoMesIni}_${anoMesFim}_${regime}.pdf`)
  }

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad">
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="month" className="form-input" value={anoMesIni} onChange={e=>setAnoMesIni(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="month" className="form-input" value={anoMesFim} onChange={e=>setAnoMesFim(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Canal</label>
            <select className="form-input" value={canalId} onChange={e=>setCanalId(e.target.value)}>
              <option value="">Todos os canais</option>
              {canais.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Regime</label>
            <select className="form-input" value={regime} onChange={e=>setRegime(e.target.value)}>
              <option value="competencia">Competência</option>
              <option value="caixa">Caixa (pagos)</option>
            </select>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer', marginBottom:6 }}>
            <input type="checkbox" checked={mostrarPct} onChange={e=>setMostrarPct(e.target.checked)} style={{accentColor:'var(--purple)'}} />
            % s/ Fat. Bruto
          </label>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
            <button className="btn btn-outline" onClick={exportarPDF} disabled={loading||!meses.length}>
              <FileText size={14}/> PDF
            </button>
          </div>
        </div>
        <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:8 }}>
          💡 Clique em qualquer valor na tabela para editá-lo manualmente. Ajustes são salvos por mês e sobrescrevem o valor calculado.
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div>
      : meses.length===0 ? (
        <div className="card card-pad empty">
          <div className="empty-icon">📊</div>
          <div className="empty-title">Nenhum dado no período</div>
          <div className="empty-sub">Lançamentos com status "Pago" aparecem aqui</div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', padding:'10px 14px', minWidth:200, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)', position:'sticky', left:0, zIndex:2 }}>
                    Categoria
                  </th>
                  {meses.map(m=>(
                    <th key={m} style={{ textAlign:'right', padding:'10px 10px', minWidth:120, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)', fontWeight:700, fontSize:12 }}>
                      {mesLabel(m+'-01')}
                    </th>
                  ))}
                  <th style={{ textAlign:'right', padding:'10px 10px', minWidth:120, background:'var(--purple-pale)', borderBottom:'2px solid var(--purple)', fontWeight:800, color:'var(--purple)', fontSize:12 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {GRUPOS.map((grupo,gi) => {
                  const linhas = []
                  // Header grupo
                  linhas.push(
                    <tr key={`g-${gi}`}>
                      <td colSpan={meses.length+2} style={{ background:grupo.tipo==='receita'?'var(--ok-pale)':'var(--danger-pale)', padding:'6px 14px', fontWeight:800, fontSize:11, color:grupo.tipo==='receita'?'var(--ok)':'var(--danger)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                        {grupo.label}
                      </td>
                    </tr>
                  )
                  // Categorias
                  for (const cat of grupo.cats) {
                    const totCat = meses.reduce((s,m)=>s+(dados[m]?.[cat]||0),0)
                    linhas.push(
                      <tr key={cat} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                        <td style={{ padding:'7px 14px 7px 24px', color:'var(--gray-700)', position:'sticky', left:0, background:'var(--white)' }}>{cat}</td>
                        {meses.map(m => {
                          const v = dados[m]?.[cat] || 0
                          const fb = calcSubtotais(dados[m]||{}).fb
                          return (
                            <td key={m} style={{ padding:'7px 10px', textAlign:'right' }}>
                              <CelulaEditavel
                                valor={v}
                                onSave={novoVal => salvarAjuste(m, cat, novoVal)}
                              />
                              {mostrarPct && v>0 && fb>0 && (
                                <div style={{ fontSize:10, color:'var(--gray-400)' }}>{fmtPct(pct(v,fb))}</div>
                              )}
                            </td>
                          )
                        })}
                        <td style={{ textAlign:'right', padding:'7px 10px', fontWeight:700, color:'var(--gray-600)' }}>{fmtR(totCat)}</td>
                      </tr>
                    )
                  }
                  // Subtotal
                  if (grupo.subtotal) {
                    const chave = SUB_KEYS[grupo.subtotal]
                    const totVal = totSub[chave]||0
                    linhas.push(
                      <tr key={`sub-${gi}`} style={{ borderTop:`2px solid ${grupo.subtotal==='Resultado Operacional'?'var(--purple)':'var(--gray-300)'}`, background:grupo.subtotal==='Resultado Operacional'?'var(--purple-pale)':'var(--gray-50)' }}>
                        <td style={{ padding:'10px 14px', fontWeight:800, fontSize:13, color:grupo.subtotal==='Resultado Operacional'?'var(--purple)':totVal>=0?'var(--ok)':'var(--danger)', position:'sticky', left:0, background:grupo.subtotal==='Resultado Operacional'?'var(--purple-pale)':'var(--gray-50)' }}>
                          {grupo.subtotal}
                        </td>
                        {meses.map(m => {
                          const s = calcSubtotais(dados[m]||{})
                          const v = s[chave]||0
                          const fb = s.fb
                          return (
                            <td key={m} style={{ textAlign:'right', padding:'10px 10px', fontWeight:800, fontSize:13, color:v>=0?(grupo.subtotal==='Resultado Operacional'?'var(--purple)':'var(--ok)'):'var(--danger)' }}>
                              {fmtR(v)}
                              {mostrarPct && fb>0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--gray-400)' }}>{fmtPct(pct(v,fb))}</div>}
                            </td>
                          )
                        })}
                        <td style={{ textAlign:'right', padding:'10px 10px', fontWeight:800, fontSize:13, color:totVal>=0?(grupo.subtotal==='Resultado Operacional'?'var(--purple)':'var(--ok)'):'var(--danger)' }}>
                          {fmtR(totVal)}
                          {mostrarPct && totSub.fb>0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--gray-400)' }}>{fmtPct(pct(totVal,totSub.fb||1))}</div>}
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
