import { supabase } from '../supabase'
import { iso, hojeISO, motivoFolga, carregarDiasSemProducao } from './diasProducao'
import { semOcultos } from './sazonal'
import { situacaoFretes } from './fretes'

// Tarefas do dia (página Hoje). Cada tarefa é de uma área do menu: o usuário vê só as das áreas que acessa
// (admin vê todas). A ✓ vem sozinha quando o sistema encontra o registro da tarefa, ou alguém marca à mão
// (tarefas_marcadas, tarefas.sql). Tarefa semanal/mensal não feita continua aparecendo como atrasada.
// Só contam os dias trabalhados (seg a sex, menos feriados e os dias sem produção do Admin › Sistema),
// a mesma regra da conferência de estoque.

const dataDe = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d) }
const somar = (s, n) => { const d = dataDe(s); d.setDate(d.getDate() + n); return iso(d) }
const br = s => dataDe(s).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
const inicioSemana = s => { const d = dataDe(s); return somar(s, -((d.getDay() + 6) % 7)) }   // segunda
const ultimoDiaMes = s => iso(new Date(+s.slice(0, 4), +s.slice(5, 7), 0))
const diaLocal = ts => ts ? iso(new Date(ts)) : null   // timestamp → data em São Paulo (horário do navegador)

function contexto(hoje, semProducao) {
  const trabalhado = s => !motivoFolga(s, semProducao)
  const proximoTrabalhado = s => { let d = somar(s, 1); for (let i = 0; i < 15 && !trabalhado(d); i++) d = somar(d, 1); return d }
  const anteriorTrabalhado = s => { let d = somar(s, -1); for (let i = 0; i < 15 && !trabalhado(d); i++) d = somar(d, -1); return d }
  // último dia trabalhado da semana / do mês de `s`
  const fimSemana = s => { const dom = somar(inicioSemana(s), 6); let d = dom; while (d > inicioSemana(s) && !trabalhado(d)) d = somar(d, -1); return d }
  const fimMes = s => { let d = ultimoDiaMes(s); while (d.slice(0, 7) === s.slice(0, 7) && !trabalhado(d)) d = somar(d, -1); return d }
  return { hoje, trabalhado, proximoTrabalhado, anteriorTrabalhado, fimSemana, fimMes, hojeTrabalhado: trabalhado(hoje) }
}

// Quem fez e quando, a partir dos registros: nomes distintos e o horário do primeiro (ou do último)
function quemQuando(linhas, campoPor, campoEm, ultimo = false) {
  const ls = (linhas || []).filter(l => l[campoEm])
  if (!ls.length) return {}
  const em = ls.map(l => l[campoEm]).sort()[ultimo ? ls.length - 1 : 0]
  const nomes = [...new Set(ls.map(l => String(l[campoPor] || '').replace(/ (auto-embalagem)$/, '').trim()).filter(Boolean))]
  return { por: nomes.join(', ') || null, em }
}

// Contagens desde uma data → Set de itens contados
async function contadosDesde(tipo, desde) {
  if (tipo === 'mp') {
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.from('conferencia_mp').select('materia_prima_id').gte('data_conferencia', desde),
      supabase.from('mp_inventarios').select('materia_prima_id').gte('data_inventario', desde),
    ])
    return new Set([...(c || []), ...(i || [])].map(r => r.materia_prima_id))
  }
  const { data } = await supabase.from('inventarios').select('embalagem_id').gte('data_inventario', desde)
  return new Set((data || []).map(r => r.embalagem_id))
}

// Itens ativos (para a contagem): MP e embalagens/rótulos em temporada; só os ⭐ se `semanal`
async function itensAtivos(tipo, semanal) {
  const tabela = tipo === 'mp' ? 'materias_primas' : 'embalagens'
  let q = supabase.from(tabela).select(tipo === 'mp' ? 'id' : 'id, codigo, nome, categoria').eq('ativo', true)
  if (semanal) q = q.eq('contagem_semanal', true)
  const { data, error } = await q
  if (error) return []   // antes do estoque_embalagem.sql (sem contagem_semanal)
  return tipo === 'mp' ? (data || []) : semOcultos(data || [])
}

async function contagem(tipo, semanal, desde) {
  const [itens, contados, { data: confs }] = await Promise.all([itensAtivos(tipo, semanal), contadosDesde(tipo, desde),
    supabase.from(tipo === 'mp' ? 'conferencia_mp' : 'conferencia_estoque').select('responsavel, criado_em').gte('data_conferencia', desde)])
  const feitos = itens.filter(i => contados.has(i.id)).length
  return { feito: itens.length > 0 && feitos === itens.length, detalhe: `${feitos} de ${itens.length} itens contados${semanal ? ' (⭐)' : ''}`,
    vazio: !itens.length, ...quemQuando(confs, 'responsavel', 'criado_em', true) }
}

// ── Catálogo ─────────────────────────────────────────────────────────────────
// instancias(ctx) → [{ ref, prazo, atrasada }]: em que dias a tarefa aparece (ref identifica a ocorrência)
// verificar(ref, ctx) → { feito, detalhe }
const diaria = (cond = c => c.hojeTrabalhado) => c => cond(c) ? [{ ref: c.hoje, prazo: c.hoje }] : []
// No último dia trabalhado da semana (e depois), a desta semana; antes dele, a da semana passada se
// ficou pendente (a contagem desta semana resolve as duas: conta qualquer contagem desde a segunda)
const semanal = c => {
  const fim = c.fimSemana(c.hoje)
  if (c.hoje >= fim) return [{ ref: inicioSemana(c.hoje), prazo: fim }]
  const antes = somar(inicioSemana(c.hoje), -7)
  return [{ ref: antes, prazo: c.fimSemana(antes), atrasada: true, soSePendente: true }]
}

export const TAREFAS = [
  {
    id: 'producao_registro', area: 'producao', titulo: 'Registrar a produção do dia', quando: 'Todo dia trabalhado',
    ir: ['producao', 'registro'], instancias: diaria(),
    async verificar(ref) {
      const { data } = await supabase.from('producao_diaria').select('registrado_por, criado_em')
        .eq('data_producao', ref).not('registrado_por', 'ilike', '%(auto-embalagem)%')
      const n = (data || []).length
      return { feito: n > 0, detalhe: n ? `${n} lançamento(s)` : 'Nenhuma produção lançada no dia', ...quemQuando(data, 'registrado_por', 'criado_em') }
    },
  },
  {
    id: 'producao_planejamento', area: 'producao', titulo: 'Fechar o planejamento do próximo dia (gera o picking)', quando: 'Todo dia trabalhado',
    ir: ['producao', 'planejamento'], instancias: diaria(),
    async verificar(ref, c) {
      const prox = c.proximoTrabalhado(ref)
      const { data } = await supabase.from('expedicao_pickings').select('gerado_em, gerado_por').eq('data_producao', prox).maybeSingle()
      return { feito: !!data, detalhe: data ? `Picking de ${br(prox)} gerado` : `Falta o picking de ${br(prox)}`, por: data?.gerado_por, em: data?.gerado_em }
    },
  },
  {
    id: 'logistica_picking', area: 'logistica', titulo: 'Baixar o picking do dia', quando: 'Todo dia trabalhado',
    ir: ['logistica', 'expedicao'], instancias: diaria(),
    async verificar(ref) {
      const { data } = await supabase.from('expedicao_pickings').select('baixado_em, baixado_por, pedidos').eq('data_producao', ref).maybeSingle()
      if (!data) return { feito: false, detalhe: 'O picking de hoje ainda não foi gerado (Produção › Planejamento)' }
      return { feito: !!data.baixado_em, detalhe: `${(data.pedidos || []).length} pedido(s)`, por: data.baixado_por, em: data.baixado_em }
    },
  },
  {
    id: 'logistica_rotas', area: 'logistica', titulo: 'Montar as rotas de entrega', quando: 'Todo dia trabalhado',
    ir: ['logistica', 'roteiro'], instancias: diaria(),
    async verificar(ref) {
      const { data } = await supabase.from('logistica_historico').select('criado_em, criado_por, total_rotas')
        .gte('criado_em', dataDe(ref).toISOString()).lt('criado_em', dataDe(somar(ref, 1)).toISOString())
      const n = (data || []).length
      return { feito: n > 0, detalhe: n ? `${n} roteiro(s) gerado(s)` : 'Nenhum roteiro gerado no dia', ...quemQuando(data, 'criado_por', 'criado_em') }
    },
  },
  {
    id: 'logistica_delivery', area: 'logistica', titulo: 'Contagem do Delivery BV', quando: 'Segunda a sexta (dias trabalhados)',
    ir: ['logistica', 'delivery'], instancias: diaria(),
    async verificar(ref) {
      const { data } = await supabase.from('delivery_contagens').select('registrado_por, criado_em').eq('data', ref)
      const n = (data || []).length
      return { feito: n > 0, detalhe: n ? `${n} produto(s) contado(s)` : 'Contagem do dia não lançada', ...quemQuando(data, 'registrado_por', 'criado_em') }
    },
  },
  {
    id: 'logistica_baixa', area: 'logistica', titulo: 'Baixa dos pedidos enviados (picking anterior)', quando: 'Todo dia trabalhado',
    ir: ['logistica', 'expedicao'], instancias: diaria(),
    async verificar(ref) {
      // Marca sozinha quando houve baixa hoje. Revenda/Venda Direta ficam Atendido ao emitir a nota e não
      // passam pela baixa: por isso "X de Y" é só informação.
      const [{ data: ant }, { data: envs }] = await Promise.all([
        supabase.from('expedicao_pickings').select('data_producao, pedidos').lt('data_producao', ref).order('data_producao', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('expedicao_envios').select('operador, criado_em')
          .gte('criado_em', dataDe(ref).toISOString()).lt('criado_em', dataDe(somar(ref, 1)).toISOString()),
      ])
      const hoje = (envs || []).length
      let info = ''
      if (ant) {
        const ids = (ant.pedidos || []).map(p => p.id).filter(Boolean)
        const { data: env } = ids.length ? await supabase.from('expedicao_envios').select('bling_id').in('bling_id', ids) : { data: [] }
        info = `Picking de ${br(ant.data_producao)}: ${new Set((env || []).map(e => String(e.bling_id))).size} de ${ids.length} pedido(s) com baixa`
      }
      return { feito: hoje > 0, detalhe: [hoje ? `${hoje} baixa(s) no dia` : 'Nenhuma baixa no dia', info].filter(Boolean).join(' · '), ...quemQuando(envs, 'operador', 'criado_em') }
    },
  },
  {
    id: 'estoque_semanal_mp', area: 'estoque', titulo: 'Contagem semanal da matéria-prima (itens ⭐)', quando: 'Último dia trabalhado da semana',
    ir: ['estoque', 'conferencia'], instancias: semanal,
    verificar: ref => contagem('mp', true, ref),
  },
  {
    id: 'estoque_semanal_emb', area: 'estoque', titulo: 'Contagem semanal de embalagens e rótulos (itens ⭐)', quando: 'Último dia trabalhado da semana',
    ir: ['estoque', 'conferencia'], instancias: semanal,
    verificar: ref => contagem('emb', true, ref),
  },
  {
    id: 'estoque_mensal', area: 'estoque', titulo: 'Contagem completa de fechamento do mês (matéria-prima e embalagens)', quando: 'Último dia do mês (vale até 3 dias antes)',
    ir: ['estoque', 'conferencia'],
    instancias: c => {
      const ult = ultimoDiaMes(c.hoje)
      if (c.hoje >= somar(ult, -3)) return [{ ref: c.hoje.slice(0, 7), prazo: ult }]
      // mês anterior, se ficou pendente: até o fechamento do CMV (dia 5)
      const ant = somar(c.hoje.slice(0, 7) + '-01', -1)
      return +c.hoje.slice(8, 10) < 5 ? [{ ref: ant.slice(0, 7), prazo: ant, atrasada: true, soSePendente: true }] : []
    },
    async verificar(ref) {
      const desde = somar(ultimoDiaMes(ref + '-01'), -3)
      const [mp, emb] = await Promise.all([contagem('mp', false, desde), contagem('emb', false, desde)])
      return { feito: mp.feito && emb.feito, detalhe: `Matéria-prima: ${mp.detalhe} · Embalagens: ${emb.detalhe}` }
    },
  },
  {
    id: 'financeiro_fretes', area: 'financeiro', titulo: 'Importar os relatórios do mês anterior da Lalamove e do Melhor Envio', quando: 'Dia 1 a 5',
    ir: ['financeiro', 'dre'],
    instancias: c => {
      const ant = somar(c.hoje.slice(0, 7) + '-01', -1).slice(0, 7)
      return [{ ref: ant, prazo: `${c.hoje.slice(0, 7)}-05`, soSePendente: c.hoje.slice(8, 10) > '05' }]
    },
    async verificar(ref) {
      const { data, error } = await supabase.from('dre_fretes').select('origem, data, por, em').eq('mes', ref).in('origem', ['lalamove', 'melhorenvio'])
      if (error) return { feito: false, detalhe: 'Aplique o dre_laricas_3.sql no Supabase.' }
      const s = situacaoFretes(data || [], ref)
      return { feito: s.lalamove.ok && s.melhorenvio.ok, detalhe: `Lalamove: ${s.lalamove.detalhe} · Melhor Envio: ${s.melhorenvio.detalhe} (mês sem envio: marque à mão)`,
        ...quemQuando(data, 'por', 'em', true) }
    },
  },
  {
    id: 'financeiro_correios', area: 'financeiro', titulo: 'Importar a fatura dos Correios (extrato analítico .csv)', quando: 'Dia 16 (a fatura fecha dia 15)',
    ir: ['financeiro', 'dre'],
    instancias: c => {
      if (+c.hoje.slice(8, 10) < 16) return []
      // a fatura que fecha dia 15 completa o mês anterior (envios do dia 16 ao fim)
      const ant = somar(c.hoje.slice(0, 7) + '-01', -1).slice(0, 7)
      return [{ ref: ant, prazo: `${c.hoje.slice(0, 7)}-16`, soSePendente: c.hoje.slice(8, 10) > '20' }]
    },
    async verificar(ref) {
      const { data, error } = await supabase.from('dre_fretes').select('origem, data, por, em').eq('mes', ref).eq('origem', 'correios')
      if (error) return { feito: false, detalhe: 'Aplique o dre_laricas_3.sql no Supabase.' }
      const s = situacaoFretes(data || [], ref)
      return { feito: s.correios.ok, detalhe: `Correios de ${ref.slice(5, 7)}/${ref.slice(0, 4)}: ${s.correios.detalhe}`, ...quemQuando(data, 'por', 'em', true) }
    },
  },
  {
    id: 'financeiro_dre', area: 'financeiro', titulo: 'Fechar a DRE do mês anterior (passo a passo e cadeado)', quando: 'A partir do dia 16 (depois da fatura dos Correios)',
    ir: ['financeiro', 'dre'],
    instancias: c => {
      if (+c.hoje.slice(8, 10) < 16) return []
      const ant = somar(c.hoje.slice(0, 7) + '-01', -1).slice(0, 7)
      return [{ ref: ant, prazo: `${c.hoje.slice(0, 7)}-20`, soSePendente: c.hoje.slice(8, 10) > '25' }]
    },
    async verificar(ref) {
      const { data } = await supabase.from('dre_mes').select('visao, fechado_em, fechado_por').eq('mes', ref)
      const fechadas = (data || []).filter(r => r.fechado_em).map(r => r.visao)
      const falta = ['competencia', 'caixa'].filter(v => !fechadas.includes(v))
      return { feito: !falta.length, detalhe: falta.length ? `Falta fechar: ${falta.map(v => v === 'caixa' ? 'caixa' : 'competência').join(' e ')}` : 'Competência e caixa fechados',
        ...(falta.length ? {} : quemQuando((data || []).filter(r => r.fechado_em), 'fechado_por', 'fechado_em', true)) }
    },
  },
]

// Tarefas do dia para as áreas `areas` (null = todas). Devolve as linhas prontas para a tela.
export async function carregarTarefas(areas, hoje = hojeISO(), diasSemProducao = null) {
  const semProducao = diasSemProducao || await carregarDiasSemProducao()
  const c = contexto(hoje, semProducao)
  const lista = TAREFAS.filter(t => !areas || areas.includes(t.area))
    .flatMap(t => t.instancias(c).map(inst => ({ t, ...inst })))
  const { data: marcadas, error } = await supabase.from('tarefas_marcadas').select('*').in('tarefa', [...new Set(lista.map(l => l.t.id))])
  const manual = {}
  for (const m of (error ? [] : marcadas || [])) manual[`${m.tarefa}|${m.ref}`] = m
  const linhas = await Promise.all(lista.map(async l => {
    let r
    try { r = await l.t.verificar(l.ref, c) } catch (e) { r = { feito: false, detalhe: 'Não consegui verificar: ' + e.message } }
    const m = manual[`${l.t.id}|${l.ref}`]
    return {
      id: l.t.id, area: l.t.area, titulo: l.t.titulo, quando: l.t.quando, ir: l.t.ir, ref: l.ref,
      prazo: l.prazo, atrasada: !!l.atrasada || l.prazo < hoje, soSePendente: l.soSePendente,
      auto: !!r.feito, manual: m || null, feito: !!r.feito || !!m, detalhe: r.detalhe,
      // quem fez e quando: do próprio registro (automática) ou de quem marcou
      por: r.feito ? (r.por || null) : (m?.marcado_por || null), em: r.feito ? (r.em || null) : (m?.marcado_em || null),
    }
  }))
  return { hoje, hojeTrabalhado: c.hojeTrabalhado, motivoFolga: motivoFolga(hoje, semProducao), linhas: linhas.filter(l => !(l.soSePendente && l.feito)), semTabela: !!error }
}

// Acompanhamento (Admin): as tarefas de todas as áreas em cada um dos últimos `n` dias trabalhados (e hoje)
export async function carregarAcompanhamento(n = 7, hoje = hojeISO()) {
  const semProducao = await carregarDiasSemProducao()
  const dias = [hoje]
  for (let d = somar(hoje, -1), i = 0; dias.length <= n && i < 40; d = somar(d, -1), i++) if (!motivoFolga(d, semProducao)) dias.push(d)
  const porDia = await Promise.all(dias.map(d => carregarTarefas(null, d, semProducao)))
  return { dias, porDia: Object.fromEntries(dias.map((d, i) => [d, porDia[i]])) }
}

export async function marcarTarefa(tarefa, ref, usuario) {
  const { error } = await supabase.from('tarefas_marcadas').upsert(
    { tarefa, ref, marcado_por: usuario || null, marcado_em: new Date().toISOString() }, { onConflict: 'tarefa,ref' })
  if (error) throw new Error(/tarefas_marcadas/.test(error.message) ? 'Aplique o tarefas.sql no Supabase.' : error.message)
}

export async function desmarcarTarefa(tarefa, ref) {
  const { error } = await supabase.from('tarefas_marcadas').delete().eq('tarefa', tarefa).eq('ref', ref)
  if (error) throw error
}

export const rotuloData = br
