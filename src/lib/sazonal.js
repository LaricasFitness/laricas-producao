import { supabase } from '../supabase'

// Produtos sazonais (ex.: Chocotone no Natal).
// Uma categoria é sazonal quando o nome tem a marca [SAZONAL]: "Chocotone [SAZONAL]".
// Em Admin › Sistema cada categoria sazonal fica "em temporada" (aparece) ou
// "fora de temporada" (some das telas de uso: produção, planejamento, estoque,
// compras, pedidos à gráfica, custos e cadastros).
// Históricos e valores em R$ (log, análises, CMV do mês, valor do estoque) NUNCA
// escondem nada: o que aconteceu continua contando.
//
// Guardado em configuracoes.chave = 'sazonais_ocultos' (lista JSON das categorias
// fora de temporada). Sem a chave, tudo aparece.

export const MARCA_SAZONAL = '[SAZONAL]'
const CHAVE = 'sazonais_ocultos'

export const ehSazonal = cat => /\[\s*sazonal\s*\]/i.test(cat || '')

let ocultas = new Set()

export async function carregarSazonais() {
  try {
    const { data } = await supabase.from('configuracoes').select('valor').eq('chave', CHAVE).maybeSingle()
    const lista = JSON.parse(data?.valor || '[]')
    ocultas = new Set(Array.isArray(lista) ? lista : [])
  } catch { ocultas = new Set() }
  return ocultas
}

// Categoria sazonal que está fora de temporada
export const categoriaOculta = cat => ehSazonal(cat) && ocultas.has(cat)
// Produto/embalagem (qualquer objeto com .categoria) que está escondido agora
export const ocultoSazonal = e => categoriaOculta(e?.categoria)
// Lista sem os escondidos. `manter` mantém um item mesmo escondido (ex.: o já escolhido num formulário)
export const semOcultos = (lista, manter) => (lista || []).filter(e => !ocultoSazonal(e) || (manter && manter(e)))
// Códigos (SKU) escondidos de uma lista de embalagens
export const skusOcultos = lista => new Set((lista || []).filter(ocultoSazonal).map(e => e.codigo).filter(Boolean))
export const emTemporada = cat => !categoriaOculta(cat)

export async function definirTemporada(cat, ativa) {
  const nova = new Set(ocultas)
  if (ativa) nova.delete(cat); else nova.add(cat)
  const { error } = await supabase.from('configuracoes').upsert({
    chave: CHAVE, valor: JSON.stringify([...nova].sort()),
    descricao: 'Categorias sazonais fora de temporada (escondidas das telas de uso). Admin › Sistema.',
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'chave' })
  if (error) throw error
  ocultas = nova
}
