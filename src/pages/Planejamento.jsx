import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Upload, FileText, RefreshCw, Plus, Trash2 } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const ORDEM_CATEGORIAS = [
  'Pão de Mel 100g', 'Mini Pão de Mel 30g', 'Lata Mini 240g',
  'Bolinho 100g', 'Potinho 60g', 'Potão 280g',
  'Barra 180g', 'Bombom', 'Outros'
]

function parsearCSV(texto) {
  const linhas = texto.trim().split('\n')
  const resultado = []
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(';').map(c => c.replace(/^"|"$/g, '').trim())
    if (cols.length < 4) continue
    const sku = cols[0]
    const qtdStr = cols[3].replace(',', '.')
    const qtd = parseFloat(qtdStr) || 0
    if (!sku || qtd <= 0) continue
    resultado.push({ sku, qtd: Math.round(qtd) })
  }
  return resultado
}

function gerarPDF(data, itensAgrupados, totalGeral) {
  const doc = new jsPDF()
  const hoje = new Date()

  // Header
  doc.setFillColor(82, 46, 100)
  doc.rect(0, 0, 210, 38, 'F')
  doc.setTextColor(234, 183, 130)
  doc.setFontSize(18); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 15)
  doc.setFontSize(10); doc.setFont(undefined, 'normal')
  doc.setTextColor(255, 255, 255)
  doc.text('Planejamento de Produção', 14, 23)
  doc.text(`Data de produção: ${data}`, 14, 30)
  doc.text(`Gerado em ${hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 110, 30)

  let startY = 46

  for (const [cat, itens] of Object.entries(itensAgrupados)) {
    const itensFiltrados = itens.filter(i => i.total > 0)
    if (!itensFiltrados.length) continue

    const totalCat = itensFiltrados.reduce((s, i) => s + i.total, 0)

    autoTable(doc, {
      startY,
      head: [[
        { content: `${cat}  —  ${totalCat.toLocaleString('pt-BR')} un no total`, colSpan: 3, styles: { halign: 'left' } }
      ]],
      body: [],
      headStyles: { fillColor: [103, 63, 124], textColor: 255, fontStyle: 'bold', fontSize: 10 },
      margin: { left: 14, right: 14 },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY,
      head: [['Produto', 'Bling (pedidos)', 'Delivery', 'Total']],
      body: itensFiltrados.map(i => [
        i.nome,
        i.bling > 0 ? i.bling.toLocaleString('pt-BR') : '—',
        i.delivery > 0 ? i.delivery.toLocaleString('pt-BR') : '—',
        i.total.toLocaleString('pt-BR'),
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [230, 225, 235], textColor: [82, 46, 100], fontStyle: 'bold', fontSize: 9 },
      alternateRowStyles: { fillColor: [250, 248, 252] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 32 },
        2: { halign: 'center', cellWidth: 28 },
        3: { halign: 'center', cellWidth: 24, fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    })

    startY = doc.lastAutoTable.finalY + 6

    // Nova página se necessário
    if (startY > 260 && Object.keys(itensAgrupados).indexOf(cat) < Object.keys(itensAgrupados).length - 1) {
      doc.addPage()
      startY = 14
    }
  }

  // Total geral
  doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(82, 46, 100)
  doc.text(`Total geral: ${totalGeral.toLocaleString('pt-BR')} unidades`, 14, startY + 8)

  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 150)
  doc.text('Laricas Fitness — Sistema de Planejamento de Produção', 14, 288)

  const nomeArq = `Producao_${data.replace(/\//g, '-')}.pdf`
  doc.save(nomeArq)
}

export default function Planejamento() {
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1)
  const [dataProducao, setDataProducao] = useState(amanha.toLocaleDateString('pt-BR'))
  const [embalagens, setEmbalagens] = useState([]) // todas do banco
  const [itens, setItens] = useState([]) // { id, sku, nome, categoria, bling, delivery }
  const [loading, setLoading] = useState(true)
  const [importando, setImportando] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    supabase.from('embalagens')
      .select('id, codigo, nome, categoria')
      .eq('visivel_producao', true)
      .order('categoria').order('nome')
      .then(({ data }) => {
        const embs = data || []
        setEmbalagens(embs)
        setItens(embs.map(e => ({ id: e.id, sku: e.codigo, nome: e.nome, categoria: e.categoria || 'Outros', bling: 0, delivery: 0 })))
        setLoading(false)
      })
  }, [])

  function handleFile(file) {
    setImportando(true)
    const reader = new FileReader()
    reader.onload = e => {
      const texto = e.target.result
      const parsed = parsearCSV(texto)

      // Mapeia SKU do CSV para itens
      setItens(prev => prev.map(it => {
        const found = parsed.find(p => p.sku.toUpperCase() === it.sku.toUpperCase())
        return found ? { ...it, bling: found.qtd } : { ...it, bling: 0 }
      }))

      // Verifica SKUs do CSV que não foram encontrados
      const naoEncontrados = parsed.filter(p =>
        !embalagens.find(e => e.codigo.toUpperCase() === p.sku.toUpperCase())
      )
      if (naoEncontrados.length) {
        console.warn('SKUs do CSV não encontrados no banco:', naoEncontrados.map(p => p.sku))
      }

      setImportando(false)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function setDelivery(sku, val) {
    setItens(prev => prev.map(it => it.sku === sku ? { ...it, delivery: parseInt(val) || 0 } : it))
  }

  function limpar() {
    setItens(prev => prev.map(it => ({ ...it, bling: 0, delivery: 0 })))
  }

  // Agrupa por categoria na ordem definida
  const itensPorCategoria = {}
  for (const cat of ORDEM_CATEGORIAS) {
    const grupo = itens.filter(i => i.categoria === cat && (i.bling > 0 || i.delivery > 0))
    if (grupo.length) itensPorCategoria[cat] = grupo.map(i => ({ ...i, total: i.bling + i.delivery }))
  }
  // Categorias não previstas
  const catsExtras = [...new Set(itens.map(i => i.categoria))].filter(c => !ORDEM_CATEGORIAS.includes(c))
  for (const cat of catsExtras) {
    const grupo = itens.filter(i => i.categoria === cat && (i.bling > 0 || i.delivery > 0))
    if (grupo.length) itensPorCategoria[cat] = grupo.map(i => ({ ...i, total: i.bling + i.delivery }))
  }

  const totalGeral = itens.reduce((s, i) => s + i.bling + i.delivery, 0)
  const temDados = itens.some(i => i.bling > 0 || i.delivery > 0)

  if (loading) return <div className="loading"><RefreshCw size={16} className="spin" /> Carregando produtos...</div>

  return (
    <>
      {/* Header com ações */}
      <div className="card card-pad">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">Data de produção</label>
            <input className="form-input" value={dataProducao} onChange={e => setDataProducao(e.target.value)}
              placeholder="24/06/2026" style={{ width: 150 }} />
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: 5, display: 'block' }}>CSV do Bling</label>
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importando}>
              {importando ? <><RefreshCw size={14} className="spin" /> Importando...</> : <><Upload size={14} /> Importar CSV</>}
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = '' }} />
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {temDados && (
              <>
                <button className="btn btn-ghost" onClick={limpar}>
                  <Trash2 size={14} /> Limpar
                </button>
                <button className="btn btn-gold" onClick={() => gerarPDF(dataProducao, itensPorCategoria, totalGeral)}>
                  <FileText size={14} /> Exportar PDF
                </button>
              </>
            )}
          </div>
        </div>

        <div className="alert-banner info" style={{ marginTop: 14 }}>
          💡 Importe o CSV do Bling, preencha as quantidades de delivery manualmente, depois exporte o PDF. Itens com valor zero não aparecem no PDF.
        </div>
      </div>

      {/* Tabela de planejamento */}
      <div className="card">
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Itens a produzir
            {totalGeral > 0 && <span style={{ marginLeft: 10, color: 'var(--purple)', fontWeight: 800 }}>{totalGeral.toLocaleString('pt-BR')} un total</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
            {itens.filter(i => i.bling > 0).length} itens do Bling · {itens.filter(i => i.delivery > 0).length} itens com delivery
          </div>
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th style={{ textAlign: 'center' }}>Bling (pedidos)</th>
                <th style={{ textAlign: 'center' }}>Delivery (manual)</th>
                <th style={{ textAlign: 'center' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rows = []
                // Agrupa por categoria em ordem
                const todasCats = [...ORDEM_CATEGORIAS, ...catsExtras]
                for (const cat of todasCats) {
                  const grupo = itens.filter(i => i.categoria === cat)
                  if (!grupo.length) continue

                  rows.push(
                    <tr key={`cat-${cat}`}>
                      <td colSpan={4} style={{ background: 'var(--purple-pale)', padding: '7px 12px', fontWeight: 800, fontSize: 12, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {cat}
                      </td>
                    </tr>
                  )

                  for (const it of grupo) {
                    const total = it.bling + it.delivery
                    rows.push(
                      <tr key={it.sku} style={{ opacity: total === 0 ? 0.45 : 1 }}>
                        <td style={{ fontWeight: total > 0 ? 600 : 400 }}>{it.nome}</td>
                        <td style={{ textAlign: 'center', fontWeight: it.bling > 0 ? 700 : 400, color: it.bling > 0 ? 'var(--purple)' : 'var(--gray-300)' }}>
                          {it.bling > 0 ? it.bling.toLocaleString('pt-BR') : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number" min={0}
                            value={it.delivery || ''}
                            placeholder="0"
                            onChange={e => setDelivery(it.sku, e.target.value)}
                            style={{
                              width: 72, padding: '6px 8px',
                              border: `1.5px solid ${it.delivery > 0 ? 'var(--ok)' : 'var(--gray-200)'}`,
                              borderRadius: 6, fontSize: 14, fontWeight: 700, textAlign: 'center',
                              background: it.delivery > 0 ? 'var(--ok-pale)' : 'var(--white)',
                              outline: 'none',
                            }}
                          />
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 15, color: total > 0 ? 'var(--gray-800)' : 'var(--gray-300)' }}>
                          {total > 0 ? total.toLocaleString('pt-BR') : '—'}
                        </td>
                      </tr>
                    )
                  }
                }
                return rows
              })()}
            </tbody>
          </table>
        </div>

        {totalGeral > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '2px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Total geral</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--purple)' }}>{totalGeral.toLocaleString('pt-BR')} un</span>
          </div>
        )}
      </div>
    </>
  )
}
