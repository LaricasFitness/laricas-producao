import { supabase } from '../supabase'

export const STATUS_LABEL = {
  em_aberto: { label: 'Em aberto',  cls: 'warning' },
  pendente:  { label: 'Em aberto',  cls: 'warning' }, // compatibilidade com dados antigos
  pago:      { label: 'Pago',       cls: 'ok'      },
  agendado:  { label: 'Agendado',   cls: 'purple'  },
  cancelado: { label: 'Cancelado',  cls: 'neutral' },
  vencido:   { label: 'Vencido',    cls: 'danger'  },
}

export function fmtR(n) {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtData(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR')
}

export function mesLabel(iso) {
  if (!iso) return '—'
  // Aceita '2025-01' ou '2025-01-01'
  const parte = iso.slice(0, 7)
  const [ano, mes] = parte.split('-').map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
}

// Verifica parcelas vencidas e atualiza status
export async function atualizarVencidas() {
  const hoje = new Date().toISOString().slice(0, 10)
  // Atualiza tanto 'pendente' (legacy) quanto 'em_aberto'
  await supabase.from('fin_parcelas').update({ status: 'vencido' })
    .in('status', ['pendente', 'em_aberto']).lt('data_vencimento', hoje)
}

// Carrega lançamentos com parcelas, categoria e canal
export async function carregarLancamentos({ tipo, status, ini, fim, categoriaId, canalId } = {}) {
  let q = supabase.from('fin_lancamentos')
    .select(`*, fin_categorias(id,nome,cor,tipo), fin_canais(id,nome,cor), fin_contas(id,nome),
             fin_parcelas(id,numero_parcela,valor,data_vencimento,data_competencia,data_pagamento,status,observacao)`)
    .order('criado_em', { ascending: false })

  if (tipo)        q = q.eq('tipo', tipo)
  if (categoriaId) q = q.eq('categoria_id', categoriaId)
  if (canalId)     q = q.eq('canal_id', canalId)

  const { data } = await q
  let result = data || []

  // Filtra por status/data das parcelas se necessário
  if (status || ini || fim) {
    result = result.filter(l => {
      const parcelas = l.fin_parcelas || []
      return parcelas.some(p => {
        if (status && p.status !== status) return false
        if (ini && p.data_vencimento < ini) return false
        if (fim && p.data_vencimento > fim) return false
        return true
      })
    })
  }

  return result
}

// KPIs do dashboard financeiro
export async function carregarKPIs(ini, fim) {
  const { data: parcelas } = await supabase
    .from('fin_parcelas')
    .select('*, fin_lancamentos(tipo, categoria_id, canal_id, fin_categorias(nome), fin_canais(nome))')
    .gte('data_vencimento', ini)
    .lte('data_vencimento', fim)

  const todas = parcelas || []
  const receitas = todas.filter(p => p.fin_lancamentos?.tipo === 'receita')
  const despesas = todas.filter(p => p.fin_lancamentos?.tipo === 'despesa')

  const receitaTotal     = receitas.reduce((s, p) => s + p.valor, 0)
  const receitaPaga      = receitas.filter(p => p.status === 'pago').reduce((s, p) => s + p.valor, 0)
  const receitaPendente  = receitas.filter(p => ['pendente','agendado'].includes(p.status)).reduce((s, p) => s + p.valor, 0)
  const receitaVencida   = receitas.filter(p => p.status === 'vencido').reduce((s, p) => s + p.valor, 0)

  const despesaTotal     = despesas.reduce((s, p) => s + p.valor, 0)
  const despesaPaga      = despesas.filter(p => p.status === 'pago').reduce((s, p) => s + p.valor, 0)
  const despesaPendente  = despesas.filter(p => ['pendente','agendado'].includes(p.status)).reduce((s, p) => s + p.valor, 0)
  const despesaVencida   = despesas.filter(p => p.status === 'vencido').reduce((s, p) => s + p.valor, 0)

  const resultado = receitaPaga - despesaPaga
  const margem    = receitaPaga > 0 ? (resultado / receitaPaga) * 100 : 0

  return {
    receitaTotal, receitaPaga, receitaPendente, receitaVencida,
    despesaTotal, despesaPaga, despesaPendente, despesaVencida,
    resultado, margem,
    inadimplencia: receitaTotal > 0 ? (receitaVencida / receitaTotal) * 100 : 0,
  }
}

// Fluxo de caixa diário
export async function carregarFluxo(ini, fim) {
  const { data } = await supabase
    .from('fin_parcelas')
    .select('valor, data_vencimento, data_pagamento, status, fin_lancamentos(tipo)')
    .gte('data_vencimento', ini)
    .lte('data_vencimento', fim)
    .order('data_vencimento')

  const map = {}
  const d = new Date(ini + 'T00:00:00')
  const fimD = new Date(fim + 'T00:00:00')
  while (d <= fimD) {
    map[d.toISOString().slice(0, 10)] = { entradas: 0, saidas: 0, entradas_real: 0, saidas_real: 0 }
    d.setDate(d.getDate() + 1)
  }

  for (const p of (data || [])) {
    const dia = p.data_vencimento
    if (!map[dia]) continue
    if (p.fin_lancamentos?.tipo === 'receita') {
      map[dia].entradas += p.valor
      if (p.status === 'pago') map[dia].entradas_real += p.valor
    } else {
      map[dia].saidas += p.valor
      if (p.status === 'pago') map[dia].saidas_real += p.valor
    }
  }

  // Acumula saldo
  let saldo = 0, saldoReal = 0
  return Object.entries(map).map(([dia, v]) => {
    saldo += v.entradas - v.saidas
    saldoReal += v.entradas_real - v.saidas_real
    return { dia, ...v, saldo, saldoReal }
  })
}

// DRE gerencial mensal
export async function carregarDRE(anoMesIni, anoMesFim, canalId) {
  const ini = anoMesIni + '-01'
  const fim = anoMesFim + '-31'

  let q = supabase.from('fin_parcelas')
    .select('valor, data_competencia, data_vencimento, status, fin_lancamentos(tipo, canal_id, fin_categorias(id,nome,tipo), fin_canais(nome))')
    .gte('data_vencimento', ini)
    .lte('data_vencimento', fim)
    .eq('status', 'pago')

  const { data } = await q
  const parcelas = (data || []).filter(p => !canalId || p.fin_lancamentos?.canal_id === canalId)

  // Agrupa por mês e categoria
  const meses = {}
  for (const p of parcelas) {
    const mes = (p.data_competencia || p.data_vencimento).slice(0, 7)
    const tipo = p.fin_lancamentos?.tipo
    const cat = p.fin_lancamentos?.fin_categorias
    if (!cat) continue
    if (!meses[mes]) meses[mes] = { receitas: {}, despesas: {} }
    const bucket = tipo === 'receita' ? meses[mes].receitas : meses[mes].despesas
    if (!bucket[cat.nome]) bucket[cat.nome] = 0
    bucket[cat.nome] += p.valor
  }

  return meses
}
