import { supabase } from '../supabase'

// Rendimento real das preparações (tabela preparacao_rendimento), usado pela tela Rendimentos
// e pela impressão das etiquetas de validade (que pode lançar o rendimento da mesma produção).

// Estimado é bruto (soma dos ingredientes); o real é líquido → comparar com estimado × (1 − perda%)
export function estimadoLiquido(prep) {
  const est = parseFloat(prep.rendimento_estimado) || 0
  const perda = parseFloat(prep.perda_percentual) || 0
  return est * (1 - perda / 100)
}

// Recalcula a média ponderada dos últimos 10 (Σ rendimento_total ÷ Σ num_receitas) e atualiza a preparação
export async function recalcularMedia(preparacao_id) {
  const { data: hist } = await supabase
    .from('preparacao_rendimento')
    .select('rendimento_total, num_receitas')
    .eq('preparacao_id', preparacao_id)
    .order('criado_em', { ascending: false })
    .limit(10)
  const somaTotal = (hist||[]).reduce((s,r) => s + (parseFloat(r.rendimento_total)||0), 0)
  const somaRec = (hist||[]).reduce((s,r) => s + (parseFloat(r.num_receitas)||0), 0)
  const media = somaRec > 0 ? somaTotal / somaRec : null
  await supabase.from('preparacoes').update({ rendimento_real_medio: media, atualizado_em: new Date().toISOString() }).eq('id', preparacao_id)
}
