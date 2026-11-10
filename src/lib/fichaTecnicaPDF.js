import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../supabase'

// Ficha técnica de produção (PDF para o time da cozinha).
// Uma tabela por preparação, com as quantidades de cada ingrediente para
// 0,5 a 6 receitas. Sem custos: é documento de produção.
// Lê as receitas direto do banco na hora de gerar (sempre a versão atual).

export const MULTIPLOS = [0.5, 1, 1.5, 2, 3, 4, 5, 6]

const ESCURO = [58, 21, 50]
const MEDIO = [90, 36, 80]
const DOURADO = [233, 189, 147]
const CLARO = [249, 245, 242]
const DESTAQUE = [243, 232, 240]
const L = 12, W = 210 - 2 * L

const n = v => parseFloat(v) || 0

// Quantidade legível, sem ponto de milhar (como na planilha da cozinha):
// até 2 casas abaixo de 10, 1 casa até 100, inteiro acima
export function fmtQtd(v) {
  if (!v) return '—'
  const casas = Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0
  return v.toLocaleString('pt-BR', { maximumFractionDigits: casas, useGrouping: false })
}

// Mesma regra do custo: rendimento real já é líquido; estimado leva a perda
function rendLiquido(prep) {
  const real = n(prep?.rendimento_real_medio)
  if (real) return { valor: real, medido: true }
  return { valor: n(prep?.rendimento_estimado) * (1 - n(prep?.perda_percentual) / 100), medido: false }
}

async function carregarReceitas() {
  const [{ data: preps, error: e1 }, { data: ings, error: e2 }] = await Promise.all([
    supabase.from('preparacoes').select('id, nome, tipo, unidade_rendimento, rendimento_estimado, rendimento_real_medio, perda_percentual, observacao, ativo, atualizado_em'),
    supabase.from('preparacao_composicao').select('preparacao_id, ingrediente, quantidade, unidade, observacao, ordem, sub_preparacao_id').order('ordem'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const prepMap = Object.fromEntries((preps || []).map(p => [p.id, p]))
  const ingsDe = id => (ings || []).filter(i => i.preparacao_id === id)
  return { preps: preps || [], prepMap, ingsDe }
}

// Blocos na ordem pedida; cada sub-preparação entra logo depois de quem a usa
function montarBlocos(ids, { prepMap, ingsDe }, compPorPrep = {}) {
  const blocos = []
  const vistos = new Set()
  function incluir(prepId, usadaEm) {
    if (!prepMap[prepId]) return
    if (vistos.has(prepId)) {
      const b = blocos.find(x => x.prep.id === prepId)
      if (b && usadaEm && !b.usadaEm.includes(usadaEm)) b.usadaEm.push(usadaEm)
      return
    }
    vistos.add(prepId)
    blocos.push({ prep: prepMap[prepId], comp: compPorPrep[prepId] || null, usadaEm: usadaEm ? [usadaEm] : [] })
    for (const i of ingsDe(prepId)) if (i.sub_preparacao_id) incluir(i.sub_preparacao_id, prepMap[prepId].nome)
  }
  for (const id of ids) incluir(id, null)
  return blocos
}

function cabecalho(doc, titulo, subtitulo, atualizadas) {
  const LG = doc.internal.pageSize.getWidth()
  doc.setFillColor(...ESCURO); doc.rect(0, 0, LG, 30, 'F')
  doc.setTextColor(...DOURADO); doc.setFont(undefined, 'bold'); doc.setFontSize(9)
  doc.text('LARC · FICHA TÉCNICA DE PRODUÇÃO', L, 9)
  doc.setTextColor(255, 255, 255); doc.setFontSize(16)
  doc.text(doc.splitTextToSize(titulo, LG - 2 * L)[0], L, 18)
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5)
  if (subtitulo) doc.text(subtitulo, L, 25)
  if (atualizadas) doc.text(`Receitas atualizadas em ${new Date(atualizadas).toLocaleDateString('pt-BR')}`, LG - L, 25, { align: 'right' })
}

function tabelaPreparacao(doc, y, { prep, comp, usadaEm }, ingsDe, prepMap, mostrarTitulo) {
  const unid = prep.unidade_rendimento || 'g'
  const lista = ingsDe(prep.id)
  const rend = rendLiquido(prep)
  const porUn = comp ? n(comp.quantidade_por_unidade) : 0
  const mesmaUnidade = comp && (comp.unidade || 'g') === unid
  const nCols = 2 + MULTIPLOS.length
  const colUm = 2 + MULTIPLOS.indexOf(1)

  const body = lista.map(i => {
    const sub = i.sub_preparacao_id ? prepMap[i.sub_preparacao_id] : null
    const nome = (i.ingrediente || sub?.nome || '—') + (sub ? ' (preparação — ver ficha)' : '')
    return [i.observacao ? `${nome}\n${i.observacao}` : nome, i.unidade || '', ...MULTIPLOS.map(m => fmtQtd(n(i.quantidade) * m))]
  })
  if (!body.length) body.push([{ content: 'Sem ingredientes cadastrados.', colSpan: nCols, styles: { halign: 'left', textColor: [150, 150, 150] } }])

  const somaveis = lista.filter(i => ['g', 'ml'].includes((i.unidade || '').toLowerCase()))
  const total = somaveis.reduce((s, i) => s + n(i.quantidade), 0)
  const rodape = []
  if (total > 0) rodape.push([
    { content: somaveis.length < lista.length ? 'Total (g + ml)' : 'Total', styles: { fontStyle: 'bold', halign: 'left' } }, '',
    ...MULTIPLOS.map(m => ({ content: fmtQtd(total * m), styles: { fontStyle: 'bold' } })),
  ])
  if (rend.valor > 0) rodape.push([
    { content: rend.medido ? 'Rende (medido na produção)' : 'Rende (estimado, com perda)', styles: { textColor: MEDIO, halign: 'left' } },
    { content: unid, styles: { halign: 'center' } },
    ...MULTIPLOS.map(m => ({ content: fmtQtd(rend.valor * m), styles: { textColor: MEDIO } })),
  ])
  if (rend.valor > 0 && porUn > 0 && mesmaUnidade) rodape.push([
    { content: `Dá para (unidades com ${fmtQtd(porUn)} ${unid})`, styles: { textColor: MEDIO, halign: 'left' } },
    { content: 'un', styles: { halign: 'center' } },
    ...MULTIPLOS.map(m => ({ content: String(Math.floor(rend.valor * m / porUn)), styles: { textColor: MEDIO, fontStyle: 'bold' } })),
  ])

  const info = [
    comp && porUn > 0 ? `${fmtQtd(porUn)} ${comp.unidade || 'g'} por unidade do produto` : null,
    usadaEm.length ? `usada em: ${usadaEm.join(', ')}` : null,
  ].filter(Boolean).join('  ·  ')

  const head = []
  if (mostrarTitulo) {
    head.push([{ content: prep.nome + (prep.tipo ? `  ·  ${prep.tipo}` : ''), colSpan: nCols,
      styles: { fillColor: ESCURO, textColor: [255, 255, 255], fontSize: 11, halign: 'left', cellPadding: { top: 3, bottom: info ? 1 : 3, left: 3, right: 3 } } }])
    if (info) head.push([{ content: info, colSpan: nCols,
      styles: { fillColor: ESCURO, textColor: DOURADO, fontStyle: 'normal', fontSize: 8.5, halign: 'left', cellPadding: { top: 0, bottom: 2.5, left: 3, right: 3 } } }])
  }
  const linhaGrupo = head.length
  head.push([
    { content: 'Ingrediente', rowSpan: 2, styles: { halign: 'left', valign: 'bottom' } },
    { content: 'Un', rowSpan: 2, styles: { halign: 'center', valign: 'bottom' } },
    { content: 'Nº de receitas', colSpan: MULTIPLOS.length, styles: { halign: 'center', fontSize: 7.5, cellPadding: 1.2 } },
  ])
  head.push(MULTIPLOS.map(m => m.toLocaleString('pt-BR')))

  autoTable(doc, {
    startY: y,
    pageBreak: 'avoid',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    head, body,
    foot: rodape.length ? rodape : undefined,
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { fontSize: 9.5, cellPadding: 1.9, lineColor: [225, 220, 224], lineWidth: 0.1, textColor: [40, 40, 40], valign: 'middle' },
    headStyles: { fillColor: MEDIO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, halign: 'right' },
    footStyles: { fillColor: CLARO, textColor: [40, 40, 40], fontStyle: 'normal', halign: 'right' },
    alternateRowStyles: { fillColor: [252, 250, 251] },
    columnStyles: {
      0: { halign: 'left', cellWidth: 'auto' },
      1: { halign: 'center', cellWidth: 9, textColor: [120, 120, 120] },
      ...Object.fromEntries(MULTIPLOS.map((_, k) => [2 + k, { halign: 'right', cellWidth: 14.5 }])),
    },
    margin: { left: L, right: L, top: 14, bottom: 14 },
    didParseCell: d => {
      if (d.column.index !== colUm) return
      if (d.section === 'head' && d.row.index === linhaGrupo + 1) d.cell.styles.fillColor = ESCURO
      if (d.section === 'body' || d.section === 'foot') { d.cell.styles.fillColor = DESTAQUE; d.cell.styles.fontStyle = 'bold' }
    },
  })
  y = doc.lastAutoTable.finalY + 3
  if (prep.observacao?.trim()) {
    doc.setFont(undefined, 'italic'); doc.setFontSize(9); doc.setTextColor(...MEDIO)
    const linhas = doc.splitTextToSize(`Obs.: ${prep.observacao.trim()}`, W)
    if (y + linhas.length * 4.2 > 297 - 14) { doc.addPage(); y = 14 }
    doc.text(linhas, L, y + 3)
    y += linhas.length * 4.2
  }
  return y + 7
}

function rodapes(doc, texto) {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  const paginas = doc.internal.getNumberOfPages()
  const LG = doc.internal.pageSize.getWidth(), AL = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFont(undefined, 'normal'); doc.setFontSize(7); doc.setTextColor(150, 150, 150)
    doc.text(`${texto} · gerado em ${agora}`, L, AL - 6)
    doc.text(`página ${i} de ${paginas}`, LG - L, AL - 6, { align: 'right' })
  }
}

const nomeArquivo = t => `Ficha_tecnica_${String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_')}.pdf`

// ── Ficha de preparações ──
// ids: preparações escolhidas (vazio = todas as ativas, por tipo e nome).
// Uma preparação sozinha usa o cabeçalho da página como título.
export async function gerarFichaPreparacoesPDF(ids = [], { salvar = true } = {}) {
  const rec = await carregarReceitas()
  const escolhidas = ids.length ? ids : rec.preps
    .filter(p => p.ativo !== false)
    .sort((a, b) => (a.tipo || '').localeCompare(b.tipo || '') || a.nome.localeCompare(b.nome))
    .map(p => p.id)
  const blocos = montarBlocos(escolhidas, rec)
  if (!blocos.length) throw new Error('Nenhuma preparação encontrada.')

  const doc = new jsPDF('p', 'mm', 'a4')
  const atualizadas = blocos.map(b => b.prep.atualizado_em).filter(Boolean).sort().pop()
  const uma = blocos.length === 1
  const principal = blocos[0].prep
  const titulo = uma || ids.length === 1 ? principal.nome : 'Preparações'
  const sub = uma || ids.length === 1
    ? [principal.tipo, blocos.length > 1 ? `com ${blocos.length - 1} sub-preparaç${blocos.length > 2 ? 'ões' : 'ão'}` : null].filter(Boolean).join('  ·  ')
    : `${blocos.length} preparações`
  cabecalho(doc, titulo, sub, atualizadas)

  let y = 38
  blocos.forEach((b, k) => {
    if (y > 297 - 40) { doc.addPage(); y = 14 }
    const tituloNaPagina = uma || (ids.length === 1 && k === 0)
    y = tabelaPreparacao(doc, y, b, rec.ingsDe, rec.prepMap, !tituloNaPagina)
  })
  rodapes(doc, titulo)

  const arquivo = nomeArquivo(titulo)
  if (salvar) doc.save(arquivo)
  return { arquivo, doc }
}

// ── Ficha das preparações de um produto (com "dá para X unidades") ──
export async function gerarFichaTecnicaPDF(produto, { salvar = true } = {}) {
  const { data: comps, error } = await supabase.from('produto_composicao')
    .select('preparacao_id, quantidade_por_unidade, unidade')
    .eq('sku_produto', produto.codigo)
  if (error) throw error
  if (!comps?.length) throw new Error('Produto sem ficha técnica cadastrada.')
  const rec = await carregarReceitas()
  const compPorPrep = Object.fromEntries(comps.map(c => [c.preparacao_id, c]))
  const blocos = montarBlocos(comps.map(c => c.preparacao_id), rec, compPorPrep)

  const doc = new jsPDF('p', 'mm', 'a4')
  cabecalho(doc, produto.nome, [produto.codigo, produto.categoria].filter(Boolean).join('  ·  '),
    blocos.map(b => b.prep.atualizado_em).filter(Boolean).sort().pop())

  const linhasUn = comps.filter(c => rec.prepMap[c.preparacao_id]).map(c => [
    rec.prepMap[c.preparacao_id].nome, `${fmtQtd(n(c.quantidade_por_unidade))} ${c.unidade || 'g'}`,
  ])
  const pesoUn = comps.reduce((s, c) => s + ((c.unidade || 'g') === 'g' ? n(c.quantidade_por_unidade) : 0), 0)
  autoTable(doc, {
    startY: 36,
    head: [[{ content: 'Em cada unidade do produto', colSpan: 2 }]],
    body: [...linhasUn, [{ content: 'Peso total da unidade', styles: { fontStyle: 'bold' } }, { content: `${fmtQtd(pesoUn)} g`, styles: { fontStyle: 'bold' } }]],
    theme: 'striped',
    headStyles: { fillColor: [255, 255, 255], textColor: ESCURO, fontStyle: 'bold', fontSize: 10, cellPadding: { top: 0, bottom: 2, left: 0, right: 0 } },
    styles: { fontSize: 9, cellPadding: 1.4, textColor: [60, 60, 60] },
    alternateRowStyles: { fillColor: CLARO },
    columnStyles: { 1: { halign: 'right', cellWidth: 30 } },
    tableWidth: 110,
    margin: { left: L },
  })

  let y = doc.lastAutoTable.finalY + 8
  for (const b of blocos) {
    if (y > 297 - 40) { doc.addPage(); y = 14 }
    y = tabelaPreparacao(doc, y, b, rec.ingsDe, rec.prepMap, true)
  }
  rodapes(doc, produto.nome)

  const arquivo = nomeArquivo(produto.codigo || produto.nome)
  if (salvar) doc.save(arquivo)
  return { arquivo, doc }
}

// ── Montagem de uma categoria (ex.: Chocotone) numa página só ──
// Para a bancada: uma linha por produto, uma coluna por etapa (massa, recheio, cobertura…)
// com os gramas GRANDES e o nome da preparação embaixo. Sem custos.
// Massa: a composição guarda o peso assado; o PDF mostra quanto porcionar CRU, pela
// proporção da receita (soma dos ingredientes ÷ rendimento pronto, medido ou estimado).
const ORDEM_TIPOS = ['massa', 'recheio', 'creme', 'cobertura']
const ROTULO_TIPO = {
  massa: ['MASSA CRUA', 'porcionar antes de assar'],
  recheio: ['RECHEIO', 'por unidade'],
  creme: ['CREME', 'por unidade'],
  cobertura: ['COBERTURA', 'por unidade'],
}
// Na coluna da etapa, o nome sem a etapa repetida: 'Cobertura de Chocolate Branco' -> 'Chocolate Branco'
const curto = (nome, tipo) => {
  const c = (nome || '').replace(new RegExp('^' + tipo + '\\s+(de\\s+)?', 'i'), '').trim()
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : nome
}
const gramas = v => `${v >= 10 ? Math.round(v) : fmtQtd(v)} g`

export async function gerarMontagemCategoriaPDF(categoria, { salvar = true } = {}) {
  const { data: prods, error: e1 } = await supabase.from('embalagens')
    .select('id, codigo, nome').eq('categoria', categoria).eq('ativo', true).order('nome')
  if (e1) throw e1
  const skus = (prods || []).map(p => p.codigo).filter(Boolean)
  if (!skus.length) throw new Error('Nenhum produto ativo nessa categoria.')

  const [{ data: comps, error: e2 }, { data: embsProd }, { data: embsCat }] = await Promise.all([
    supabase.from('produto_composicao')
      .select('sku_produto, preparacao_id, quantidade_por_unidade, unidade, observacao, preparacoes(id, nome, tipo, unidade_rendimento, rendimento_estimado, rendimento_real_medio, perda_percentual, atualizado_em)')
      .in('sku_produto', skus),
    supabase.from('produto_embalagem').select('sku_produto, quantidade, embalagens(nome)').in('sku_produto', skus),
    supabase.from('categoria_embalagem').select('quantidade, embalagens(nome)').eq('categoria', categoria),
  ])
  if (e2) throw e2

  // Receita de cada preparação: quanto entra cru (soma dos ingredientes) e quanto sai pronto
  const prepIds = [...new Set((comps || []).map(c => c.preparacao_id))]
  const { data: ings } = await supabase.from('preparacao_composicao')
    .select('preparacao_id, quantidade, unidade').in('preparacao_id', prepIds)
  const receita = {}
  for (const c of (comps || [])) {
    const p = c.preparacoes
    if (!p || receita[p.id]) continue
    const soma = (ings || []).filter(i => i.preparacao_id === p.id && ['g', 'ml'].includes((i.unidade || '').toLowerCase()))
      .reduce((s, i) => s + n(i.quantidade), 0)
    const cru = soma > 0 ? soma : n(p.rendimento_estimado)
    const pronto = rendLiquido(p)
    receita[p.id] = { ...p, cru, pronto: pronto.valor, medido: pronto.medido, fator: pronto.valor > 0 && cru > 0 ? cru / pronto.valor : 1 }
  }

  const tipoDe = c => (c.preparacoes?.tipo || 'outros').toLowerCase()
  const presentes = [...new Set((comps || []).map(tipoDe))]
  const tipos = [...ORDEM_TIPOS.filter(t => presentes.includes(t)), ...presentes.filter(t => !ORDEM_TIPOS.includes(t)).sort()]
  const qtdEmb = q => n(q) && n(q) !== 1 ? ` (×${fmtQtd(n(q))})` : ''
  const embCat = (embsCat || []).map(x => `${x.embalagens?.nome}${qtdEmb(x.quantidade)}`)

  const semFicha = []
  const usos = {}   // rendimento por preparação × gramas: "1 receita dá N unidades"
  const linhas = (prods || []).map(p => {
    const doProd = (comps || []).filter(c => c.sku_produto === p.codigo)
    if (!doProd.length) semFicha.push(p.nome)
    const peso = doProd.reduce((s, c) => s + ((c.unidade || 'g') === 'g' ? n(c.quantidade_por_unidade) : 0), 0)
    const embs = (embsProd || []).filter(x => x.sku_produto === p.codigo).map(x => `${x.embalagens?.nome}${qtdEmb(x.quantidade)}`)
    const celulas = tipos.map(t => doProd.filter(c => tipoDe(c) === t).map(c => {
      const r = receita[c.preparacao_id] || {}
      const pronto = n(c.quantidade_por_unidade)
      const ehMassa = t === 'massa'
      const valor = ehMassa ? pronto * (r.fator || 1) : pronto
      const chave = `${c.preparacao_id}|${valor.toFixed(1)}`
      if (!usos[chave]) usos[chave] = { r, valor, ehMassa, pronto, produtos: [] }
      usos[chave].produtos.push(p.nome)
      return {
        grande: gramas(valor),
        nome: curto(r.nome || c.preparacoes?.nome || '—', t),
        nota: [ehMassa && r.fator !== 1 ? `${gramas(pronto)} depois de assada` : null, c.observacao].filter(Boolean).join(' · '),
      }
    }))
    return { nome: p.nome, peso, celulas, emb: embs.length ? embs : embCat }
  })

  const doc = new jsPDF('l', 'mm', 'a4')
  const atualizadas = (comps || []).map(c => c.preparacoes?.atualizado_em).filter(Boolean).sort().pop()
  const nomeCat = categoria.replace(/\s*\[\s*sazonal\s*\]\s*/i, '').trim() || categoria
  cabecalho(doc, `Montagem · ${nomeCat}`, `${linhas.length} produto${linhas.length > 1 ? 's' : ''}  ·  quantidades para 1 unidade`, atualizadas)

  const nCols = tipos.length + 4
  const alturaItem = 19
  autoTable(doc, {
    startY: 36,
    head: [[
      'PRODUTO',
      ...tipos.map(t => (ROTULO_TIPO[t] || [t.toUpperCase(), 'por unidade']).join('\n')),
      'PESO FINAL', 'EMBALAGEM', 'QTD. A\nMONTAR',
    ]],
    body: linhas.map(l => [
      { content: l.nome, styles: { fontSize: 15, fontStyle: 'bold', textColor: ESCURO } },
      ...l.celulas.map(itens => ({ content: '', itens, styles: { minCellHeight: Math.max(1, itens.length) * alturaItem } })),
      { content: l.peso ? gramas(l.peso) : '—', styles: { fontSize: 18, fontStyle: 'bold', halign: 'center', fillColor: DESTAQUE, textColor: ESCURO } },
      l.emb.length ? l.emb.join('\n') : { content: 'SEM EMBALAGEM CADASTRADA', styles: { textColor: [190, 60, 60], fontStyle: 'bold' } },
      '',
    ]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, lineColor: [200, 190, 198], lineWidth: 0.25, textColor: [40, 40, 40], valign: 'middle' },
    headStyles: { fillColor: ESCURO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10.5, valign: 'middle', halign: 'center', cellPadding: 3.5 },
    columnStyles: {
      0: { cellWidth: 46 },
      [nCols - 3]: { cellWidth: 24 },
      [nCols - 2]: { cellWidth: 32, fontSize: 9 },
      [nCols - 1]: { cellWidth: 26 },
    },
    margin: { left: L, right: L, top: 14, bottom: 14 },
    didParseCell: d => {
      if (d.section === 'head' && d.column.index === 0) d.cell.styles.halign = 'left'
      if (d.section === 'head' && d.column.index > 0 && d.column.index <= tipos.length && tipos[d.column.index - 1] === 'massa') d.cell.styles.fillColor = MEDIO
    },
    didDrawCell: d => {
      const itens = d.section === 'body' && d.cell.raw?.itens
      if (!itens) return
      if (!itens.length) {
        doc.setFont(undefined, 'normal'); doc.setFontSize(12); doc.setTextColor(180, 180, 180)
        doc.text('—', d.cell.x + d.cell.width / 2, d.cell.y + d.cell.height / 2 + 1.5, { align: 'center' })
        return
      }
      const x = d.cell.x + 3
      const larg = d.cell.width - 6
      const topo = d.cell.y + (d.cell.height - itens.length * alturaItem) / 2
      itens.forEach((it, k) => {
        const y0 = topo + k * alturaItem
        doc.setFont(undefined, 'bold'); doc.setFontSize(22); doc.setTextColor(...ESCURO)
        doc.text(it.grande, x, y0 + 9.5)
        doc.setFont(undefined, 'bold'); doc.setFontSize(10.5); doc.setTextColor(60, 60, 60)
        const nomeL = doc.splitTextToSize(it.nome, larg).slice(0, 2)
        doc.text(nomeL, x, y0 + 14)
        if (it.nota) {
          doc.setFont(undefined, 'italic'); doc.setFontSize(8); doc.setTextColor(...MEDIO)
          doc.text(doc.splitTextToSize(it.nota, larg)[0], x, y0 + 14 + nomeL.length * 4)
        }
      })
    },
  })

  // Quanto rende cada receita, para saber quantas receitas fazer
  const palavras = linhas.map(l => l.nome.split(' '))
  let comum = 0
  while (linhas.length > 1 && palavras.every(p => p.length > comum + 1 && p[comum] === palavras[0][comum])) comum++
  const sabor = nome => comum ? nome.split(' ').slice(comum).join(' ') : nome
  const linhasRend = Object.values(usos)
    .filter(u => u.r.pronto > 0)
    .sort((a, b) => (ORDEM_TIPOS.indexOf(a.r.tipo) + 9) % 9 - (ORDEM_TIPOS.indexOf(b.r.tipo) + 9) % 9 || a.r.nome.localeCompare(b.r.nome))
    .map(u => {
      const unid = u.r.unidade_rendimento || 'g'
      const porReceita = Math.floor(u.r.pronto / u.pronto)
      return [
        { content: u.r.nome, styles: { fontStyle: 'bold' } },
        `${fmtQtd(u.r.cru)} ${unid} de ingredientes = ${fmtQtd(u.r.pronto)} ${unid} ${u.ehMassa ? 'assada' : 'pronta'}${u.r.medido ? ' (medido)' : ''}`,
        `${gramas(u.valor)}${u.ehMassa ? ' crua' : ''}`,
        { content: `${porReceita} unidades`, styles: { fontStyle: 'bold', textColor: ESCURO } },
        u.produtos.length === linhas.length && linhas.length > 1 ? 'todos' : u.produtos.map(sabor).join(', '),
      ]
    })
  if (linhasRend.length) {
    let y = doc.lastAutoTable.finalY + 7
    if (y + 14 + linhasRend.length * 6.2 > 210 - 10) { doc.addPage(); y = 14 }
    doc.setFont(undefined, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...ESCURO)
    doc.text('Quanto rende 1 receita de cada preparação', L, y)
    autoTable(doc, {
      startY: y + 2,
      head: [['Preparação', '1 receita', 'Por unidade', '1 receita dá para', 'Usada em']],
      body: linhasRend,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 1.7, textColor: [50, 50, 50] },
      headStyles: { fillColor: CLARO, textColor: ESCURO, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [252, 250, 251] },
      columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 80 }, 2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 34, halign: 'right' } },
      margin: { left: L, right: L, top: 14, bottom: 10 },
    })
  }

  if (semFicha.length) {
    const y = doc.lastAutoTable.finalY + 5
    doc.setFont(undefined, 'bold'); doc.setFontSize(9); doc.setTextColor(190, 60, 60)
    doc.text(`Sem composição cadastrada: ${semFicha.join(', ')}.`, L, y)
  }
  rodapes(doc, `Montagem · ${nomeCat}`)

  const arquivo = nomeArquivo(`Montagem_${nomeCat}`)
  if (salvar) doc.save(arquivo)
  return { arquivo, doc }
}
