import { supabase } from '../supabase'

// Categorias que precisam de 15 dias de antecedência
const CATEGORIAS_15_DIAS = ['Pão de Mel', 'Barra', 'Chocotone']

export function diasProducao(categoria) {
  return CATEGORIAS_15_DIAS.includes(categoria) ? 15 : 7
}

export async function carregarEmbalagens() {
  const { data, error } = await supabase
    .from('embalagens')
    .select('*')
    .eq('ativo', true)
    .order('categoria')
    .order('nome')
  if (error) throw error
  return data || []
}

// Calcula média diária de produção dos últimos 30 dias
export async function calcularMediaDiaria(embalagemId) {
  const trinta = new Date()
  trinta.setDate(trinta.getDate() - 30)
  const { data } = await supabase
    .from('producao_diaria')
    .select('quantidade, data_producao')
    .eq('embalagem_id', embalagemId)
    .gte('data_producao', trinta.toISOString().slice(0, 10))

  if (!data || data.length === 0) return 0
  const total = data.reduce((s, r) => s + r.quantidade, 0)
  // Divide pelos 30 dias (não pelos dias com registro — evita inflação da média)
  return total / 30
}

export async function carregarStatusCompleto() {
  const embs = await carregarEmbalagens()
  const resultado = []

  for (const emb of embs) {
    const media = await calcularMediaDiaria(emb.id)
    const dias = emb.dias_producao || diasProducao(emb.categoria)
    const margem = emb.margem_seguranca || 0.10

    // Estoque mínimo = produção média × dias de antecedência × (1 + margem segurança)
    const minimoIdeal = Math.ceil(media * dias * (1 + margem))

    const estoque = emb.estoque_atual || 0
    const falta = Math.max(0, minimoIdeal - estoque)
    const minGraf = emb.unidade_minima_grafica || 100
    const qtdPedido = falta > 0 ? Math.ceil(falta / minGraf) * minGraf : 0

    // Dias de estoque restantes
    const diasRestantes = media > 0 ? Math.floor(estoque / media) : null

    const status = !media ? 'sem-dados'
      : estoque < minimoIdeal * 0.5 ? 'critico'
      : estoque < minimoIdeal ? 'atencao'
      : 'ok'

    resultado.push({
      ...emb,
      media,
      minimoIdeal,
      diasRestantes,
      qtdPedido,
      status,
    })
  }
  return resultado
}

export function gerarNumeroPedido() {
  const d = new Date()
  return `GRF-${d.getFullYear().toString().slice(-2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(Math.floor(Math.random()*99)+1).padStart(2,'0')}`
}

export function statusConfig(s) {
  return {
    ok:        { label: '✅ OK',        cls: 'pill-ok',      rowCls: '' },
    atencao:   { label: '⚠️ Atenção',  cls: 'pill-warning', rowCls: 'row-warning' },
    critico:   { label: '🚨 Crítico',   cls: 'pill-danger',  rowCls: 'row-danger' },
    'sem-dados':{ label: '—',           cls: 'pill-gray',    rowCls: '' },
  }[s] || { label: s, cls: 'pill-gray', rowCls: '' }
}
