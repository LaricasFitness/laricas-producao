import jsPDF from 'jspdf'
import QRCode from 'qrcode'

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

function desenhar(doc, e, empresa, qr) {
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

  // parte de baixo: textos à esquerda, QR Code (15 mm) à direita
  const Q = 15, xq = L - M - Q, yq = L - M - Q
  doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(M, yq - 1.4, L - M, yq - 1.4)
  if (qr) doc.addImage(qr, 'PNG', xq, yq, Q, Q)
  const WE = xq - M - 2
  let yb = yq + 2.2
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  if (e.responsavel) { doc.text(doc.splitTextToSize(`Resp.: ${e.responsavel}`, WE)[0], M, yb); yb += 3 }
  if (e.observacao) { doc.text(doc.splitTextToSize(e.observacao, WE)[0], M, yb) }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(numeroEtiqueta(e.numero), M, L - M - 4.3)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5)
  const linha1 = [empresa?.nome, empresa?.cnpj && `CNPJ ${empresa.cnpj}`].filter(Boolean).join(' · ')
  if (linha1) doc.text(doc.splitTextToSize(linha1, WE)[0], M, L - M - 1.9)
  if (empresa?.endereco) doc.text(doc.splitTextToSize(empresa.endereco, WE)[0], M, L - M + 0.3)
}

// QR Code da etiqueta: link do sistema que abre a baixa (?etiqueta=123). Lido pela câmera
// dentro do sistema (Validades › Ler QR) ou pela câmera do celular (abre o sistema, pede login).
export const linkEtiqueta = (numero, origem = window.location.origin) => `${origem}/?etiqueta=${numero}`
// Texto lido do QR (link ou só o número, com ou sem #) → número da etiqueta
export function numeroDoCodigo(texto) {
  const t = String(texto || '').trim()
  try { const n = new URL(t).searchParams.get('etiqueta'); if (n) return parseInt(n, 10) || null } catch { /* não é link */ }
  const m = t.match(/^#?0*(\d{1,12})$/)
  return m ? parseInt(m[1], 10) : null
}
// 4 px por módulo: imagem pequena e nítida (o PDF estica para 15 mm)
export const qrDataURL = texto => QRCode.toDataURL(texto, { margin: 0, errorCorrectionLevel: 'M', scale: 4 })

export async function pdfEtiquetas(etiquetas, empresa, origem) {
  const doc = new jsPDF({ unit: 'mm', format: [60, 60], orientation: 'portrait', compress: true })
  for (const [i, e] of etiquetas.entries()) {
    if (i) doc.addPage([60, 60], 'portrait')
    const qr = e.numero ? await qrDataURL(linkEtiqueta(e.numero, origem)) : null
    desenhar(doc, e, empresa, qr)
  }
  return doc
}

// Abre a janela de impressão do navegador com o PDF (iframe escondido; se o navegador
// bloquear, abre o PDF numa aba para imprimir de lá)
export async function imprimirEtiquetas(etiquetas, empresa) {
  const doc = await pdfEtiquetas(etiquetas, empresa)
  const url = doc.output('bloburl')
  const fr = document.createElement('iframe')
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  fr.src = url
  fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print() } catch { window.open(url) } }
  document.body.appendChild(fr)
  setTimeout(() => fr.remove(), 120000)
  return url
}
