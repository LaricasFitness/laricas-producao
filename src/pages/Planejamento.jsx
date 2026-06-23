import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Upload, FileText, RefreshCw, Trash2 } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const ORDEM_CATS = [
  'Pão de Mel 100g','Mini Pão de Mel 30g','Lata Mini 240g','Bolinho 100g',
  'Potinho 60g','Potão 280g','Barra 180g','Bombom','Outros'
]

function parsearCSV(texto) {
  const linhas = texto.trim().split('\n').slice(1)
  const resultado = []
  for (const linha of linhas) {
    const cols = linha.split(';').map(c => c.replace(/^"|"$/g, '').trim())
    if (cols.length < 6) continue
    const sku = cols[0]
    const qtd = parseFloat(cols[3].replace(',', '.')) || 0
    const dataBr = cols[5] // DD/MM/YYYY
    if (!sku || qtd <= 0 || !dataBr) continue
    // Converte DD/MM/YYYY → YYYY-MM-DD
    const [d, m, y] = dataBr.split('/')
    if (!d || !m || !y) continue
    const dataIso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
    resultado.push({ sku, qtd: Math.round(qtd), data: dataIso })
  }
  return resultado
}

function fmtDataBr(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}`
}

function diaSemana(iso) {
  const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
  return dias[new Date(iso + 'T12:00:00').getDay()]
}

function headerDia(iso) {
  return `${diaSemana(iso)} ${fmtDataBr(iso)}`
}

// ── PDF Produção (só total do próximo dia) ──────────────────────────────────
function gerarPDFProducao(dataProducao, itensDia, totalGeral) {
  const doc = new jsPDF()
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 210, 38, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(18); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 15)
  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text('Produção do dia', 14, 23)
  doc.text(`Data: ${headerDia(dataProducao)} · Gerado: ${agora}`, 14, 30)

  let startY = 46
  const cats = ORDEM_CATS.filter(c => itensDia[c]?.length)

  for (const cat of cats) {
    const itens = itensDia[cat].filter(i => i.total > 0)
    if (!itens.length) continue
    const totalCat = itens.reduce((s, i) => s + i.total, 0)

    autoTable(doc, {
      startY,
      head: [[{ content: `${cat}  —  ${totalCat.toLocaleString('pt-BR')} un`, colSpan: 2 }]],
      body: itens.map(i => [i.nome, { content: i.total.toLocaleString('pt-BR'), styles: { halign: 'center', fontStyle: 'bold' } }]),
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [103, 63, 124], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 240, 248] },
      columnStyles: { 1: { cellWidth: 28, halign: 'center' } },
      margin: { left: 14, right: 14 },
    })
    startY = doc.lastAutoTable.finalY + 6
    if (startY > 260 && cats.indexOf(cat) < cats.length - 1) { doc.addPage(); startY = 14 }
  }

  doc.setFont(undefined,'bold'); doc.setFontSize(12); doc.setTextColor(82,46,100)
  doc.text(`Total geral: ${totalGeral.toLocaleString('pt-BR')} unidades`, 14, startY + 8)
  doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(150,150,150)
  doc.text('Laricas Fitness — Planejamento de Produção', 14, 288)
  doc.save(`Producao_${dataProducao}.pdf`)
}

// ── PDF Produção Completa (próximo dia Bling+Delivery+Total, demais só Bling) ─
function gerarPDFCompleto(diasOrdenados, diasBling, diasDelivery, embalagens, dataProxDia) {
  const doc = new jsPDF('l', 'mm', 'a4') // landscape para caber as colunas
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 297, 38, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(18); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 15)
  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text('Produção Completa — Previsão Semanal', 14, 23)
  doc.text(`Gerado: ${agora}`, 14, 30)

  // Cabeçalhos das colunas
  const diaAtual = diasOrdenados[0]
  const diasResto = diasOrdenados.slice(1)

  // Monta colunas: Produto | [Bling / Del / Total] para diaAtual | [Total Bling] para cada dia restante
  const colHead = ['Produto', 'Bling', 'Delivery', 'Total']
  diasResto.forEach(d => colHead.push(headerDia(d)))

  const cats = ORDEM_CATS.filter(cat =>
    embalagens.some(e => e.categoria === cat &&
      diasOrdenados.some(d => (diasBling[d]?.[e.codigo] || 0) + (diasDelivery[d]?.[e.codigo] || 0) > 0)
    )
  )

  let startY = 46
  for (const cat of cats) {
    const itens = embalagens.filter(e => e.categoria === cat && (
      diasOrdenados.some(d => (diasBling[d]?.[e.codigo] || 0) + (diasDelivery[d]?.[e.codigo] || 0) > 0)
    ))
    if (!itens.length) continue

    // Header da categoria
    autoTable(doc, {
      startY,
      head: [[{ content: cat, colSpan: colHead.length }]],
      body: [],
      headStyles: { fillColor: [103, 63, 124], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      margin: { left: 14, right: 14 },
    })

    const body = itens.map(e => {
      const b = diasBling[diaAtual]?.[e.codigo] || 0
      const del = diasDelivery[diaAtual]?.[e.codigo] || 0
      const tot = b + del
      const row = [e.nome, b > 0 ? b : '—', del > 0 ? del : '—', tot > 0 ? tot : '—']
      diasResto.forEach(d => {
        const bResto = diasBling[d]?.[e.codigo] || 0
        row.push(bResto > 0 ? bResto : '—')
      })
      return row
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY,
      head: [colHead],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [230, 225, 235], textColor: [82,46,100], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 248, 252] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 18 },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'center', cellWidth: 18, fontStyle: 'bold' },
        ...Object.fromEntries(diasResto.map((_, i) => [i + 4, { halign: 'center', cellWidth: 22 }]))
      },
      margin: { left: 14, right: 14 },
    })

    startY = doc.lastAutoTable.finalY + 5
    if (startY > 175 && cats.indexOf(cat) < cats.length - 1) { doc.addPage(); startY = 14 }
  }

  doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(150,150,150)
  doc.text('Laricas Fitness — Planejamento de Produção Completo', 14, 198)
  doc.save(`Producao_Completa_semana.pdf`)
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function Planejamento() {
  const [embalagens, setEmbalagens] = useState([])
  const [loading, setLoading] = useState(true)
  const [importando, setImportando] = useState(false)

  // diasBling[dataIso][sku] = qtd
  const [diasBling, setDiasBling] = useState({})
  // diasDelivery[dataIso][sku] = qtd (só para o próximo dia)
  const [diasDelivery, setDiasDelivery] = useState({})
  const [diasOrdenados, setDiasOrdenados] = useState([])

  const fileRef = useRef()

  useEffect(() => {
    supabase.from('embalagens')
      .select('id, codigo, nome, categoria')
      .eq('visivel_producao', true)
      .order('categoria').order('nome')
      .then(({ data }) => { setEmbalagens(data || []); setLoading(false) })
  }, [])

  function handleFile(file) {
    setImportando(true)
    const reader = new FileReader()
    reader.onload = e => {
      const parsed = parsearCSV(e.target.result)
      const novosBling = {}
      for (const { sku, qtd, data } of parsed) {
        if (!novosBling[data]) novosBling[data] = {}
        novosBling[data][sku] = (novosBling[data][sku] || 0) + qtd
      }
      const datas = Object.keys(novosBling).sort()
      setDiasBling(novosBling)
      setDiasOrdenados(datas)
      // Inicializa delivery zerado para o primeiro dia
      if (datas.length) {
        setDiasDelivery({ [datas[0]]: {} })
      }
      setImportando(false)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function setDel(sku, val) {
    if (!diasOrdenados.length) return
    const diaAtual = diasOrdenados[0]
    setDiasDelivery(prev => ({
      ...prev,
      [diaAtual]: { ...(prev[diaAtual] || {}), [sku]: parseInt(val) || 0 }
    }))
  }

  function limpar() {
    setDiasBling({}); setDiasDelivery({}); setDiasOrdenados([])
  }

  const diaAtual = diasOrdenados[0]
  const diasResto = diasOrdenados.slice(1)

  // Monta dados do dia atual para PDF simples
  const itensDiaAtual = {}
  if (diaAtual) {
    for (const cat of ORDEM_CATS) {
      const grupo = embalagens.filter(e => e.categoria === cat)
      const itensComValor = grupo.map(e => ({
        nome: e.nome, sku: e.codigo,
        bling: diasBling[diaAtual]?.[e.codigo] || 0,
        delivery: diasDelivery[diaAtual]?.[e.codigo] || 0,
        total: (diasBling[diaAtual]?.[e.codigo] || 0) + (diasDelivery[diaAtual]?.[e.codigo] || 0),
      })).filter(i => i.total > 0)
      if (itensComValor.length) itensDiaAtual[cat] = itensComValor
    }
  }
  const totalDiaAtual = Object.values(itensDiaAtual).flat().reduce((s, i) => s + i.total, 0)
  const temDados = diasOrdenados.length > 0

  if (loading) return <div className="loading"><RefreshCw size={16} className="spin" /></div>

  return (
    <>
      {/* Barra de ações */}
      <div className="card card-pad">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label className="form-label" style={{ marginBottom: 5, display: 'block' }}>CSV do Bling</label>
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importando}>
              {importando ? <><RefreshCw size={14} className="spin" /> Importando...</> : <><Upload size={14} /> Importar CSV</>}
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = '' }} />
          </div>

          {temDados && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={limpar}>
                <Trash2 size={14} /> Limpar
              </button>
              <button className="btn btn-gold" onClick={() => gerarPDFProducao(diaAtual, itensDiaAtual, totalDiaAtual)}>
                <FileText size={14} /> PDF Produção
              </button>
              <button className="btn btn-primary" onClick={() => gerarPDFCompleto(diasOrdenados, diasBling, diasDelivery, embalagens, diaAtual)}>
                <FileText size={14} /> PDF Produção Completa
              </button>
            </div>
          )}
        </div>

        {temDados && (
          <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
            {diasOrdenados.map((d, i) => (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--purple)' : 'var(--gray-400)', textTransform: 'uppercase' }}>
                  {i === 0 ? '🎯 Próxima produção' : `📅 ${headerDia(d)}`}
                </div>
                {i === 0 && <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--purple)' }}>{headerDia(d)}</div>}
              </div>
            ))}
          </div>
        )}

        {!temDados && (
          <div className="alert-banner info" style={{ marginTop: 14 }}>
            💡 Importe o CSV do Bling. O sistema distribui os itens por data de produção automaticamente.
            Para o próximo dia, adicione o delivery manualmente. Depois exporte os PDFs.
          </div>
        )}
      </div>

      {temDados && (
        <div className="card">
          {/* Header da tabela com dias */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', minWidth: 200 }}>
                    Produto
                  </th>
                  {/* Próximo dia: 3 colunas */}
                  <th colSpan={3} style={{ textAlign: 'center', padding: '10px 14px', background: 'var(--purple-pale)', borderBottom: '2px solid var(--purple)', color: 'var(--purple)', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    🎯 {headerDia(diaAtual)}
                  </th>
                  {/* Dias seguintes: 1 coluna cada */}
                  {diasResto.map(d => (
                    <th key={d} style={{ textAlign: 'center', padding: '10px 10px', background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', color: 'var(--gray-600)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 12 }}>
                      {headerDia(d)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th style={{ padding: '6px 14px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}></th>
                  <th style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--purple-ghost)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700 }}>Bling</th>
                  <th style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--purple-ghost)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700 }}>Delivery</th>
                  <th style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--purple-ghost)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--purple)', fontWeight: 800 }}>Total</th>
                  {diasResto.map(d => (
                    <th key={d} style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}>Bling</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ORDEM_CATS.map(cat => {
                  const itens = embalagens.filter(e => e.categoria === cat)
                  const temAlgo = itens.some(e =>
                    diasOrdenados.some(d => (diasBling[d]?.[e.codigo] || 0) > 0 || (diasDelivery[d]?.[e.codigo] || 0) > 0)
                  )
                  if (!itens.length || !temAlgo) return null
                  return [
                    // Linha de categoria
                    <tr key={`cat-${cat}`}>
                      <td colSpan={4 + diasResto.length} style={{ background: 'var(--purple-pale)', padding: '7px 14px', fontWeight: 800, fontSize: 11, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {cat}
                      </td>
                    </tr>,
                    // Linhas de produto
                    ...itens.map(e => {
                      const bAtual = diasBling[diaAtual]?.[e.codigo] || 0
                      const del = diasDelivery[diaAtual]?.[e.codigo] || 0
                      const tot = bAtual + del
                      const temQualquer = tot > 0 || diasResto.some(d => (diasBling[d]?.[e.codigo] || 0) > 0)
                      if (!temQualquer) return null
                      return (
                        <tr key={e.codigo} style={{ opacity: tot === 0 && !diasResto.some(d => diasBling[d]?.[e.codigo] > 0) ? 0.4 : 1 }}>
                          <td style={{ padding: '9px 14px', fontWeight: tot > 0 ? 600 : 400, borderBottom: '1px solid var(--gray-100)' }}>{e.nome}</td>
                          <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', color: bAtual > 0 ? 'var(--purple)' : 'var(--gray-300)', fontWeight: bAtual > 0 ? 700 : 400, background: 'var(--purple-ghost)' }}>
                            {bAtual > 0 ? bAtual : '—'}
                          </td>
                          <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', background: 'var(--purple-ghost)' }}>
                            <input type="number" min={0} value={del || ''}
                              placeholder="0"
                              onChange={ev => setDel(e.codigo, ev.target.value)}
                              style={{ width: 60, padding: '5px 6px', border: `1.5px solid ${del > 0 ? 'var(--ok)' : 'var(--gray-200)'}`, borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: 'center', background: del > 0 ? 'var(--ok-pale)' : 'var(--white)', outline: 'none' }} />
                          </td>
                          <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', fontWeight: 800, fontSize: 15, color: tot > 0 ? 'var(--gray-800)' : 'var(--gray-300)', background: 'var(--purple-ghost)' }}>
                            {tot > 0 ? tot : '—'}
                          </td>
                          {diasResto.map(d => {
                            const bResto = diasBling[d]?.[e.codigo] || 0
                            return (
                              <td key={d} style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', color: bResto > 0 ? 'var(--gray-800)' : 'var(--gray-300)', fontWeight: bResto > 0 ? 600 : 400 }}>
                                {bResto > 0 ? bResto : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    }).filter(Boolean)
                  ]
                })}
              </tbody>
            </table>
          </div>

          {/* Total do dia atual */}
          {totalDiaAtual > 0 && (
            <div style={{ padding: '12px 20px', borderTop: '2px solid var(--purple-pale)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Total {headerDia(diaAtual)}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>{totalDiaAtual.toLocaleString('pt-BR')} un</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}
