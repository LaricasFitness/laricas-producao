import { supabase } from '../supabase'

// Rendimento líquido de uma preparação: real já é medido líquido; estimado leva a perda
function rendLiquido(prep) {
  const real = parseFloat(prep?.rendimento_real_medio) || null
  if (real) return real
  const bruto = parseFloat(prep?.rendimento_estimado) || 1
  const perda = parseFloat(prep?.perda_percentual) || 0
  return bruto * (1 - perda / 100)
}

// Consumo de MP de um produto × quantidade, pela ficha técnica
// Retorna { mpId: gramas }
export async function calcularConsumoMP(sku, quantidade) {
  const { data: comps } = await supabase
    .from('produto_composicao')
    .select('preparacao_id, quantidade_por_unidade')
    .eq('sku_produto', sku)
  if (!comps?.length) return {}

  const prepIds = [...new Set(comps.map(c => c.preparacao_id))]
  const [{ data: preps }, { data: todosIngs }] = await Promise.all([
    supabase.from('preparacoes').select('id, rendimento_estimado, rendimento_real_medio, perda_percentual'),
    supabase.from('preparacao_composicao').select('preparacao_id, quantidade, materia_prima_id, sub_preparacao_id'),
  ])
  const prepMap = {}
  for (const p of (preps || [])) prepMap[p.id] = p

  // g de MP por g de preparação (recursivo para sub-preparações)
  const cache = {}
  function mpPorG(prepId, vis = new Set()) {
    if (cache[prepId]) return cache[prepId]
    if (vis.has(prepId)) return {}
    const v = new Set([...vis, prepId])
    const ings = (todosIngs || []).filter(i => i.preparacao_id === prepId)
    const rend = rendLiquido(prepMap[prepId])
    const out = {}
    for (const ing of ings) {
      const q = parseFloat(ing.quantidade) || 0
      if (ing.sub_preparacao_id) {
        const sub = mpPorG(ing.sub_preparacao_id, v)
        for (const [mpId, g] of Object.entries(sub)) {
          out[mpId] = (out[mpId] || 0) + (g * q) / (rend || 1)
        }
      } else if (ing.materia_prima_id) {
        out[ing.materia_prima_id] = (out[ing.materia_prima_id] || 0) + q / (rend || 1)
      }
    }
    cache[prepId] = out
    return out
  }
  for (const id of prepIds) mpPorG(id)

  const total = {}
  for (const c of comps) {
    const gPrep = (parseFloat(c.quantidade_por_unidade) || 0) * quantidade
    for (const [mpId, gPorG] of Object.entries(mpPorG(c.preparacao_id))) {
      total[mpId] = (total[mpId] || 0) + gPorG * gPrep
    }
  }
  return total
}

async function ajustarEstoqueMP(mpId, delta) {
  const { data: mp } = await supabase.from('materias_primas').select('estoque_atual').eq('id', mpId).single()
  const novo = Math.max(0, (parseFloat(mp?.estoque_atual) || 0) + delta)
  await supabase.from('materias_primas')
    .update({ estoque_atual: novo, atualizado_em: new Date().toISOString() })
    .eq('id', mpId)
}

async function ajustarEstoqueEmb(embId, delta) {
  const { data: e } = await supabase.from('embalagens').select('estoque_atual').eq('id', embId).single()
  const novo = Math.max(0, (parseFloat(e?.estoque_atual) || 0) + delta)
  await supabase.from('embalagens')
    .update({ estoque_atual: novo, atualizado_em: new Date().toISOString() })
    .eq('id', embId)
}

/**
 * Edita um registro de produção corrigindo TODOS os efeitos:
 * reverte o consumo de MP e o estoque de embalagem antigos,
 * aplica os novos conforme a ficha técnica.
 */
export async function editarProducao(rowId, { novoEmbalagemId, novaQuantidade }) {
  const { data: row } = await supabase
    .from('producao_diaria')
    .select('id, embalagem_id, quantidade, data_producao, embalagens(codigo, nome)')
    .eq('id', rowId).single()
  if (!row) throw new Error('Registro de produção não encontrado.')

  const embAntigo = row.embalagem_id
  const qtdAntiga = parseFloat(row.quantidade) || 0
  const embNovo = novoEmbalagemId || embAntigo
  const qtdNova = novaQuantidade !== undefined ? (parseFloat(novaQuantidade) || 0) : qtdAntiga
  if (embNovo === embAntigo && qtdNova === qtdAntiga) return { alterado: false }

  // 1) Reverte MP consumida por este registro.
  //    Preferência: débitos reais gravados (exato).
  //    Fallback: recalcula pela ficha — necessário para registros anteriores
  //    ao vínculo producao_diaria_id, que não têm débitos rastreáveis.
  const { data: consumos } = await supabase
    .from('mp_consumos').select('id, materia_prima_id, quantidade')
    .eq('producao_diaria_id', rowId)

  let revertidoPorFicha = false
  if (consumos?.length) {
    for (const c of consumos) {
      await ajustarEstoqueMP(c.materia_prima_id, parseFloat(c.quantidade) || 0)
    }
    await supabase.from('mp_consumos').delete().eq('producao_diaria_id', rowId)
  } else {
    const consumoAntigo = await calcularConsumoMP(row.embalagens?.codigo, qtdAntiga)
    for (const [mpId, g] of Object.entries(consumoAntigo)) {
      if (g > 0) await ajustarEstoqueMP(mpId, g)
    }
    revertidoPorFicha = Object.keys(consumoAntigo).length > 0
  }

  // 2) Devolve a embalagem antiga ao estoque
  await ajustarEstoqueEmb(embAntigo, qtdAntiga)

  // 3) Atualiza o registro
  await supabase.from('producao_diaria')
    .update({ embalagem_id: embNovo, quantidade: qtdNova })
    .eq('id', rowId)

  // 4) Debita a embalagem nova
  await ajustarEstoqueEmb(embNovo, -qtdNova)

  // 5) Recalcula e grava o consumo de MP novo
  const { data: embInfo } = await supabase
    .from('embalagens').select('codigo, nome').eq('id', embNovo).single()
  const consumo = await calcularConsumoMP(embInfo?.codigo, qtdNova)
  const linhas = []
  for (const [mpId, g] of Object.entries(consumo)) {
    if (!(g > 0)) continue
    await ajustarEstoqueMP(mpId, -g)
    linhas.push({
      materia_prima_id: mpId,
      quantidade: g,
      data_consumo: row.data_producao,
      origem: 'producao',
      sku_produto: embInfo?.codigo,
      quantidade_produzida: qtdNova,
      producao_diaria_id: rowId,
      descricao: `${embInfo?.nome} (${qtdNova} un) — edição de registro`,
    })
  }
  if (linhas.length) await supabase.from('mp_consumos').insert(linhas)

  return {
    alterado: true,
    de: `${row.embalagens?.nome} (${qtdAntiga} un)`,
    para: `${embInfo?.nome} (${qtdNova} un)`,
    mpsAjustadas: linhas.length,
    revertidoPorFicha,
  }
}

// Exclui um registro de produção, revertendo embalagem e matéria-prima
export async function excluirProducao(rowId) {
  const { data: row } = await supabase
    .from('producao_diaria')
    .select('id, embalagem_id, quantidade, embalagens(codigo, nome)')
    .eq('id', rowId).single()
  if (!row) throw new Error('Registro não encontrado.')

  const qtd = parseFloat(row.quantidade) || 0

  // Reverte MP: usa débitos gravados; se não houver, recalcula pela ficha
  const { data: consumos } = await supabase
    .from('mp_consumos').select('materia_prima_id, quantidade')
    .eq('producao_diaria_id', rowId)
  if (consumos?.length) {
    for (const c of consumos) await ajustarEstoqueMP(c.materia_prima_id, parseFloat(c.quantidade) || 0)
    await supabase.from('mp_consumos').delete().eq('producao_diaria_id', rowId)
  } else {
    const consumo = await calcularConsumoMP(row.embalagens?.codigo, qtd)
    for (const [mpId, g] of Object.entries(consumo)) {
      if (g > 0) await ajustarEstoqueMP(mpId, g)
    }
  }

  // Devolve a embalagem e remove o registro
  await ajustarEstoqueEmb(row.embalagem_id, qtd)
  await supabase.from('producao_diaria').delete().eq('id', rowId)

  return { nome: row.embalagens?.nome, quantidade: qtd }
}

// Adiciona um item de produção a um dia já existente
export async function adicionarProducao({ embalagemId, quantidade, dataProducao, registradoPor }) {
  const qtd = parseFloat(quantidade) || 0
  if (!embalagemId || qtd <= 0) throw new Error('Produto e quantidade são obrigatórios.')

  const { data: emb } = await supabase
    .from('embalagens').select('codigo, nome').eq('id', embalagemId).single()

  const { data: novo, error } = await supabase.from('producao_diaria').insert({
    embalagem_id: embalagemId,
    quantidade: qtd,
    data_producao: dataProducao,
    registrado_por: registradoPor || 'Edição de lote',
  }).select().single()
  if (error) throw error

  await ajustarEstoqueEmb(embalagemId, -qtd)

  const consumo = await calcularConsumoMP(emb?.codigo, qtd)
  const linhas = []
  for (const [mpId, g] of Object.entries(consumo)) {
    if (!(g > 0)) continue
    await ajustarEstoqueMP(mpId, -g)
    linhas.push({
      materia_prima_id: mpId, quantidade: g, data_consumo: dataProducao,
      origem: 'producao', sku_produto: emb?.codigo, quantidade_produzida: qtd,
      producao_diaria_id: novo.id,
      descricao: `${emb?.nome} (${qtd} un) — incluído na edição do lote`,
    })
  }
  if (linhas.length) await supabase.from('mp_consumos').insert(linhas)

  return { id: novo.id, nome: emb?.nome, quantidade: qtd }
}
