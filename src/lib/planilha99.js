import { lerXlsx } from './lerXlsx'
import { siglaUnidade } from './dre'

// Planilha "Detalhes da fatura" do portal da 99 Food → faturamento por loja e mês (competência
// pela data do pedido). Colunas somadas como na DRE gerencial da Laricas:
//   Receita bruta  preço dos itens sem ofertas + pedido mínimo + taxa de entrega da loja + gorjeta
//   Promoções      investimento da loja e contribuição da 99 em ofertas, logística de ofertas e entrega
//                  (a contribuição da 99 vem positiva e abate o que a loja investiu)
//   Comissão       comissão e distribuição, recompensa de comissão, processamento de pagamento,
//                  custos logísticos, mensalidade e taxa do Entrega
//   Ajustes        reembolso (parcial/perda de pedido), compensação de contestação, dedução/reembolso
//   Marketing      despesas com anúncio
// Conferência: receita − promoções − comissão − anúncios + ajustes = "Ganhos do pedido".

const GRUPOS = {
  vendas: ['Preço total dos itens sem as ofertas', 'Taxa de pedido mínimo', 'Taxa de entrega da loja', 'Gorjeta'],
  promocoes: ['Investimento da loja em itens em oferta', 'Contribuição 99 Food em itens em oferta',
    'Investimento da loja em custos logísticos de ofertas', 'Contribuição 99 Food em custos logísticos de ofertas',
    'Investimento da loja em custos de entrega', 'Contribuição 99 Food em custos de entrega'],
  taxas: ['Custos com comissão e distribuição', 'Recompensa de comissão (da 99 Food) para a loja',
    'Taxa de processamento de pagamento', 'Custos Logísticos', 'Mensalidade', 'Taxa do Entrega'],
  ajustes: ['Reembolso (reembolso parcial/perda de pedido)', 'Compensação de contestação', 'Valor da dedução/reembolso'],
  marketing: ['Despesas com anúncio'],
}
// Colunas com valor que não entram em nenhum grupo: se aparecerem, o sistema avisa
const IGNORAR = ['Base da comissão', 'Comissão do pedido', 'Distância da entrega', 'Período de cobrança da mensalidade',
  'Limite de cobrança da mensalidade', 'Vendas no período de cobrança da mensalidade', 'Ganhos do pedido', 'Valor da cobrança',
  'Dinheiro coletado do cliente ou do entregador', 'Vale-refeição cobrado direto do cliente pela loja']

const num = v => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  return /^-?[\d.]*\d,\d+$|^-?\d+$/.test(s) ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : null
}
const mesDe = v => { const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}` : null }
const r2 = v => Math.round(v * 100) / 100 + 0 // + 0 tira o "-0"

export async function lerPlanilha99(dados, anteriores = []) {
  const abas = await lerXlsx(dados)
  const aba = abas.find(a => /detalhes da fatura/i.test(a.nome))
  if (!aba) throw new Error('Não achei a aba "Detalhes da fatura": exporte a planilha de detalhes da fatura do portal da 99 Food.')
  const iCab = aba.linhas.findIndex(l => l.includes('Preço total dos itens sem as ofertas'))
  if (iCab < 0) throw new Error('Não reconheci as colunas da planilha da 99 Food.')
  const cab = aba.linhas[iCab].map(c => String(c ?? '').trim())
  const col = nome => cab.indexOf(nome)
  const iLoja = col('Nome do estabelecimento'), iPedido = col('Data do pedido'), iCobranca = col('Data de cobrança')
  const iGanhos = col('Ganhos do pedido'), iAdiant = col('Valor de adiantamento da plataforma para oferta de Marketing de itens')
  const conhecidas = new Set([...Object.values(GRUPOS).flat(), ...IGNORAR])

  const porChave = {}
  const avisos = new Set()
  for (const l of aba.linhas.slice(iCab + 1)) {
    if (!l || !l.some(v => v != null && v !== '')) continue
    const mes = mesDe(l[iPedido]) || mesDe(l[iCobranca])
    if (!mes) continue
    const loja = String(l[iLoja] || '').trim()
    const k = `${loja}|${mes}`
    const g = porChave[k] || (porChave[k] = { loja, mes, pedidos: 0, vendas: 0, promocoes: 0, taxas: 0, ajustes: 0, marketing: 0, ganhos: 0, colunas: {} })
    g.pedidos++
    for (const [campo, nomes] of Object.entries(GRUPOS)) for (const nome of nomes) {
      const v = num(l[col(nome)])
      if (col(nome) < 0 || v == null) continue
      g[campo] += v
      g.colunas[nome] = (g.colunas[nome] || 0) + v
    }
    g.ganhos += num(l[iGanhos]) || 0
    if (iAdiant >= 0 && num(l[iAdiant])) avisos.add('A planilha tem "adiantamento da plataforma para oferta de marketing": confira se precisa de lançamento separado.')
    cab.forEach((nome, i) => {
      if (nome && !conhecidas.has(nome) && i > iLoja && num(l[i]) && i !== iAdiant && !/data|horário|id |documento|nº|cnpj|método|forma|tipo/i.test(nome))
        avisos.add(`Coluna "${nome}" tem valor e não entra em nenhum grupo.`)
    })
  }

  // Custos vêm negativos na planilha: no lançamento ficam positivos (como no iFood)
  return Object.values(porChave).sort((a, b) => a.mes.localeCompare(b.mes)).map(g => ({
    canal: '99 Food', mes: g.mes, unidade_print: g.loja, unidade: siglaUnidade(g.loja, anteriores),
    vendas: r2(g.vendas), promocoes: r2(-g.promocoes), taxas: r2(-g.taxas), servicos: 0,
    marketing: r2(-g.marketing), ajustes: r2(g.ajustes), total_faturamento: r2(g.ganhos),
    detalhes: Object.entries(g.colunas).filter(([, v]) => Math.abs(v) >= 0.005)
      .map(([descricao, valor]) => ({ grupo: Object.keys(GRUPOS).find(k => GRUPOS[k].includes(descricao)), descricao, valor: r2(valor) })),
    pedidos: g.pedidos, avisos: [...avisos],
  }))
}
