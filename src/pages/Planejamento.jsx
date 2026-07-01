import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Upload, FileText, RefreshCw, Trash2 } from 'lucide-react'
import { registrarAcao } from '../lib/log'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const ORDEM_CATS = [
  'Pão de Mel 100g','Mini Pão de Mel 30g','Lata Mini 240g','Bolinho 100g',
  'Potinho 60g','Potão 280g','Barra 180g','Bombom','Outros'
]

// ── Parser CSV robusto (respeita campos com aspas e quebras de linha) ─────────
function parseCSVRobusto(texto) {
  const rows = []
  let col = '', row = [], inQuote = false
  const clean = texto.replace(/^\uFEFF/, '')
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i], next = clean[i + 1]
    if (inQuote) {
      if (c === '"' && next === '"') { col += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { col += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ';') { row.push(col.trim()); col = '' }
      else if (c === '\n') { row.push(col.trim()); rows.push(row); row = []; col = '' }
      else if (c === '\r') { /* skip */ }
      else { col += c }
    }
  }
  if (col || row.length) { row.push(col.trim()); rows.push(row) }
  return rows
}

function parsearDataBr(dataBr) {
  if (!dataBr) return null
  const [d, m, y] = dataBr.trim().split('/')
  if (!d || !m || !y) return null
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
}

function parsearCSV(texto) {
  const rows = parseCSVRobusto(texto)
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.replace(/^"|"$/g, '').trim())
  const isVendas = header[0] === 'Número pedido' || header.includes('SKU')
  const resultado = []

  if (!isVendas) {
    for (const cols of rows.slice(1)) {
      if (cols.length < 6) continue
      const sku = cols[0], qtd = parseFloat(cols[3].replace(',', '.')) || 0
      const dataIso = parsearDataBr(cols[5])
      if (!sku || qtd <= 0 || !dataIso) continue
      resultado.push({ sku, qtd: Math.round(qtd), data: dataIso })
    }
  } else {
    const idxSku = header.indexOf('SKU'), idxQtd = header.indexOf('Quantidade'), idxData = header.indexOf('Data Prevista')
    if (idxSku < 0 || idxQtd < 0 || idxData < 0) return []
    for (const cols of rows.slice(1)) {
      if (cols.length <= idxData) continue
      const sku = cols[idxSku], qtd = parseFloat((cols[idxQtd] || '0').replace(',', '.')) || 0
      const dataIso = parsearDataBr(cols[idxData])
      if (!sku || qtd <= 0 || !dataIso) continue
      resultado.push({ sku, qtd: Math.round(qtd), data: dataIso })
    }
  }
  return resultado
}

function fmtDataBr(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}`
}

function diaSemana(iso) {
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][new Date(iso + 'T12:00:00').getDay()]
}

function headerDia(iso) { return `${diaSemana(iso)} ${fmtDataBr(iso)}` }

// ── PDF Produção (página única, compacto) ─────────────────────────────────────
function gerarPDFProducao(dataProducao, itensDia, totalGeral) {
  const doc = new jsPDF()
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(15); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 12)
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text(`Produção do dia — ${headerDia(dataProducao)}`, 14, 20)
  doc.text(`Gerado: ${agora}`, 130, 20)

  const body = []
  for (const cat of ORDEM_CATS) {
    const itens = (itensDia[cat] || []).filter(i => i.total > 0)
    if (!itens.length) continue
    const totalCat = itens.reduce((s, i) => s + i.total, 0)
    body.push([{ content: `${cat}  —  ${totalCat.toLocaleString('pt-BR')} un`, colSpan: 2,
      styles: { fillColor: [103,63,124], textColor: [255,255,255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 } }])
    for (const i of itens) {
      body.push([i.nome, { content: i.total.toLocaleString('pt-BR'), styles: { halign: 'center', fontStyle: 'bold' } }])
    }
  }

  autoTable(doc, {
    startY: 33, body,
    styles: { fontSize: 8, cellPadding: 2.5 },
    alternateRowStyles: { fillColor: [248, 245, 252] },
    columnStyles: { 1: { cellWidth: 22, halign: 'center' } },
    margin: { left: 14, right: 14 },
  })

  const finalY = doc.lastAutoTable.finalY + 6
  doc.setFont(undefined,'bold'); doc.setFontSize(11); doc.setTextColor(82,46,100)
  doc.text(`Total geral: ${totalGeral.toLocaleString('pt-BR')} unidades`, 14, finalY)
  doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(150,150,150)
  doc.text('Laricas Fitness — Planejamento de Produção', 14, 290)
  doc.save(`Producao_${dataProducao}.pdf`)
}

// ── PDF Produção Completa ─────────────────────────────────────────────────────
function gerarPDFCompleto(diasVisiveis, diasBling, diasDelivery, embalagens, diaAtual) {
  const doc = new jsPDF('l', 'mm', 'a4')
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 297, 38, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(18); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 15)
  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text('Produção Completa — Previsão Semanal', 14, 23)
  doc.text(`Gerado: ${agora}`, 14, 30)

  const diasResto = diasVisiveis.slice(1)
  const colHead = ['Produto', 'Bling', 'Delivery', 'Total']
  diasResto.forEach(d => colHead.push(headerDia(d)))

  const cats = ORDEM_CATS.filter(cat =>
    embalagens.some(e => e.categoria === cat &&
      diasVisiveis.some(d => (diasBling[d]?.[e.codigo] || 0) + (diasDelivery[d]?.[e.codigo] || 0) > 0)
    )
  )

  let startY = 46
  for (const cat of cats) {
    const itens = embalagens.filter(e => e.categoria === cat && (
      diasVisiveis.some(d => (diasBling[d]?.[e.codigo] || 0) + (diasDelivery[d]?.[e.codigo] || 0) > 0)
    ))
    if (!itens.length) continue

    autoTable(doc, {
      startY,
      head: [[{ content: cat, colSpan: colHead.length }]],
      body: [],
      headStyles: { fillColor: [103,63,124], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      margin: { left: 14, right: 14 },
    })

    const body = itens.map(e => {
      const b = diasBling[diaAtual]?.[e.codigo] || 0
      const del = diasDelivery[diaAtual]?.[e.codigo] || 0
      const tot = b + del
      const row = [e.nome, b > 0 ? b : '—', del > 0 ? del : '—', tot > 0 ? tot : '—']
      diasResto.forEach(d => { const bR = diasBling[d]?.[e.codigo] || 0; row.push(bR > 0 ? bR : '—') })
      return row
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY,
      head: [colHead], body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [230,225,235], textColor: [82,46,100], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [250,248,252] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 18 },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'center', cellWidth: 18, fontStyle: 'bold' },
        ...Object.fromEntries(diasResto.map((_, i) => [i+4, { halign: 'center', cellWidth: 22 }]))
      },
      margin: { left: 14, right: 14 },
    })

    startY = doc.lastAutoTable.finalY + 5
    if (startY > 175 && cats.indexOf(cat) < cats.length - 1) { doc.addPage(); startY = 14 }
  }

  doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(150,150,150)
  doc.text('Laricas Fitness — Planejamento de Produção Completo', 14, 198)
  doc.save('Producao_Completa_semana.pdf')
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Planejamento({ onIrLogistica }) {
  const [embalagens, setEmbalagens] = useState([])
  const [loading, setLoading] = useState(true)
  const [importando, setImportando] = useState(false)
  const [diasBling, setDiasBling] = useState({})
  const [pedidosPorDia, setPedidosPorDia] = useState({})
  const [diasDelivery, setDiasDelivery] = useState({})
  const [diasOrdenados, setDiasOrdenados] = useState([])
  const [datasAtivas, setDatasAtivas] = useState([])
  const [csvRaw, setCsvRaw] = useState(null) // guarda o texto CSV para passar à logística
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
      const texto = e.target.result
      setCsvRaw(texto)
      const parsed = parsearCSV(texto)
      const novosBling = {}
      const pedidosPorDia = {} // { data: Set<numeroPedido> }

      // Tenta extrair número de pedido para contar pedidos distintos
      const rows = texto.split('\n').map(r => r.replace(/\r$/,''))
      const header = rows[0]?.split(';').map(h=>h.replace(/^"|"$/g,'').trim()) || []
      const idxPed = header.indexOf('Número pedido')
      const idxData = header.indexOf('Data Prevista')

      for (const { sku, qtd, data } of parsed) {
        if (!novosBling[data]) novosBling[data] = {}
        novosBling[data][sku] = (novosBling[data][sku] || 0) + qtd
      }

      // Conta pedidos distintos por dia
      if (idxPed >= 0 && idxData >= 0) {
        for (const row of rows.slice(1)) {
          const cols = row.split(';').map(c=>c.replace(/^"|"$/g,'').trim())
          const numPed = cols[idxPed]?.trim()
          const dataBr = cols[idxData]?.trim()
          if (!numPed || !dataBr) continue
          // Converte data pt-BR para ISO
          const parts = dataBr.split('/')
          const iso = parts.length===3 ? `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}` : null
          if (!iso) continue
          if (!pedidosPorDia[iso]) pedidosPorDia[iso] = new Set()
          pedidosPorDia[iso].add(numPed)
        }
      }

      // Converte Sets para contagens
      const countsPorDia = {}
      for (const [d, set] of Object.entries(pedidosPorDia)) countsPorDia[d] = set.size

      const datas = Object.keys(novosBling).sort()
      setDiasBling(novosBling)
      setPedidosPorDia(countsPorDia)
      setDiasOrdenados(datas)
      setDatasAtivas([])
      setDiasDelivery({})
      setImportando(false)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function toggleData(d) {
    setDatasAtivas(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  function limpar() {
    setDiasBling({}); setDiasDelivery({}); setDiasOrdenados([]); setDatasAtivas([]); setPedidosPorDia({})
  }

  const diasVisiveis = diasOrdenados.filter(d => datasAtivas.includes(d))
  const diaAtual = diasVisiveis[0]
  const diasResto = diasVisiveis.slice(1)

  function setDel(sku, val) {
    if (!diaAtual) return
    setDiasDelivery(prev => ({
      ...prev,
      [diaAtual]: { ...(prev[diaAtual] || {}), [sku]: parseInt(val) || 0 }
    }))
  }

  async function exportarPDFProducao() {
    gerarPDFProducao(diaAtual, itensDiaAtual, totalDiaAtual)
    try {
      const { data: plan, error } = await supabase.from('planejamentos')
        .insert({ data_producao: diaAtual }).select().single()
      if (error) throw error
      const itensParaSalvar = []
      for (const cat of ORDEM_CATS) {
        for (const item of (itensDiaAtual[cat] || []).filter(i => i.total > 0)) {
          const emb = embalagens.find(e => e.nome === item.nome)
          if (!emb) continue
          itensParaSalvar.push({
            planejamento_id: plan.id, embalagem_id: emb.id,
            quantidade_bling: item.bling, quantidade_delivery: item.delivery, quantidade_total: item.total,
          })
        }
      }
      if (itensParaSalvar.length) await supabase.from('planejamento_itens').insert(itensParaSalvar)

      await registrarAcao({
        acao: 'planejamento_salvo',
        descricao: `Planejamento de ${diaAtual} salvo — ${totalDiaAtual} unidades`,
        tabela: 'planejamentos',
        registroId: plan.id,
        dadosAnteriores: { ids_itens: itensParaSalvar.map(i => i.embalagem_id) },
        dadosNovos: { data_producao: diaAtual, total: totalDiaAtual },
      })
    } catch(e) { console.error('Erro ao salvar planejamento:', e) }
  }

  // Monta dados do dia atual
  const itensDiaAtual = {}
  if (diaAtual) {
    for (const cat of ORDEM_CATS) {
      const itens = embalagens.filter(e => e.categoria === cat).map(e => ({
        nome: e.nome, sku: e.codigo,
        bling: diasBling[diaAtual]?.[e.codigo] || 0,
        delivery: diasDelivery[diaAtual]?.[e.codigo] || 0,
        total: (diasBling[diaAtual]?.[e.codigo] || 0) + (diasDelivery[diaAtual]?.[e.codigo] || 0),
      })).filter(i => i.total > 0)
      if (itens.length) itensDiaAtual[cat] = itens
    }
  }
  const totalDiaAtual = Object.values(itensDiaAtual).flat().reduce((s, i) => s + i.total, 0)
  const temDados = diasOrdenados.length > 0

  if (loading) return <div className="loading"><RefreshCw size={16} className="spin" /> Carregando...</div>

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
              <button className="btn btn-ghost" onClick={limpar}><Trash2 size={14} /> Limpar</button>
              {diaAtual && totalDiaAtual > 0 && (
                <button className="btn btn-gold" onClick={exportarPDFProducao}>
                  <FileText size={14} /> PDF Produção
                </button>
              )}
              {diaAtual && csvRaw && onIrLogistica && (
                <button className="btn btn-outline" onClick={() => onIrLogistica(csvRaw)}>
                  🚚 Ir para Logística
                </button>
              )}
              {diaAtual && (
                <button className="btn btn-primary" onClick={() => gerarPDFCompleto(diasVisiveis, diasBling, diasDelivery, embalagens, diaAtual)}>
                  <FileText size={14} /> PDF Produção Completa
                </button>
              )}
            </div>
          )}
        </div>

        {temDados && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)' }}>SELECIONE AS DATAS:</span>
            {diasOrdenados.map(d => {
              const ativa = datasAtivas.includes(d)
              const idx = datasAtivas.indexOf(d)
              const nPed = pedidosPorDia[d] || 0
              return (
                <button key={d} className={`btn btn-sm ${ativa ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => toggleData(d)} style={{ fontSize: 12, display:'flex', alignItems:'center', gap:5 }}>
                  {ativa && idx === 0 ? '🎯 ' : ''}{headerDia(d)}
                  {nPed > 0 && (
                    <span style={{
                      background: ativa ? 'rgba(255,255,255,.3)' : 'var(--purple-pale)',
                      color: ativa ? '#fff' : 'var(--purple)',
                      fontSize: 10, fontWeight: 700,
                      padding: '1px 5px', borderRadius: 999, lineHeight: 1.6,
                    }}>{nPed}</span>
                  )}
                </button>
              )
            })}
            {datasAtivas.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                Selecione pelo menos uma data para ver a tabela
              </span>
            )}
            {datasAtivas.length > 0 && (() => {
              const totalPed = datasAtivas.reduce((s,d) => s + (pedidosPorDia[d]||0), 0)
              return totalPed > 0 ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginLeft: 4, padding:'4px 10px', background:'var(--purple-pale)', borderRadius:999 }}>
                  📦 {totalPed} pedido{totalPed!==1?'s':''} selecionado{totalPed!==1?'s':''}
                </span>
              ) : null
            })()}
          </div>
        )}

        {!temDados && (
          <div className="alert-banner info" style={{ marginTop: 14 }}>
            💡 Aceita dois formatos do Bling: relatório de produção (por SKU) ou relatório de vendas (por pedido).
            Importe o CSV e selecione as datas que quer incluir.
          </div>
        )}
      </div>

      {/* Aviso sem data */}
      {temDados && datasAtivas.length === 0 && (
        <div className="card card-pad">
          <div className="alert-banner info">
            👆 Selecione pelo menos uma data acima para ver a tabela de planejamento.
          </div>
        </div>
      )}

      {/* Tabela */}
      {temDados && datasAtivas.length > 0 && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', minWidth: 200 }}>
                    Produto
                  </th>
                  {diaAtual && (
                    <th colSpan={3} style={{ textAlign: 'center', padding: '10px 14px', background: 'var(--purple-pale)', borderBottom: '2px solid var(--purple)', color: 'var(--purple)', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      🎯 {headerDia(diaAtual)}
                    </th>
                  )}
                  {diasResto.map(d => (
                    <th key={d} style={{ textAlign: 'center', padding: '10px 10px', background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', color: 'var(--gray-600)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 12 }}>
                      {headerDia(d)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th style={{ padding: '6px 14px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}></th>
                  {diaAtual && (
                    <>
                      <th style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--purple-ghost)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700 }}>Bling</th>
                      <th style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--purple-ghost)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700 }}>Delivery</th>
                      <th style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--purple-ghost)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--purple)', fontWeight: 800 }}>Total</th>
                    </>
                  )}
                  {diasResto.map(d => (
                    <th key={d} style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)', fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}>Bling</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ORDEM_CATS.map(cat => {
                  const itens = embalagens.filter(e => e.categoria === cat)
                  if (!itens.length) return null
                  return [
                    <tr key={`cat-${cat}`}>
                      <td colSpan={4 + diasResto.length} style={{ background: 'var(--purple-pale)', padding: '7px 14px', fontWeight: 800, fontSize: 11, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {cat}
                      </td>
                    </tr>,
                    ...itens.map(e => {
                      const bAtual = diaAtual ? (diasBling[diaAtual]?.[e.codigo] || 0) : 0
                      const del = diaAtual ? (diasDelivery[diaAtual]?.[e.codigo] || 0) : 0
                      const tot = bAtual + del
                      const temResto = diasResto.some(d => (diasBling[d]?.[e.codigo] || 0) > 0)
                      return (
                        <tr key={e.codigo} style={{ opacity: tot === 0 && !temResto ? 0.4 : 1 }}>
                          <td style={{ padding: '9px 14px', fontWeight: tot > 0 ? 600 : 400, borderBottom: '1px solid var(--gray-100)' }}>{e.nome}</td>
                          {diaAtual && (
                            <>
                              <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', color: bAtual > 0 ? 'var(--purple)' : 'var(--gray-300)', fontWeight: bAtual > 0 ? 700 : 400, background: 'var(--purple-ghost)' }}>
                                {bAtual > 0 ? bAtual : '—'}
                              </td>
                              <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', background: 'var(--purple-ghost)' }}>
                                <input type="number" min={0} value={del || ''} placeholder="0"
                                  onChange={ev => setDel(e.codigo, ev.target.value)}
                                  style={{ width: 60, padding: '5px 6px', border: `1.5px solid ${del > 0 ? 'var(--ok)' : 'var(--gray-200)'}`, borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: 'center', background: del > 0 ? 'var(--ok-pale)' : 'var(--white)', outline: 'none' }} />
                              </td>
                              <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', fontWeight: 800, fontSize: 15, color: tot > 0 ? 'var(--gray-800)' : 'var(--gray-300)', background: 'var(--purple-ghost)' }}>
                                {tot > 0 ? tot : '—'}
                              </td>
                            </>
                          )}
                          {diasResto.map(d => {
                            const bR = diasBling[d]?.[e.codigo] || 0
                            return (
                              <td key={d} style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', color: bR > 0 ? 'var(--gray-800)' : 'var(--gray-300)', fontWeight: bR > 0 ? 600 : 400 }}>
                                {bR > 0 ? bR : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })
                  ]
                })}
              </tbody>
            </table>
          </div>

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
