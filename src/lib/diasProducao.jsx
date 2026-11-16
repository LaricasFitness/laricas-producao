import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

// Dias de produção e bloqueio da conferência de estoque.
//
// Dia trabalhado = segunda a sexta, menos feriados (nacionais + São Paulo) e menos os dias sem produção
// cadastrados em Admin › Sistema (recesso, folga coletiva, dia em que não houve produção).
// Produção lançada num sábado, domingo ou feriado vale normalmente; só não é exigida.
//
// A conferência (matéria-prima e embalagens) só pode ser lançada com a produção em dia quando é a
// contagem de fechamento:
//   semana → hoje é o último dia trabalhado da semana (normalmente sexta) ou depois dele:
//            exige produção lançada em todos os dias trabalhados de segunda até hoje
//   mês    → hoje é o último dia trabalhado do mês ou depois dele:
//            exige produção lançada em todos os dias trabalhados do mês até hoje
// Nos outros dias a conferência fica livre.
//
// Os dias sem produção ficam em configuracoes.chave = 'dias_sem_producao' (lista JSON de { data, motivo }).

const CHAVE = 'dias_sem_producao'

// datas sempre como 'AAAA-MM-DD' no horário local (toISOString viraria o dia depois das 21h)
export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dataDe = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d) }
const somar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export const hojeISO = () => iso(new Date())
export const rotuloDia = s => dataDe(s).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(ano, mes - 1, dia)
}

// { 'AAAA-MM-DD': nome } — nacionais + estado e cidade de São Paulo
export function feriados(ano) {
  const p = pascoa(ano)
  const fixos = {
    '01-01': 'Confraternização Universal', '01-25': 'Aniversário de São Paulo', '04-21': 'Tiradentes',
    '05-01': 'Dia do Trabalho', '07-09': 'Revolução Constitucionalista', '09-07': 'Independência',
    '10-12': 'Nossa Senhora Aparecida', '11-02': 'Finados', '11-15': 'Proclamação da República',
    '11-20': 'Consciência Negra', '12-25': 'Natal',
  }
  const out = Object.fromEntries(Object.entries(fixos).map(([md, nome]) => [`${ano}-${md}`, nome]))
  out[iso(somar(p, -48))] = 'Carnaval'
  out[iso(somar(p, -47))] = 'Carnaval'
  out[iso(somar(p, -2))] = 'Sexta-feira Santa'
  out[iso(somar(p, 60))] = 'Corpus Christi'
  return out
}

export async function carregarDiasSemProducao() {
  const { data } = await supabase.from('configuracoes').select('valor').eq('chave', CHAVE).maybeSingle()
  try { const l = JSON.parse(data?.valor || '[]'); return Array.isArray(l) ? l : [] } catch { return [] }
}

export async function salvarDiasSemProducao(lista) {
  const valor = JSON.stringify([...lista].sort((a, b) => a.data.localeCompare(b.data)))
  const { error } = await supabase.from('configuracoes').upsert({
    chave: CHAVE, valor,
    descricao: 'Dias de semana sem produção (recesso, folga). Não são cobrados na conferência de estoque. Admin › Sistema.',
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'chave' })
  if (error) throw error
}

// Por que o dia não é trabalhado (ou null se é dia de produção)
export function motivoFolga(s, semProducao = []) {
  const d = dataDe(s)
  if (d.getDay() === 0 || d.getDay() === 6) return 'Fim de semana'
  const f = feriados(d.getFullYear())[s]
  if (f) return f
  const extra = semProducao.find(x => x.data === s)
  return extra ? (extra.motivo || 'Sem produção') : null
}
const trabalhado = (s, semProducao) => !motivoFolga(s, semProducao)

// Há algum dia trabalhado depois de `s` até `fim` (inclusive)?
function temTrabalhoDepois(s, fim, semProducao) {
  for (let d = somar(dataDe(s), 1); iso(d) <= fim; d = somar(d, 1)) if (trabalhado(iso(d), semProducao)) return true
  return false
}

// → { exige: [] | ['semana'] | ['mês'] | ['semana', 'mês'], inicio, faltando: ['AAAA-MM-DD', ...] }
export async function verificarProducaoConferencia(hoje = hojeISO()) {
  const semProducao = await carregarDiasSemProducao()
  const d = dataDe(hoje)
  const segunda = somar(d, -((d.getDay() + 6) % 7))
  const domingo = iso(somar(segunda, 6))
  const fimMes = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  const exige = [], inicios = []
  if (!temTrabalhoDepois(hoje, domingo, semProducao)) { exige.push('semana'); inicios.push(iso(segunda)) }
  if (!temTrabalhoDepois(hoje, fimMes, semProducao)) { exige.push('mês'); inicios.push(hoje.slice(0, 8) + '01') }
  if (!exige.length) return { exige, inicio: null, faltando: [] }

  const inicio = inicios.sort()[0]
  const { data, error } = await supabase.from('producao_diaria')
    .select('data_producao, registrado_por').gte('data_producao', inicio).lte('data_producao', hoje)
  if (error) throw error
  // baixa automática de embalagem não conta como produção lançada
  const comProducao = new Set((data || []).filter(r => !/auto-embalagem/i.test(r.registrado_por || '')).map(r => r.data_producao))
  const faltando = []
  for (let x = dataDe(inicio); iso(x) <= hoje; x = somar(x, 1)) {
    const s = iso(x)
    if (trabalhado(s, semProducao) && !comProducao.has(s)) faltando.push(s)
  }
  return { exige, inicio, faltando }
}

// Hook para as telas de conferência: { carregando, exige, faltando, bloqueado, recarregar }
export function useBloqueioConferencia() {
  const [estado, setEstado] = useState({ carregando: true, exige: [], faltando: [] })
  async function recarregar() {
    setEstado(e => ({ ...e, carregando: true }))
    try { setEstado({ carregando: false, ...(await verificarProducaoConferencia()) }) }
    catch (e) { setEstado({ carregando: false, exige: [], faltando: [], erro: e.message || String(e) }) }
  }
  useEffect(() => { recarregar() }, [])
  return { ...estado, bloqueado: estado.faltando.length > 0, recarregar }
}

// Confere de novo na hora de salvar (a tela pode ter ficado aberta). true = pode salvar.
export async function podeLancarConferencia() {
  try {
    const r = await verificarProducaoConferencia()
    if (!r.faltando.length) return true
    alert(`Conferência de fechamento d${r.exige.includes('mês') ? 'o mês' : 'a semana'} bloqueada.\n\n` +
      `Falta lançar a produção de: ${r.faltando.map(rotuloDia).join(', ')}.\n\n` +
      'Lance a produção desses dias (Produção) ou, se não houve produção, marque o dia em Admin › Sistema › Dias sem produção.')
    return false
  } catch { return true } // sem conseguir checar, não trava a contagem
}

export function AvisoProducaoPendente({ bloqueio }) {
  if (bloqueio.carregando || !bloqueio.exige.length) return null
  const qual = bloqueio.exige.includes('mês') ? 'do mês' : 'da semana'
  if (!bloqueio.faltando.length) return (
    <div className="alert-banner ok" style={{ fontSize: 13 }}>
      ✓ Conferência de fechamento {qual}: a produção de todos os dias trabalhados está lançada.
    </div>
  )
  return (
    <div className="alert-banner danger" style={{ fontSize: 13, lineHeight: 1.5 }}>
      <b>Conferência de fechamento {qual} bloqueada.</b> Falta lançar a produção de{' '}
      <b>{bloqueio.faltando.map(rotuloDia).join(', ')}</b>.
      {' '}Lance a produção desses dias antes de contar o estoque. Se não houve produção num desses dias,
      marque em Admin › Sistema › Dias sem produção.{' '}
      <button className="btn btn-ghost btn-sm" onClick={bloqueio.recarregar}>Verificar de novo</button>
    </div>
  )
}
