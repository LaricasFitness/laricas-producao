import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, FileText } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Estrutura da DRE Laricas — ordem exata
const GRUPOS = [
  { key: 'receita',    label: 'FATURAMENTO BRUTO',     tipo: 'receita',  cats: ['Vendas Shopify','Vendas Delivery','Vendas B2B','Laricas Club','Outras Receitas'], subtotal: 'Faturamento Bruto', cor: 'ok' },
  { key: 'deducoes',   label: '(-) DEDUÇÕES',          tipo: 'despesa',  cats: ['Deduções/Descontos'], subtotal: 'Faturamento Líquido', cor: 'danger' },
  { key: 'impostos',   label: '(-) IMPOSTOS (DAS)',    tipo: 'despesa',  cats: ['Impostos'], subtotal: null, cor: 'danger' },
  { key: 'cmv',        label: '(-) CMV',               tipo: 'despesa',  cats: ['CMV - ECOM','CMV - Delivery','CMV - B2B','CMV - Outros'], subtotal: 'Lucro Bruto (Margem Bruta)', cor: 'danger' },
  { key: 'dvc',        label: '(-) DESP. VAR. COMERCIAIS', tipo: 'despesa', cats: ['Taxas/Comissões','Logística/Entrega','Comissões Comerciais'], subtotal: 'Margem de Contribuição (MC)', cor: 'danger' },
  { key: 'dvm',        label: '(-) DESP. VAR. MARKETING', tipo: 'despesa', cats: ['Marketing Digital','Marketing Offline'], subtotal: 'MC com Marketing (MCM)', cor: 'danger' },
  { key: 'fixas',      label: '(-) DESPESAS FIXAS',    tipo: 'despesa',  cats: ['Aluguel','Pessoal/RH','Sistemas/Ferramentas','Contador/Jurídico','Outras Despesas Fixas'], subtotal: 'Resultado Operacional', cor: 'danger' },
]

const COR_STATUS = { ok: 'var(--ok)', danger: 'var(--danger)', warning: 'var(--warning)' }

function pct(v, base) { return base > 0 ? (v/base)*100 : 0 }
function fmtPct(v) { return v.toFixed(1) + '%' }

export default function FinDRE() {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const [anoMesIni, setAnoMesIni] = useState(`${anoAtual}-01`)
  const [anoMesFim, setAnoMesFim] = useState(`${anoAtual}-${String(hoje.getMonth()+1).padStart(2,'0')}`)
  const [canalId, setCanalId] = useState('')
  const [canais, setCanais] = useState([])
  const [dados, setDados] = useState({})  // { mes: { cat: valor } }
  const [loading, setLoading] = useState(true)
  const [mostrarPct, setMostrarPct] = useState(false)

  useEffect(() => {
    supabase.from('fin_canais').select('*').eq('ativo', true).order('ordem')
      .then(({ data }) => setCanais(data || []))
  }, [])

  useEffect(() => { carregar() }, [anoMesIni, anoMesFim, canalId])

  async function carregar() {
    setLoading(true)
    const ini = anoMesIni + '-01'
    const fim = anoMesFim + '-31'

    let q = supabase.from('fin_parcelas')
      .select('valor, data_competencia, data_vencimento, status, fin_lancamentos(tipo, canal_id, fin_categorias(nome, tipo, ordem))')
      .gte('data_vencimento', ini)
      .lte('data_vencimento', fim)
      .eq('status', 'pago')

    const { data } = await q
    const parcelas = (data || []).filter(p =>
      !canalId || p.fin_lancamentos?.canal_id === canalId
    )

    // Agrupa por mês e categoria
    const mapa = {}
    for (const p of parcelas) {
      const mes = (p.data_competencia || p.data_vencimento).slice(0, 7)
      const tipo = p.fin_lancamentos?.tipo
      const cat  = p.fin_lancamentos?.fin_categorias?.nome
      if (!cat) continue
      if (!mapa[mes]) mapa[mes] = {}
      mapa[mes][cat] = (mapa[mes][cat] || 0) + p.valor
    }

    setDados(mapa)
    setLoading(false)
  }

  const meses = Object.keys(dados).sort()

  // Calcula subtotais por mês
  function somaGrupo(mes, grupo) {
    return grupo.cats.reduce((s, cat) => s + (dados[mes]?.[cat] || 0), 0)
  }

  function subtotais(mes) {
    const fb   = somaGrupo(mes, GRUPOS[0])
    const ded  = somaGrupo(mes, GRUPOS[1])
    const imp  = somaGrupo(mes, GRUPOS[2])
    const fl   = fb - ded - imp
    const cmv  = somaGrupo(mes, GRUPOS[3])
    const lb   = fl - cmv
    const dvc  = somaGrupo(mes, GRUPOS[4])
    const mc   = lb - dvc
    const dvm  = somaGrupo(mes, GRUPOS[5])
    const mcm  = mc - dvm
    const fix  = somaGrupo(mes, GRUPOS[6])
    const res  = mcm - fix
    return { fb, ded, imp, fl, cmv, lb, dvc, mc, dvm, mcm, fix, res }
  }

  // Totais acumulados
  const totGrupo = (grupo) =>
    grupo.cats.reduce((s, cat) =>
      s + meses.reduce((ss, m) => ss + (dados[m]?.[cat] || 0), 0), 0)

  const totSub = meses.reduce((acc, m) => {
    const s = subtotais(m)
    Object.entries(s).forEach(([k,v]) => { acc[k] = (acc[k]||0)+v })
    return acc
  }, {})

  function exportarPDF() {
    const doc = new jsPDF('l','mm','a4')
    doc.setFillColor(82,46,100); doc.rect(0,0,297,28,'F')
    doc.setTextColor(234,183,130); doc.setFontSize(14); doc.setFont(undefined,'bold')
    doc.text('Laricas Fitness — DRE Gerencial', 14, 14)
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(255,255,255)
    const canalNome = canalId ? canais.find(c=>c.id===canalId)?.nome : 'Todos os canais'
    doc.text(`${mesLabel(anoMesIni+'-01')} → ${mesLabel(anoMesFim+'-01')} · ${canalNome}`, 14, 22)

    const colHead = ['', ...meses.map(m => mesLabel(m+'-01')), 'TOTAL']
    const body = []

    for (const grupo of GRUPOS) {
      // Header do grupo
      body.push([{ content: grupo.label, colSpan: colHead.length,
        styles: { fillColor: grupo.tipo==='receita'?[200,240,210]:[255,220,220], fontStyle:'bold', fontSize:8 } }])
      // Categorias do grupo
      for (const cat of grupo.cats) {
        const hasDados = meses.some(m => dados[m]?.[cat] > 0)
        if (!hasDados) continue
        const totCat = meses.reduce((s,m) => s+(dados[m]?.[cat]||0),0)
        body.push([
          { content: `  ${cat}`, styles: { halign:'left' }},
          ...meses.map(m => fmtR(dados[m]?.[cat]||0)),
          { content: fmtR(totCat), styles: { fontStyle:'bold' }}
        ])
      }
      // Subtotal se existir
      if (grupo.subtotal) {
        const subKey = { 'Faturamento Bruto':'fb','Faturamento Líquido':'fl','Lucro Bruto (Margem Bruta)':'lb','Margem de Contribuição (MC)':'mc','MC com Marketing (MCM)':'mcm','Resultado Operacional':'res' }[grupo.subtotal] || ''
        if (subKey) {
          body.push([
            { content: grupo.subtotal, styles:{ fontStyle:'bold', fillColor:[245,245,255]}},
            ...meses.map(m => ({ content: fmtR(subtotais(m)[subKey]), styles:{ fontStyle:'bold', fillColor:[245,245,255]}})),
            { content: fmtR(totSub[subKey]||0), styles:{ fontStyle:'bold', fillColor:[240,240,255]}}
          ])
        }
      }
    }

    autoTable(doc, {
      startY: 34, head: [colHead], body,
      styles: { fontSize: 7.5, cellPadding: 2.5, halign: 'right' },
      headStyles: { fillColor:[103,63,124], textColor:255, fontStyle:'bold', halign:'center', fontSize:8 },
      columnStyles: { 0: { halign:'left', cellWidth:52 } },
      margin: { left:8, right:8 },
    })
    doc.save(`DRE_${anoMesIni}_${anoMesFim}.pdf`)
  }

  const SubtotalRow = ({ label, valor, base, cor }) => (
    <tr style={{ background: cor === 'ok' ? 'var(--ok-pale)' : 'var(--purple-pale)', borderTop: `2px solid ${COR_STATUS[cor]||'var(--purple)'}` }}>
      <td style={{ fontWeight:800, fontSize:13, padding:'9px 14px', color: COR_STATUS[cor]||'var(--purple)' }}>{label}</td>
      {meses.map(m => {
        const s = subtotais(m)
        const chave = { 'Faturamento Bruto':'fb','Faturamento Líquido':'fl','Lucro Bruto':'lb','Margem de Contribuição':'mc','MC c/ Marketing':'mcm','Resultado Operacional':'res' }[label]
        const v = s[chave] || valor?.(m) || 0
        const fb = s.fb
        return (
          <td key={m} style={{ textAlign:'right', fontWeight:800, fontSize:13, padding:'9px 10px', color: v>=0?COR_STATUS[cor]||'var(--purple)':'var(--danger)' }}>
            {fmtR(v)}
            {mostrarPct && fb > 0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--gray-400)' }}>{fmtPct(pct(v,fb))}</div>}
          </td>
        )
      })}
      <td style={{ textAlign:'right', fontWeight:800, fontSize:13, padding:'9px 10px' }}>
        {fmtR(totSub[{ 'Faturamento Bruto':'fb','Faturamento Líquido':'fl','Lucro Bruto':'lb','Margem de Contribuição':'mc','MC c/ Marketing':'mcm','Resultado Operacional':'res' }[label]]||0)}
      </td>
    </tr>
  )

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
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', marginBottom:6 }}>
            <input type="checkbox" checked={mostrarPct} onChange={e=>setMostrarPct(e.target.checked)} style={{ accentColor:'var(--purple)' }} />
            Mostrar % s/ faturamento
          </label>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button className="btn btn-ghost" onClick={carregar}><RefreshCw size={14}/></button>
            <button className="btn btn-outline" onClick={exportarPDF} disabled={loading||!meses.length}>
              <FileText size={14}/> PDF
            </button>
          </div>
        </div>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div>
      : meses.length === 0 ? (
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
                  <th style={{ textAlign:'left', padding:'10px 14px', minWidth:200, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>
                    Categoria
                  </th>
                  {meses.map(m=>(
                    <th key={m} style={{ textAlign:'right', padding:'10px 10px', minWidth:110, background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)', fontWeight:700, fontSize:12 }}>
                      {mesLabel(m+'-01')}
                    </th>
                  ))}
                  <th style={{ textAlign:'right', padding:'10px 10px', minWidth:110, background:'var(--purple-pale)', borderBottom:'2px solid var(--purple)', fontWeight:800, color:'var(--purple)', fontSize:12 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {GRUPOS.map((grupo, gi) => {
                  const linhas = []
                  // Header do grupo
                  linhas.push(
                    <tr key={`g-${gi}`}>
                      <td colSpan={meses.length+2} style={{
                        background: grupo.tipo==='receita' ? 'var(--ok-pale)' : 'var(--danger-pale)',
                        padding:'6px 14px', fontWeight:800, fontSize:11,
                        color: grupo.tipo==='receita' ? 'var(--ok)' : 'var(--danger)',
                        textTransform:'uppercase', letterSpacing:'.05em',
                      }}>
                        {grupo.label}
                      </td>
                    </tr>
                  )
                  // Linhas das categorias
                  for (const cat of grupo.cats) {
                    const hasDados = meses.some(m => (dados[m]?.[cat]||0) > 0)
                    if (!hasDados) continue
                    const totCat = meses.reduce((s,m)=>s+(dados[m]?.[cat]||0),0)
                    linhas.push(
                      <tr key={cat} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                        <td style={{ padding:'8px 14px 8px 24px', color:'var(--gray-700)' }}>{cat}</td>
                        {meses.map(m => {
                          const v = dados[m]?.[cat] || 0
                          const fb = subtotais(m).fb
                          return (
                            <td key={m} style={{ textAlign:'right', padding:'8px 10px', color: v>0?'var(--gray-800)':'var(--gray-300)', fontWeight: v>0?600:400 }}>
                              {v>0 ? fmtR(v) : '—'}
                              {mostrarPct && v>0 && fb>0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--gray-400)' }}>{fmtPct(pct(v,fb))}</div>}
                            </td>
                          )
                        })}
                        <td style={{ textAlign:'right', padding:'8px 10px', fontWeight:700, color:'var(--gray-700)' }}>
                          {fmtR(totCat)}
                        </td>
                      </tr>
                    )
                  }
                  // Subtotais
                  if (grupo.subtotal) {
                    const chaveMap = {
                      'Faturamento Bruto':'fb', 'Faturamento Líquido':'fl',
                      'Lucro Bruto (Margem Bruta)':'lb', 'Margem de Contribuição (MC)':'mc',
                      'MC com Marketing (MCM)':'mcm', 'Resultado Operacional':'res'
                    }
                    const chave = chaveMap[grupo.subtotal]
                    const isPositivo = (totSub[chave]||0) >= 0
                    linhas.push(
                      <tr key={`sub-${gi}`} style={{ borderTop:`2px solid ${grupo.subtotal==='Resultado Operacional'?'var(--purple)':grupo.tipo==='receita'?'var(--ok)':'var(--gray-300)'}`, background: grupo.subtotal==='Resultado Operacional'?'var(--purple-pale)':'var(--gray-50)' }}>
                        <td style={{ padding:'10px 14px', fontWeight:800, fontSize:13, color: grupo.subtotal==='Resultado Operacional'?'var(--purple)': isPositivo?'var(--ok)':'var(--danger)' }}>
                          {grupo.subtotal}
                        </td>
                        {meses.map(m => {
                          const v = subtotais(m)[chave] || 0
                          const fb = subtotais(m).fb
                          return (
                            <td key={m} style={{ textAlign:'right', padding:'10px 10px', fontWeight:800, fontSize:13, color: v>=0?( grupo.subtotal==='Resultado Operacional'?'var(--purple)':'var(--ok)'):'var(--danger)' }}>
                              {fmtR(v)}
                              {mostrarPct && fb>0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--gray-400)' }}>{fmtPct(pct(v,fb))}</div>}
                            </td>
                          )
                        })}
                        <td style={{ textAlign:'right', padding:'10px 10px', fontWeight:800, fontSize:13, color: (totSub[chave]||0)>=0?( grupo.subtotal==='Resultado Operacional'?'var(--purple)':'var(--ok)'):'var(--danger)' }}>
                          {fmtR(totSub[chave]||0)}
                          {mostrarPct && totSub.fb>0 && <div style={{ fontSize:10, fontWeight:400, color:'var(--gray-400)' }}>{fmtPct(pct(totSub[chave]||0, totSub.fb||1))}</div>}
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
