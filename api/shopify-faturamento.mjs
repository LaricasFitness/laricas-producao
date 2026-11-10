// Vercel Function — faturamento do site (Shopify) no mês, por competência, para a DRE.
// GET /api/shopify-faturamento?mes=2026-10
// Variáveis de ambiente (Vercel › Settings › Environment Variables), app do Dev Dashboard da Shopify
// com escopo de leitura de pedidos instalado na loja:
//   SHOPIFY_LOJA           05befe-5.myshopify.com
//   SHOPIFY_CLIENT_ID      Client ID do app
//   SHOPIFY_CLIENT_SECRET  Client secret do app
// O token de acesso (vale 24 h) é pedido a cada chamada pelo client credentials grant.

import { resumirPedidos } from '../src/lib/shopifyFaturamento.js'

export const config = { maxDuration: 60 }

const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]
const VERSAO = '2026-07'

const CONSULTA = `query Pedidos($q: String!, $depois: String) {
  orders(first: 15, after: $depois, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name createdAt cancelledAt test displayFinancialStatus
      totalPriceSet { shopMoney { amount } }
      refunds { totalRefundedSet { shopMoney { amount } } }
      shippingLines(first: 3) { nodes {
        originalPriceSet { shopMoney { amount } }
        discountAllocations { allocatedAmountSet { shopMoney { amount } } }
      } }
      lineItems(first: 40) {
        pageInfo { hasNextPage }
        nodes {
          quantity
          originalTotalSet { shopMoney { amount } }
          customAttributes { key value }
          discountAllocations {
            allocatedAmountSet { shopMoney { amount } }
            discountApplication {
              ... on DiscountCodeApplication { code }
              ... on AutomaticDiscountApplication { title }
              ... on ManualDiscountApplication { title }
              ... on ScriptDiscountApplication { title }
            }
          }
        }
      }
    }
  }
}`

async function token(loja) {
  const r = await fetch(`https://${loja}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`A Shopify recusou o acesso (${r.status}${j.error ? ': ' + j.error : ''}). Confira o app e as variáveis no Vercel.`)
  return j.access_token
}

// Início do mês em Brasília (UTC−3) em ISO UTC
const inicioMes = (a, m) => new Date(Date.UTC(a, m - 1, 1, 3)).toISOString()

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' })
  const origem = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '')
  if (origem && !ORIGENS.some(r => r.test(origem))) return res.status(403).json({ erro: 'Origem não autorizada' })
  const mes = String(req.query.mes || '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ erro: 'Informe o mês (AAAA-MM).' })
  const loja = process.env.SHOPIFY_LOJA
  if (!loja || !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET)
    return res.status(500).json({ erro: 'Shopify não configurada no Vercel (SHOPIFY_LOJA, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET).' })

  try {
    const tk = await token(loja)
    const [a, m] = mes.split('-').map(Number)
    const q = `created_at:>='${inicioMes(a, m)}' AND created_at:<'${inicioMes(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1)}'`
    const pedidos = []
    let depois = null
    for (let pagina = 0; pagina < 200; pagina++) {
      const r = await fetch(`https://${loja}/admin/api/${VERSAO}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tk },
        body: JSON.stringify({ query: CONSULTA, variables: { q, depois } }),
      })
      const j = await r.json().catch(() => ({}))
      const limitado = (j.errors || []).some(e => e.extensions?.code === 'THROTTLED')
      if (limitado) { await new Promise(ok => setTimeout(ok, 1500)); pagina--; continue }
      if (!r.ok || j.errors) throw new Error(`Erro da Shopify: ${(j.errors || []).map(e => e.message).join('; ') || r.status}`)
      const o = j.data.orders
      pedidos.push(...o.nodes)
      if (!o.pageInfo.hasNextPage) break
      depois = o.pageInfo.endCursor
      // respeita o limite de custo: espera se o balde estiver baixo
      const disp = j.extensions?.cost?.throttleStatus?.currentlyAvailable
      if (disp != null && disp < 400) await new Promise(ok => setTimeout(ok, 1000))
    }
    return res.status(200).json({ faturamento: { mes, ...resumirPedidos(pedidos) } })
  } catch (e) {
    return res.status(502).json({ erro: e.message || String(e) })
  }
}
