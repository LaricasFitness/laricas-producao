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
// Uma linha por produto; uma coluna por tipo de preparação (massa, recheio, cobertura…)
// com o nome e os gramas por unidade, peso total, embalagem e um espaço para anotar
// quantas montar. Sem custos.
const ORDEM_TIPOS = ['massa', 'recheio', 'creme', 'cobertura']

export async function gerarMontagemCategoriaPDF(categoria, { salvar = true } = {}) {
  const { data: prods, error: e1 } = await supabase.from('embalagens')
    .select('id, codigo, nome').eq('categoria', categoria).eq('ativo', true).order('nome')
  if (e1) throw e1
  const skus = (prods || []).map(p => p.codigo).filter(Boolean)
  if (!skus.length) throw new Error('Nenhum produto ativo nessa categoria.')

  const [{ data: comps, error: e2 }, { data: embsProd }, { data: embsCat }] = await Promise.all([
    supabase.from('produto_composicao').select('sku_produto, quantidade_por_unidade, unidade, observacao, preparacoes(nome, tipo, atualizado_em)').in('sku_produto', skus),
    supabase.from('produto_embalagem').select('sku_produto, quantidade, embalagens(nome)').in('sku_produto', skus),
    supabase.from('categoria_embalagem').select('quantidade, embalagens(nome)').eq('categoria', categoria),
  ])
  if (e2) throw e2

  const tipoDe = c => (c.preparacoes?.tipo || 'outros').toLowerCase()
  const presentes = [...new Set((comps || []).map(tipoDe))]
  const tipos = [...ORDEM_TIPOS.filter(t => presentes.includes(t)), ...presentes.filter(t => !ORDEM_TIPOS.includes(t)).sort()]
  const titulo1 = t => t.charAt(0).toUpperCase() + t.slice(1)
  const qtdEmb = q => n(q) && n(q) !== 1 ? ` ×${fmtQtd(n(q))}` : ''
  const embCat = (embsCat || []).map(x => `${x.embalagens?.nome}${qtdEmb(x.quantidade)}`)

  const semFicha = []
  const body = (prods || []).map(p => {
    const doProd = (comps || []).filter(c => c.sku_produto === p.codigo)
    if (!doProd.length) semFicha.push(p.nome)
    const peso = doProd.reduce((s, c) => s + ((c.unidade || 'g') === 'g' ? n(c.quantidade_por_unidade) : 0), 0)
    const embs = (embsProd || []).filter(x => x.sku_produto === p.codigo).map(x => `${x.embalagens?.nome}${qtdEmb(x.quantidade)}`)
    const listaEmb = embs.length ? embs : embCat
    return [
      { content: p.nome, styles: { fontStyle: 'bold' } },
      ...tipos.map(t => doProd.filter(c => tipoDe(c) === t)
        .map(c => `${c.preparacoes?.nome}\n${fmtQtd(n(c.quantidade_por_unidade))} ${c.unidade || 'g'}${c.observacao ? ` · ${c.observacao}` : ''}`)
        .join('\n') || '—'),
      { content: peso ? `${fmtQtd(peso)} g` : '—', styles: { fontStyle: 'bold', halign: 'center' } },
      listaEmb.length ? listaEmb.join('\n') : { content: 'sem embalagem cadastrada', styles: { textColor: [190, 60, 60] } },
      '',
    ]
  })

  const doc = new jsPDF('l', 'mm', 'a4')
  const atualizadas = (comps || []).map(c => c.preparacoes?.atualizado_em).filter(Boolean).sort().pop()
  const nomeCat = categoria.replace(/\s*\[\s*sazonal\s*\]\s*/i, '').trim() || categoria
  cabecalho(doc, `Montagem · ${nomeCat}`, `${body.length} produto${body.length > 1 ? 's' : ''}  ·  quantidades por unidade montada`, atualizadas)

  autoTable(doc, {
    startY: 38,
    head: [['Produto', ...tipos.map(titulo1), 'Peso', 'Embalagem', 'Qtd. a montar']],
    body,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 2.6, lineColor: [225, 220, 224], lineWidth: 0.1, textColor: [40, 40, 40], valign: 'middle' },
    headStyles: { fillColor: MEDIO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9.5 },
    alternateRowStyles: { fillColor: [252, 250, 251] },
    columnStyles: {
      0: { cellWidth: 52 },
      [tipos.length + 1]: { cellWidth: 20, fillColor: DESTAQUE },
      [tipos.length + 2]: { cellWidth: 44, fontSize: 8.5 },
      [tipos.length + 3]: { cellWidth: 26 },
    },
    margin: { left: L, right: L, top: 14, bottom: 14 },
  })

  let y = doc.lastAutoTable.finalY + 6
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MEDIO)
  const notas = [
    'Pesos do produto acabado (já assado), por unidade. Receitas de cada preparação: PDF "Ficha técnica das preparações".',
    semFicha.length ? `Sem composição cadastrada: ${semFicha.join(', ')}.` : null,
  ].filter(Boolean)
  doc.text(doc.splitTextToSize(notas.join('  '), 297 - 2 * L), L, y)
  rodapes(doc, `Montagem · ${nomeCat}`)

  const arquivo = nomeArquivo(`Montagem_${nomeCat}`)
  if (salvar) doc.save(arquivo)
  return { arquivo, doc }
}
