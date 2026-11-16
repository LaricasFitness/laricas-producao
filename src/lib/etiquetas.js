import jsPDF from 'jspdf'

// Etiqueta de validade das preparações: 60×60 mm na Zebra ZD220 (mesmo formato da Suflex).
// Impressão pelo PDF: cada etiqueta é uma página de 60×60 mm. Na impressora, o papel precisa estar
// configurado em 60×60 mm (preferências da Zebra) quando o rolo das etiquetas de validade estiver nela.

export const CONSERVACOES = {
  ambiente:    { nome: 'Ambiente',    faixa: '',                     campo: 'validade_ambiente_dias' },
  refrigerado: { nome: 'Refrigerado', faixa: 'até 5 °C',             campo: 'validade_refrigerado_dias' },
  congelado:   { nome: 'Congelado',   faixa: '-18 °C ou menos',       campo: 'validade_congelado_dias' },
}

// "REFRIGERADO · até 5 °C"
export const faixaConservacao = k => [CONSERVACOES[k].nome.toUpperCase(), CONSERVACOES[k].faixa].filter(Boolean).join(" · ")

export const calcularValidade = (manipulado, dias) => new Date(new Date(manipulado).getTime() + Number(dias) * 86400000)

const DIA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const dois = n => String(n).padStart(2, '0')
export const fmtDataHora = d => { d = new Date(d); return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${dois(d.getHours())}:${dois(d.getMinutes())}` }
export const fmtValidade = d => `${DIA[new Date(d).getDay()]} ${fmtDataHora(d)}`
export const numeroEtiqueta = n => '#' + String(n).padStart(6, '0')

// Prazo em dias → texto ("3 dias", "12 h")
export function fmtPrazo(dias) {
  const v = Number(dias)
  if (!v) return '—'
  if (v < 1) return `${Math.round(v * 24)} h`
  return `${String(v).replace('.', ',')} dia${v === 1 ? '' : 's'}`
}

function desenhar(doc, e, empresa) {
  const L = 60, M = 3, W = L - 2 * M
  let y = M + 4
  // nome da preparação (até 2 linhas)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  const nome = doc.splitTextToSize(e.nome, W).slice(0, 2)
  doc.text(nome, M, y); y += nome.length * 4.6

  // faixa de conservação (preta, texto branco)
  doc.setFillColor(0, 0, 0); doc.rect(M, y - 1, W, 5.6, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(8.5)
  doc.text(faixaConservacao(e.conservacao), L / 2, y + 2.9, { align: 'center' })
  doc.setTextColor(0, 0, 0); y += 9

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text('MANIPULAÇÃO', M, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(fmtDataHora(e.manipulado_em), M, y + 4.2)
  y += 8.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text('VALIDADE', M, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(fmtValidade(e.validade), M, y + 5.4)
  y += 10

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  if (e.responsavel) { doc.text(doc.splitTextToSize(`Resp.: ${e.responsavel}`, W)[0], M, y); y += 3.6 }
  if (e.observacao) { doc.text(doc.splitTextToSize(e.observacao, W).slice(0, 2), M, y) }

  // rodapé: empresa e número da etiqueta
  doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(M, L - 9.5, L - M, L - 9.5)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(numeroEtiqueta(e.numero), L - M, L - 5.6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5)
  const linha1 = [empresa?.nome, empresa?.cnpj && `CNPJ ${empresa.cnpj}`].filter(Boolean).join(' · ')
  if (linha1) doc.text(doc.splitTextToSize(linha1, W - 14)[0], M, L - 6.2)
  if (empresa?.endereco) doc.text(doc.splitTextToSize(empresa.endereco, W)[0], M, L - 3.4)
}

export function pdfEtiquetas(etiquetas, empresa) {
  const doc = new jsPDF({ unit: 'mm', format: [60, 60], orientation: 'portrait' })
  etiquetas.forEach((e, i) => { if (i) doc.addPage([60, 60], 'portrait'); desenhar(doc, e, empresa) })
  return doc
}

// Abre a janela de impressão do navegador com o PDF (iframe escondido; se o navegador
// bloquear, devolve o link do PDF para abrir manualmente)
export function imprimirEtiquetas(etiquetas, empresa) {
  const doc = pdfEtiquetas(etiquetas, empresa)
  const url = doc.output('bloburl')
  const fr = document.createElement('iframe')
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  fr.src = url
  fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print() } catch { window.open(url) } }
  document.body.appendChild(fr)
  setTimeout(() => fr.remove(), 120000)
  return url
}
