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
    // Tenta pegar coluna de nome/descrição (cols[1] geralmente é o nome no Bling)
    for (const cols of rows.slice(1)) {
      if (cols.length < 6) continue
      const sku = cols[0], qtd = parseFloat(cols[3].replace(',', '.')) || 0
      const dataIso = parsearDataBr(cols[5])
      const nome = cols[1]?.trim() || ''
      if (!sku || qtd <= 0 || !dataIso) continue
      resultado.push({ sku, qtd: Math.round(qtd), data: dataIso, nome })
    }
  } else {
    const idxSku = header.indexOf('SKU'), idxQtd = header.indexOf('Quantidade'), idxData = header.indexOf('Data Prevista')
    // Tenta achar coluna de nome do produto
    const idxNome = header.indexOf('Produto') >= 0 ? header.indexOf('Produto')
      : header.indexOf('Descrição') >= 0 ? header.indexOf('Descrição')
      : header.indexOf('Nome') >= 0 ? header.indexOf('Nome') : -1
    if (idxSku < 0 || idxQtd < 0 || idxData < 0) return []
    for (const cols of rows.slice(1)) {
      if (cols.length <= idxData) continue
      const sku = cols[idxSku], qtd = parseFloat((cols[idxQtd] || '0').replace(',', '.')) || 0
      const dataIso = parsearDataBr(cols[idxData])
      const nome = idxNome >= 0 ? (cols[idxNome]?.trim() || '') : ''
      if (!sku || qtd <= 0 || !dataIso) continue
      resultado.push({ sku, qtd: Math.round(qtd), data: dataIso, nome })
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
function gerarPDFProducao(dataProducao, itensDia, totalGeral, observacao='') {
  const doc = new jsPDF()
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const PAGE_H = 297 // A4 altura mm
  const MARGIN = 14

  // Header compacto
  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 210, 14, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(9); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', MARGIN, 9)
  doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text(`Gerado: ${agora}`, 130, 9)

  // Título "Produção do dia — Data"
  doc.setTextColor(82, 46, 100); doc.setFontSize(16); doc.setFont(undefined, 'bold')
  doc.text(`Produção do dia — ${headerDia(dataProducao)}`, MARGIN, 26)

  // Observação
  let startY = 33
  if (observacao.trim()) {
    doc.setFontSize(8); doc.setFont(undefined, 'italic'); doc.setTextColor(120, 80, 150)
    doc.text(`Obs: ${observacao}`, MARGIN, startY)
    startY += 6
  }

  // Monta body
  const body = []
  for (const cat of ORDEM_CATS) {
    const itens = (itensDia[cat] || []).filter(i => i.total > 0)
    if (!itens.length) continue
    const totalCat = itens.reduce((s, i) => s + i.total, 0)
    body.push([{ content: `${cat}  —  ${totalCat.toLocaleString('pt-BR')} un`, colSpan: 2,
      styles: { fillColor: [103,63,124], textColor: [255,255,255], fontStyle: 'bold', cellPadding: 2.5 } }])
    for (const i of itens) {
      body.push([i.nome, { content: i.total.toLocaleString('pt-BR'), styles: { halign: 'center', fontStyle: 'bold' } }])
    }
  }

  // Rodapé — reserva 12mm no fundo
  const FOOTER_H = 12
  const availableH = PAGE_H - startY - FOOTER_H - MARGIN

  // Calcula fontSize ideal para caber tudo
  // Estimativa: cada linha ocupa ~(fontSize * 0.45) mm com cellPadding 2
  const totalRows = body.length
  const estimatedRowH = (fs) => fs * 0.45 + 4 // cellPadding
  let fontSize = 9
  while (fontSize > 5.5) {
    const estH = totalRows * estimatedRowH(fontSize)
    if (estH <= availableH) break
    fontSize -= 0.5
  }
  const cellPad = fontSize < 7 ? 1.5 : 2

  autoTable(doc, {
    startY, body,
    styles: { fontSize, cellPadding: cellPad },
    alternateRowStyles: { fillColor: [248, 245, 252] },
    columnStyles: { 1: { cellWidth: 22, halign: 'center' } },
    margin: { left: MARGIN, right: MARGIN },
    // Se ainda sobrar muito, distribui o espaço verticalmente
    didDrawPage: () => {},
  })

  const finalY = doc.lastAutoTable.finalY + 4
  // Total geral
  doc.setFont(undefined,'bold'); doc.setFontSize(11); doc.setTextColor(82,46,100)
  doc.text(`Total geral: ${totalGeral.toLocaleString('pt-BR')} unidades`, MARGIN, Math.min(finalY, PAGE_H - 10))

  // Rodapé
  doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(180,180,180)
  doc.text('Laricas Fitness — Planejamento de Produção', MARGIN, PAGE_H - 5)
  doc.save(`Producao_${dataProducao}.pdf`)
}

// ── PDF Produção Completa ─────────────────────────────────────────────────────
function gerarPDFCompleto(diasVisiveis, diasBling, diasDelivery, embalagens, diaAtual, itensExtras=[]) {
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

  // Categorias com dados (CSV ou extras)
  const catsComDados = ORDEM_CATS.filter(cat => {
    const temCSV = embalagens.some(e => e.categoria === cat &&
      diasVisiveis.some(d => (diasBling[d]?.[e.codigo] || 0) + (diasDelivery[d]?.[e.codigo] || 0) > 0))
    const temExtra = itensExtras.some(x => x.cat === cat && x.qtd > 0 && diasVisiveis.includes(x.data))
    return temCSV || temExtra
  })
  // Extras em categorias não reconhecidas
  const catsExtras = [...new Set(itensExtras
    .filter(x => !ORDEM_CATS.includes(x.cat) && x.qtd > 0 && diasVisiveis.includes(x.data))
    .map(x => x.cat))]
  const todasCats = [...catsComDados, ...catsExtras]

  let startY = 46
  for (const cat of todasCats) {
    const itensCSV = embalagens.filter(e => e.categoria === cat &&
      diasVisiveis.some(d => (diasBling[d]?.[e.codigo] || 0) + (diasDelivery[d]?.[e.codigo] || 0) > 0))
    const extrasNaCat = itensExtras.filter(x => x.cat === cat && x.qtd > 0 && diasVisiveis.includes(x.data))

    if (!itensCSV.length && !extrasNaCat.length) continue

    autoTable(doc, {
      startY,
      head: [[{ content: cat, colSpan: colHead.length }]],
      body: [],
      headStyles: { fillColor: [103,63,124], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      margin: { left: 14, right: 14 },
    })

    const body = []

    // Itens do CSV
    for (const e of itensCSV) {
      const b = diasBling[diaAtual]?.[e.codigo] || 0
      const del = diasDelivery[diaAtual]?.[e.codigo] || 0
      const tot = b + del
      const row = [e.nome, b > 0 ? b : '—', del > 0 ? del : '—', tot > 0 ? tot : '—']
      diasResto.forEach(d => { const bR = diasBling[d]?.[e.codigo] || 0; row.push(bR > 0 ? bR : '—') })
      body.push(row)
    }

    // Itens extras — aparecem na coluna da sua data
    for (const x of extrasNaCat) {
      const row = [`${x.nome} ✦`, '—', '—', '—']
      // Para diaAtual
      if (x.data === diaAtual) { row[1] = '—'; row[2] = String(x.qtd); row[3] = String(x.qtd) }
      // Para diasResto
      diasResto.forEach(d => { row.push(x.data === d ? String(x.qtd) : '—') })
      body.push(row)
    }

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
    if (startY > 175 && todasCats.indexOf(cat) < todasCats.length - 1) { doc.addPage(); startY = 14 }
  }

  doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(150,150,150)
  doc.text('Laricas Fitness — Planejamento de Produção Completo', 14, 198)
  doc.save('Producao_Completa_semana.pdf')
}

// ── Componente principal ──────────────────────────────────────────────────────
function ModalCadastrarProduto({ sugestao, onClose, onSalvo }) {
  const [form, setForm] = useState({
    nome: sugestao.nome || '',
    codigo: sugestao.sku || '',
    categoria: sugestao.cat || ORDEM_CATS[0],
    tipo: 'rotulo',
    visivel_producao: true,
    visivel_estoque: true,
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const [saving, setSaving] = useState(false)

  async function salvar() {
    if (!form.nome.trim() || !form.codigo.trim()) return
    setSaving(true)
    try {
      const { data: emb, error } = await supabase.from('embalagens').insert({
        nome: form.nome.trim(),
        codigo: form.codigo.trim().toUpperCase(),
        categoria: form.categoria,
        tipo: form.tipo,
        visivel_producao: form.visivel_producao,
        visivel_estoque: form.visivel_estoque,
        estoque_atual: 0,
        estoque_minimo: 0,
        ativo: true,
      }).select().single()
      if (error) throw error
      onSalvo(sugestao, emb)
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div className="modal-title">Cadastrar produto no sistema</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ padding: '8px 12px', background: 'var(--purple-pale)', borderRadius: 6, fontSize: 12, marginBottom: 14 }}>
            SKU original: <strong style={{ fontFamily: 'monospace' }}>{sugestao.sku}</strong>
            <br/>Após cadastrar, o sistema vai reconhecer esse SKU automaticamente nas próximas importações.
          </div>
          <div className="form-group">
            <label className="form-label">Nome do produto *</label>
            <input className="form-input" value={form.nome} onChange={e => set('nome', e.target.value)} autoFocus />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Código / SKU *</label>
              <input className="form-input" value={form.codigo} onChange={e => set('codigo', e.target.value.toUpperCase())} />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select className="form-input" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="rotulo">🏷️ Rótulo</option>
                <option value="embalagem">📦 Embalagem</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Categoria</label>
            <select className="form-input" value={form.categoria} onChange={e => set('categoria', e.target.value)}>
              {ORDEM_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.visivel_producao} onChange={e => set('visivel_producao', e.target.checked)} style={{ accentColor: 'var(--purple)' }} />
              Aparece no planejamento
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.visivel_estoque} onChange={e => set('visivel_estoque', e.target.checked)} style={{ accentColor: 'var(--purple)' }} />
              Aparece no estoque
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving || !form.nome.trim() || !form.codigo.trim()} onClick={salvar}>
            {saving ? <RefreshCw size={14} className="spin" /> : '✓ Cadastrar produto'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Planejamento({ onIrLogistica }) {
  const [embalagens, setEmbalagens] = useState([])
  const [loading, setLoading] = useState(true)
  const [importando, setImportando] = useState(false)
  const [diasBling, setDiasBling] = useState({})
  const [pedidosPorDia, setPedidosPorDia] = useState({})
  const [diasDelivery, setDiasDelivery] = useState({})
  const [diasOrdenados, setDiasOrdenados] = useState([])
  const [datasAtivas, setDatasAtivas] = useState([])
  const [csvRaw, setCsvRaw] = useState(null)
  const [observacao, setObservacao] = useState('')
  const [itensExtras, setItensExtras] = useState([]) // [{id, nome, cat, qtd, data}]
  const [novoExtra, setNovoExtra] = useState({ nome: '', cat: ORDEM_CATS[0], qtd: '', data: '' })
  const [sugestoes, setSugestoes] = useState([])
  const [sugestoesCadastrando, setSugestoeCadastrando] = useState(null) // [{id, sku, nome, qtd, data, cat, confirmado}]
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
      for (const { sku, qtd, data } of parsed) {
        if (!novosBling[data]) novosBling[data] = {}
        novosBling[data][sku] = (novosBling[data][sku] || 0) + qtd
      }

      // Conta pedidos distintos por data usando o parser robusto
      const countsPorDia = {}
      const rows = parseCSVRobusto(texto)
      if (rows.length > 1) {
        const header = rows[0].map(h => h.replace(/^"|"$/g,'').trim())
        const idxPed  = header.indexOf('Número pedido')
        const idxData = header.indexOf('Data Prevista')
        if (idxPed >= 0 && idxData >= 0) {
          const pedsPorDia = {} // { data: Set<numPedido> }
          for (const cols of rows.slice(1)) {
            const numPed = cols[idxPed]?.trim()
            const dataBr = cols[idxData]?.trim()
            if (!numPed || !dataBr) continue
            const dataIso = parsearDataBr(dataBr)
            if (!dataIso) continue
            if (!pedsPorDia[dataIso]) pedsPorDia[dataIso] = new Set()
            pedsPorDia[dataIso].add(numPed)
          }
          for (const [d, set] of Object.entries(pedsPorDia)) countsPorDia[d] = set.size
        }
      }

      const datas = Object.keys(novosBling).sort()
      setDiasBling(novosBling)
      setPedidosPorDia(countsPorDia)
      setDiasOrdenados(datas)
      setDatasAtivas([])
      setDiasDelivery({})

      // Detecta SKUs não cadastrados — sugere como itens extras
      const skusCadastrados = new Set(embalagens.map(e => e.codigo))
      const novaSugestoes = []
      // Agrupa por SKU: soma qtd por data, guarda nome do produto
      const skuMap = {} // { sku: { data: { qtd, nome } } }
      for (const { sku, qtd, data, nome } of parsed) {
        if (skusCadastrados.has(sku)) continue
        if (!skuMap[sku]) skuMap[sku] = {}
        if (!skuMap[sku][data]) skuMap[sku][data] = { qtd: 0, nome: nome || '' }
        skuMap[sku][data].qtd += qtd
        if (nome && nome !== sku) skuMap[sku][data].nome = nome
      }
      for (const [sku, porData] of Object.entries(skuMap)) {
        for (const [data, { qtd, nome }] of Object.entries(porData)) {
          // Usa o nome do produto se disponível, senão o SKU
          const nomeExibir = (nome && nome.trim() && nome !== sku) ? nome.trim() : sku
          novaSugestoes.push({
            id: `${sku}-${data}-${Date.now()}-${Math.random()}`,
            sku,
            nome: nomeExibir,
            qtd,
            data,
            cat: ORDEM_CATS[0],
            confirmado: false,
          })
        }
      }
      setSugestoes(novaSugestoes)
      setImportando(false)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function toggleData(d) {
    setDatasAtivas(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  function limpar() {
    setDiasBling({}); setDiasDelivery({}); setDiasOrdenados([]); setDatasAtivas([]); setPedidosPorDia({})
    setSugestoes([]); setItensExtras([])
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

  function adicionarExtra() {
    if (!novoExtra.nome.trim() || !novoExtra.qtd) return
    const dataExtra = novoExtra.data || diaAtual
    setItensExtras(prev => [...prev, {
      id: Date.now(),
      nome: novoExtra.nome.trim(),
      cat: novoExtra.cat,
      qtd: parseInt(novoExtra.qtd) || 0,
      data: dataExtra,
    }])
    setNovoExtra(p => ({ ...p, nome: '', qtd: '', data: '' }))
  }

  async function exportarPDFProducao() {
    gerarPDFProducao(diaAtual, itensDiaAtual, totalDiaAtual, observacao)
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

  // Monta dados do dia atual (CSV + extras manuais)
  const itensDiaAtual = {}
  if (diaAtual) {
    for (const cat of ORDEM_CATS) {
      const itens = embalagens.filter(e => e.categoria === cat).map(e => ({
        nome: e.nome, sku: e.codigo,
        bling: diasBling[diaAtual]?.[e.codigo] || 0,
        delivery: diasDelivery[diaAtual]?.[e.codigo] || 0,
        total: (diasBling[diaAtual]?.[e.codigo] || 0) + (diasDelivery[diaAtual]?.[e.codigo] || 0),
      })).filter(i => i.total > 0)
      // Adiciona extras manuais na categoria correta — filtra pela data selecionada
      const extras = itensExtras.filter(x => x.cat === cat && x.qtd > 0 && x.data === diaAtual)
        .map(x => ({ nome: x.nome, sku: null, bling: 0, delivery: 0, total: x.qtd, extra: true, extraId: x.id }))
      const todos = [...itens, ...extras]
      if (todos.length) itensDiaAtual[cat] = todos
    }
    // Extras sem categoria reconhecida vão para "Outros"
    const semCat = itensExtras.filter(x => !ORDEM_CATS.includes(x.cat) && x.qtd > 0 && x.data === diaAtual)
    if (semCat.length) {
      itensDiaAtual['Outros'] = semCat.map(x => ({ nome: x.nome, sku: null, bling: 0, delivery: 0, total: x.qtd, extra: true, extraId: x.id }))
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
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {/* Campo de observação */}
              {diaAtual && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ marginBottom: 3 }}>Observação (aparece no PDF)</label>
                  <input className="form-input" value={observacao} onChange={e => setObservacao(e.target.value)}
                    placeholder="Ex: Produção reduzida, faltou Whey..."
                    style={{ width: 280, fontSize: 12 }} />
                </div>
              )}
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
                <button className="btn btn-primary" onClick={() => gerarPDFCompleto(diasVisiveis, diasBling, diasDelivery, embalagens, diaAtual, itensExtras)}>
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

      {/* Sugestões de SKUs não cadastrados */}
      {sugestoes.length > 0 && (
        <div className="card card-pad" style={{ border: '2px solid var(--gold)', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--gold)' }}>
                ⚠️ {sugestoes.filter(s=>!s.confirmado&&!s.cadastrado).length} produto(s) não cadastrado(s) encontrado(s) no CSV
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
                <strong>Cadastrar</strong> → entra no sistema permanentemente e aparece na produção normalmente ·
                <strong> Confirmar</strong> → adiciona só para hoje como item extra
              </div>
            </div>
            {sugestoes.every(s=>s.confirmado||s.cadastrado) && (
              <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 700 }}>✓ Todos resolvidos</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sugestoes.map(s => (
              <div key={s.id} style={{
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                padding: '10px 12px', borderRadius: 8,
                background: s.cadastrado ? '#f0fdf4' : s.confirmado ? '#fffbf0' : 'var(--white)',
                border: `1px solid ${s.cadastrado ? 'var(--ok)' : s.confirmado ? 'var(--gold)' : 'var(--gray-200)'}`,
                opacity: (s.confirmado || s.cadastrado) ? 0.75 : 1,
              }}>
                <span style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'monospace', flexShrink: 0 }}>
                  SKU: {s.sku}
                </span>
                <input className="form-input" value={s.nome}
                  disabled={s.confirmado || s.cadastrado}
                  onChange={e => setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, nome:e.target.value} : x))}
                  placeholder="Nome do produto" style={{ flex: 1, minWidth: 160, fontSize: 13 }} />
                <select className="form-input" value={s.cat}
                  disabled={s.confirmado || s.cadastrado}
                  onChange={e => setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, cat:e.target.value} : x))}
                  style={{ width: 160, fontSize: 13 }}>
                  {ORDEM_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" className="form-input" value={s.qtd} min={1}
                  disabled={s.confirmado || s.cadastrado}
                  onChange={e => setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, qtd:parseInt(e.target.value)||0} : x))}
                  style={{ width: 72, fontSize: 13 }} />
                <select className="form-input" value={s.data}
                  disabled={s.confirmado || s.cadastrado}
                  onChange={e => setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, data:e.target.value} : x))}
                  style={{ width: 120, fontSize: 13 }}>
                  {diasOrdenados.map(d => <option key={d} value={d}>{headerDia(d)}</option>)}
                </select>

                {s.cadastrado ? (
                  <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 700, flexShrink: 0 }}>✓ Cadastrado</span>
                ) : s.confirmado ? (
                  <button className="btn btn-ghost btn-sm" style={{ color:'var(--gray-400)', flexShrink:0 }}
                    onClick={() => {
                      setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, confirmado:false} : x))
                      setItensExtras(prev => prev.filter(x => x.id !== s.id))
                    }}>↩ Desfazer</button>
                ) : (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {/* Cadastrar permanentemente */}
                    <button className="btn btn-sm btn-primary" style={{ fontSize: 12, padding: '5px 10px' }}
                      onClick={() => setSugestoeCadastrando(s)}>
                      + Cadastrar
                    </button>
                    {/* Só para hoje */}
                    <button className="btn btn-sm" style={{ background:'var(--gold)', color:'#fff', border:'none', fontSize: 12, padding: '5px 10px' }}
                      onClick={() => {
                        setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, confirmado:true} : x))
                        setItensExtras(prev => [...prev, { id: s.id, nome: s.nome, cat: s.cat, qtd: s.qtd, data: s.data }])
                      }}>
                      Só hoje
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ color:'var(--danger)' }}
                      onClick={() => setSugestoes(prev => prev.filter(x => x.id !== s.id))}>✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal cadastro rápido de produto */}
      {sugestoesCadastrando && (
        <ModalCadastrarProduto
          sugestao={sugestoesCadastrando}
          onClose={() => setSugestoeCadastrando(null)}
          onSalvo={(s, embalagem) => {
            // Marca como cadastrado e adiciona ao embalagens local para reconhecimento imediato
            setSugestoes(prev => prev.map(x => x.id===s.id ? {...x, cadastrado:true} : x))
            setEmbalagens(prev => [...prev, embalagem])
            setSugestoeCadastrando(null)
          }}
        />
      )}

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
                      if (e.extra) {
                        // Item extra manual
                        return (
                          <tr key={`extra-${e.extraId}`} style={{ background: '#fffbf0' }}>
                            <td style={{ padding: '9px 14px', fontWeight: 600, borderBottom: '1px solid var(--gray-100)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, background: 'var(--gold)', color: '#fff', padding: '1px 5px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>EXTRA</span>
                              {e.nome}
                              {(() => { const x = itensExtras.find(ix=>ix.id===e.extraId); return x?.data && x.data !== diaAtual ? <span style={{fontSize:10,color:'var(--gray-400)',marginLeft:4}}>({headerDia(x.data)})</span> : null })()}
                            </div>
                          </td>
                            {diaAtual && (
                              <>
                                <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', color: 'var(--gray-300)', background: 'var(--purple-ghost)' }}>—</td>
                                <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', background: 'var(--purple-ghost)' }}>
                                  <input type="number" min={0} value={e.total || ''}
                                    onChange={ev => setItensExtras(prev => prev.map(x => x.id === e.extraId ? { ...x, qtd: parseInt(ev.target.value) || 0 } : x))}
                                    style={{ width: 60, padding: '5px 6px', border: '1.5px solid var(--gold)', borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#fffbf0', outline: 'none' }} />
                                </td>
                                <td style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', fontWeight: 800, fontSize: 15, color: 'var(--gray-800)', background: 'var(--purple-ghost)' }}>
                                  {e.total > 0 ? e.total : '—'}
                                </td>
                              </>
                            )}
                            {diasResto.map(d => (
                              <td key={d} style={{ textAlign: 'center', padding: '9px 10px', borderBottom: '1px solid var(--gray-100)', color: 'var(--gray-800)', fontWeight: itensExtras.find(x=>x.id===e.extraId)?.data===d?700:300 }}>
                                {itensExtras.find(x=>x.id===e.extraId)?.data===d ? e.total : '—'}
                              </td>
                            ))}
                            <td style={{ padding: '0 6px' }}>
                              <button onClick={() => setItensExtras(prev => prev.filter(x => x.id !== e.extraId))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14, padding: 2 }}>✕</button>
                            </td>
                          </tr>
                        )
                      }
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

          {/* Adicionar item extra */}
          {diaAtual && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-100)', background: '#fffbf0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', flexShrink: 0 }}>+ Item extra:</span>
              <input className="form-input" placeholder="Nome do produto"
                value={novoExtra.nome} onChange={e => setNovoExtra(p => ({ ...p, nome: e.target.value }))}
                style={{ flex: 1, minWidth: 160, fontSize: 13 }} />
              <select className="form-input" value={novoExtra.cat}
                onChange={e => setNovoExtra(p => ({ ...p, cat: e.target.value }))}
                style={{ width: 170, fontSize: 13 }}>
                {ORDEM_CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" className="form-input" placeholder="Qtd" min={1}
                value={novoExtra.qtd} onChange={e => setNovoExtra(p => ({ ...p, qtd: e.target.value }))}
                style={{ width: 72, fontSize: 13 }}
                onKeyDown={e => { if (e.key === 'Enter') adicionarExtra() }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--gray-500)', flexShrink: 0 }}>Data:</span>
                <select className="form-input" value={novoExtra.data || diaAtual}
                  onChange={e => setNovoExtra(p => ({ ...p, data: e.target.value }))}
                  style={{ width: 120, fontSize: 13 }}>
                  {diasVisiveis.map(d => (
                    <option key={d} value={d}>{headerDia(d)}{d === diaAtual ? ' (hoje)' : ''}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-gold" onClick={adicionarExtra}
                disabled={!novoExtra.nome.trim() || !novoExtra.qtd}>
                + Adicionar
              </button>
            </div>
          )}

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
