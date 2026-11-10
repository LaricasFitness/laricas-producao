// Pedidos da Shopify (Admin GraphQL) → faturamento do site no mês, por competência (data do pedido).
// Usado pela função api/shopify-faturamento.mjs; fica aqui para poder ser testado sem a Shopify.
//
// Regras (DRE gerencial da Laricas):
//   Receita bruta  produtos pelo preço do pedido antes dos descontos + frete cobrado do cliente,
//                  menos o valor coberto por voucher de influenciador (ver abaixo)
//   Descontos      cupons, ofertas de upsell (QIKIFY…), descontos automáticos, frete grátis por desconto
//                  e devoluções (reembolsos) dos pedidos do mês
//   Voucher        cupons "voucher…" (influenciadoras e nutricionistas): o valor coberto pelo voucher é
//                  produto dado, não venda nem desconto — fica FORA da receita e dos descontos; o custo
//                  real (matéria-prima, embalagem) já está no CMV do fechamento de estoque. Se o pedido
//                  passou do voucher, o que a influenciadora pagou é receita normal.
//   Brinde         produto da régua de recompensa (atributo _qbk-tier ou cupom QIKIFY-OKEVSB) que saiu
//                  de graça: fica FORA da receita e dos descontos. Se o cliente pagou alguma coisa
//                  por ele (ex.: outro cupom substituiu o da régua), é venda normal. Quando o cupom da
//                  régua vem rateado entre os itens (não zera uma linha), o valor dele também fica fora.
//   Fora           pedidos de teste, cancelados e não pagos (Pix/boleto vencido)
// Conferência: receita − descontos = total dos pedidos − reembolsos.

export const CODIGO_REGUA = 'QIKIFY-OKEVSB'
export const ehVoucher = code => /^voucher/i.test(code || '')
const NAO_PAGOS = ['PENDING', 'VOIDED', 'EXPIRED']

const v = m => Number(m?.shopMoney?.amount) || 0
const r2 = x => Math.round(x * 100) / 100 + 0
const nomeDesconto = a => {
  const d = a?.discountApplication || {}
  if (d.code) return /^QIKIFY/i.test(d.code) ? `${d.code} (app de ofertas)` : `Cupom ${d.code}`
  return d.title ? `${d.title}` : 'Desconto'
}

export function resumirPedidos(pedidos) {
  const t = { pedidos: 0, produtos: 0, frete: 0, descontos: 0, vouchers: 0, vouchersQtd: 0, reguaRateada: 0, freteDesc: 0, devolucoes: 0, total: 0,
    brindes: 0, brindesQtd: 0, reguaPaga: 0, foraCancelados: 0, foraNaoPagos: 0, foraTeste: 0 }
  const porDesconto = {}, porVoucher = {}
  const naoFecham = [] // pedidos cujo total não é a soma das linhas (gorjeta, taxa, imposto…)
  const avisos = new Set()

  for (const p of pedidos) {
    if (p.test) { t.foraTeste++; continue }
    if (p.cancelledAt) { t.foraCancelados++; continue }
    if (NAO_PAGOS.includes(p.displayFinancialStatus)) { t.foraNaoPagos++; continue }
    t.pedidos++
    const antes = t.produtos + t.frete - t.descontos - t.freteDesc - t.vouchers - t.reguaRateada
    if (p.lineItems?.pageInfo?.hasNextPage) avisos.add(`O pedido ${p.name} tem mais itens do que a consulta trouxe: confira na Shopify.`)

    for (const li of p.lineItems?.nodes || []) {
      const orig = v(li.originalTotalSet)
      const alocs = li.discountAllocations || []
      const desc = alocs.reduce((s, a) => s + v(a.allocatedAmountSet), 0)
      const daRegua = (li.customAttributes || []).some(a => a.key === '_qbk-tier')
        || alocs.some(a => a.discountApplication?.code === CODIGO_REGUA)
      if (daRegua && orig > 0 && orig - desc < 0.01) { t.brindes += orig; t.brindesQtd += li.quantity || 1; continue }
      if (daRegua) t.reguaPaga++
      t.produtos += orig
      for (const a of alocs) {
        const val = v(a.allocatedAmountSet), code = a.discountApplication?.code
        if (ehVoucher(code)) { t.vouchers += val; porVoucher[code] = (porVoucher[code] || 0) + val; continue }
        if (code === CODIGO_REGUA) { t.reguaRateada += val; continue }
        t.descontos += val
        const k = nomeDesconto(a); porDesconto[k] = (porDesconto[k] || 0) + val
      }
    }
    for (const sl of p.shippingLines?.nodes || []) {
      t.frete += v(sl.originalPriceSet)
      for (const a of sl.discountAllocations || []) {
        const val = v(a.allocatedAmountSet), code = a.discountApplication?.code
        if (ehVoucher(code)) { t.vouchers += val; porVoucher[code] = (porVoucher[code] || 0) + val; continue }
        t.freteDesc += val
        porDesconto['Frete grátis por desconto'] = (porDesconto['Frete grátis por desconto'] || 0) + val
      }
    }
    const dif = v(p.totalPriceSet) - (t.produtos + t.frete - t.descontos - t.freteDesc - t.vouchers - t.reguaRateada - antes)
    if (Math.abs(dif) >= 0.05) naoFecham.push(`${p.name} (${dif > 0 ? '+' : ''}${dif.toFixed(2).replace('.', ',')})`)
    const reemb = (p.refunds || []).reduce((s, rf) => s + v(rf.totalRefundedSet), 0)
    t.devolucoes += reemb
    t.total += v(p.totalPriceSet)
  }

  const vendas = r2(t.produtos + t.frete - t.vouchers - t.reguaRateada)
  const promocoes = r2(t.descontos + t.freteDesc + t.devolucoes)
  const total = r2(t.total - t.devolucoes)
  if (Math.abs(vendas - promocoes - total) >= 0.05)
    avisos.add(`A soma das linhas não bate com o total dos pedidos${naoFecham.length ? `: ${naoFecham.slice(0, 8).join(', ')}${naoFecham.length > 8 ? '…' : ''}` : ''}. Confira esses pedidos na Shopify.`)
  if (t.reguaPaga) avisos.add(`${t.reguaPaga} item(ns) da régua foram pagos (outro cupom no lugar do da régua): contados como venda.`)

  const detalhes = [
    { grupo: 'vendas', descricao: 'Produtos (preço antes dos descontos)', valor: r2(t.produtos) },
    { grupo: 'vendas', descricao: 'Frete cobrado', valor: r2(t.frete) },
    ...(t.vouchers ? [{ grupo: 'vendas', descricao: `Coberto por voucher de influenciador (${Object.keys(porVoucher).length} voucher(s), fora da receita)`, valor: -r2(t.vouchers) }] : []),
    ...Object.entries(porDesconto).sort((a, b) => b[1] - a[1]).map(([descricao, valor]) => ({ grupo: 'promocoes', descricao, valor: -r2(valor) })),
    ...(t.devolucoes ? [{ grupo: 'promocoes', descricao: 'Devoluções (reembolsos)', valor: -r2(t.devolucoes) }] : []),
    ...Object.entries(porVoucher).sort((a, b) => b[1] - a[1]).map(([code, valor]) => ({ grupo: 'fora', descricao: `Voucher ${code}`, valor: r2(valor) })),
    ...(t.reguaRateada ? [{ grupo: 'vendas', descricao: `Cupom da régua ${CODIGO_REGUA} rateado nos itens (fora da receita)`, valor: -r2(t.reguaRateada) }] : []),
    ...(t.brindes ? [{ grupo: 'fora', descricao: `Brindes da régua (${t.brindesQtd} un., fora da receita)`, valor: r2(t.brindes) }] : []),
  ].filter(d => Math.abs(d.valor) >= 0.005)

  return {
    canal: 'Site', unidade: '', vendas, promocoes, taxas: 0, servicos: 0, marketing: 0, ajustes: 0,
    total_faturamento: total, detalhes, pedidos: t.pedidos,
    fora: { cancelados: t.foraCancelados, naoPagos: t.foraNaoPagos, teste: t.foraTeste },
    brindes: { valor: r2(t.brindes + t.reguaRateada), quantidade: t.brindesQtd },
    vouchers: { valor: r2(t.vouchers), quantidade: Object.keys(porVoucher).length },
    avisos: [...avisos],
  }
}
