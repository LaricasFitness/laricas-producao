import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'

// Picking da expedição: A4 deitada com 2 pedidos lado a lado (cada um numa meia folha em pé, tipo A5,
// com linha de corte no meio), só com o que a separação precisa: número grande, QR Code do pedido
// (a Expedição lê e marca o pedido para baixa), cliente, envio, itens com caixinha para ticar e as
// observações. Pedido com itens demais para meia folha ocupa a folha inteira (ou mais).
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
const observacoes = p => [p.obs, p.obsInterna && `Interna: ${p.obsInterna}`].filter(Boolean).join('\n')

// Altura que o pedido ocupa numa meia folha (estimativa folgada)
const alturaPedido = p => 36 + Math.max(1, (p.itens || []).length) * LINHA + 8 +
  (observacoes(p) ? 4 + Math.ceil(observacoes(p).length / 70) * 4.2 : 0)

// Desenha o pedido na faixa [x, x + w]
function desenhar(doc, p, qr, x, w) {
  const itens = p.itens || []
  const y = M
  doc.addImage(qr, 'PNG', x + w - 24, y, 24, 24)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22)
  doc.text(`#${p.numero}`, x, y + 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90)
  doc.text([fmtData(p.data), p.nf ? 'NF emitida' : 'sem NF'].join('  ·  '), x + 44, y + 7)
  doc.setTextColor(0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(doc.splitTextToSize(p.cliente || '—', w - 28)[0], x, y + 15)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(doc.splitTextToSize([envio(p) || 'Sem transportadora', p.cidade].filter(Boolean).join('  ·  '), w - 28)[0], x, y + 21)

  autoTable(doc, {
    startY: y + 27,
    margin: { left: x, right: LARG - x - w, top: M, bottom: M },
    tableWidth: w,
    head: [['', 'Qtd', 'Produto', 'Código']],
    body: itens.length ? itens.map(it => ['', qtd(it.quantidade), it.descricao || '', it.codigo || '']) : [['', '', 'Pedido sem itens no Bling', '']],
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 1.4, minCellHeight: LINHA - 0.5, lineColor: 180, lineWidth: 0.2, valign: 'middle' },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontSize: 7.5, fontStyle: 'bold', minCellHeight: 5 },
    columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 13, halign: 'center', fontStyle: 'bold', fontSize: 13 }, 3: { cellWidth: 30, fontSize: 6.5, textColor: 90 } },
    didDrawCell: d => {      // caixinha para ticar
      if (d.section === 'body' && d.column.index === 0 && itens.length)
        doc.rect(d.cell.x + 1.5, d.cell.y + d.cell.height / 2 - 2, 4, 4)
    },
  })
  const f = doc.lastAutoTable.finalY + 1

  const total = itens.reduce((s, it) => s + (Number(it.quantidade) || 0), 0)
  doc.setFontSize(8.5); doc.setTextColor(90)
  doc.text(`${itens.length} produto${itens.length === 1 ? '' : 's'} · ${qtd(total)} unidade${total === 1 ? '' : 's'}`, x + w, f + 3, { align: 'right' })
  doc.setTextColor(0)

  const obs = observacoes(p)
  if (obs) {
    doc.setFontSize(9)
    const linhas = doc.splitTextToSize(obs, w - 4)
    doc.setFillColor(255, 247, 214)
    doc.rect(x, f + 5, w, linhas.length * 4 + 3, 'F')
    doc.text(linhas, x + 2, f + 9)
  }
}

function linhaDeCorte(doc) {
  doc.setLineDashPattern([1.5, 1.5], 0); doc.setDrawColor(150)
  doc.line(MEIO, 4, MEIO, ALT - 4)
  doc.setLineDashPattern([], 0); doc.setDrawColor(0)
}

export async function gerarPicking(pedidos) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const qrs = await Promise.all(pedidos.map(p => QRCode.toDataURL(String(p.numero), { margin: 0, width: 240, errorCorrectionLevel: 'M' })))
  let metade = 0          // 0 = folha vazia, 1 = metade da esquerda usada, 2 = folha cheia
  let primeira = true
  const novaFolha = () => { if (!primeira) doc.addPage(); primeira = false; metade = 0 }

  pedidos.forEach((p, i) => {
    if (alturaPedido(p) > ALT - 2 * M) {
      // não cabe em meia folha: folha inteira só para ele (a tabela continua na próxima, se precisar)
      novaFolha()
      desenhar(doc, p, qrs[i], M, LARG - 2 * M)
      metade = 2
      return
    }
    if (primeira || metade === 2) novaFolha()
    if (metade === 0) { desenhar(doc, p, qrs[i], M, MEIO - 2 * M); linhaDeCorte(doc); metade = 1 }
    else { desenhar(doc, p, qrs[i], MEIO + M, MEIO - 2 * M); metade = 2 }
  })

  const d = new Date()
  doc.save(`Picking_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`)
}
