import { lerXlsx } from './lerXlsx'

// Planilha "Billing report" do portal da Keeta (Financials › Download › Billing report) → faturamento
// por mês da transação. A Keeta só existe na Bela Vista. A planilha sai em português ou inglês,
// conforme o idioma do portal: cada coluna tem os dois nomes.
//   Receita bruta  total dos itens + diferença paga (pedido mínimo) + taxa de entrega (entrega própria)
//   Promoções      promoção de itens e subsídio de entrega por conta da loja; o reembolso da conta de
//                  promoção (positivo) abate o que a loja investiu
//   Comissão       comissão básica, taxa adicional de distância, pagamento online, saque antecipado,
//                  mensalidade e dedução pelo serviço da Ajuda
//   Ajustes        compensação por danos de pratos e ajuste de comissão
//   Marketing      custos de publicidade
// Conferência: receita − promoções − comissão − anúncios + ajustes = "Pagamento total".

const C = (pt, en) => [pt, en]
const GRUPOS = {
  vendas: [C('Total do item', 'Item total'), C('Diferença paga', 'Top-up to minimum'),
    C('Taxa de entrega (entrega própria)', 'Delivery fee (merchant delivery)')],
  promocoes: [C('Custos de promoção do item por conta da loja', 'Item promotion costs borne by merchant'),
    C('Subsídios de entrega cobertos pela loja', 'Delivery subsidies covered by merchant'),
    C('Rendimento de reembolso da conta da promoção', 'Rebate income of promotion account')],
  taxas: [C('Comissão básica', 'Basic commission'), C('Taxa adicional de distância', 'Distance addition fee'),
    C('Taxa de pagamento online', 'Online payment fee'), C('Taxa de saque antecipado', 'Early withdrawal fee'),
    C('Taxa de serviço mensal', 'Monthly service fee'), C('Dedução pelo serviço da Ajuda', 'Customer service deduction')],
  ajustes: [C('Compensação por danos de pratos', 'Dish damage compensation'), C('Ajuste de comissão', 'Commission adjustment')],
  marketing: [C('Custos de publicidade', 'Advertising costs')],
}
// Entram no "Pagamento total" mas não são receita nem custo da loja: se aparecerem, o sistema avisa
const AVISAR = {
  'Dedução do vale-refeição no pedido': 'pedido pago com vale-refeição direto à loja (dedução do vale-refeição)',
  'Meal voucher order deduction': 'pedido pago com vale-refeição direto à loja (dedução do vale-refeição)',
  'Aumento de ajuste (não incluído na fatura)': 'ajuste fora da fatura', 'Adjustment increase (not included in invoice)': 'ajuste fora da fatura',
  'Redução de ajuste (não incluída na fatura)': 'ajuste fora da fatura', 'Adjustment decrease (not included in invoice)': 'ajuste fora da fatura',
}
const MESES_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

const num = v => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s)
  return /^-?[\d.]*\d,\d+$/.test(s) ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : null
}
// '02/08/2026' ou '1 Oct 2026' (com ou sem horário) → '2026-08'
const mesDe = v => {
  const s = String(v || '')
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}`
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3})\w* (\d{4})/)
  if (m && MESES_EN[m[2].toLowerCase()]) return `${m[3]}-${String(MESES_EN[m[2].toLowerCase()]).padStart(2, '0')}`
  return null
}
const r2 = v => Math.round(v * 100) / 100 + 0 // + 0 tira o "-0"

export async function lerPlanilhaKeeta(dados) {
  const abas = await lerXlsx(dados)
  const aba = abas.find(a => /hist[oó]rico de pedidos|order summary/i.test(a.nome))
  if (!aba) throw new Error('Não achei a aba "Histórico de pedidos": exporte o Billing report do portal da Keeta.')
  const iCab = aba.linhas.findIndex(l => l.includes('Total do item') || l.includes('Item total'))
  if (iCab < 0) throw new Error('Não reconheci as colunas da planilha da Keeta.')
  const cab = aba.linhas[iCab].map(c => String(c ?? '').trim())
  const col = nomes => { for (const n of nomes) { const i = cab.indexOf(n); if (i >= 0) return i } return -1 } // 1ª ocorrência
  const iLoja = col(['Nome da loja', 'Store name']), iData = col(['Data da transação', 'Transaction date'])
  const iPedido = col(['Horário de início do pedido', 'Order start time']), iTotal = col(['Pagamento total', 'Total payout'])
  const iStatus = col(['Status']), iTipo = col(['Tipo de transação', 'Transaction type'])

  const porChave = {}
  const avisos = new Set()
  for (const l of aba.linhas.slice(iCab + 1)) {
    if (!l || !l.some(v => v != null && v !== '')) continue
    const mes = mesDe(l[iData]) || mesDe(l[iPedido])
    if (!mes) continue
    const loja = String(l[iLoja] || '').trim()
    const k = `${loja}|${mes}`
    const g = porChave[k] || (porChave[k] = { loja, mes, pedidos: 0, vendas: 0, promocoes: 0, taxas: 0, ajustes: 0, marketing: 0, total: 0, colunas: {} })
    // ressarcimento ao cliente, ajustes etc. não são pedidos
    if (!/cancel/i.test(String(l[iStatus] || '')) && (iTipo < 0 || /pedido|order/i.test(String(l[iTipo] || '')))) g.pedidos++
    for (const [campo, lista] of Object.entries(GRUPOS)) for (const nomes of lista) {
      const i = col(nomes), v = num(l[i])
      if (i < 0 || v == null) continue
      g[campo] += v
      g.colunas[nomes[0]] = (g.colunas[nomes[0]] || 0) + v
    }
    g.total += num(l[iTotal]) || 0
    for (const [nome, txt] of Object.entries(AVISAR)) if (num(l[cab.indexOf(nome)])) avisos.add(`A planilha tem ${txt}: confira antes de salvar.`)
  }

  // Custos vêm negativos na planilha: no lançamento ficam positivos (como no iFood)
  return Object.values(porChave).sort((a, b) => a.mes.localeCompare(b.mes)).map(g => ({
    canal: 'Keeta', mes: g.mes, unidade_print: g.loja, unidade: '',
    vendas: r2(g.vendas), promocoes: r2(-g.promocoes), taxas: r2(-g.taxas), servicos: 0,
    marketing: r2(-g.marketing), ajustes: r2(g.ajustes), total_faturamento: r2(g.total),
    detalhes: Object.entries(g.colunas).filter(([, v]) => Math.abs(v) >= 0.005)
      .map(([descricao, valor]) => ({ grupo: Object.keys(GRUPOS).find(k => GRUPOS[k].some(n => n[0] === descricao)), descricao, valor: r2(valor) })),
    pedidos: g.pedidos, avisos: [...avisos],
  }))
}
