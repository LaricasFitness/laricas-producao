import { lerCSV } from './dre'

// Mercado Pago › Relatórios › Vendas (.csv) → faturamento por mês da compra, por loja do Mercado Pago:
//   loja "Ativação"                → canal 'Ativação' (Venda Ativação)
//   loja "Loja" a partir de jul/26 → canal 'Balcão'   (Venda Balcão); antes disso já está em Venda Direta (Bling)
//   o resto (Pix do e-commerce, links de pagamento de B2B, checkout) fica fora: já vem da Shopify e do Bling
// Receita = valor do produto; comissão e taxas = tarifa do Mercado Pago + custo de parcelamento + tarifa de
// plataforma; promoções = desconto dado ao cliente + valor devolvido. Conferência: soma do "Valor total recebido"
// menos o devolvido.
export const BALCAO_DESDE = '2026-07'
// dias em que a maquininha da Loja foi usada numa ativação: as vendas da Loja nesses dias são Ativação
export const ATIVACAO_NA_LOJA = ['2026-11-07']

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const mesDe = s => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}` : null }
const r2 = v => Math.round(v * 100) / 100 + 0

export function lerRelatorioMercadoPago(texto) {
  const linhas = lerCSV(texto)
  const cab = (linhas.shift() || []).map(h => (String(h).match(/\(([^)]+)\)\s*$/) || [])[1] || String(h).trim())
  const col = k => cab.indexOf(k)
  const ix = { data: col('date_created'), status: col('status'), valor: col('transaction_amount'), tarifa: col('mercadopago_fee'),
    plataforma: col('marketplace_fee'), cupom: col('coupon_fee'), liquido: col('net_received_amount'), devolvido: col('amount_refunded'),
    parcelamento: col('financing_fee'), loja: col('description'), pagamento: col('payment_type'), motivo: col('reason') }
  if (ix.data < 0 || ix.valor < 0 || ix.loja < 0) {
    throw new Error('Não reconheci o arquivo: esperava o relatório de Vendas do Mercado Pago (.csv), com a coluna "Nome da loja".')
  }
  const grupos = {}, fora = {}
  for (const r of linhas) {
    const mes = mesDe(r[ix.data])
    if (!mes) continue
    const status = String(r[ix.status] || '').trim()
    if (!['approved', 'refunded', 'partially_refunded'].includes(status)) continue
    const loja = String(r[ix.loja] || '').trim()
    let canal = null
    const dia = String(r[ix.data] || '').replace(/^(\d{2})\/(\d{2})\/(\d{4}).*/, '$3-$2-$1')
    if (/^ativa[cç][aã]o$/i.test(loja) || (/^loja$/i.test(loja) && ATIVACAO_NA_LOJA.includes(dia))) canal = 'Ativação'
    else if (/^loja$/i.test(loja) && mes >= BALCAO_DESDE) canal = 'Balcão'
    const valor = num(r[ix.valor])
    if (!canal) {
      const k = /^loja$/i.test(loja) ? 'Loja antes de jul/26 (já em Venda Direta)' : loja ? `Loja ${loja}` : 'Sem loja (Pix do site, links de pagamento)'
      fora[k] = (fora[k] || 0) + valor
      continue
    }
    const g = grupos[`${canal}|${mes}`] || (grupos[`${canal}|${mes}`] = { canal, mes, vendas: 0, n: 0, tarifa: 0, parcelamento: 0, plataforma: 0, cupom: 0, devolvido: 0, liquido: 0 })
    g.n++
    g.vendas += valor
    // tarifas e descontos vêm com sinal negativo no relatório: no lançamento ficam positivos
    const pos = i => i >= 0 ? Math.abs(num(r[i])) : 0
    g.tarifa += pos(ix.tarifa); g.parcelamento += pos(ix.parcelamento)
    g.plataforma += pos(ix.plataforma); g.cupom += pos(ix.cupom)
    g.devolvido += pos(ix.devolvido)
    g.liquido += ix.liquido >= 0 ? num(r[ix.liquido]) : 0
  }
  const meses = Object.values(grupos).sort((a, b) => (a.mes + a.canal).localeCompare(b.mes + b.canal)).map(g => {
    const taxas = r2(g.tarifa + g.parcelamento + g.plataforma), promocoes = r2(g.cupom + g.devolvido)
    return {
      canal: g.canal, unidade: '', mes: g.mes, vendas: r2(g.vendas), promocoes, taxas, servicos: 0, marketing: 0, ajustes: 0,
      total_faturamento: r2(g.liquido - g.devolvido), unidade_print: `Mercado Pago · loja ${g.canal === 'Balcão' ? 'Loja' : 'Ativação'}`, pedidos: g.n,
      detalhes: [
        { grupo: 'vendas', descricao: `Vendas (${g.n})`, valor: r2(g.vendas) },
        ...(g.cupom ? [{ grupo: 'promocoes', descricao: 'Desconto ao cliente', valor: -r2(g.cupom) }] : []),
        ...(g.devolvido ? [{ grupo: 'promocoes', descricao: 'Devoluções', valor: -r2(g.devolvido) }] : []),
        { grupo: 'taxas', descricao: 'Tarifa do Mercado Pago', valor: -r2(g.tarifa) },
        ...(g.parcelamento ? [{ grupo: 'taxas', descricao: 'Custo de parcelamento', valor: -r2(g.parcelamento) }] : []),
        ...(g.plataforma ? [{ grupo: 'taxas', descricao: 'Tarifa de plataforma', valor: -r2(g.plataforma) }] : []),
      ].filter(d => Math.abs(d.valor) >= 0.005),
    }
  })
  return { meses, fora: Object.fromEntries(Object.entries(fora).map(([k, v]) => [k, r2(v)])) }
}
