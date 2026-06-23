import { supabase } from '../supabase'

const CATS_15 = ['Pão de Mel 100g', 'Mini Pão de Mel 30g', 'Barra 180g']

export function diasPorCategoria(cat) {
  return CATS_15.includes(cat) ? 15 : 7
}

export async function carregarEmbalagens() {
  const { data, error } = await supabase
    .from('embalagens').select('*').eq('ativo', true)
    .order('categoria').order('nome')
  if (error) throw error
  return data || []
}

export async function carregarTodasEmbalagens() {
  const { data } = await supabase
    .from('embalagens').select('*').order('categoria').order('nome')
  return data || []
}

// Média diária das últimas N semanas
export async function calcularMedia(embalagemId, semanas = 8) {
  const desde = new Date()
  desde.setDate(desde.getDate() - semanas * 7)
  const { data } = await supabase
    .from('producao_diaria')
    .select('quantidade, data_producao')
    .eq('embalagem_id', embalagemId)
    .gte('data_producao', desde.toISOString().slice(0, 10))
  if (!data?.length) return 0
  const total = data.reduce((s, r) => s + r.quantidade, 0)
  return total / (semanas * 7)
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
  const embs = await carregarEmbalagens()
  const result = []

  for (const emb of embs) {
    const media8s = await calcularMedia(emb.id, 8)
    const media4s = await calcularMedia(emb.id, 4) // últimas 4 semanas

    const dias = emb.dias_producao || diasPorCategoria(emb.categoria)
    const margem = emb.margem_seguranca || 0.10
    const estoque = emb.estoque_atual || 0

    const minimoIdeal = Math.ceil(media8s * dias * (1 + margem))
    const diasRestantes = media8s > 0 ? Math.floor(estoque / media8s) : null

    // Sugestão de pedido
    const falta = Math.max(0, minimoIdeal - estoque)
    const minG = emb.unidade_minima_grafica || 100
    const qtdPedido = falta > 0 ? Math.ceil(falta / minG) * minG : 0

    // Tendência (4s vs 8s)
    const tendencia = media4s > media8s * 1.1 ? 'up'
      : media4s < media8s * 0.9 ? 'down' : 'flat'

    const status = estoque === 0 ? 'critico'
      : diasRestantes !== null && diasRestantes <= dias * 0.5 ? 'critico'
      : diasRestantes !== null && diasRestantes <= dias ? 'atencao'
      : diasRestantes !== null ? 'ok'
      : 'sem-dados'

    result.push({
      ...emb,
      media: Math.round(media8s * 10) / 10,
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
