import { supabase } from '../supabase'

// ═══════════════════════════════════════════════════════════════
// CMV real gerencial — mesmo método das redes de alimentação:
//
//   CMV = Estoque inicial + Compras − Estoque final   (em R$)
//
// • Estoque final = contagem do ÚLTIMO DIA do mês. Sem contagem nesse
//   dia, usa o saldo calculado (última contagem + entradas − consumo
//   registrado) e marca o item como "calculado".
// • Valorização PEPS: o que sobra no estoque vale o preço das compras
//   mais recentes até a data.
// • Fechamento automático: a partir do dia DIA_FECHAMENTO do mês
//   seguinte, o primeiro acesso ao sistema congela o mês em
//   fechamento_cmv. O estoque final congelado vira o inicial do mês
//   seguinte.
// • Compra lançada depois do fechamento com data de um mês fechado
//   ("atrasada") entra no primeiro mês que estava aberto quando ela foi
//   lançada — nada some do CMV e ninguém precisa reabrir mês.
// ═══════════════════════════════════════════════════════════════

export const DIA_FECHAMENTO = 5

// ── Datas (strings YYYY-MM / YYYY-MM-DD, sem fuso) ───────────────
export const ultimoDia = mes => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10)
const deslocaMes = (mes, n) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
export const mesAnterior = mes => deslocaMes(mes, -1)
export const mesSeguinte = mes => deslocaMes(mes, 1)
const hojeISO = () => new Date().toISOString().slice(0, 10)

// Último mês que já deveria estar fechado hoje
export function ultimoMesFechavel(hoje = hojeISO()) {
  const atual = hoje.slice(0, 7)
  return +hoje.slice(8, 10) >= DIA_FECHAMENTO ? mesAnterior(atual) : mesAnterior(mesAnterior(atual))
}

// Data em que um mês fecha sozinho (dd/mm/aaaa)
export function dataFechamentoPrevista(mes) {
  const s = mesSeguinte(mes)
  return `${String(DIA_FECHAMENTO).padStart(2, '0')}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

// Supabase devolve no máximo 1.000 linhas por consulta — pagina tudo
async function buscarTudo(montar) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ── Fechamentos já gravados ──────────────────────────────────────
export async function carregarFechamentos() {
  const rows = await buscarTudo(() => supabase.from('fechamento_cmv').select('*').order('id'))
  const NUM = ['ei_qtd', 'ei_valor', 'compras_qtd', 'compras_valor', 'atrasadas_qtd', 'atrasadas_valor',
    'ef_qtd', 'ef_valor', 'cmv_qtd', 'cmv_valor', 'teorico_qtd', 'teorico_valor']
  const porMes = {}
  for (const r0 of rows) {
    const r = { ...r0 }
    for (const k of NUM) r[k] = r[k] === null ? null : parseFloat(r[k])
    const f = porMes[r.mes] || (porMes[r.mes] = { mes: r.mes, fechado_em: r.fechado_em, linhas: [] })
    if (r.fechado_em < f.fechado_em) f.fechado_em = r.fechado_em
    f.linhas.push(r)
  }
  return porMes
}

// A data pertence a um mês já fechado?
export async function mesFechado(data) {
  if (!data) return false
  const { data: r } = await supabase.from('fechamento_cmv').select('id').eq('mes', data.slice(0, 7)).limit(1)
  return !!r?.length
}

export function avisoMesFechado(data) {
  const m = data.slice(0, 7)
  return `Esta compra é de ${m.slice(5, 7)}/${m.slice(0, 4)}, mês já fechado no CMV.\n\n` +
    'Para alterar ou excluir, reabra o mês em Custos › CMV do Mês.'
}

// Reabre o mês e os seguintes (o estoque final de um é o inicial do outro)
export async function reabrirMes(mes) {
  const { error } = await supabase.from('fechamento_cmv').delete().gte('mes', mes)
  if (error) throw error
}

// ── Dados de base ────────────────────────────────────────────────
// Carrega tudo o que o cálculo precisa até `ate` (inclusive).
export async function carregarBase(ate) {
  const [mps, embs, confMP, invMP, invEmb, comprasMP, recItens] = await Promise.all([
    buscarTudo(() => supabase.from('materias_primas').select('id,nome,unidade,categoria,custo_unitario,ativo').order('id')),
    buscarTudo(() => supabase.from('embalagens').select('id,codigo,nome,categoria,tipo,custo_unitario,ativo').order('id')),
    buscarTudo(() => supabase.from('conferencia_mp').select('materia_prima_id,data_conferencia,estoque_contado,criado_em').order('id')),
    buscarTudo(() => supabase.from('mp_inventarios').select('materia_prima_id,data_inventario,quantidade,criado_em').order('id')),
    buscarTudo(() => supabase.from('inventarios').select('embalagem_id,data_inventario,quantidade,criado_em').order('id')),
    buscarTudo(() => supabase.from('mp_compras').select('id,materia_prima_id,quantidade,custo_total,data_compra,criado_em').order('id')),
    buscarTudo(() => supabase.from('recebimento_itens')
      .select('id,embalagem_id,quantidade_recebida,valor_unitario,recebimentos(data_recebimento,criado_em)')
      .not('embalagem_id', 'is', null).order('id')),
  ])

  const contagens = {
    mp: [
      ...confMP.map(c => ({ item: c.materia_prima_id, data: c.data_conferencia, qtd: parseFloat(c.estoque_contado) || 0, ts: c.criado_em })),
      ...invMP.map(c => ({ item: c.materia_prima_id, data: c.data_inventario, qtd: parseFloat(c.quantidade) || 0, ts: c.criado_em })),
    ],
    emb: invEmb.map(c => ({ item: c.embalagem_id, data: c.data_inventario, qtd: parseFloat(c.quantidade) || 0, ts: c.criado_em })),
  }
  const compras = {
    mp: comprasMP.map(c => {
      const q = parseFloat(c.quantidade) || 0, v = parseFloat(c.custo_total) || 0
      return { item: c.materia_prima_id, data: c.data_compra, ts: c.criado_em, qtd: q, valor: v, unit: q > 0 ? v / q : null }
    }),
    emb: recItens.filter(r => r.recebimentos?.data_recebimento).map(r => {
      const q = parseFloat(r.quantidade_recebida) || 0, u = parseFloat(r.valor_unitario) || 0
      return { item: r.embalagem_id, data: r.recebimentos.data_recebimento, ts: r.recebimentos.criado_em, qtd: q, valor: q * u, unit: u > 0 ? u : null }
    }),
  }

  // Saídas registradas: só desde a contagem mais antiga (é o que o saldo calculado usa)
  const datas = [...contagens.mp, ...contagens.emb].map(c => c.data).filter(Boolean).sort()
  const desde = datas[0] || ate
  const [consMP, saidasEmb] = await Promise.all([
    buscarTudo(() => supabase.from('mp_consumos').select('id,materia_prima_id,quantidade,data_consumo,criado_em')
      .gte('data_consumo', desde).lte('data_consumo', ate).order('id')),
    buscarTudo(() => supabase.from('producao_diaria').select('id,embalagem_id,quantidade,data_producao,criado_em')
      .gte('data_producao', desde).lte('data_producao', ate).order('id')),
  ])
  const saidas = {
    mp: consMP.map(c => ({ item: c.materia_prima_id, data: c.data_consumo, ts: c.criado_em, qtd: parseFloat(c.quantidade) || 0 })),
    emb: saidasEmb.map(p => ({ item: p.embalagem_id, data: p.data_producao, ts: p.criado_em, qtd: parseFloat(p.quantidade) || 0 })),
  }

  const agrupa = lista => {
    const m = {}
    for (const x of lista) if (x.item) (m[x.item] || (m[x.item] = [])).push(x)
    return m
  }
  return {
    itens: { mp: mps, emb: embs },
    contagens: { mp: agrupa(contagens.mp), emb: agrupa(contagens.emb) },
    compras: { mp: agrupa(compras.mp), emb: agrupa(compras.emb) },
    comprasLista: compras,
    saidas: { mp: agrupa(saidas.mp), emb: agrupa(saidas.emb) },
  }
}

// Primeiro mês com contagem de abertura (contagem de MP no último dia do mês anterior)
export function mesInicial(base) {
  const fimDeMes = Object.values(base.contagens.mp).flat()
    .map(c => c.data).filter(d => d && d === ultimoDia(d.slice(0, 7))).sort()
  return fimDeMes.length ? mesSeguinte(fimDeMes[0].slice(0, 7)) : null
}

// ── Estoque numa data ────────────────────────────────────────────
function ultimaContagem(base, tipo, itemId, ate) {
  let melhor = null
  for (const c of (base.contagens[tipo][itemId] || [])) {
    if (!c.data || c.data > ate) continue
    if (!melhor || c.data > melhor.data || (c.data === melhor.data && c.ts > melhor.ts)) melhor = c
  }
  return melhor
}

// Contagem exatamente na data; senão saldo calculado a partir da última contagem
function estoqueEm(base, tipo, itemId, data) {
  const cont = ultimaContagem(base, tipo, itemId, data)
  if (!cont) return null
  if (cont.data === data) return { qtd: cont.qtd, origem: 'contagem' }

  // Mesmo dia da contagem: o que foi registrado depois dela ainda mexe no saldo.
  // Exceção: compra de MP com data igual à da contagem já está no número contado
  // (mesma regra de efeitoNoSaldo em MatPrimas.jsx).
  const depois = (x, contaMesmoDia) => x.data > cont.data && x.data <= data ||
    (contaMesmoDia && x.data === cont.data && x.ts > cont.ts)
  const ent = (base.compras[tipo][itemId] || []).filter(x => depois(x, tipo === 'emb')).reduce((s, x) => s + x.qtd, 0)
  const sai = (base.saidas[tipo][itemId] || []).filter(x => depois(x, true)).reduce((s, x) => s + x.qtd, 0)
  const qtd = cont.qtd + ent - sai
  // Embalagem segue calcularEstoqueCronologico (piso zero); MP pode ficar negativa de propósito
  return { qtd: tipo === 'emb' ? Math.max(0, qtd) : qtd, origem: 'calculado' }
}

// PEPS: a quantidade em estoque vale o preço das compras mais recentes até a data
function valorPEPS(base, tipo, item, qtd, data) {
  const camadas = (base.compras[tipo][item.id] || [])
    .filter(c => c.data <= data && c.unit > 0 && c.qtd > 0)
    .sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : (a.ts < b.ts ? 1 : -1))
  const reserva = parseFloat(item.custo_unitario) || 0
  if (qtd <= 0) return qtd * (camadas[0]?.unit ?? reserva)
  let resto = qtd, valor = 0, ultimo = null
  for (const c of camadas) {
    const q = Math.min(resto, c.qtd)
    valor += q * c.unit
    resto -= q
    ultimo = c.unit
    if (resto <= 0) break
  }
  // Mais estoque que compras registradas: o excedente vale a camada mais antiga
  if (resto > 0) valor += resto * (ultimo ?? reserva)
  return valor
}

// Mês que recebe uma compra lançada depois do fechamento do mês dela
function destinoAtrasada(c, fechamentos) {
  let m = mesSeguinte(c.data.slice(0, 7))
  while (fechamentos[m] && fechamentos[m].fechado_em <= c.ts) m = mesSeguinte(m)
  return m
}

// ── Teórico: produção registrada × ficha técnica ─────────────────
export async function calcularTeorico(ini, fim) {
  const [embs, producao, prodComps, preps, prepComps, catEmbs, prodEmbs, cfgPerda, mps] = await Promise.all([
    buscarTudo(() => supabase.from('embalagens').select('id,codigo,nome,categoria,tipo,custo_unitario').eq('ativo', true).order('id')),
    buscarTudo(() => supabase.from('producao_diaria').select('id,embalagem_id,quantidade')
      .gte('data_producao', ini).lte('data_producao', fim)
      .not('registrado_por', 'ilike', '%(auto-embalagem)%').order('id')),
    buscarTudo(() => supabase.from('produto_composicao').select('id,sku_produto,preparacao_id,quantidade_por_unidade').order('id')),
    buscarTudo(() => supabase.from('preparacoes').select('id,nome,tipo,rendimento_estimado,rendimento_real_medio,perda_percentual').order('id')),
    buscarTudo(() => supabase.from('preparacao_composicao').select('id,preparacao_id,quantidade,materia_prima_id,sub_preparacao_id').order('id')),
    buscarTudo(() => supabase.from('categoria_embalagem').select('id,categoria,embalagem_id,quantidade,embalagens(custo_unitario)').order('id')),
    buscarTudo(() => supabase.from('produto_embalagem').select('id,sku_produto,embalagem_id,quantidade,embalagens(custo_unitario)').order('id')),
    supabase.from('configuracoes').select('chave,valor').eq('chave', 'perda_embalagem_pct'),
    buscarTudo(() => supabase.from('materias_primas').select('id,nome,unidade,custo_unitario').eq('ativo', true).order('id')),
  ])
  const perdaEmbPct = parseFloat(cfgPerda?.data?.[0]?.valor) || 2

  const mpMap = {}; for (const m of mps) mpMap[m.id] = m
  const embMap = {}; for (const e of embs) embMap[e.id] = e
  const prepMap = {}; for (const p of preps) prepMap[p.id] = p

  // Mesma regra de rendimento de todo o sistema: real já é líquido; estimado leva a perda
  const rendLiq = prep => {
    const real = parseFloat(prep.rendimento_real_medio) || null
    return real ? real : (parseFloat(prep.rendimento_estimado) || 1) * (1 - (parseFloat(prep.perda_percentual) || 0) / 100)
  }

  const cache = {}
  function custoPrepPorG(prepId, vis = new Set()) {
    if (cache[prepId] !== undefined) return cache[prepId]
    if (vis.has(prepId)) return 0
    const v = new Set([...vis, prepId])
    const prep = prepMap[prepId]; if (!prep) return 0
    const custo = prepComps.filter(c => c.preparacao_id === prepId).reduce((s, ing) => {
      if (ing.sub_preparacao_id) return s + (parseFloat(ing.quantidade) || 0) * custoPrepPorG(ing.sub_preparacao_id, v)
      return s + (parseFloat(ing.quantidade) || 0) * (parseFloat(mpMap[ing.materia_prima_id]?.custo_unitario) || 0)
    }, 0)
    const r = rendLiq(prep)
    cache[prepId] = r > 0 ? custo / r : 0
    return cache[prepId]
  }

  // Consumo de MP de uma preparação, por grama de rendimento (recursivo)
  const mpCache = {}
  function mpPorG(prepId, vis = new Set()) {
    if (mpCache[prepId]) return mpCache[prepId]
    if (vis.has(prepId)) return {}
    const v = new Set([...vis, prepId])
    const prep = prepMap[prepId]; if (!prep) return {}
    const acc = {}
    for (const ing of prepComps.filter(x => x.preparacao_id === prepId)) {
      const q = parseFloat(ing.quantidade) || 0
      if (ing.sub_preparacao_id) {
        for (const [mpId, g] of Object.entries(mpPorG(ing.sub_preparacao_id, v))) acc[mpId] = (acc[mpId] || 0) + g * q
      } else if (ing.materia_prima_id) {
        acc[ing.materia_prima_id] = (acc[ing.materia_prima_id] || 0) + q
      }
    }
    const r = rendLiq(prep), out = {}
    if (r > 0) for (const [mpId, g] of Object.entries(acc)) out[mpId] = g / r
    mpCache[prepId] = out
    return out
  }

  const custoEmbCat = {}
  for (const ce of catEmbs) {
    custoEmbCat[ce.categoria] = (custoEmbCat[ce.categoria] || 0)
      + (parseFloat(ce.quantidade) || 1) * (parseFloat(ce.embalagens?.custo_unitario) || 0)
  }
  // Vínculo por produto tem precedência sobre o padrão da categoria
  const custoEmbSku = {}
  for (const pe of prodEmbs) {
    custoEmbSku[pe.sku_produto] = (custoEmbSku[pe.sku_produto] || 0)
      + (parseFloat(pe.quantidade) || 1) * (parseFloat(pe.embalagens?.custo_unitario) || 0)
  }

  const skusComFicha = new Set(prodComps.map(p => p.sku_produto))
  const prodPorSku = {}
  for (const p of producao) {
    const emb = embMap[p.embalagem_id]
    if (!emb) continue
    if (emb.tipo !== 'rotulo' && !skusComFicha.has(emb.codigo)) continue
    if (!prodPorSku[emb.codigo]) prodPorSku[emb.codigo] = { emb, qtd: 0 }
    prodPorSku[emb.codigo].qtd += p.quantidade
  }

  const mpQtd = {}   // consumo teórico de MP no mês, por MP
  const produzidos = Object.values(prodPorSku).map(({ emb, qtd }) => {
    const comps = prodComps.filter(c => c.sku_produto === emb.codigo)
    const mpUnit = comps.reduce((s, c) => s + custoPrepPorG(c.preparacao_id) * (parseFloat(c.quantidade_por_unidade) || 0), 0)
    const embUnit = (parseFloat(emb.custo_unitario) || 0) + (custoEmbSku[emb.codigo] ?? (custoEmbCat[emb.categoria] || 0))

    const porMP = {}
    for (const cp of comps) {
      const gramas = parseFloat(cp.quantidade_por_unidade) || 0
      for (const [mpId, gPorG] of Object.entries(mpPorG(cp.preparacao_id))) {
        const g = gPorG * gramas
        const mp = mpMap[mpId]
        if (!porMP[mpId]) porMP[mpId] = { nome: mp?.nome || '?', unidade: mp?.unidade, qtd: 0, custo: 0 }
        porMP[mpId].qtd += g
        porMP[mpId].custo += g * (parseFloat(mp?.custo_unitario) || 0)
        mpQtd[mpId] = (mpQtd[mpId] || 0) + g * qtd
      }
    }
    const mpsProd = Object.values(porMP).filter(m => m.custo > 0).sort((a, b) => b.custo - a.custo)
    return { emb, qtd, mpUnit, embUnit, cmvUnit: mpUnit + embUnit, total: (mpUnit + embUnit) * qtd, mps: mpsProd }
  }).sort((a, b) => b.total - a.total)

  // Embalagem pela produção: rótulo (1 por unidade) + vínculos × quantidade
  const embQtd = {}
  const addEmb = (id, q) => { if (id) embQtd[id] = (embQtd[id] || 0) + q }
  for (const { emb, qtd } of Object.values(prodPorSku)) {
    addEmb(emb.id, qtd)
    const links = prodEmbs.filter(pe => pe.sku_produto === emb.codigo)
    if (links.length) for (const pe of links) addEmb(pe.embalagem_id, qtd * (parseFloat(pe.quantidade) || 1))
    else for (const ce of catEmbs.filter(x => x.categoria === emb.categoria)) addEmb(ce.embalagem_id, qtd * (parseFloat(ce.quantidade) || 1))
  }

  return {
    produzidos, mpQtd, embQtd, perdaEmbPct,
    cmvMP: produzidos.reduce((s, p) => s + p.mpUnit * p.qtd, 0),
    cmvEmb: produzidos.reduce((s, p) => s + p.embUnit * p.qtd, 0),
    unidades: produzidos.reduce((s, p) => s + p.qtd, 0),
  }
}

// ── CMV real de um mês ───────────────────────────────────────────
// Mês fechado: devolve o congelado. Aberto: calcula ao vivo (provisório).
export async function calcularCMVMes(mes, { base, fechamentos, teorico } = {}) {
  fechamentos = fechamentos || await carregarFechamentos()
  if (fechamentos[mes]) {
    return { mes, status: 'fechado', fechado_em: fechamentos[mes].fechado_em, linhas: fechamentos[mes].linhas }
  }
  const ini = mes + '-01', fim = ultimoDia(mes)
  const mesAnt = mesAnterior(mes), fimAnt = ultimoDia(mesAnt)
  base = base || await carregarBase(fim)
  teorico = teorico || await calcularTeorico(ini, fim)

  const eiFechado = {}
  for (const l of (fechamentos[mesAnt]?.linhas || [])) eiFechado[`${l.tipo}:${l.item_id}`] = l

  // Compras atrasadas que caem neste mês
  const atrasadas = { mp: {}, emb: {} }
  for (const tipo of ['mp', 'emb']) {
    for (const c of base.comprasLista[tipo]) {
      const mC = c.data.slice(0, 7)
      const f = fechamentos[mC]
      if (!f || !(c.ts > f.fechado_em) || destinoAtrasada(c, fechamentos) !== mes) continue
      const a = atrasadas[tipo][c.item] || (atrasadas[tipo][c.item] = { qtd: 0, valor: 0 })
      a.qtd += c.qtd; a.valor += c.valor
    }
  }

  const linhas = []
  for (const tipo of ['mp', 'emb']) {
    const teoQtd = tipo === 'mp' ? teorico.mpQtd : teorico.embQtd
    for (const item of base.itens[tipo]) {
      // Estoque inicial: o final congelado do mês anterior; senão contagem/saldo no fim dele
      let ei
      const congelado = eiFechado[`${tipo}:${item.id}`]
      if (fechamentos[mesAnt]) {
        ei = congelado
          ? { qtd: parseFloat(congelado.ef_qtd), valor: parseFloat(congelado.ef_valor), origem: 'fechamento' }
          : { qtd: 0, valor: 0, origem: 'fechamento' }
      } else {
        const e = estoqueEm(base, tipo, item.id, fimAnt)
        ei = e ? { ...e, valor: valorPEPS(base, tipo, item, e.qtd, fimAnt) } : null
      }

      const doMes = (base.compras[tipo][item.id] || []).filter(c => c.data >= ini && c.data <= fim)
      const compras = { qtd: doMes.reduce((s, c) => s + c.qtd, 0), valor: doMes.reduce((s, c) => s + c.valor, 0) }
      const atr = atrasadas[tipo][item.id] || { qtd: 0, valor: 0 }

      const e = estoqueEm(base, tipo, item.id, fim)
      const ef = e ? { ...e, valor: valorPEPS(base, tipo, item, e.qtd, fim) } : null

      const cmvQtd = ei && ef ? ei.qtd + compras.qtd + atr.qtd - ef.qtd : null
      const cmvValor = ei && ef ? ei.valor + compras.valor + atr.valor - ef.valor : null
      const tQtd = teoQtd[item.id] || 0
      const unitReal = cmvQtd > 0 ? cmvValor / cmvQtd : (parseFloat(item.custo_unitario) || 0)

      const vazio = !ei?.qtd && !compras.qtd && !atr.qtd && !ef?.qtd && !tQtd && !cmvQtd
      if (vazio) continue
      linhas.push({
        mes, tipo, item_id: item.id, nome: item.nome, categoria: item.categoria || null,
        unidade: tipo === 'mp' ? item.unidade : 'un',
        ei_qtd: ei?.qtd ?? null, ei_valor: ei?.valor ?? null, ei_origem: ei?.origem ?? null,
        compras_qtd: compras.qtd, compras_valor: compras.valor,
        atrasadas_qtd: atr.qtd, atrasadas_valor: atr.valor,
        ef_qtd: ef?.qtd ?? null, ef_valor: ef?.valor ?? null, ef_origem: ef?.origem ?? null,
        cmv_qtd: cmvQtd, cmv_valor: cmvValor,
        teorico_qtd: tQtd, teorico_valor: tQtd * unitReal,
      })
    }
  }
  linhas.sort((a, b) => (b.cmv_valor || 0) - (a.cmv_valor || 0))
  return { mes, status: 'provisorio', linhas, teorico }
}

// ── Fechamento automático ────────────────────────────────────────
// Chamado ao abrir o sistema. Fecha, em ordem, os meses vencidos ainda
// abertos. Falha em silêncio (ex.: tabela ainda não criada).
let fechando = null
export function fecharMesesPendentes() {
  if (!fechando) fechando = _fecharMesesPendentes().catch(e => { console.warn('Fechamento CMV:', e?.message || e) })
  return fechando
}

async function _fecharMesesPendentes() {
  const alvo = ultimoMesFechavel()
  const fechamentos = await carregarFechamentos()

  // Descobre o primeiro mês sem carregar a base inteira
  const [{ data: c1 }, { data: c2 }] = await Promise.all([
    supabase.from('conferencia_mp').select('data_conferencia').lte('data_conferencia', ultimoDia(alvo)),
    supabase.from('mp_inventarios').select('data_inventario').lte('data_inventario', ultimoDia(alvo)),
  ])
  const fimDeMes = [...(c1 || []).map(c => c.data_conferencia), ...(c2 || []).map(c => c.data_inventario)]
    .filter(d => d && d === ultimoDia(d.slice(0, 7))).sort()
  if (!fimDeMes.length) return
  let m = mesSeguinte(fimDeMes[0].slice(0, 7))
  if (m > alvo) return

  const pendentes = []
  for (let x = m; x <= alvo; x = mesSeguinte(x)) if (!fechamentos[x]) pendentes.push(x)
  if (!pendentes.length) return

  const base = await carregarBase(ultimoDia(alvo))
  for (const mes of pendentes) {
    const r = await calcularCMVMes(mes, { base, fechamentos })
    const fechado_em = new Date().toISOString()
    const rows = r.linhas.map(l => ({ ...l, fechado_em }))
    if (rows.length) {
      const { error } = await supabase.from('fechamento_cmv').insert(rows)
      if (error) throw error   // outro acesso fechou ao mesmo tempo (unique) — para aqui
    }
    fechamentos[mes] = { mes, fechado_em, linhas: rows }
  }
}
