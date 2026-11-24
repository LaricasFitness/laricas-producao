import { supabase } from '../supabase'
import { calcularCMVMes, custoPorSku } from './cmv'

// DRE Laricas (Financeiro › DRE), dre_laricas.sql.
//
// Competência: receitas lançadas à mão por canal (dre_receitas: bruto, descontos, comissão da plataforma,
// pedidos); despesas das contas a pagar do Bling pela data de competência (dre_contas_competencia); CMV do
// fechamento de estoque (fechamento_cmv) + embalagem de envio estimada (R$ por pedido × pedidos) + auxiliares;
// lançamentos manuais (dre_manuais). Compras de estoque e mídia paga pagas no Bling ficam só no caixa.
// Caixa: extrato do Bling (dre_caixa_lancamentos), CMV = compras pagas.
// Cada lançamento do Bling cai numa conta do plano (dre_plano) pela classificação à mão (dre_classificacao),
// senão pela regra da categoria + fornecedor, senão pela regra só da categoria (dre_regras).
// Auditoria: ponte competência → caixa linha a linha, e o caixa conferido com os saldos dos bancos (dre_saldos).
// Rateios (dre_rateios): despesa dividida em parcelas mensais. Produto que saiu sem venda (lojas de marketing do
// Bling e Shopify com voucher, só a parte que o voucher pagou) sai do CMV pelo custo da ficha e entra no marketing (dre_mes.extras.cmv_marketing).

// Blocos fixos da DRE, na ordem. sinal: +1 soma no resultado, −1 subtrai
export const GRUPOS = [
  { id: 'rec', nome: 'Faturamento bruto', sinal: 1 },
  { id: 'ded', nome: 'Deduções', sinal: -1 },
  { id: 'cmv', nome: 'CMV', sinal: -1 },
  { id: 'vc', nome: 'Despesas variáveis comerciais', sinal: -1 },
  { id: 'vm', nome: 'Despesas variáveis de marketing', sinal: -1 },
  { id: 'vo', nome: 'Outras despesas variáveis', sinal: -1 },
  { id: 'fo', nome: 'Despesas fixas operacionais', sinal: -1 },
  { id: 'fa', nome: 'Despesas fixas administrativas', sinal: -1 },
  { id: 'fm', nome: 'Despesas fixas de marketing', sinal: -1 },
  { id: 'fc', nome: 'Despesas fixas comerciais', sinal: -1 },
  { id: 'fin', nome: 'Resultado financeiro', sinal: 1 },
  { id: 'inv', nome: 'Investimentos (abaixo do EBITDA)', sinal: -1 },
  { id: 'fora', nome: 'Fora do resultado', sinal: 1 },
]
export const NOME_GRUPO = Object.fromEntries(GRUPOS.map(g => [g.id, g.nome]))

// Canais de receita (competência). conta = linha do faturamento bruto
export const CANAIS = [
  ['Site', 'rec.site'], ['Clube de assinatura', 'rec.clube'], ['iFood BV', 'rec.delivery'], ['iFood ZN', 'rec.delivery'], ['iFood BK', 'rec.delivery'],
  ['iFood PR', 'rec.delivery'], ['99 Food BV', 'rec.delivery'], ['99 Food BK', 'rec.delivery'], ['Keeta', 'rec.delivery'], ['Anota.AI BV', 'rec.delivery'],
  ['Mercado Livre', 'rec.mkt'], ['Revenda', 'rec.b2b'], ['Venda direta', 'rec.direta'], ['Balcão', 'rec.balcao'], ['Ativação', 'rec.ativ'], ['Licenciamento e royalties', 'rec.lic'],
  ['Multas e reembolsos recebidos', 'rec.outras'],
]

export const ultimoDia = m => `${m}-${String(new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()).padStart(2, '0')}`
export const mesAnterior = m => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

async function buscarTudo(montar) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

// Tudo o que a DRE de um mês precisa
export async function carregarMes(mes) {
  const ini = mes + '-01', fim = ultimoDia(mes), ant = mesAnterior(mes)
  const [plano, regras, classif, pagar, caixa, receitas, manuais, fech, saldos, dreMes, cfg] = await Promise.all([
    buscarTudo(() => supabase.from('dre_plano').select('*').order('grupo').order('ordem')),
    buscarTudo(() => supabase.from('dre_regras').select('*')),
    buscarTudo(() => supabase.from('dre_classificacao').select('*')),
    buscarTudo(() => supabase.from('dre_contas_competencia').select('*').gte('competencia', ini).lte('competencia', fim).order('competencia')),
    buscarTudo(() => supabase.from('dre_caixa_lancamentos').select('*').eq('mes', mes).order('data')),
    buscarTudo(() => supabase.from('dre_receitas').select('*').eq('mes', mes).order('ordem')),
    buscarTudo(() => supabase.from('dre_manuais').select('*').eq('mes', mes).order('em')),
    buscarTudo(() => supabase.from('fechamento_cmv').select('tipo, nome, categoria, cmv_valor, ef_origem, ei_valor, compras_valor, atrasadas_valor, ef_valor').eq('mes', mes)),
    buscarTudo(() => supabase.from('dre_saldos').select('*').in('mes', [ant, mes])),
    buscarTudo(() => supabase.from('dre_mes').select('*').eq('mes', mes)),
    supabase.from('configuracoes').select('chave, valor').in('chave', ['dre_embalagem_envio', 'dre_sacola_ativacao']),
  ])
  let rateios = [], fretes = []
  try { rateios = await buscarTudo(() => supabase.from('dre_rateios').select('*').order('mes_inicio')) } catch { /* dre_laricas_2.sql não aplicado */ }
  try { fretes = await buscarTudo(() => supabase.from('dre_fretes').select('origem, data, valor, documento').eq('mes', mes).order('data')) } catch { /* dre_laricas_3.sql não aplicado */ }
  // CMV: fechado (congelado) ou, no mês aberto, o provisório calculado agora
  let cmv = fech, cmvProvisorio = false
  if (!cmv.length) {
    try { cmv = (await calcularCMVMes(mes)).linhas || []; cmvProvisorio = true } catch { cmv = [] }
  }
  const visao = v => dreMes.find(r => r.visao === v) || null
  return {
    mes, plano, regras, classif, pagar, caixa, receitas, manuais, cmv, cmvProvisorio, rateios, fretes,
    saldos: saldos.filter(s => s.mes === mes), saldosAnt: saldos.filter(s => s.mes === ant),
    comp: visao('competencia'), cx: visao('caixa'),
    envioPorPedido: parseFloat(cfg?.data?.find(x => x.chave === 'dre_embalagem_envio')?.valor) || 1.75,
    sacolaAtivacao: parseFloat(cfg?.data?.find(x => x.chave === 'dre_sacola_ativacao')?.valor) || 0,
  }
}

// ── Classificação ────────────────────────────────────────────────────────────
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export function regraDe(l, regras) {
  const cat = l.categoria || ''
  const daCat = regras.filter(r => r.categoria === cat)
  // "fornecedor" da regra procura no nome e no histórico (ex.: "multa" em Reembolsos e Multas)
  const texto = norm(`${l.nome || ''} ${l.observacoes || ''} ${l.historico || ''}`)
  return daCat.find(r => r.fornecedor && texto.includes(norm(r.fornecedor))) || daCat.find(r => !r.fornecedor) || null
}
// → { conta, como: 'manual' | 'fornecedor' | 'categoria' | null, soCaixa }
export function classificar(l, origem, d) {
  const man = l.id_bling ? d.classif.find(c => c.origem === origem && c.id_bling === String(l.id_bling)) : null
  if (man) return { conta: man.conta, como: 'manual', soCaixa: false, por: man.por }
  const r = regraDe(l, d.regras)
  if (!r) return { conta: null, como: null, soCaixa: false }
  return { conta: r.conta, como: r.fornecedor ? 'fornecedor' : 'categoria', soCaixa: !!r.so_caixa }
}

// Sinal do lançamento de caixa: entrada soma, saída subtrai
export const sinalCaixa = l => (l.tipo === 'receita' || /entrada/i.test(l.categoria || '')) ? 1 : -1

// ── Montagem ─────────────────────────────────────────────────────────────────
// v[conta] = { valor (positivo = no sentido da linha), itens: [{ tipo, valor, ... }] }
// Chaves especiais: _semrec (receita sem conta), _sem (despesa sem conta), _socaixa (pago no Bling, fora da competência)
// Rateio: despesa dividida em parcelas iguais a partir de mes_inicio. Com id_bling, a conta do Bling sai da
// competência (entra só pelas parcelas); sem id_bling (rateios antigos da planilha), a conta já ficou no passado.
const somaMeses = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
export const fimRateio = r => somaMeses(r.mes_inicio, (r.parcelas || 1) - 1)
export const parcelaDoMes = (r, mes) => {
  if (mes < r.mes_inicio || mes > fimRateio(r)) return null
  let n = 0; for (let m = r.mes_inicio; m <= mes; m = somaMeses(m, 1)) n++
  return { n, valor: Math.round(+r.valor_total / r.parcelas * 100) / 100 }
}

// Produto que saiu sem venda: sai do CMV (pelo custo da ficha) e entra no marketing
export const TIPOS_MKT = {
  degustacao: ['Ativação - Degustação', 'vm.ativ'], premiacao: ['Ativação - Premiação', 'vm.ativ'],
  marketing: ['Marketing', 'vm.influ'], voucher: ['Shopify com voucher', 'vm.influ'], bonificacao: ['Bonificação', 'vm.bonif'],
}

// Voucher: parte dos produtos paga pelo desconto (o resto o cliente pagou e continua custo da venda)
export const parteVoucher = p => p.totalProdutos > 0
  ? Math.min(1, Math.max(0, (p.totalProdutos + (p.frete || 0) - p.total) / p.totalProdutos)) : 1

// pedidos: [{ id, numero, tipo, loja, itens: [{ codigo, descricao, quantidade }], totalProdutos, total, frete }]
// → grupos para dre_mes.extras.cmv_marketing
export async function custoMarketing(pedidos) {
  const custo = await custoPorSku()
  const grupos = {}
  for (const p of pedidos) {
    const [nome, conta] = TIPOS_MKT[p.tipo] || [p.tipo, 'vm.outros']
    const g = grupos[p.tipo] ||= { tipo: p.tipo, nome, conta, pedidos: 0, mp: 0, emb: 0, itens: {}, semFicha: {} }
    const f = p.tipo === 'voucher' ? parteVoucher(p) : 1
    g.pedidos++
    for (const it of p.itens || []) {
      const c = custo(it.codigo), q = it.quantidade * f
      const chave = it.codigo || it.descricao
      if (!c) { g.semFicha[chave] = (g.semFicha[chave] || 0) + q; continue }
      const x = g.itens[it.codigo] ||= { codigo: it.codigo, descricao: it.descricao, qtd: 0, mpUnit: c.mpUnit, embUnit: c.embUnit }
      x.qtd += q
      g.mp += c.mpUnit * q; g.emb += c.embUnit * q
    }
  }
  return Object.values(grupos).map(g => ({ ...g, mp: Math.round(g.mp * 100) / 100, emb: Math.round(g.emb * 100) / 100,
    itens: Object.values(g.itens).sort((a, b) => b.qtd - a.qtd), semFicha: Object.entries(g.semFicha).map(([codigo, qtd]) => ({ codigo, qtd })) }))
}

// Pedidos que levam embalagem de envio (deliverys + Bling); as vendas de ativação levam só uma sacola cada
export const totalPedidos = d => d.receitas.filter(r => r.conta !== 'rec.ativ').reduce((t, r) => t + (r.pedidos || 0), 0) + (d.comp?.extras?.pedidos_bling || 0)
export const pedidosAtivacao = d => d.receitas.filter(r => r.conta === 'rec.ativ').reduce((t, r) => t + (r.pedidos || 0), 0)
export function montar(d, visao) {
  const planoDe = Object.fromEntries(d.plano.map(p => [p.id, p]))
  const v = {}, add = (k, valor, item) => { (v[k] ||= { valor: 0, itens: [] }); v[k].valor += valor; v[k].itens.push({ ...item, valor }) }
  if (visao === 'competencia') {
    for (const r of d.receitas) {
      if (+r.bruto) add(r.conta, +r.bruto, { tipo: 'receita', r, parte: 'bruto' })
      if (+r.descontos) add('ded.desc', +r.descontos, { tipo: 'receita', r, parte: 'descontos' })
      if (+r.comissao) add('vc.taxas', +r.comissao, { tipo: 'receita', r, parte: 'comissão' })
    }
    for (const c of d.cmv) if (+c.cmv_valor) add(c.tipo === 'mp' ? 'cmv.mp' : 'cmv.emb', +c.cmv_valor, { tipo: 'cmv', c })
    const ped = totalPedidos(d)
    if (ped) add('cmv.envio', ped * d.envioPorPedido, { tipo: 'envio', pedidos: ped })
    const ativ = pedidosAtivacao(d)
    if (ativ && d.sacolaAtivacao) add('cmv.envio', ativ * d.sacolaAtivacao, { tipo: 'sacola', pedidos: ativ, unit: d.sacolaAtivacao })
    for (const m of d.manuais) if (+m.valor) add(m.conta, +m.valor, { tipo: 'manual', m })
    // fretes dos relatórios das transportadoras, pela data do envio (um item por transportadora)
    const porOrigem = {}
    for (const f of d.fretes || []) { const o = porOrigem[f.origem] ||= { origem: f.origem, envios: 0, valor: 0, docs: new Set() }; o.envios++; o.valor += +f.valor; o.docs.add(f.documento) }
    for (const o of Object.values(porOrigem)) add('vc.frete', Math.round(o.valor * 100) / 100, { tipo: 'frete', f: { ...o, docs: [...o.docs] } })
    for (const r of d.rateios || []) { const p = parcelaDoMes(r, d.mes); if (p) add(r.conta, p.valor, { tipo: 'rateio', r, parcela: p.n }) }
    for (const g of d.comp?.extras?.cmv_marketing || []) {
      const conta = planoDe[g.conta] ? g.conta : 'vm.outros'
      if (g.mp) add('cmv.mp', -g.mp, { tipo: 'cmvmkt', g })
      if (g.emb) add('cmv.emb', -g.emb, { tipo: 'cmvmkt', g })
      if (g.mp + g.emb) add(conta, g.mp + g.emb, { tipo: 'cmvmkt', g })
    }
    const rateados = new Set((d.rateios || []).filter(r => r.id_bling).map(r => String(r.id_bling)))
    for (const l of d.pagar) {
      if (l.id_bling && rateados.has(String(l.id_bling))) { add('_rateado', +l.valor, { tipo: 'pagar', l, c: classificar(l, 'pagar', d) }); continue }
      const c = classificar(l, 'pagar', d)
      const fora = c.como !== 'manual' && (c.soCaixa || planoDe[c.conta]?.so_caixa)
      add(fora ? '_socaixa' : (c.conta || '_sem'), +l.valor, { tipo: 'pagar', l, c })
    }
    // Reembolso/estorno recebido de uma despesa (entrada no extrato classificada numa conta de despesa): reduz a
    // despesa no mês em que entrou. Contas que na competência vêm de outra fonte (estoque, envio estimado) ficam fora.
    // tarifas bancárias debitadas direto no extrato (sem conta a pagar): competência = mês do débito.
    // A que também existe no contas a pagar (mesmo valor) já entrou por lá.
    const finPagar = d.pagar.filter(l => classificar(l, 'pagar', d).conta === 'fin.desp').map(l => Math.round(+l.valor * 100))
    for (const l of d.caixa) {
      if (sinalCaixa(l) > 0 || classificar(l, 'caixa', d).conta !== 'fin.desp') continue
      const i = finPagar.indexOf(Math.round(+l.valor * 100))
      if (i >= 0) { finPagar.splice(i, 1); continue }
      add('fin.desp', +l.valor, { tipo: 'caixa', l, c: classificar(l, 'caixa', d), sinal: -1 })
    }
    for (const l of d.caixa) {
      if (sinalCaixa(l) < 0) continue
      const c = classificar(l, 'caixa', d), g = planoDe[c.conta]?.grupo
      // rendimentos de aplicação e juros recebidos só existem no extrato: competência = mês em que entraram
      if (c.conta === 'fin.rec') { add('fin.rec', +l.valor, { tipo: 'caixa', l, c, sinal: 1 }); continue }
      if (!c.conta || ['rec', 'fora', 'fin'].includes(g) || planoDe[c.conta]?.so_caixa || (c.como !== 'manual' && c.soCaixa)) continue
      add(c.conta, -l.valor, { tipo: 'estorno', l, c })
    }
  } else {
    for (const l of d.caixa) {
      const c = classificar(l, 'caixa', d)
      // valor no sentido da linha: estorno numa conta de despesa (entrada) reduz a despesa, e vice-versa
      const k = c.conta || (sinalCaixa(l) > 0 ? '_semrec' : '_sem'), g = planoDe[k]?.grupo
      const positiva = g === 'rec' || g === 'fora' || k === 'fin.rec' || k === '_semrec'
      add(k, (positiva ? 1 : -1) * sinalCaixa(l) * (+l.valor), { tipo: 'caixa', l, c, sinal: sinalCaixa(l) })
    }
  }
  return v
}

// Totais e indicadores
export function calcular(v, plano) {
  const g = id => plano.filter(p => p.grupo === id).reduce((t, p) => t + (v[p.id]?.valor || 0), 0)
  const bruta = g('rec') + (v._semrec?.valor || 0), ded = g('ded'), liq = bruta - ded, cmv = g('cmv'), lb = liq - cmv
  const vc = g('vc'), mc = lb - vc, vm = g('vm'), vo = g('vo') + (v._sem?.valor || 0), mcl = mc - vm - vo
  const fo = g('fo'), fa = g('fa'), fm = g('fm'), fc = g('fc'), fixas = fo + fa + fm + fc, ebitda = mcl - fixas
  const fin = (v['fin.rec']?.valor || 0) - (v['fin.desp']?.valor || 0), inv = g('inv')
  const cmo = plano.filter(p => p.cmo).reduce((t, p) => t + (v[p.id]?.valor || 0), 0)
  return { bruta, ded, liq, cmv, lb, vc, mc, vm, vo, mcl, fo, fa, fm, fc, fixas, ebitda, fin, inv, cmo, ll: ebitda + fin - inv }
}

// ── Auditoria: ponte competência → caixa ─────────────────────────────────────
// Cada linha compara o efeito no resultado pela competência com o efeito no caixa; a soma das diferenças leva
// do lucro por competência ao resultado de caixa sem sobra. Receitas por recebedor (Pagar.me e Mercado Pago
// misturam site, clube, balcão e ativação). Contas a pagar da competência pagas em outro mês e pagamentos de
// outras competências aparecem dos dois lados.
const RECEBEDORES = [
  ['Delivery (repasses iFood, 99, Keeta, Anota.AI)', ['rec.delivery']],
  ['Site, clube, marketplace, balcão e ativação (Pagar.me, Mercado Pago, PIX)', ['rec.site', 'rec.clube', 'rec.mkt', 'rec.balcao', 'rec.ativ']],
  ['Revenda e venda direta', ['rec.b2b', 'rec.direta']],
  ['Licenciamento e royalties', ['rec.lic']],
]
export function ponte(d) {
  const planoDe = Object.fromEntries(d.plano.map(p => [p.id, p]))
  const vc = montar(d, 'competencia'), vx = montar(d, 'caixa'), linhas = []
  const efComp = k => (planoDe[k]?.grupo === 'rec' || k === 'fin.rec' || k === '_semrec') ? 1 : -1
  const L = (id, nome, comp, cx, porque) => linhas.push({ id, nome, comp, cx, porque, ec: comp.reduce((t, x) => t + x.ef, 0), ex: cx.reduce((t, x) => t + x.ef, 0) })
  const doComp = contas => contas.flatMap(k => (vc[k]?.itens || []).map(x => ({ ...x, conta: k, ef: efComp(k) * x.valor })))
  const doCaixa = contas => contas.flatMap(k => (vx[k]?.itens || []).map(x => ({ ...x, conta: k, ef: x.sinal * (+x.l.valor) })))
  const usadas = new Set()
  // contas de receita criadas no plano fora dos recebedores acima: uma linha própria
  const fixas = RECEBEDORES.flatMap(r => r[1])
  const outrasRec = d.plano.filter(p => p.grupo === 'rec' && !fixas.includes(p.id)).map(p => p.id)
  const recebedores = outrasRec.length ? [...RECEBEDORES, ['Outras receitas', outrasRec]] : RECEBEDORES
  for (const [nome, recs] of recebedores) {
    // competência: bruto − desconto − comissão das receitas desses canais
    const comp = d.receitas.filter(r => recs.includes(r.conta)).map(r => ({ tipo: 'receitaLiq', r, valor: +r.bruto - +r.descontos - +r.comissao, ef: +r.bruto - +r.descontos - +r.comissao }))
    recs.forEach(k => usadas.add(k))
    const cx = doCaixa(recs)
    if (comp.length || cx.length) L('rec:' + recs[0], nome, comp, cx, recs.includes('rec.lic')
      ? 'Acerto sem caixa: não entra dinheiro.'
      : 'Vendido no mês (líquido de desconto e comissão) contra o recebido no mês. Diferença = o que ficou a receber menos o que entrou de meses anteriores, e taxas descontadas no recebimento.')
  }
  if (vx._semrec) L('rec:_semrec', 'Receita sem classificação', [], doCaixa(['_semrec']), 'Classifique na aba Lançamentos.')
  const POR = {
    ded: 'DAS da competência contra o pago no mês (vence no mês seguinte).',
    cmv: 'CMV do consumo (fechamento de estoque, envio estimado, auxiliares) contra as compras pagas no mês. Diferença = variação do estoque e compras a prazo.',
    vc: 'Comissões e taxas descontadas no repasse não saem do caixa; frete e meios de pagamento pagos em outro mês.',
    vm: 'Mídia da planilha da agência (competência) contra as faturas pagas no mês; produtos de influenciadores não têm caixa.',
    inv: 'Equipamento: competência pela nota, caixa pelo pagamento.', fin: 'Rendimentos e tarifas.',
  }
  for (const gr of GRUPOS) {
    if (gr.id === 'rec' || gr.id === 'fora') continue
    const contas = d.plano.filter(p => p.grupo === gr.id).map(p => p.id)
    if (gr.id === 'vo') contas.push('_sem')
    // descontos e comissões das plataformas já estão na receita líquida de cada recebedor
    const comp = doComp(contas.filter(k => !usadas.has(k))).filter(x => x.tipo !== 'receita')
    const cx = doCaixa(contas)
    if (comp.length || cx.length) L('g:' + gr.id, gr.nome, comp, cx, POR[gr.id] || 'Contas da competência pagas em outro mês, e pagamentos de outras competências.')
  }
  const forasCx = d.plano.filter(p => p.grupo === 'fora' && p.id !== 'fora.ajuste').map(p => p.id)
  const fx = doCaixa(forasCx)
  if (fx.length) L('fora', 'Transferências, aportes e venda de ativo', [], fx, 'Não é resultado: transferência entre contas se anula; aporte e venda de ativo entram só no caixa.')
  const aj = doCaixa(['fora.ajuste'])
  if (aj.length) L('ajuste', '⚠ Ajustes de saldo no Bling', [], aj, 'Saldo mudado no Bling sem lançamento de verdade. Não é dinheiro: confira com o extrato do banco o que motivou o ajuste.')
  const ll = calcular(vc, d.plano).ll
  const resCx = d.caixa.reduce((t, l) => t + sinalCaixa(l) * (+l.valor), 0)
  // por conta bancária: variação do extrato do Bling × variação dos saldos do banco
  const bancos = [...new Set([...d.caixa.map(l => l.banco).filter(Boolean), ...d.saldos.map(s => s.conta)])].sort()
  const porBanco = bancos.map(b => {
    const mov = d.caixa.filter(l => l.banco === b).reduce((t, l) => t + sinalCaixa(l) * (+l.valor), 0)
    const ini = d.saldosAnt.find(s => s.conta === b), fim = d.saldos.find(s => s.conta === b)
    return { banco: b, mov, ini: ini ? +ini.saldo : null, fim: fim ? +fim.saldo : null, varBanco: ini && fim ? +fim.saldo - +ini.saldo : null }
  })
  return { linhas, ll, resCx, porBanco }
}

// ── CMV: do caixa ao consumo ─────────────────────────────────────────────────
// CMV por estoque = estoque inicial + compras recebidas no mês − estoque final (PEPS, fechamento_cmv).
// O caixa só mostra as compras pagas; a diferença para as recebidas é o que ficou a pagar (ou foi pago de
// meses anteriores), e a diferença entre recebidas e consumo é o que ficou (ou saiu) do estoque.
export function conciliacaoCMV(d) {
  const vc = montar(d, 'competencia'), vx = montar(d, 'caixa')
  const soma = (xs, k) => xs.reduce((t, x) => t + (+x[k] || 0), 0)
  const porTipo = tipo => {
    const est = d.cmv.filter(c => c.tipo === tipo && c.ei_valor != null && c.ef_valor != null)
    const prod = d.cmv.filter(c => c.tipo === tipo && (c.ei_valor == null || c.ef_valor == null))
    return { ei: soma(est, 'ei_valor'), compras: soma(est, 'compras_valor') + soma(est, 'atrasadas_valor'), ef: soma(est, 'ef_valor'),
      cmvEstoque: soma(est, 'cmv_valor'), pelaProducao: soma(prod, 'cmv_valor') }
  }
  const contasCmv = d.plano.filter(p => p.grupo === 'cmv').map(p => p.id)
  const itensCx = contasCmv.flatMap(k => vx[k]?.itens || [])
  const pago = k => (vx[k]?.valor || 0)
  const mkt = (d.comp?.extras?.cmv_marketing || []).reduce((t, g) => t + g.mp + g.emb, 0)
  return {
    mp: porTipo('mp'), emb: porTipo('emb'),
    envio: vc['cmv.envio']?.itens.filter(x => x.tipo === 'envio' || x.tipo === 'sacola').reduce((t, x) => t + x.valor, 0) || 0,
    insumos: vc['cmv.insumos']?.valor || 0, marketing: mkt,
    manuais: contasCmv.flatMap(k => vc[k]?.itens || []).filter(x => x.tipo === 'manual').reduce((t, x) => t + x.valor, 0),
    cmvDRE: calcular(vc, d.plano).cmv,
    pagoMP: pago('cmv.mp'), pagoEmb: pago('cmv.emb'), pagoEnvio: pago('cmv.envio'), pagoInsumos: pago('cmv.insumos'),
    pagoTotal: itensCx.reduce((t, x) => t + x.valor, 0),
  }
}

// ── Prova da competência (a partir de nov/26) ────────────────────────────────
// Lucro por competência − resultado de caixa (sem transferências e aportes) = variação do que ficou pendente:
//   + Δ a receber (plataformas: painel de cada uma; revenda: contas a receber do Bling)
//   + Δ estoque contado (fechamento do CMV) + Δ despesas antecipadas (rateios a apropriar) + Δ carteiras pré-pagas
//   − Δ contas a pagar (Bling, na data) − Δ Correios a pagar (envios de faturas ainda não vencidas)
//   + estimativas sem saldo conferível (embalagem sem contagem, embalagem de envio por pedido)
// Cada saldo vem de fora da DRE; o que sobra ("não explicado") é erro em algum lugar da competência.
export const PROVA_DESDE = '2026-11'
export const ITENS_PROVA = [
  { id: 'receber:ifood', nome: 'iFood: a receber', lado: 1, onde: 'Portal do Parceiro › Financeiro › repasses futuros (todas as lojas)' },
  { id: 'receber:99food', nome: '99 Food: a receber', lado: 1, onde: 'Portal 99 Food › Financeiro › a receber' },
  { id: 'receber:keeta', nome: 'Keeta: a receber', lado: 1, onde: 'Keeta Merchant › Finanças › a receber' },
  { id: 'receber:anotaai', nome: 'Anota.AI: a receber', lado: 1, onde: 'Anota.AI › Financeiro › a receber' },
  { id: 'receber:pagarme', nome: 'Pagar.me: a receber', lado: 1, onde: 'Dashboard Pagar.me › Recebíveis › saldo a receber (+ saldo disponível não sacado)' },
  { id: 'receber:mercadopago', nome: 'Mercado Pago e Mercado Livre: a liberar', lado: 1, onde: 'Mercado Pago › Seu dinheiro › a liberar (+ saldo disponível não transferido)' },
  { id: 'receber:rits', nome: 'Clube (Rits Pay): a receber', lado: 1, onde: 'Rits Pay › Financeiro › a receber' },
  { id: 'receber:bling', nome: 'Revenda e venda direta: a receber (Bling)', lado: 1, auto: true },
  { id: 'carteira:lalamove', nome: 'Lalamove: saldo da carteira', lado: 1, onde: 'Lalamove Business › Carteira (saldo)' },
  { id: 'carteira:melhorenvio', nome: 'Melhor Envio: saldo da carteira', lado: 1, onde: 'Melhor Envio › Carteira (saldo)' },
  { id: 'carteira:midia', nome: 'Meta e Google: crédito − fatura em aberto', lado: 1, onde: 'Gerenciador de anúncios › Faturamento (negativo se há valor a pagar)' },
  { id: 'estoque', nome: 'Estoque contado (matéria-prima e embalagem)', lado: 1, auto: true },
  { id: 'antecipadas', nome: 'Despesas antecipadas (rateios a apropriar)', lado: 1, auto: true },
  { id: 'pagar:bling', nome: 'Contas a pagar em aberto (Bling)', lado: -1, auto: true },
  { id: 'pagar:correios', nome: 'Correios a pagar (envios de faturas não vencidas)', lado: -1, auto: true },
]

// Saldo a apropriar dos rateios no fim de `mes`
export const antecipadasEm = (rateios, mes) => (rateios || []).filter(r => r.mes_inicio <= mes).reduce((t, r) => {
  const p = parcelaDoMes(r, mes), apropriado = p ? p.n * p.valor : (mes > fimRateio(r) ? +r.valor_total : 0)
  return t + Math.max(0, +r.valor_total - apropriado)
}, 0)

// Contas a pagar (ou a receber) em aberto numa data: competência até a data e ainda não pagas nela
// (em aberto hoje, ou pagas depois da data). Provisão dos Correios fica fora: vem de pagar:correios.
// Contas a receber: só revenda e venda direta (as plataformas vêm do painel de cada uma).
export async function abertoEm(tipo, data, pagasDepois) {
  const tabela = tipo === 'pagar' ? 'dre_contas_competencia' : 'dre_receber_competencia'
  const cols = 'id_bling, competencia, valor, situacao, nome, categoria'
  const abertas = await buscarTudo(() => supabase.from(tabela).select(cols).lte('competencia', data).not('situacao', 'in', '("Pago","pago")').order('id_bling'))
  const ids = [...new Set(pagasDepois.map(String))], pagas = []
  for (let i = 0; i < ids.length; i += 200) pagas.push(...await buscarTudo(() => supabase.from(tabela).select(cols).lte('competencia', data).in('id_bling', ids.slice(i, i + 200)).order('id_bling')))
  const vistos = new Set(), lista = []
  for (const c of [...abertas, ...pagas]) {
    if (!c.id_bling || vistos.has(c.id_bling)) continue
    vistos.add(c.id_bling)
    if (tipo === 'pagar' && /correios/i.test(c.nome || '') && /frete/i.test(c.categoria || '')) continue
    if (tipo === 'receber' && !/revenda|venda direta/i.test(c.categoria || '')) continue
    lista.push(c)
  }
  return { saldo: Math.round(lista.reduce((t, c) => t + +c.valor, 0) * 100) / 100, n: lista.length, parciais: lista.filter(c => /parcial/i.test(c.situacao || '')).length }
}

// Correios a pagar numa data: envios até a data cuja fatura vence depois dela (ou ainda sem vencimento)
export async function correiosAPagarEm(data) {
  try {
    const ls = await buscarTudo(() => supabase.from('dre_fretes').select('valor, data, vencimento').eq('origem', 'correios').lte('data', data).or(`vencimento.gt.${data},vencimento.is.null`).order('data'))
    return Math.round(ls.reduce((t, l) => t + +l.valor, 0) * 100) / 100
  } catch { return null }   // antes do dre_laricas_5.sql (sem vencimento): fica faltando
}

// bal: linhas de dre_balanco do mês; balAnt: do mês anterior (saldo inicial quando o do mês não tem saldo_ini)
export function prova(d, bal, balAnt, correios) {
  const vc = montar(d, 'competencia'), vx = montar(d, 'caixa'), c = calcular(vc, d.plano)
  const resCx = d.caixa.reduce((t, l) => t + sinalCaixa(l) * (+l.valor), 0)
  const foraCx = d.plano.filter(p => p.grupo === 'fora' && p.id !== 'fora.ajuste').reduce((t, p) => t + (vx[p.id]?.itens || []).reduce((s, x) => s + x.sinal * (+x.l.valor), 0), 0)
  const ajuste = (vx['fora.ajuste']?.itens || []).reduce((s, x) => s + x.sinal * (+x.l.valor), 0)
  const linhaDe = id => bal.find(b => b.item === id), antDe = id => balAnt.find(b => b.item === id)
  const est = d.cmv.filter(x => x.ei_valor != null && x.ef_valor != null)
  const itens = ITENS_PROVA.map(it => {
    let ini = null, fim = null
    if (it.id === 'estoque') { ini = est.reduce((t, x) => t + +x.ei_valor, 0); fim = est.reduce((t, x) => t + +x.ef_valor, 0) }
    else if (it.id === 'antecipadas') { ini = antecipadasEm(d.rateios, mesAnterior(d.mes)); fim = antecipadasEm(d.rateios, d.mes) }
    else if (it.id === 'pagar:correios') { ini = correios?.ini ?? null; fim = correios?.fim ?? null }
    else { const b = linhaDe(it.id); fim = b ? +b.saldo : null; ini = b?.saldo_ini != null ? +b.saldo_ini : antDe(it.id) ? +antDe(it.id).saldo : null }
    const delta = ini != null && fim != null ? fim - ini : null
    return { ...it, ini, fim, delta, efeito: delta == null ? null : it.lado * delta, detalhe: linhaDe(it.id)?.detalhe || null }
  })
  // estimativas: consumo estimado × compras do mês (sem saldo que dê para conferir)
  const pagarConta = k => d.pagar.filter(l => classificar(l, 'pagar', d).conta === k).reduce((t, l) => t + +l.valor, 0)
  const embProd = d.cmv.filter(x => x.tipo === 'emb' && (x.ei_valor == null || x.ef_valor == null)).reduce((t, x) => t + (+x.cmv_valor || 0), 0)
  const envioComp = (vc['cmv.envio']?.itens || []).filter(x => x.tipo === 'envio' || x.tipo === 'sacola').reduce((t, x) => t + x.valor, 0)
  const estimativas = [
    embProd ? { id: 'est:emb', nome: 'Embalagem sem contagem: compras − consumo estimado pela produção', efeito: pagarConta('cmv.emb') - embProd } : null,
    { id: 'est:envio', nome: 'Embalagem de envio e sacolas: compras − estimado por pedido', efeito: pagarConta('cmv.envio') - envioComp },
  ].filter(Boolean)
  const resOper = resCx - foraCx - ajuste
  const alvo = c.ll - resOper
  const explicado = itens.reduce((t, x) => t + (x.efeito || 0), 0) + estimativas.reduce((t, x) => t + x.efeito, 0)
  const faltam = itens.filter(x => x.efeito == null)
  return { ll: c.ll, resCx, foraCx, ajuste, resOper, alvo, itens, estimativas, explicado, naoExplicado: faltam.length ? null : alvo - explicado, faltam }
}
