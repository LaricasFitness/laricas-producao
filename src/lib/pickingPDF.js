import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'

// Picking da expedição: um bloco por pedido (vários por folha A4), só com o que a separação precisa:
// número grande, QR Code do pedido (a Expedição lê e marca o pedido para baixa), cliente, envio,
// itens com caixinha para ticar e as observações do pedido.
// O QR guarda o número do pedido no Bling: a leitura na Expedição acha o pedido por ele.

const M = 10                    // margem (mm)
const L = 210 - 2 * M           // largura útil
const ALTURA = 297 - M          // limite de baixo

const fmtData = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ''
const qtd = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Ordem da separação: por envio (todos da J&T juntos etc.) e depois pelo número
export const ordemPicking = (a, b) =>
  (envio(a) || 'zz').localeCompare(envio(b) || 'zz') || Number(a.numero) - Number(b.numero)

const envio = p => [p.transportadora, p.servico].filter(Boolean).join(' · ')

export async function gerarPicking(pedidos) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const qrs = await Promise.all(pedidos.map(p => QRCode.toDataURL(String(p.numero), { margin: 0, width: 240, errorCorrectionLevel: 'M' })))
  let y = M
  pedidos.forEach((p, i) => {
    const itens = p.itens || []
    const obs = [p.obs, p.obsInterna && `Interna: ${p.obsInterna}`].filter(Boolean).join('\n')
    const altura = 40 + Math.max(1, itens.length) * 8 + (obs ? 6 + Math.ceil(obs.length / 110) * 4.5 : 0)
    if (i > 0 && y + altura > ALTURA) { doc.addPage(); y = M }

    // cabeçalho: número e QR
    doc.addImage(qrs[i], 'PNG', M + L - 26, y, 26, 26)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(24)
    doc.text(`#${p.numero}`, M, y + 9)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90)
    doc.text([fmtData(p.data), p.nf ? 'NF emitida' : 'sem NF'].filter(Boolean).join('  ·  '), M + 48, y + 8)
    doc.setTextColor(0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.text(doc.splitTextToSize(p.cliente || '—', L - 32)[0], M, y + 17)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    const linhaEnvio = [envio(p) || 'Sem transportadora', p.cidade].filter(Boolean).join('  ·  ')
    doc.text(doc.splitTextToSize(linhaEnvio, L - 32)[0], M, y + 23)

    // itens
    autoTable(doc, {
      startY: y + 29,
      margin: { left: M, right: M },
      head: [['', 'Qtd', 'Produto', 'Código']],
      body: itens.length ? itens.map(it => ['', qtd(it.quantidade), it.descricao || '', it.codigo || '']) : [['', '', 'Pedido sem itens no Bling', '']],
      theme: 'grid',
      styles: { fontSize: 11, cellPadding: 1.8, lineColor: 180, lineWidth: 0.2, valign: 'middle' },
      headStyles: { fillColor: [235, 235, 235], textColor: 0, fontSize: 8, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 16, halign: 'center', fontStyle: 'bold', fontSize: 14 }, 3: { cellWidth: 38, fontSize: 8, textColor: 90 } },
      didDrawCell: d => {      // caixinha para ticar
        if (d.section === 'body' && d.column.index === 0 && itens.length)
          doc.rect(d.cell.x + 2, d.cell.y + d.cell.height / 2 - 2, 4, 4)
      },
    })
    y = doc.lastAutoTable.finalY + 2

    const totalItens = itens.reduce((s, it) => s + (Number(it.quantidade) || 0), 0)
    doc.setFontSize(9); doc.setTextColor(90)
    doc.text(`${itens.length} produto${itens.length === 1 ? '' : 's'} · ${qtd(totalItens)} unidade${totalItens === 1 ? '' : 's'}`, M + L, y + 3, { align: 'right' })
    doc.setTextColor(0)

    if (obs) {
      doc.setFontSize(9)
      const linhas = doc.splitTextToSize(obs, L - 4)
      doc.setFillColor(255, 247, 214)
      doc.rect(M, y + 5, L, linhas.length * 4 + 3, 'F')
      doc.text(linhas, M + 2, y + 9)
      y += linhas.length * 4 + 5
    }
    y += 8

    // linha de corte entre pedidos
    doc.setLineDashPattern([1.5, 1.5], 0); doc.setDrawColor(150)
    doc.line(M, y - 3, M + L, y - 3)
    doc.setLineDashPattern([], 0); doc.setDrawColor(0)
    y += 2
  })
  const d = new Date()
  doc.save(`Picking_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`)
}
