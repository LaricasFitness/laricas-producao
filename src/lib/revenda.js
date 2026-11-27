import { supabase } from '../supabase'

// Mercadoria para revenda feita por terceiros com material nosso (Wafer na MM Produtos Alimentícios).
// O display e o filme são comprados por nós e ficam guardados na MM; cada lote de wafer que a MM fatura consome
// uma parte deles. Custo de cada lote = NF da MM (só o wafer) + frete do lote + displays usados + filme usado.
// Esse custo completo vai para a compra do lote (mp_compras), então o CMV de revenda já carrega tudo.
// Os pagamentos de display, filme e frete continuam só no caixa (contas de CMV "só caixa"): na competência eles
// entram pelo consumo, lote a lote.
//
// configuracoes.revenda_componentes = {
//   componentes: [{ id, nome, unidade, rende (wafers por unidade do componente), compras: [{ data, nf, fornecedor, qtd, valor, obs }] }],
//   lotes: [{ id, data, nf, unidades, wafer, frete, compraId, historico, obs, uso: { [componente]: { qtd, valor } } }],
// }

export const CHAVE_COMPONENTES = 'revenda_componentes'

export const COMPONENTES_PADRAO = {
  componentes: [
    { id: 'display', nome: 'Display', unidade: 'un', rende: 12,
      compras: [{ data: '2026-07-06', nf: '10795', fornecedor: 'JF Print Grafica e Editora', qtd: 1375, valor: 2076.25 }] },
    { id: 'filme', nome: 'Filme da embalagem', unidade: 'kg', rende: 3504 / 5.7,
      compras: [{ data: '2026-08-19', nf: '10508', fornecedor: 'Mult Flex Rótulos e Embalagens', qtd: 65.285, valor: 7184.30, obs: 'inclui clichê (1.356,23), frete (269,00) e IPI (517,76)' }] },
  ],
  lotes: [
    { id: 'lote-73450', data: '2026-09-04', nf: '73450', unidades: 3504, historico: true,
      obs: '1º lote, antes do controle no sistema (meses fechados): só baixa o display e o filme usados' },
  ],
}

const r2 = v => Math.round(v * 100) / 100
const r4 = v => Math.round(v * 10000) / 10000

export async function carregarComponentes() {
  const { data } = await supabase.from('configuracoes').select('valor').eq('chave', CHAVE_COMPONENTES).maybeSingle()
  try { if (data?.valor) return { ...JSON.parse(data.valor), padrao: false } } catch { /* cai no padrão */ }
  return { ...structuredClone(COMPONENTES_PADRAO), padrao: true }
}

export async function gravarComponentes(cfg) {
  const { padrao, ...valor } = cfg   // eslint-disable-line no-unused-vars
  const { error } = await supabase.from('configuracoes').upsert({ chave: CHAVE_COMPONENTES, valor: JSON.stringify(valor),
    descricao: 'Wafer: display e filme guardados na MM e o que cada lote consumiu', atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })
  if (error) throw error
}

// Custo médio de cada unidade do componente (todas as compras dele)
export function custoComponente(c) {
  const q = c.compras.reduce((t, x) => t + (+x.qtd || 0), 0), v = c.compras.reduce((t, x) => t + (+x.valor || 0), 0)
  return q > 0 ? v / q : 0
}

// Lotes que contam: históricos e os que ainda têm a compra no sistema (compra apagada = lote desfeito)
export const lotesValidos = (cfg, compraIds) => cfg.lotes.filter(l => l.historico || !l.compraId || compraIds.has(l.compraId))

// Saldo de cada componente na MM: comprado − usado nos lotes
export function saldos(cfg, compraIds) {
  const lotes = lotesValidos(cfg, compraIds)
  return cfg.componentes.map(c => {
    const comprado = c.compras.reduce((t, x) => t + (+x.qtd || 0), 0)
    const usado = lotes.reduce((t, l) => t + (l.uso?.[c.id]?.qtd ?? (+l.unidades || 0) / c.rende), 0)
    const unit = custoComponente(c)
    return { ...c, comprado, usado, saldo: comprado - usado, unit, porWafer: unit / c.rende, valorSaldo: (comprado - usado) * unit, rendeSaldo: (comprado - usado) * c.rende }
  })
}

// Valor do display e do filme na MM numa data (fim do dia): comprado até a data − usado nos lotes até a data,
// pelo custo médio. Entra na prova da competência: material pago que ainda não virou custo.
export function valorNaMMEm(cfg, data) {
  return cfg.componentes.reduce((t, c) => {
    const comprado = c.compras.filter(x => x.data <= data).reduce((s, x) => s + (+x.qtd || 0), 0)
    const usado = cfg.lotes.filter(l => l.data <= data).reduce((s, l) => s + (l.uso?.[c.id]?.qtd ?? (+l.unidades || 0) / c.rende), 0)
    return t + (comprado - usado) * custoComponente(c)
  }, 0)
}

// Custo de um lote novo: { uso, componentes, total, porWafer }
export function custoLote(cfg, { unidades, wafer, frete }) {
  const n = +unidades || 0, uso = {}
  let comp = 0
  for (const c of cfg.componentes) {
    const qtd = n / c.rende, valor = r2(qtd * custoComponente(c))
    uso[c.id] = { qtd: r4(qtd), valor }
    comp += valor
  }
  const total = r2((+wafer || 0) + (+frete || 0) + comp)
  return { uso, componentes: r2(comp), total, porWafer: n ? total / n : 0 }
}
