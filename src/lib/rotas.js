import { supabase } from '../supabase'

// Rotas da Lalamove: pedidos agrupados por zona (cidade ou faixa de CEP), até 5 paradas por rota, em ordem de CEP.
// Usado na Logística (arquivo do planejamento) e na Expedição (direto dos pedidos do Bling, sem importar nada).
// Cada parada: { id: nº do pedido, nome, tel, rua, numero, complemento, bairro, cidade, uf, cep, cepNum, cpfCnpj }

export function formatCEP(v) {
  if (!v) return ''
  const s = String(Math.round(Number(String(v).replace(/\D/g, '')) || 0)).padStart(8, '0')
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

export function getZone(cidade = '', cepNum = '') {
  const c = cidade.toLowerCase()
  if (c.includes('barueri') || c.includes('santana de parnaíba') || c.includes('cajamar')) return 'Alphaville'
  if (c.includes('guarulhos')) return 'Guarulhos'
  if (c.includes('santo andré')) return 'ABC — Santo André'
  if (c.includes('são bernardo') || c.includes('diadema')) return 'ABC — São Bernardo'
  if (c.includes('osasco')) return 'Osasco'
  const p = parseInt((cepNum || '').replace(/\D/g, '').slice(0, 5)) || 0
  if (p <= 1999) return 'Centro'
  if (p <= 2999) return 'Norte'
  if (p <= 3999) return 'Zona Leste'
  if (p <= 4999) return 'Zona Sul'
  if (p <= 5999) return 'Zona Oeste'
  if (p <= 8999) return 'Zona Leste Ext.'
  return 'Outro'
}

export function buildRoutes(orders) {
  const byZone = {}
  for (const o of orders) {
    const zone = getZone(o.cidade, o.cepNum)
    if (!byZone[zone]) byZone[zone] = []
    byZone[zone].push(o)
  }
  for (const z of Object.values(byZone)) z.sort((a, b) => (a.cepNum || '').localeCompare(b.cepNum || ''))
  const routes = [], MAX = 5
  for (const [zone, ords] of Object.entries(byZone)) {
    for (let i = 0; i < ords.length; i += MAX) routes.push({ label: zone, stops: ords.slice(i, i + MAX) })
  }
  return routes.map((r, i) => ({ ...r, code: String(i + 1).padStart(2, '0') }))
}

// Grava as rotas em logistica_historico (é de lá que a Expedição lê a rota de cada pacote). Devolve a linha gravada.
export async function salvarHistorico(routes, dateStr, datasAtivas) {
  try {
    const usuario = JSON.parse(sessionStorage.getItem('usuario') || '{}').nome
    const totalParadas = routes.reduce((s, r) => s + r.stops.length, 0)
    const { data, error } = await supabase.from('logistica_historico').insert({
      datas: datasAtivas?.length ? datasAtivas : [dateStr],
      total_pedidos: totalParadas,
      total_rotas: routes.length,
      total_paradas: totalParadas,
      rotas: routes,
      criado_por: usuario,
    }).select('id, datas, rotas, criado_em').single()
    if (error) throw error
    return data
  } catch (e) { console.error('Erro ao salvar histórico:', e); return null }
}
