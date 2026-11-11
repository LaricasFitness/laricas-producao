import { custoCanal, marketingCanal, itensReceber, itensCaixa } from './dre'

// Margem de contribuição por canal (competência, só receitas + CMV teórico):
//   receita bruta − descontos − comissões e taxas (inclui anúncios da plataforma) = receita líquida
//   receita líquida − CMV (% de custo do canal × receita bruta) − frete            = margem do canal
// O % de custo de cada canal vem da DRE-3.0 - 2026 da planilha (CMV ÷ faturamento do canal, jul a set/26),
// que já inclui embalagem do produto, rótulo, sacola e caixa. Fica editável por canal (dre_cmv_canal).
// Conferência: CMV do período × compras de matéria-prima e embalagens no caixa (diferença = perdas,
// brindes, vouchers, estoque que sobrou ou faltou).

export const CMV_PADRAO = 27          // canal novo, sem histórico na planilha
export const CMV_PADRAO_CANAL = {     // DRE-3.0 - 2026, média jul a set/26
  'iFood': 28.2, '99 Food': 22.9, 'Keeta': 22.9, 'Anota.AI': 23.7,
  'Site': 24.1, 'Clube': 32.3, 'Mercado Livre': 24.1,
  'Revenda': 41.7, 'Venda Direta': 48.2, 'Balcão': 26.0, 'Ativação': 30.4,
}

// Canais da margem: plataformas e Mercado Pago/Bling (dre_canal_competencia) + contas a receber do Bling
const CANAL_DO_RECEBER = { rec_revenda: 'Revenda', rec_direta: 'Venda Direta', rec_balcao: 'Balcão', rec_outras: null }
// Frete pago no caixa (Correios, Lalamove, Melhor Envio, motoboy, Uber) → site e clube, rateado pela receita
// bruta (o do Mercado Livre já vem nas taxas; sacola e caixa já estão no % de custo).
export const POOLS_ENVIO = {
  frete: { nome: 'Frete', canais: ['Site', 'Clube'] },
}
const CAT_FRETE = /^fretes?( e seguros)?$/i
export function poolEnvio(i) {
  if (i.tipo !== 'despesa') return null
  if (CAT_FRETE.test(i.categoria)) return 'frete'
  return null
}
export const ORDEM_CANAIS = ['iFood', '99 Food', 'Keeta', 'Anota.AI', 'Site', 'Clube', 'Mercado Livre', 'Revenda', 'Venda Direta', 'Balcão', 'Ativação']

export const pctCustoDe = (canal, tabela = {}) =>
  tabela[canal] != null ? Number(tabela[canal]) : CMV_PADRAO_CANAL[canal] ?? CMV_PADRAO

export function margemPorCanal({ meses, canais = [], receber = [], caixa = [], caixaLanc = [], mapaDB = [], pctCanal = {} }) {
  const dentro = m => meses.includes(m)
  const g = {}
  const linha = canal => g[canal] || (g[canal] = { canal, bruta: 0, descontos: 0, taxas: 0 })
  for (const r of canais) {
    if (!dentro(r.mes)) continue
    const x = linha(r.canal)
    x.bruta += Number(r.vendas) || 0
    x.descontos += Number(r.promocoes) || 0
    x.taxas += custoCanal(r) + marketingCanal(r)
  }
  for (const i of itensReceber({ receber, mapaDB })) {
    const canal = CANAL_DO_RECEBER[i.linha]
    if (!canal || !dentro(i.mes)) continue
    linha(canal).bruta += i.valor
  }
  const doCaixa = itensCaixa({ caixa, caixaLanc, mapaDB }).filter(i => dentro(i.mes))
  const pools = Object.fromEntries(Object.keys(POOLS_ENVIO).map(k => [k, 0]))
  for (const i of doCaixa) { const p = poolEnvio(i); if (p) pools[p] += i.valor }
  const base = Object.fromEntries(Object.entries(POOLS_ENVIO).map(([k, p]) =>
    [k, Object.values(g).filter(x => p.canais.includes(x.canal)).reduce((s, x) => s + x.bruta, 0)]))
  const linhas = Object.values(g).filter(x => Math.abs(x.bruta) >= 0.005).map(x => {
    const pct = pctCustoDe(x.canal, pctCanal)
    const envioPor = {}
    for (const [k, p] of Object.entries(POOLS_ENVIO))
      envioPor[k] = p.canais.includes(x.canal) && base[k] ? pools[k] * x.bruta / base[k] : 0
    const envio = Object.values(envioPor).reduce((s, v) => s + v, 0)
    const liquida = x.bruta - x.descontos - x.taxas
    const cmv = x.bruta * pct / 100
    return { ...x, pct, liquida, cmv, envio, envioPor, margem: liquida - cmv - envio }
  }).sort((a, b) => (ORDEM_CANAIS.indexOf(a.canal) + 100) % 100 - (ORDEM_CANAIS.indexOf(b.canal) + 100) % 100 || b.bruta - a.bruta)
  const soma = k => linhas.reduce((s, x) => s + x[k], 0)
  const total = { canal: 'Total', bruta: soma('bruta'), descontos: soma('descontos'), taxas: soma('taxas'), liquida: soma('liquida'), cmv: soma('cmv'), envio: soma('envio'), margem: soma('margem') }
  // CMV real do período pelo caixa: compras de matéria-prima, embalagem do produto e do pedido (sacola, caixa)
  const compras = doCaixa.filter(i => i.linha === 'cmv' || i.linha === 'cmv_envio').reduce((s, i) => s + i.valor, 0)
  return { linhas, total, compras, pools }
}
