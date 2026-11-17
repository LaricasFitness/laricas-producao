import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { chamarExpedicao } from './expedicao'

// PDF de envio do dia (Expedição › 3. Etiquetas e DANFE), para a térmica 10 × 15 cm: UMA etiqueta por pedido,
// com a etiqueta de transporte que a logística gerou no Bling (Correios, Bling Envios, Lalamove...) em cima e a
// DANFE simplificada embaixo, montada aqui com o XML da nota autorizada (o Bling não entrega a DANFE
// simplificada pela API). A etiqueta não é reduzida: só as sobras em branco (e o rodapé do Melhor Envio)
// são cortadas para abrir espaço. Modelo de etiqueta desconhecido: é reduzida para caber (fica avisado).
// Pedido sem nota autorizada sai só com a etiqueta. Valor total fora: deixou de ser obrigatório (NT 2020.004).
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

  texto(cortar(`Pedido ${pedido.numero} · ${pedido.cliente || ''}`, 7, f, W), M, M, 7)
  texto('Consulte a autenticidade em www.nfe.fazenda.gov.br/portal', M, M + 10, 6.5)
}

// DANFE simplificada compacta, para a faixa de baixo da etiqueta (x, y = canto inferior esquerdo)
const ALTURA_DANFE = 104
function danfeCompacta(page, f, fb, d, x, y, w) {
  const h = ALTURA_DANFE
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.6 })
  const texto = (t, xx, yy, tam, fonte = f) => {
    let s = latin(t); const max = x + w - 4 - xx
    while (s && fonte.widthOfTextAtSize(s, tam) > max) s = s.slice(0, -1)
    page.drawText(s, { x: xx, y: yy, size: tam, font: fonte, color: rgb(0, 0, 0) })
  }
  let cy = y + h - 10
  texto('DANFE SIMPLIFICADO - ETIQUETA', x + 4, cy, 7.5, fb)
  const dir = latin(`${d.tipo === '0' ? '0-ENTRADA' : '1-SAÍDA'}  NF ${d.numero}  Série ${d.serie}  ${fmtDataHora(d.emissao).slice(0, 10)}`)
  page.drawText(dir, { x: x + w - 4 - f.widthOfTextAtSize(dir, 6.5), y: cy, size: 6.5, font: f })
  cy -= 32
  desenharBarras(page, d.chave, x + 10, cy, w - 20, 28)
  cy -= 8
  const chave = d.chave.replace(/(\d{4})(?=\d)/g, '$1 ')
  page.drawText(chave, { x: x + (w - f.widthOfTextAtSize(chave, 6.5)) / 2, y: cy, size: 6.5, font: f })
  cy -= 10.5
  texto(`Protocolo de autorização: ${d.protocolo}  ${fmtDataHora(d.autorizadaEm)}`, x + 4, cy, 6.5)
  cy -= 9.5
  // emitente: razão social inteira numa linha, documentos (obrigatórios) na de baixo
  texto(`Emitente: ${d.emitente.nome}`, x + 4, cy, 6.5)
  cy -= 9
  texto(`CNPJ ${fmtDoc(d.emitente.doc)}  IE ${d.emitente.ie || '-'}  UF ${d.emitente.uf}`, x + 4, cy, 6.5)
  cy -= 9.5
  // destinatário: numa linha se couber; senão nome numa linha e documentos na de baixo
  const docDest = String(d.destinatario.doc || '')
  const docs = `${docDest.length === 14 ? 'CNPJ' : 'CPF'} ${fmtDoc(docDest)}${d.destinatario.ie ? '  IE ' + d.destinatario.ie : ''}  UF ${d.destinatario.uf}`
  const umaLinha = latin(`Destinatário: ${d.destinatario.nome}  ${docs}`)
  if (f.widthOfTextAtSize(umaLinha, 6.5) <= w - 8) texto(umaLinha, x + 4, cy, 6.5)
  else {
    texto(`Destinatário: ${d.destinatario.nome}`, x + 4, cy, 6.5)
    cy -= 9
    texto(docs, x + 4, cy, 6.5)
  }
}

// Quanto de cada modelo de etiqueta aproveitar (o resto é branco):
//   Bling (Correios, Lalamove, Retirada): 284 × 425, conteúdo entre 6% e 80% a partir do topo
//   Melhor Envio (J&T, Jadlog): ~577 × 813, rodapé com o logo do Melhor Envio abaixo de 76,5%
function recorte(pg) {
  const { width: w, height: h } = pg.getSize()
  if (Math.abs(w - 284) < 3 && Math.abs(h - 425) < 3) return { modelo: 'bling', box: { left: 0, right: w, bottom: h * 0.20, top: h * 0.925 } }
  if (Math.abs(w / h - 577.5 / 813) < 0.02) return { modelo: 'melhorenvio', box: { left: 0, right: w, bottom: h * 0.235, top: h } }
  return { modelo: 'outro', box: { left: 0, right: w, bottom: 0, top: h } }
}

// Etiqueta de transporte + DANFE simplificada numa página 10 × 15. Devolve true se precisou reduzir a etiqueta.
export async function etiquetaComDanfe(pdf, f, fb, origem, d) {
  const pg = origem.getPage(0)
  const { modelo, box } = recorte(pg)
  const emb = await pdf.embedPage(pg, box)
  const page = pdf.addPage([L, A])
  const M = 4
  const altLivre = A - ALTURA_DANFE - 2 * M - 4
  const escalaLargura = L / emb.width
  const escala = Math.min(escalaLargura, altLivre / emb.height)
  const lw = emb.width * escala, lh = emb.height * escala
  page.drawPage(emb, { x: (L - lw) / 2, y: A - M - lh, width: lw, height: lh })
  danfeCompacta(page, f, fb, d, M + 4, M, L - 2 * M - 8)
  return modelo === 'outro' || escala < escalaLargura - 0.001
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
      let origem = null
      if (doc.etiqueta) {
        try { origem = await PDFDocument.load(Uint8Array.from(atob(doc.etiqueta), c => c.charCodeAt(0))) }
        catch (e) { r.avisos.push('Não consegui ler o PDF da etiqueta: ' + e.message) }
      }
      try {
        if (origem && doc.danfe) {
          // uma etiqueta só: transporte em cima, DANFE simplificada embaixo
          if (await etiquetaComDanfe(pdf, f, fb, origem, doc.danfe)) r.avisos.push('Modelo de etiqueta diferente: foi reduzida para caber a DANFE. Confira a leitura.')
          if (origem.getPageCount() > 1) for (const pg of await pdf.copyPages(origem, origem.getPageIndices().slice(1))) pdf.addPage(pg)
          r.etiqueta = r.danfe = true
        } else if (origem) {
          for (const pg of await pdf.copyPages(origem, origem.getPageIndices())) pdf.addPage(pg)
          r.etiqueta = true
        } else if (doc.danfe) {
          paginaDanfe(pdf, f, fb, doc.danfe, { numero: r.numero, cliente: r.cliente })
          r.danfe = true
        }
      } catch (e) { r.avisos.push('Não consegui montar a etiqueta: ' + e.message) }
      // sem NF só sai por Lalamove ou Retirada (Correios e Bling Envios precisam da nota)
      if (!r.nota && r.transportadora && !/LALAMOVE|RETIRADA/i.test(r.transportadora))
        r.avisos.push(`Sem NF, mas vai por ${r.transportadora}: sem nota só Lalamove ou Retirada.`)
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
