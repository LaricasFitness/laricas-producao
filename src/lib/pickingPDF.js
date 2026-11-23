import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'

// Picking da expedição: A4 deitada com 2 pedidos lado a lado (cada um numa meia folha em pé, tipo A5,
// com linha de corte no meio), só com o que a separação precisa: número grande, QR Code do pedido
// (a Expedição lê e marca o pedido para baixa), cliente, envio, itens com caixinha para ticar e as
// observações e a data prevista do pedido no Bling. Cada pedido cabe sempre numa meia folha: a fonte
// diminui até caber (ESCALAS); se nem com a mínima couber, continua na metade AO LADO (não embaixo).
// No fim, o resumo da separação: a soma de cada produto em todos os pedidos do PDF.
// O QR guarda o número do pedido no Bling: a leitura na Expedição acha o pedido por ele.

const LARG = 297, ALT = 210     // A4 deitada (mm)
const MEIO = LARG / 2           // linha de corte
const M = 8                     // margem dentro de cada metade
const LINHA = 7                 // altura de uma linha de item

const fmtData = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ''
const qtd = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Ordem da separação: por envio (todos da J&T juntos etc.) e depois pelo número
export const ordemPicking = (a, b) =>
  (envio(a) || 'zz').localeCompare(envio(b) || 'zz') || Number(a.numero) - Number(b.numero)

const envio = p => [p.transportadora, p.servico].filter(Boolean).join(' · ')
const limpo = t => String(t || '').trim()

// Observação interna: em preto e branco precisa saltar aos olhos → faixa preta + borda grossa + negrito
function obsInterna(doc, texto, x, y, w, s) {
  doc.setFillColor(0); doc.rect(x, y, w, 5.5 * s, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9 * s); doc.setTextColor(255)
  doc.text('OBSERVAÇÃO INTERNA', x + 2, y + 3.9 * s)
  doc.setTextColor(0); doc.setFontSize(11 * s)
  const linhas = doc.splitTextToSize(texto, w - 5)
  const h = linhas.length * 4.8 * s + 3 * s
  doc.setLineWidth(0.8); doc.rect(x, y, w, 5.5 * s + h); doc.setLineWidth(0.2)
  doc.text(linhas, x + 2.5, y + 5.5 * s + 4.6 * s)
  doc.setFont('helvetica', 'normal')
  return 5.5 * s + h
}

// Desenha o pedido (ou uma parte dele) na faixa [x, x + w], com a escala de fonte `s`.
// parte: { itens, inicio (tem cabeçalho completo), fim (tem total e obs. do cliente) }. Devolve o y final.
function desenhar(doc, p, qr, x, w, s = 1, parte = { itens: p.itens || [], inicio: true, fim: true }) {
  const todos = p.itens || [], itens = parte.itens
  const y = M
  let topo
  if (parte.inicio) {
    const q = 24 * s
    if (qr) doc.addImage(qr, 'PNG', x + w - q, y, q, q)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22 * s)
    doc.text(`#${p.numero}`, x, y + 8 * s)
    const larguraNum = doc.getTextWidth(`#${p.numero}`) + 4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9 * s); doc.setTextColor(90)
    const datas = [fmtData(p.data), p.dataPrevista ? `prev. ${fmtData(p.dataPrevista)}` : '', p.nf ? 'NF emitida' : 'sem NF'].filter(Boolean).join('  ·  ')
    doc.text(doc.splitTextToSize(datas, Math.max(10, w - q - larguraNum - 2))[0], x + larguraNum, y + 7 * s)
    doc.setTextColor(0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12 * s)
    doc.text(doc.splitTextToSize(p.cliente || '—', w - q - 4)[0], x, y + 15 * s)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * s)
    const local = [p.cidade, p.uf].filter(Boolean).join('/')
    doc.text(doc.splitTextToSize([envio(p) || 'Sem transportadora', local].filter(Boolean).join('  ·  '), w - q - 4)[0], x, y + 21 * s)
    if (p.loja) {
      doc.setFontSize(9 * s); doc.setTextColor(90)
      doc.text(doc.splitTextToSize(`Loja: ${p.loja}`, w - q - 4)[0], x, y + 26 * s)
      doc.setTextColor(0)
    }
    topo = y + 30 * s
    if (limpo(p.obsInterna)) topo += obsInterna(doc, limpo(p.obsInterna), x, topo, w, s) + 3 * s
  } else {
    // continuação: só o número, para não misturar as metades
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14 * s)
    doc.text(`#${p.numero}`, x, y + 6 * s)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9 * s); doc.setTextColor(90)
    doc.text('continuação', x + doc.getTextWidth(`#${p.numero}`) + 6, y + 5.5 * s)
    doc.setTextColor(0)
    topo = y + 10 * s
  }

  autoTable(doc, {
    startY: topo,
    margin: { left: x, right: LARG - x - w, top: M, bottom: M },
    tableWidth: w,
    head: [['', 'Qtd', 'Produto']],
    body: itens.length ? itens.map(it => ['', qtd(it.quantidade), it.descricao || it.codigo || '']) : [['', '', 'Pedido sem itens no Bling']],
    theme: 'grid',
    styles: { fontSize: 10 * s, cellPadding: 1.4 * s, minCellHeight: (LINHA - 0.5) * s, lineColor: 180, lineWidth: 0.2, valign: 'middle' },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontSize: 7.5 * s, fontStyle: 'bold', minCellHeight: 5 * s },
    columnStyles: { 0: { cellWidth: 7 * s }, 1: { cellWidth: 13 * s, halign: 'center', fontStyle: 'bold', fontSize: 13 * s } },
    didDrawCell: d => {      // caixinha para ticar
      if (d.section === 'body' && d.column.index === 0 && itens.length)
        doc.rect(d.cell.x + 1.5 * s, d.cell.y + d.cell.height / 2 - 2 * s, 4 * s, 4 * s)
    },
  })
  let f = doc.lastAutoTable.finalY + 1
  if (!parte.fim) {
    doc.setFontSize(8.5 * s); doc.setTextColor(90)
    doc.text('continua ao lado →', x + w, f + 3 * s, { align: 'right' })
    doc.setTextColor(0)
    return f + 4 * s
  }

  const total = todos.reduce((t, it) => t + (Number(it.quantidade) || 0), 0)
  doc.setFontSize(8.5 * s); doc.setTextColor(90)
  doc.text(`${todos.length} produto${todos.length === 1 ? '' : 's'} · ${qtd(total)} unidade${total === 1 ? '' : 's'}`, x + w, f + 3 * s, { align: 'right' })
  doc.setTextColor(0)
  f += 4 * s

  // Observação do cliente (ex.: mensagem de presente): caixa com borda fina
  const obs = limpo(p.obs)
  if (obs) {
    doc.setFontSize(9.5 * s)
    const linhas = doc.splitTextToSize(obs, w - 4)
    const h = linhas.length * 4.2 * s + 8 * s
    doc.setLineWidth(0.3); doc.rect(x, f + 1, w, h); doc.setLineWidth(0.2)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8 * s)
    doc.text('Obs. do cliente', x + 2, f + 1 + 3.8 * s)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5 * s)
    doc.text(linhas, x + 2, f + 1 + 8 * s)
    f += 1 + h
  }
  return f
}

// Cabe numa meia folha? Desenha numa folha de rascunho (sem o QR) e confere a altura e se a tabela
// não pulou de página
function cabe(p, w, s, parte) {
  const rascunho = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const fim = desenhar(rascunho, p, null, M, w, s, parte)
  return rascunho.getNumberOfPages() === 1 && fim <= ALT - M
}

// Fonte do tamanho normal até o mínimo legível: usa a maior em que o pedido cabe inteiro na meia folha
const ESCALAS = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6]

// Divide o pedido em partes que cabem cada uma numa meia folha (na escala mínima), em ordem:
// a primeira com o cabeçalho, as seguintes como "continuação" na metade ao lado
function dividir(p, w) {
  const s = ESCALAS[ESCALAS.length - 1]
  const itens = p.itens || [], partes = []
  let i = 0
  while (i < itens.length) {
    const inicio = i === 0
    let k = itens.length - i
    // maior número de itens que cabe nesta metade (fechando o pedido se forem os últimos)
    while (k > 1 && !cabe(p, w, s, { itens: itens.slice(i, i + k), inicio, fim: i + k === itens.length })) k--
    partes.push({ itens: itens.slice(i, i + k), inicio, fim: i + k === itens.length })
    i += k
  }
  return { s, partes: partes.length ? partes : [{ itens: [], inicio: true, fim: true }] }
}

// Resumo da separação: soma de cada produto em todos os pedidos
function somarItens(pedidos) {
  const soma = new Map()
  for (const p of pedidos) for (const it of p.itens || []) {
    const chave = it.codigo || it.descricao
    const atual = soma.get(chave) || { descricao: it.descricao || it.codigo, quantidade: 0, pedidos: new Set() }
    atual.quantidade += Number(it.quantidade) || 0
    atual.pedidos.add(p.id ?? p.numero)
    soma.set(chave, atual)
  }
  return [...soma.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

function desenharResumo(doc, pedidos, x, w) {
  const linhas = somarItens(pedidos)
  const total = linhas.reduce((s, l) => s + l.quantidade, 0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('Resumo da separação', x, M + 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90)
  doc.text(`${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} · ${linhas.length} produto${linhas.length === 1 ? '' : 's'} · ${qtd(total)} unidade${total === 1 ? '' : 's'}`, x, M + 15)
  doc.setTextColor(0)
  autoTable(doc, {
    startY: M + 20,
    margin: { left: x, right: LARG - x - w, top: M, bottom: M },
    tableWidth: w,
    head: [['', 'Qtd', 'Produto', 'Pedidos']],
    body: linhas.map(l => ['', qtd(l.quantidade), l.descricao, String(l.pedidos.size)]),
    foot: [['', qtd(total), 'Total', String(pedidos.length)]],
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 1.4, minCellHeight: LINHA - 0.5, lineColor: 180, lineWidth: 0.2, valign: 'middle' },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontSize: 7.5, fontStyle: 'bold', minCellHeight: 5 },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 15, halign: 'center', fontStyle: 'bold', fontSize: 13 }, 3: { cellWidth: 16, halign: 'center', textColor: 90 } },
    didDrawCell: d => {
      if (d.section === 'body' && d.column.index === 0)
        doc.rect(d.cell.x + 1.5, d.cell.y + d.cell.height / 2 - 2, 4, 4)
    },
  })
}

function linhaDeCorte(doc) {
  doc.setLineDashPattern([1.5, 1.5], 0); doc.setDrawColor(150)
  doc.line(MEIO, 4, MEIO, ALT - 4)
  doc.setLineDashPattern([], 0); doc.setDrawColor(0)
}

export async function gerarPicking(pedidos, nomeArquivo) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const qrs = await Promise.all(pedidos.map(p => QRCode.toDataURL(String(p.numero), { margin: 0, width: 240, errorCorrectionLevel: 'M' })))
  let metade = 0          // 0 = folha vazia, 1 = metade da esquerda usada, 2 = folha cheia
  let primeira = true
  const novaFolha = () => { if (!primeira) doc.addPage(); primeira = false; metade = 0 }

  const W = MEIO - 2 * M
  // próxima meia folha livre: esquerda (com a linha de corte) ou direita
  const proximaMetade = () => {
    if (primeira || metade === 2) novaFolha()
    if (metade === 0) linhaDeCorte(doc)
    return metade++ === 0 ? M : MEIO + M
  }

  pedidos.forEach((p, i) => {
    // cada pedido numa meia folha: a fonte diminui até caber
    const s = ESCALAS.find(e => cabe(p, W, e))
    if (s) { desenhar(doc, p, qrs[i], proximaMetade(), W, s); return }
    // nem com a fonte mínima: começa na metade da esquerda e continua na da direita (não embaixo)
    const d = dividir(p, W)
    if (metade === 1) novaFolha()
    for (const parte of d.partes) desenhar(doc, p, qrs[i], proximaMetade(), W, d.s, parte)
  })

  // resumo no fim: na metade livre da última folha, se couber; senão numa folha nova
  const alturaResumo = 30 + (somarItens(pedidos).length + 1) * LINHA
  if (alturaResumo > ALT - 2 * M) { novaFolha(); desenharResumo(doc, pedidos, M, LARG - 2 * M) }
  else if (metade === 1) desenharResumo(doc, pedidos, MEIO + M, MEIO - 2 * M)
  else { novaFolha(); desenharResumo(doc, pedidos, M, MEIO - 2 * M); linhaDeCorte(doc) }

  const d = new Date()
  doc.save(nomeArquivo || `Picking_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`)
}
