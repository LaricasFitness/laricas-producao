import { supabase } from '../supabase'
import { chamarExpedicao, nomeLoja } from './expedicao'

// Picking do dia: gerado ao fechar o planejamento de produção ("PDF Produção"), com os números dos
// pedidos que vieram na planilha do Bling para aquele dia. Busca cada pedido completo no Bling
// (itens, envio, cidade/UF, loja, observações) e guarda em expedicao_pickings; o líder de expedição
// baixa o PDF em Logística › Expedição. Gerar de novo para o mesmo dia substitui o anterior.

const POR_CHAMADA = 20

export async function gerarPickingDoDia(dataProducao, numeros, geradoPor, onProgresso) {
  const lista = [...new Set((numeros || []).map(String))]
  const pedidos = [], faltando = []
  let lojas = {}
  for (let i = 0; i < lista.length; i += POR_CHAMADA) {
    const r = await chamarExpedicao('picking', { numeros: lista.slice(i, i + POR_CHAMADA) })
    pedidos.push(...(r.pedidos || []))
    faltando.push(...(r.faltando || []))
    lojas = { ...lojas, ...(r.lojas || {}) }
    onProgresso?.(Math.min(lista.length, i + POR_CHAMADA), lista.length)
  }
  // gerar de novo mantém o que as etapas seguintes já marcaram (ex.: "Sem NF" na etapa de notas)
  const { data: antes } = await supabase.from('expedicao_pickings').select('pedidos').eq('data_producao', dataProducao).maybeSingle()
  const semNF = Object.fromEntries((antes?.pedidos || []).filter(p => p.semNF).map(p => [String(p.numero), p.semNF]))
  // só o que o PDF usa
  const guardar = pedidos.map(p => ({
    id: p.id, numero: p.numero, numeroLoja: p.numeroLoja, data: p.data, cliente: p.cliente, nf: p.nf,
    transportadora: p.transportadora, servico: p.servico, cidade: p.cidade, uf: p.uf,
    loja: nomeLoja(p, lojas), itens: p.itens, obs: p.obs, obsInterna: p.obsInterna,
    ...(semNF[String(p.numero)] ? { semNF: semNF[String(p.numero)] } : {}),
  }))
  const { error } = await supabase.from('expedicao_pickings').upsert({
    data_producao: dataProducao, pedidos: guardar, faltando,
    gerado_por: geradoPor || null, gerado_em: new Date().toISOString(), baixado_por: null, baixado_em: null,
  }, { onConflict: 'data_producao' })
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Aplique o expedicao_pickings.sql no Supabase.' : error.message)
  return { total: guardar.length, faltando }
}
