import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { chamarExpedicao } from './expedicao'

// PDF de envio do dia (Expedição › 3. Etiquetas e DANFE): para cada pedido do picking, a etiqueta que a
// logística gerou no Bling (Correios, Bling Envios, Lalamove...) seguida da DANFE simplificada (10 × 15 cm),
// montada aqui com os dados do XML da nota autorizada. O Bling não entrega a DANFE simplificada pela API.
// Só leitura: não gera etiqueta nem contrata frete.

const POR_CHAMADA = 8
const L = 283.46, A = 425.2           // 10 × 15 cm em pontos

// ── Code 128 (conjunto C: só dígitos, em pares) para o código de barras da chave de acesso ──
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112']
function code128C(digitos) {
  const vals = [105]
  for (let i = 0; i < digitos.length; i += 2) vals.push(Number(digitos.slice(i, i + 2)))
  vals.push(vals.reduce((s, v, i) => s + v * (i || 1), 0) % 103)
  vals.push(106)
  return vals.map(v => C128[v]).join('')     // larguras alternando barra/espaço, em módulos
}
function desenharBarras(page, digitos, x, y, largura, altura) {
  const larguras = code128C(digitos)
  const modulos = [...larguras].reduce((s, w) => s + Number(w), 0)
  const m = largura / modulos
  let cx = x
  ;[...larguras].forEach((w, i) => {
    const lw = Number(w) * m
    if (i % 2 === 0) page.drawRectangle({ x: cx, y, width: lw, height: altura, color: rgb(0, 0, 0) })
    cx += lw
  })
}

// Helvetica padrão só tem Latin-1: troca o que não couber
const latin = s => String(s ?? '').normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
const fmtDoc = d => {
  const s = String(d || '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return s
}
const fmtDataHora = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? iso : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
const fmtValor = v => `R$ ${Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

export function paginaDanfe(pdf, f, fb, d, pedido) {
  const page = pdf.addPage([L, A])
  const M = 12, W = L - 2 * M
  let y = A - M
  const texto = (t, x, yy, tam = 7.5, fonte = f) => page.drawText(latin(t), { x, y: yy, size: tam, font: fonte, color: rgb(0, 0, 0) })
  const cortar = (t, tam, fonte, max) => { let s = latin(t); while (s && fonte.widthOfTextAtSize(s, tam) > max) s = s.slice(0, -1); return s }
  const caixa = (h) => { page.drawRectangle({ x: M, y: y - h, width: W, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.7 }); }
  const secao = (titulo, linhas) => {
    const h = 12 + linhas.length * 10.5
    caixa(h)
    texto(titulo, M + 4, y - 9, 6.5, fb)
    linhas.forEach((l, i) => texto(cortar(l, 8, f, W - 8), M + 4, y - 20 - i * 10.5, 8))
    y -= h + 4
  }

  // Cabeçalho
  caixa(34)
  texto('DANFE SIMPLIFICADO - ETIQUETA', M + 4, y - 13, 11, fb)
  texto(`${d.tipo === '0' ? '0 - ENTRADA' : '1 - SAÍDA'}   Nº ${d.numero}   Série ${d.serie}   Emissão ${fmtDataHora(d.emissao).slice(0, 10)}`, M + 4, y - 27, 8)
  y -= 38

  // Chave de acesso
  caixa(74)
  texto('CHAVE DE ACESSO', M + 4, y - 9, 6.5, fb)
  desenharBarras(page, d.chave, M + 8, y - 52, W - 16, 38)
  texto(d.chave.replace(/(\d{4})(?=\d)/g, '$1 '), M + 4 + (W - 8 - f.widthOfTextAtSize(d.chave.replace(/(\d{4})(?=\d)/g, '$1 '), 8)) / 2, y - 66, 8)
  y -= 78

  secao('PROTOCOLO DE AUTORIZAÇÃO DE USO', [`${d.protocolo} - ${fmtDataHora(d.autorizadaEm)}`])
  secao('EMITENTE', [d.emitente.nome, `CNPJ/CPF ${fmtDoc(d.emitente.doc)}   IE ${d.emitente.ie || '-'}   UF ${d.emitente.uf}`])
  secao('DESTINATÁRIO', [d.destinatario.nome, `CNPJ/CPF ${fmtDoc(d.destinatario.doc)}   IE ${d.destinatario.ie || '-'}   UF ${d.destinatario.uf}`])
  secao('VALOR TOTAL DA NOTA', [fmtValor(d.valor)])

  texto(cortar(`Pedido ${pedido.numero} · ${pedido.cliente || ''}`, 7, f, W), M, M, 7)
  texto('Consulte a autenticidade em www.nfe.fazenda.gov.br/portal', M, M + 10, 6.5)
}

// Busca os documentos no servidor e monta o PDF. pedidos: [{ id, numero, cliente }] (do picking).
// Devolve { bytes, resumo: [{ numero, etiqueta, danfe, avisos, erro }] }
export async function montarPdfEnvio(pedidos, onProgresso) {
  const pdf = await PDFDocument.create()
  const f = await pdf.embedFont(StandardFonts.Helvetica)
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold)
  const resumo = []
  for (let i = 0; i < pedidos.length; i += POR_CHAMADA) {
    const lote = pedidos.slice(i, i + POR_CHAMADA)
    const { pedidos: docs } = await chamarExpedicao('documentos', { ids: lote.map(p => p.id) })
    for (const p of lote) {
      const doc = docs.find(x => String(x.id) === String(p.id)) || { avisos: [], erro: 'Sem resposta do servidor.' }
      const r = { numero: doc.numero || p.numero, cliente: doc.cliente || p.cliente, transportadora: doc.transportadora || p.transportadora || '',
        etiqueta: false, danfe: false, nota: doc.nota, avisos: [...(doc.avisos || [])], erro: doc.erro || '' }
      if (doc.etiqueta) {
        try {
          const origem = await PDFDocument.load(Uint8Array.from(atob(doc.etiqueta), c => c.charCodeAt(0)))
          const paginas = await pdf.copyPages(origem, origem.getPageIndices())
          paginas.forEach(pg => pdf.addPage(pg))
          r.etiqueta = true
        } catch (e) { r.avisos.push('Não consegui ler o PDF da etiqueta: ' + e.message) }
      }
      if (doc.danfe) {
        try { paginaDanfe(pdf, f, fb, doc.danfe, { numero: r.numero, cliente: r.cliente }); r.danfe = true }
        catch (e) { r.avisos.push('Não consegui montar a DANFE: ' + e.message) }
      }
      resumo.push(r)
    }
    onProgresso?.(Math.min(pedidos.length, i + POR_CHAMADA), pedidos.length)
  }
  return { bytes: pdf.getPageCount() ? await pdf.save() : null, resumo }
}

export function baixarPdf(bytes, nome) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
