import { supabase } from '../supabase'

const CATS_15 = ['Pão de Mel 100g', 'Mini Pão de Mel 30g', 'Barra 180g']

export function diasPorCategoria(cat) {
  return CATS_15.includes(cat) ? 15 : 7
}

export async function carregarEmbalagens() {
  const { data, error } = await supabase
    .from('embalagens').select('*')
    .eq('visivel_producao', true)
    .order('categoria').order('nome')
  if (error) throw error
  return data || []
}

export async function carregarEmbalagenEstoque() {
  const { data, error } = await supabase
    .from('embalagens').select('*')
    .eq('visivel_estoque', true)
    .order('categoria').order('nome')
  if (error) throw error
  return data || []
}

export async function carregarTodasEmbalagens() {
  const { data } = await supabase
    .from('embalagens').select('*').order('categoria').order('nome')
  return data || []
}

// Média diária ponderada: últimas 4 semanas valem 2x mais que as 4 anteriores
export async function calcularMedia(embalagemId) {
  const desde8s = new Date()
  desde8s.setDate(desde8s.getDate() - 56)
  const desde4s = new Date()
  desde4s.setDate(desde4s.getDate() - 28)

  const { data } = await supabase
    .from('producao_diaria')
    .select('quantidade, data_producao')
    .eq('embalagem_id', embalagemId)
    .gte('data_producao', desde8s.toISOString().slice(0, 10))

  if (!data?.length) return 0

  const corte4s = desde4s.toISOString().slice(0, 10)

  // Separa as duas janelas
  const recente   = data.filter(r => r.data_producao >= corte4s)
  const anterior  = data.filter(r => r.data_producao <  corte4s)

  const totalRecente  = recente.reduce((s, r) => s + r.quantidade, 0)
  const totalAnterior = anterior.reduce((s, r) => s + r.quantidade, 0)

  // Média diária ponderada: recente (28 dias) peso 2, anterior (28 dias) peso 1
  // Equivale a: (totalRecente*2 + totalAnterior*1) / (28*2 + 28*1)
  const mediaPonderada = (totalRecente * 2 + totalAnterior * 1) / (28 * 2 + 28 * 1)

  return mediaPonderada
}

// Consumo semanal agrupado (últimas N semanas) para gráfico
export async function consumoSemanal(embalagemId, semanas = 8) {
  const desde = new Date()
  desde.setDate(desde.getDate() - semanas * 7)
  const { data } = await supabase
    .from('producao_diaria')
    .select('quantidade, data_producao')
    .eq('embalagem_id', embalagemId)
    .gte('data_producao', desde.toISOString().slice(0, 10))
    .order('data_producao')
  if (!data?.length) return []

  // Agrupa por semana (seg-dom)
  const semMap = {}
  for (const r of data) {
    const d = new Date(r.data_producao + 'T00:00:00')
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const mon = new Date(d); mon.setDate(d.getDate() + diff)
    const key = mon.toISOString().slice(0, 10)
    semMap[key] = (semMap[key] || 0) + r.quantidade
  }
  return Object.entries(semMap).sort(([a],[b]) => a.localeCompare(b))
    .map(([semana, total]) => ({ semana, total }))
}

// Status completo de todas as embalagens
export async function carregarStatusCompleto() {
  const embs = await carregarEmbalagenEstoque()
  const result = []

  for (const emb of embs) {
    // Média ponderada (8 semanas, últimas 4 com peso 2)
    const mediaPonderada = await calcularMedia(emb.id)

    // Média simples das últimas 4 semanas para calcular tendência
    const desde4s = new Date()
    desde4s.setDate(desde4s.getDate() - 28)
    const { data: dados4s } = await supabase
      .from('producao_diaria')
      .select('quantidade')
      .eq('embalagem_id', emb.id)
      .gte('data_producao', desde4s.toISOString().slice(0, 10))
    const media4s = dados4s?.length
      ? dados4s.reduce((s, r) => s + r.quantidade, 0) / 28
      : 0

    const dias = emb.dias_producao || diasPorCategoria(emb.categoria)
    const margem = emb.margem_seguranca || 0.10
    const estoque = emb.estoque_atual || 0

    const minimoIdeal = Math.ceil(mediaPonderada * dias * (1 + margem))
    const diasRestantes = mediaPonderada > 0 ? Math.floor(estoque / mediaPonderada) : null

    const falta = Math.max(0, minimoIdeal - estoque)
    const minG = emb.unidade_minima_grafica || 100
    const qtdPedido = falta > 0 ? Math.ceil(falta / minG) * minG : 0

    // Tendência: compara média das últimas 4 semanas vs média ponderada geral
    const tendencia = mediaPonderada > 0
      ? media4s > mediaPonderada * 1.1 ? 'up'
        : media4s < mediaPonderada * 0.9 ? 'down' : 'flat'
      : 'flat'

    const status = estoque === 0 ? 'critico'
      : diasRestantes !== null && diasRestantes <= dias * 0.5 ? 'critico'
      : diasRestantes !== null && diasRestantes <= dias ? 'atencao'
      : diasRestantes !== null ? 'ok'
      : 'sem-dados'

    result.push({
      ...emb,
      media: Math.round(mediaPonderada * 10) / 10,
      media4s: Math.round(media4s * 10) / 10,
      minimoIdeal,
      diasRestantes,
      qtdPedido,
      tendencia,
      status,
      dias,
    })
  }
  return result
}

export function statusCfg(s) {
  return {
    ok:         { label: 'OK',      cls: 'ok',      icon: '✅' },
    atencao:    { label: 'Atenção', cls: 'warning',  icon: '⚠️' },
    critico:    { label: 'Crítico', cls: 'danger',   icon: '🚨' },
    'sem-dados':{ label: 'Sem dados', cls: 'neutral', icon: '—' },
  }[s] || { label: s, cls: 'neutral', icon: '?' }
}

export function gerarNumeroPedido() {
  const d = new Date()
  return `GRF-${d.getFullYear().toString().slice(-2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(Math.floor(Math.random()*99)+1).padStart(2,'0')}`
}
