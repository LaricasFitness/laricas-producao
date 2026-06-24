import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, TrendingUp, TrendingDown, Minus, FileText } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n) { return (n || 0).toLocaleString('pt-BR') }
function fmtDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }

function periodoAnterior(ini, fim) {
  const a = new Date(ini + 'T00:00:00')
  const b = new Date(fim + 'T00:00:00')
  const dias = Math.round((b - a) / 86400000) + 1
  const novaFim = new Date(a); novaFim.setDate(a.getDate() - 1)
  const novaIni = new Date(novaFim); novaIni.setDate(novaFim.getDate() - dias + 1)
  return [novaIni.toISOString().slice(0,10), novaFim.toISOString().slice(0,10)]
}

function periodoMesAnterior(ini, fim) {
  const a = new Date(ini + 'T00:00:00')
  const b = new Date(fim + 'T00:00:00')
  const novaIni = new Date(a); novaIni.setMonth(a.getMonth() - 1)
  const novaFim = new Date(b); novaFim.setMonth(b.getMonth() - 1)
  return [novaIni.toISOString().slice(0,10), novaFim.toISOString().slice(0,10)]
}

function periodoAnoAnterior(ini, fim) {
  const a = new Date(ini + 'T00:00:00')
  const b = new Date(fim + 'T00:00:00')
  const novaIni = new Date(a); novaIni.setFullYear(a.getFullYear() - 1)
  const novaFim = new Date(b); novaFim.setFullYear(b.getFullYear() - 1)
  return [novaIni.toISOString().slice(0,10), novaFim.toISOString().slice(0,10)]
}

function resolveCompPeriod(mode, ini, fim, iniComp, fimComp) {
  if (mode === 'anterior') return periodoAnterior(ini, fim)
  if (mode === 'mes_ant')  return periodoMesAnterior(ini, fim)
  if (mode === 'ano_ant')  return periodoAnoAnterior(ini, fim)
  return [iniComp, fimComp]
}

function compModeLabel(mode, ini, fim, iniComp, fimComp) {
  const [a, b] = resolveCompPeriod(mode, ini, fim, iniComp, fimComp)
  if (!a || !b) return ''
  const fmt2 = d => new Date(d+'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  return `${fmt2(a)} a ${fmt2(b)}`
}

function getTrimestres(ano) {
  return [
    { label: `Q1 ${ano}`, ini: `${ano}-01-01`, fim: `${ano}-03-31` },
    { label: `Q2 ${ano}`, ini: `${ano}-04-01`, fim: `${ano}-06-30` },
    { label: `Q3 ${ano}`, ini: `${ano}-07-01`, fim: `${ano}-09-30` },
    { label: `Q4 ${ano}`, ini: `${ano}-10-01`, fim: `${ano}-12-31` },
  ]
}

function variacao(atual, anterior) {
  if (!anterior) return null
  return ((atual - anterior) / anterior) * 100
}

// ── mini componentes ──────────────────────────────────────────────────────────
function KPI({ label, value, sub, prev, unit = '' }) {
  const v = variacao(value, prev)
  return (
    <div className="kpi neutral">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 26 }}>{fmt(value)}{unit}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        {v !== null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: v > 0 ? 'var(--ok)' : v < 0 ? 'var(--danger)' : 'var(--gray-400)' }}>
            {v > 0 ? '▲' : v < 0 ? '▼' : '→'} {Math.abs(v).toFixed(1)}%
          </span>
        )}
        <span className="kpi-detail">{sub}</span>
      </div>
    </div>
  )
}

function LineChart({ dados, height = 180 }) {
  if (!dados?.length) return <div className="empty"><div className="empty-sub">Sem dados no período</div></div>
  const max = Math.max(...dados.map(d => d.total), 1)
  const w = Math.max(600, dados.length * 28)
  const h = height - 40
  const pts = dados.map((d, i) => {
    const x = 20 + (i / Math.max(dados.length - 1, 1)) * (w - 40)
    const y = 10 + (1 - d.total / max) * (h - 20)
    return { x, y, ...d }
  })
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={w} height={height} style={{ display: 'block' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = 10 + pct * (h - 20)
          return (
            <g key={pct}>
              <line x1={20} y1={y} x2={w - 20} y2={y} stroke="var(--gray-100)" strokeWidth={1} />
              <text x={14} y={y + 4} fontSize={9} fill="var(--gray-400)" textAnchor="end">
                {Math.round(max * (1 - pct)).toLocaleString('pt-BR')}
              </text>
            </g>
          )
        })}
        {/* Area fill */}
        <polygon
          points={`20,${h - 10} ${polyline} ${w - 20},${h - 10}`}
          fill="rgba(103,63,124,0.08)"
        />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke="var(--purple)" strokeWidth={2} strokeLinejoin="round" />
        {/* Points + labels */}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="var(--purple)" />
            <title>{`${new Date(p.dia+'T12:00:00').toLocaleDateString('pt-BR')}: ${p.total.toLocaleString('pt-BR')} un`}</title>
            {/* Data label a cada 7 pontos ou no primeiro/último */}
            {(i === 0 || i === pts.length - 1 || i % 7 === 0) && (
              <text x={p.x} y={height - 6} fontSize={9} fill="var(--gray-400)" textAnchor="middle"
                transform={pts.length > 20 ? `rotate(-35,${p.x},${height - 6})` : undefined}>
                {new Date(p.dia+'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

function BarChart({ dados, cor = 'var(--purple)', label = 'total', height = 180 }) {
  if (!dados?.length) return <div className="empty"><div className="empty-sub">Sem dados no período</div></div>
  const max = Math.max(...dados.map(d => d[label] || 0), 1)
  const barHeight = height - 44 // reserva 20px topo (label valor) + 24px base (label semana)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, paddingBottom: 24, paddingTop: 20, overflowX: 'auto' }}>
      {dados.map((d, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto', minWidth: 32 }}>
          <span style={{ fontSize: 9, color: 'var(--gray-600)', fontWeight: 700, marginBottom: 2 }}>
            {d[label] > 0 ? fmt(d[label]) : ''}
          </span>
          <div
            title={`${fmtDate(d.semana || d.dia)}: ${fmt(d[label])}`}
            style={{
              width: 22, minHeight: 3, borderRadius: '3px 3px 0 0',
              background: cor, opacity: 0.85,
              height: `${Math.max(3, ((d[label] || 0) / max) * barHeight)}px`,
              transition: 'height .3s',
              cursor: 'default',
            }}
          />
          <span style={{ fontSize: 9, color: 'var(--gray-500)', fontWeight: 600, marginTop: 4 }}>
            {fmtDate(d.semana || d.dia)}
          </span>
        </div>
      ))}
    </div>
  )
}

function BarHorizontal({ dados, cor = 'var(--purple)', valueKey = 'total', labelKey = 'nome' }) {
  if (!dados?.length) return <div className="empty"><div className="empty-sub">Sem dados</div></div>
  const max = Math.max(...dados.map(d => d[valueKey] || 0), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {dados.map((d, i) => {
        const tooltip = d.itens?.length
          ? `${d[labelKey]}: ${fmt(d[valueKey])} un\n\nProdutos:\n${d.itens.map(it => `• ${it.nome}: ${fmt(it.total)} un`).join('\n')}`
          : `${d[labelKey]}: ${fmt(d[valueKey])} un`
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={tooltip}>
            <div style={{ width: 160, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
              {d[labelKey]}
            </div>
            <div style={{ flex: 1, height: 18, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden', cursor: 'help' }}>
              <div style={{ height: '100%', borderRadius: 3, background: cor, width: `${((d[valueKey] || 0) / max) * 100}%`, transition: 'width .4s' }} />
            </div>
            <div style={{ width: 60, textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--gray-800)' }}>
              {fmt(d[valueKey])}
            </div>
            {d.pct !== undefined && (
              <div style={{ width: 36, fontSize: 11, color: 'var(--gray-400)' }}>{d.pct.toFixed(0)}%</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Heatmap({ dados }) {
  // dados: { [dia_semana]: { [hora_categoria]: count } }
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  if (!dados?.length) return <div className="empty"><div className="empty-sub">Sem dados</div></div>
  const max = Math.max(...dados.map(d => d.total || 0), 1)
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {dias.map((dia, i) => {
        const d = dados.find(x => x.dia_semana === i) || { total: 0 }
        const pct = (d.total || 0) / max
        const alpha = Math.max(0.07, pct)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: '100%', height: 48, borderRadius: 6, background: `rgba(103,63,124,${alpha})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: pct > 0.5 ? '#fff' : 'var(--purple)' }}>{fmt(d.total)}</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>{dia}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── componente principal ──────────────────────────────────────────────────────
export default function Analise() {
  const hoje = new Date().toISOString().slice(0,10)
  const trintaDias = new Date(); trintaDias.setDate(trintaDias.getDate() - 29)

  const [ini, setIni] = useState(trintaDias.toISOString().slice(0,10))
  const [fim, setFim] = useState(hoje)
  const [catFiltro, setCatFiltro] = useState('todas')
  const [respFiltro, setRespFiltro] = useState('todos')

  // Período de comparação
  const [compMode, setCompMode] = useState('anterior') // 'anterior' | 'mes_ant' | 'ano_ant' | 'custom'
  const [iniComp, setIniComp] = useState('')
  const [fimComp, setFimComp] = useState('')

  // Análise trimestral
  const [trimestres, setTrimestres] = useState([])

  // Evolução diária (período independente)
  const [evoIni, setEvoIni] = useState(() => { const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().slice(0,10) })
  const [evoFim, setEvoFim] = useState(hoje)
  const [evolucao, setEvolucao] = useState([])
  const [evoLoading, setEvoLoading] = useState(false)

  // Planejado x Realizado
  const [pvr, setPvr] = useState([]) // por produto
  const [pvrCat, setPvrCat] = useState([]) // por categoria
  const [pvrLoading, setPvrLoading] = useState(false)
  const [pvrIni, setPvrIni] = useState(() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10) })
  const [pvrFim, setPvrFim] = useState(hoje)
  const [embs, setEmbs] = useState([])
  const [cats, setCats] = useState([])
  const [resps, setResps] = useState([])

  // dados processados
  const [kpis, setKpis] = useState({ total: 0, dias: 0, mediaDia: 0, totalAnterior: 0 })
  const [porSemana, setPorSemana] = useState([])
  const [ranking, setRanking] = useState([])
  const [porCategoria, setPorCategoria] = useState([])
  const [porResponsavel, setPorResponsavel] = useState([])
  const [porDiaSemana, setPorDiaSemana] = useState([])
  const [tendencia, setTendencia] = useState([]) // por produto: atual vs anterior
  const [desperdicio, setDesperdicio] = useState([])

  // carrega embalagens visíveis na análise (respeita toggle do Admin)
  useEffect(() => {
    supabase.from('embalagens').select('id,codigo,nome,categoria')
      .neq('visivel_analise', false)
      .order('categoria').order('nome')
      .then(({ data }) => {
        setEmbs(data || [])
        const uniqCats = [...new Set((data||[]).map(e => e.categoria).filter(Boolean))]
        setCats(uniqCats)
      })
  }, [])

  // Planejado x Realizado — carrega independente
  useEffect(() => {
    async function loadPvR() {
      setPvrLoading(true)
      try {
        // Busca planejamentos no período
        const { data: plans } = await supabase
          .from('planejamentos')
          .select('id, data_producao')
          .gte('data_producao', pvrIni)
          .lte('data_producao', pvrFim)

        if (!plans?.length) { setPvr([]); setPvrCat([]); setPvrLoading(false); return }

        const planIds = plans.map(p => p.id)

        // Busca itens planejados
        const { data: planItens } = await supabase
          .from('planejamento_itens')
          .select('embalagem_id, quantidade_total, planejamento_id')
          .in('planejamento_id', planIds)

        // Busca produção real no mesmo período
        const { data: prodReal } = await supabase
          .from('producao_diaria')
          .select('embalagem_id, quantidade, data_producao')
          .gte('data_producao', pvrIni)
          .lte('data_producao', pvrFim)

        // Busca embalagens
        const { data: embsData } = await supabase
          .from('embalagens')
          .select('id, nome, codigo, categoria')

        const embMap = {}
        ;(embsData || []).forEach(e => { embMap[e.id] = e })

        // Agrega por embalagem
        const planejadoMap = {}
        for (const i of (planItens || [])) {
          planejadoMap[i.embalagem_id] = (planejadoMap[i.embalagem_id] || 0) + i.quantidade_total
        }
        const realMap = {}
        for (const r of (prodReal || [])) {
          realMap[r.embalagem_id] = (realMap[r.embalagem_id] || 0) + r.quantidade
        }

        // Todos os IDs que aparecem em qualquer um
        const todosIds = [...new Set([...Object.keys(planejadoMap), ...Object.keys(realMap)])]

        const porProduto = todosIds.map(id => {
          const emb = embMap[id] || { nome: '?', codigo: id, categoria: 'Outros' }
          const plan = planejadoMap[id] || 0
          const real = realMap[id] || 0
          const desvio = plan > 0 ? ((real - plan) / plan) * 100 : null
          return { id, nome: emb.nome, categoria: emb.categoria, plan, real, desvio }
        }).sort((a, b) => b.plan - a.plan)

        setPvr(porProduto)

        // Agrega por categoria
        const catMap = {}
        for (const p of porProduto) {
          const cat = p.categoria || 'Outros'
          if (!catMap[cat]) catMap[cat] = { plan: 0, real: 0 }
          catMap[cat].plan += p.plan
          catMap[cat].real += p.real
        }
        setPvrCat(Object.entries(catMap).map(([cat, v]) => ({
          cat,
          plan: v.plan,
          real: v.real,
          desvio: v.plan > 0 ? ((v.real - v.plan) / v.plan) * 100 : null
        })).sort((a, b) => b.plan - a.plan))

      } catch(e) { console.error(e) }
      setPvrLoading(false)
    }
    loadPvR()
  }, [pvrIni, pvrFim])

  // Evolução diária — período independente
  useEffect(() => {
    async function loadEvo() {
      setEvoLoading(true)
      const { data } = await supabase
        .from('producao_diaria')
        .select('data_producao, quantidade')
        .gte('data_producao', evoIni)
        .lte('data_producao', evoFim)
        .order('data_producao')
      // Agrupa por dia
      const map = {}
      for (const r of (data || [])) {
        map[r.data_producao] = (map[r.data_producao] || 0) + r.quantidade
      }
      setEvolucao(Object.entries(map).map(([dia, total]) => ({ dia, total })))
      setEvoLoading(false)
    }
    loadEvo()
  }, [evoIni, evoFim])

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const embIds = catFiltro === 'todas' ? null : embs.filter(e => e.categoria === catFiltro).map(e => e.id)

      let q = supabase.from('producao_diaria')
        .select('embalagem_id, quantidade, data_producao, registrado_por')
        .gte('data_producao', ini).lte('data_producao', fim)

      if (embIds) q = q.in('embalagem_id', embIds)
      if (respFiltro !== 'todos') q = q.eq('registrado_por', respFiltro)

      const { data: rows } = await q

      // responsáveis únicos
      const uniqResps = [...new Set((rows||[]).map(r => r.registrado_por).filter(Boolean))]
      setResps(uniqResps)

      if (!rows?.length) {
        setKpis({ total: 0, dias: 0, mediaDia: 0, totalAnterior: 0 })
        setPorSemana([]); setRanking([]); setPorCategoria([])
        setPorResponsavel([]); setPorDiaSemana([]); setTendencia([]); setDesperdicio([])
        setLoading(false); return
      }

      const total = rows.reduce((s, r) => s + r.quantidade, 0)
      const diasUnicos = new Set(rows.map(r => r.data_producao)).size
      const mediaDia = diasUnicos > 0 ? Math.round(total / diasUnicos) : 0

      // período de comparação
      const [iniAnt, fimAnt] = resolveCompPeriod(compMode, ini, fim, iniComp, fimComp)
      let qAnt = supabase.from('producao_diaria').select('quantidade, embalagem_id')
        .gte('data_producao', iniAnt).lte('data_producao', fimAnt)
      if (embIds) qAnt = qAnt.in('embalagem_id', embIds)
      if (respFiltro !== 'todos') qAnt = qAnt.eq('registrado_por', respFiltro)
      const { data: rowsAnt } = await qAnt
      const totalAnterior = (rowsAnt || []).reduce((s, r) => s + r.quantidade, 0)

      setKpis({ total, dias: diasUnicos, mediaDia, totalAnterior })

      // por semana
      const semMap = {}
      for (const r of rows) {
        const d = new Date(r.data_producao + 'T00:00:00')
        const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day
        const mon = new Date(d); mon.setDate(d.getDate() + diff)
        const key = mon.toISOString().slice(0,10)
        semMap[key] = (semMap[key] || 0) + r.quantidade
      }
      setPorSemana(Object.entries(semMap).sort(([a],[b]) => a.localeCompare(b)).map(([semana, total]) => ({ semana, total })))

      // ranking SKUs
      const skuMap = {}
      for (const r of rows) {
        const emb = embs.find(e => e.id === r.embalagem_id)
        if (!emb) continue
        if (!skuMap[emb.id]) skuMap[emb.id] = { nome: emb.nome, codigo: emb.codigo, total: 0 }
        skuMap[emb.id].total += r.quantidade
      }
      const rank = Object.values(skuMap).sort((a,b) => b.total - a.total)
      const rankTotal = rank.reduce((s,r) => s + r.total, 0)
      setRanking(rank.slice(0,15).map(r => ({ ...r, pct: rankTotal > 0 ? (r.total/rankTotal)*100 : 0 })))

      // por categoria — com detalhamento de produtos para tooltip
      const catMap = {}
      const catItensMap = {} // cat -> { skuNome: total }
      for (const r of rows) {
        const emb = embs.find(e => e.id === r.embalagem_id)
        const cat = emb?.categoria || `Outros (${emb?.codigo || 'sem categoria'})`
        catMap[cat] = (catMap[cat] || 0) + r.quantidade
        if (!catItensMap[cat]) catItensMap[cat] = {}
        const nome = emb?.nome || emb?.codigo || '?'
        catItensMap[cat][nome] = (catItensMap[cat][nome] || 0) + r.quantidade
      }
      const catTotal = Object.values(catMap).reduce((s,v) => s + v, 0)
      setPorCategoria(Object.entries(catMap).sort(([,a],[,b]) => b-a).map(([nome, total]) => ({
        nome, total,
        pct: catTotal > 0 ? (total/catTotal)*100 : 0,
        itens: Object.entries(catItensMap[nome] || {}).sort(([,a],[,b]) => b-a).map(([n, t]) => ({ nome: n, total: t }))
      })))

      // por responsável
      const respMap = {}
      for (const r of rows) {
        const nome = r.registrado_por || 'Desconhecido'
        respMap[nome] = (respMap[nome] || 0) + r.quantidade
      }
      setPorResponsavel(Object.entries(respMap).sort(([,a],[,b]) => b-a).map(([nome, total]) => ({ nome, total })))

      // por dia da semana
      const diaMap = {}
      for (const r of rows) {
        const d = new Date(r.data_producao + 'T00:00:00')
        const dia = d.getDay()
        diaMap[dia] = (diaMap[dia] || 0) + r.quantidade
      }
      setPorDiaSemana(Object.entries(diaMap).map(([dia_semana, total]) => ({ dia_semana: parseInt(dia_semana), total })))

      // tendência: compara atual vs anterior por SKU
      const skuAntMap = {}
      for (const r of (rowsAnt || [])) {
        const emb = embs.find(e => e.id === r.embalagem_id)
        if (!emb) continue
        skuAntMap[emb.id] = (skuAntMap[emb.id] || 0) + r.quantidade
      }
      const tend = Object.values(skuMap).map(s => {
        const emb = Object.values(skuMap).find(x => x.nome === s.nome)
        const embId = Object.keys(skuMap).find(k => skuMap[k].nome === s.nome)
        const ant = skuAntMap[embId] || 0
        const delta = ant > 0 ? ((s.total - ant) / ant) * 100 : null
        return { nome: s.nome, atual: s.total, anterior: ant, delta }
      }).sort((a,b) => (b.delta||0) - (a.delta||0))
      setTendencia(tend)

      // desperdício
      const { data: desp } = await supabase
        .from('producao_interna')
        .select('item, observacao, data_producao, registrado_por')
        .eq('fase', 'desperdicio')
        .gte('data_producao', ini).lte('data_producao', fim)
        .order('data_producao', { ascending: false })
      setDesperdicio(desp || [])

      // trimestres — carrega os 2 anos com dados
      const anoAtual = new Date().getFullYear()
      const anoAnterior = anoAtual - 1
      const todosTrims = [...getTrimestres(anoAnterior), ...getTrimestres(anoAtual)]
      const trimsComDados = await Promise.all(todosTrims.map(async t => {
        const { data: d } = await supabase.from('producao_diaria')
          .select('quantidade')
          .gte('data_producao', t.ini)
          .lte('data_producao', t.fim)
        const total = (d || []).reduce((s, r) => s + r.quantidade, 0)
        return { ...t, total }
      }))
      setTrimestres(trimsComDados)

    } catch(e) { console.error(e) }
    setLoading(false)
  }, [ini, fim, catFiltro, respFiltro, embs, compMode, iniComp, fimComp])

  useEffect(() => { if (embs.length) carregar() }, [carregar])

  function exportarPDF() {
    const doc = new jsPDF()
    const hoje2 = new Date()
    doc.setFillColor(82, 46, 100); doc.rect(0, 0, 210, 36, 'F')
    doc.setTextColor(234, 183, 130); doc.setFontSize(14); doc.setFont(undefined, 'bold')
    doc.text('Laricas Fitness — Relatório de Produção', 14, 16)
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
    doc.text(`Período: ${new Date(ini+'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(fim+'T12:00:00').toLocaleDateString('pt-BR')} | Cat: ${catFiltro} | Resp: ${respFiltro}`, 14, 24)
    doc.text(`Gerado em ${hoje2.toLocaleString('pt-BR')}`, 14, 31)
    doc.setTextColor(30,30,30); doc.setFont(undefined,'bold'); doc.setFontSize(10)
    doc.text(`Total: ${fmt(kpis.total)} un`, 14, 46)
    doc.text(`Dias produtivos: ${kpis.dias}`, 70, 46)
    doc.text(`Média/dia: ${fmt(kpis.mediaDia)} un`, 130, 46)
    if (ranking.length) {
      autoTable(doc, {
        startY: 54,
        head: [['Produto', 'SKU', 'Qtd produzida', '% do total']],
        body: ranking.map(r => [r.nome, r.codigo, fmt(r.total) + ' un', r.pct.toFixed(1) + '%']),
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [103, 63, 124], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 240, 248] },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
    }
    if (tendencia.length) {
      const y = doc.lastAutoTable?.finalY + 10 || 60
      autoTable(doc, {
        startY: y,
        head: [['Produto', 'Período atual', 'Período anterior', 'Variação']],
        body: tendencia.map(t => [t.nome, fmt(t.atual)+' un', fmt(t.anterior)+' un', t.delta !== null ? (t.delta>=0?'+':'')+t.delta.toFixed(1)+'%' : '—']),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [82, 46, 100], textColor: 255 },
      })
    }
    doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(150,150,150)
    doc.text('Laricas Fitness — Sistema de Controle de Produção', 14, 285)
    doc.save(`Producao_${ini}_${fim}.pdf`)
  }

  const ATALHOS = [
    { label: '7 dias', fn: () => { const d = new Date(); d.setDate(d.getDate()-6); setIni(d.toISOString().slice(0,10)); setFim(hoje) } },
    { label: '30 dias', fn: () => { const d = new Date(); d.setDate(d.getDate()-29); setIni(d.toISOString().slice(0,10)); setFim(hoje) } },
    { label: 'Este mês', fn: () => { const d = new Date(); setIni(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`); setFim(hoje) } },
    { label: 'Mês passado', fn: () => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1)
      const ult = new Date(d.getFullYear(), d.getMonth()+1, 0)
      setIni(d.toISOString().slice(0,10)); setFim(ult.toISOString().slice(0,10))
    }},
    { label: '3 meses', fn: () => { const d = new Date(); d.setMonth(d.getMonth()-3); setIni(d.toISOString().slice(0,10)); setFim(hoje) } },
    { label: 'Tudo', fn: () => { setIni('2025-01-01'); setFim(hoje) } },
  ]

  const varTotal = variacao(kpis.total, kpis.totalAnterior)

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e => setIni(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e => setFim(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Categoria</label>
            <select className="form-input" value={catFiltro} onChange={e => setCatFiltro(e.target.value)}>
              <option value="todas">Todas</option>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Responsável</label>
            <select className="form-input" value={respFiltro} onChange={e => setRespFiltro(e.target.value)}>
              <option value="todos">Todos</option>
              {resps.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={carregar} disabled={loading}>
            {loading ? <RefreshCw size={14} className="spin" /> : '↻'} Atualizar
          </button>
          <button className="btn btn-outline btn-sm" onClick={exportarPDF} disabled={!kpis.total}>
            <FileText size={13} /> Exportar PDF
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {ATALHOS.map(a => (
            <button key={a.label} className="btn btn-ghost btn-xs" onClick={a.fn}>{a.label}</button>
          ))}
        </div>

        {/* Período de comparação */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--gray-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)' }}>COMPARAR COM:</span>
            {[
              { id: 'anterior', label: 'Período anterior' },
              { id: 'mes_ant',  label: 'Mesmo período mês anterior' },
              { id: 'ano_ant',  label: 'Mesmo período ano anterior' },
              { id: 'custom',   label: 'Personalizado' },
            ].map(opt => (
              <button key={opt.id}
                className={`btn btn-xs ${compMode === opt.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCompMode(opt.id)}>
                {opt.label}
              </button>
            ))}
            {compMode === 'custom' && (
              <>
                <input type="date" className="form-input" style={{ padding: '5px 8px', fontSize: 12, width: 140 }}
                  value={iniComp} onChange={e => setIniComp(e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>até</span>
                <input type="date" className="form-input" style={{ padding: '5px 8px', fontSize: 12, width: 140 }}
                  value={fimComp} onChange={e => setFimComp(e.target.value)} />
              </>
            )}
            {compMode !== 'custom' && (
              <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                → {compModeLabel(compMode, ini, fim, iniComp, fimComp)}
              </span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><RefreshCw size={16} className="spin" /> Calculando...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="kpi-row">
            <KPI label="📦 Total produzido" value={kpis.total} sub="vs período de comparação" prev={kpis.totalAnterior} unit=" un" />
            <KPI label="📅 Dias com produção" value={kpis.dias} sub="no período selecionado" />
            <KPI label="⚡ Média por dia" value={kpis.mediaDia} sub="unidades/dia produtivo" />
            <div className="kpi neutral">
              <div className="kpi-label">📊 Variação vs comparação</div>
              <div className="kpi-value" style={{ fontSize: 26, color: varTotal === null ? 'var(--gray-400)' : varTotal >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                {varTotal === null ? '—' : `${varTotal >= 0 ? '+' : ''}${varTotal.toFixed(1)}%`}
              </div>
              <div className="kpi-detail">
                {{ anterior: 'período anterior', mes_ant: 'mesmo período mês anterior', ano_ant: 'mesmo período ano anterior', custom: 'período personalizado' }[compMode]}
              </div>
            </div>
          </div>

          {/* Evolução diária — período independente */}
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>📈 Evolução diária de produção</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 }}>Período:</span>
                <input type="date" className="form-input" style={{ padding: '5px 8px', fontSize: 12, width: 140 }}
                  value={evoIni} onChange={e => setEvoIni(e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>até</span>
                <input type="date" className="form-input" style={{ padding: '5px 8px', fontSize: 12, width: 140 }}
                  value={evoFim} onChange={e => setEvoFim(e.target.value)} />
              </div>
            </div>
            {/* Atalhos rápidos */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {[
                { label: '30 dias', fn: () => { const d = new Date(); d.setDate(d.getDate()-29); setEvoIni(d.toISOString().slice(0,10)); setEvoFim(hoje) } },
                { label: '3 meses', fn: () => { const d = new Date(); d.setMonth(d.getMonth()-3); setEvoIni(d.toISOString().slice(0,10)); setEvoFim(hoje) } },
                { label: '6 meses', fn: () => { const d = new Date(); d.setMonth(d.getMonth()-6); setEvoIni(d.toISOString().slice(0,10)); setEvoFim(hoje) } },
                { label: 'Tudo', fn: () => { setEvoIni('2025-01-01'); setEvoFim(hoje) } },
              ].map(a => (
                <button key={a.label} className="btn btn-ghost btn-xs" onClick={a.fn}>{a.label}</button>
              ))}
            </div>
            {evoLoading
              ? <div className="loading"><RefreshCw size={14} className="spin" /> Carregando...</div>
              : <LineChart dados={evolucao} height={200} />
            }
          </div>

          {/* Volume semanal */}
          <div className="card card-pad">
            <div className="card-title">Volume semanal de produção</div>
            <BarChart dados={porSemana} cor="var(--purple)" label="total" height={160} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Ranking */}
            <div className="card card-pad">
              <div className="card-title">🏆 Ranking — produtos mais produzidos</div>
              <BarHorizontal dados={ranking} cor="var(--purple-mid)" valueKey="total" labelKey="nome" />
            </div>

            {/* Por categoria */}
            <div className="card card-pad">
              <div className="card-title">📂 Mix por categoria</div>
              <BarHorizontal dados={porCategoria} cor="var(--gold-dark)" valueKey="total" labelKey="nome" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Por responsável */}
            <div className="card card-pad">
              <div className="card-title">👤 Produção por responsável</div>
              <BarHorizontal dados={porResponsavel} cor="var(--rose)" valueKey="total" labelKey="nome" />
            </div>

            {/* Heatmap dias da semana */}
            <div className="card card-pad">
              <div className="card-title">📅 Produção por dia da semana</div>
              <Heatmap dados={porDiaSemana} />
              <div className="form-hint" style={{ marginTop: 10 }}>Tom mais escuro = mais produção nesse dia</div>
            </div>
          </div>

          {/* Tendência por produto */}
          <div className="card card-pad">
            <div className="card-title">📈 Tendência por produto — período atual vs anterior</div>
            {tendencia.length === 0 ? (
              <div className="empty"><div className="empty-sub">Sem dados suficientes para comparar</div></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Período atual</th>
                      <th>Período anterior</th>
                      <th>Variação</th>
                      <th>Tendência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tendencia.map((t, i) => {
                      const d = t.delta
                      const cor = d === null ? 'var(--gray-400)' : d > 10 ? 'var(--ok)' : d < -10 ? 'var(--danger)' : 'var(--warning)'
                      const Icon = d === null ? Minus : d > 0 ? TrendingUp : TrendingDown
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 600, fontSize: 13 }}>{t.nome}</td>
                          <td>{fmt(t.atual)} un</td>
                          <td style={{ color: 'var(--gray-400)' }}>{fmt(t.anterior)} un</td>
                          <td style={{ fontWeight: 700, color: cor }}>
                            {d === null ? '—' : `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`}
                          </td>
                          <td>
                            <Icon size={16} color={cor} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Análise Trimestral */}
          {trimestres.length > 0 && (
            <div className="card card-pad">
              <div className="card-title">📆 Crescimento trimestral</div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Trimestre</th>
                      <th>Total produzido</th>
                      <th>Vs trimestre anterior</th>
                      <th>Vs mesmo trimestre ano anterior</th>
                      <th>Gráfico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trimestres.map((t, i) => {
                      const anterior = trimestres[i - 1]
                      const mesmoTrimestreAnoAnt = trimestres[i - 4]
                      const vAnt = anterior?.total > 0 ? ((t.total - anterior.total) / anterior.total) * 100 : null
                      const vAno = mesmoTrimestreAnoAnt?.total > 0 ? ((t.total - mesmoTrimestreAnoAnt.total) / mesmoTrimestreAnoAnt.total) * 100 : null
                      const maxTotal = Math.max(...trimestres.map(x => x.total), 1)
                      const corV = v => v === null ? 'var(--gray-400)' : v > 0 ? 'var(--ok)' : 'var(--danger)'
                      const fmtV = v => v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
                      const isCurrent = new Date() >= new Date(t.ini) && new Date() <= new Date(t.fim + 'T23:59:59')
                      return (
                        <tr key={t.label} style={{ background: isCurrent ? 'var(--purple-ghost)' : undefined }}>
                          <td>
                            <span style={{ fontWeight: 800, color: isCurrent ? 'var(--purple)' : 'var(--gray-800)' }}>{t.label}</span>
                            {isCurrent && <span className="pill purple" style={{ marginLeft: 8, fontSize: 10 }}>atual</span>}
                          </td>
                          <td style={{ fontWeight: 700 }}>{t.total > 0 ? fmt(t.total) + ' un' : <span className="text-muted">—</span>}</td>
                          <td style={{ fontWeight: 700, color: corV(vAnt) }}>{fmtV(vAnt)}</td>
                          <td style={{ fontWeight: 700, color: corV(vAno) }}>{fmtV(vAno)}</td>
                          <td style={{ minWidth: 120 }}>
                            <div style={{ height: 12, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, background: isCurrent ? 'var(--purple)' : 'var(--purple-light)', width: `${(t.total / maxTotal) * 100}%`, transition: 'width .4s' }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--gray-400)' }}>
                Q1 = Jan–Mar · Q2 = Abr–Jun · Q3 = Jul–Set · Q4 = Out–Dez
              </div>
            </div>
          )}

          {/* Planejado x Realizado */}
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>🎯 Planejado × Realizado</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 }}>Período:</span>
                <input type="date" className="form-input" style={{ padding: '5px 8px', fontSize: 12, width: 140 }}
                  value={pvrIni} onChange={e => setPvrIni(e.target.value)} />
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>até</span>
                <input type="date" className="form-input" style={{ padding: '5px 8px', fontSize: 12, width: 140 }}
                  value={pvrFim} onChange={e => setPvrFim(e.target.value)} />
              </div>
            </div>

            {pvrLoading ? (
              <div className="loading"><RefreshCw size={14} className="spin" /> Carregando...</div>
            ) : pvr.length === 0 ? (
              <div className="alert-banner info">
                📋 Nenhum planejamento salvo neste período. Os planejamentos são salvos automaticamente ao exportar o PDF de Produção.
              </div>
            ) : (
              <>
                {/* Por categoria */}
                <div style={{ marginBottom: 20 }}>
                  <div className="card-title">Por categoria</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Categoria</th>
                          <th style={{ textAlign: 'center' }}>Planejado</th>
                          <th style={{ textAlign: 'center' }}>Realizado</th>
                          <th style={{ textAlign: 'center' }}>Desvio</th>
                          <th style={{ minWidth: 120 }}>Barra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pvrCat.map(c => {
                          const cor = c.desvio === null ? 'var(--gray-400)'
                            : c.desvio >= -5 ? 'var(--ok)'
                            : c.desvio >= -20 ? 'var(--warning)'
                            : 'var(--danger)'
                          const pctPlan = 100
                          const pctReal = c.plan > 0 ? Math.min(150, (c.real / c.plan) * 100) : 0
                          return (
                            <tr key={c.cat}>
                              <td style={{ fontWeight: 700 }}>{c.cat}</td>
                              <td style={{ textAlign: 'center', color: 'var(--gray-600)' }}>{fmt(c.plan)} un</td>
                              <td style={{ textAlign: 'center', fontWeight: 700 }}>{fmt(c.real)} un</td>
                              <td style={{ textAlign: 'center', fontWeight: 800, color: cor }}>
                                {c.desvio === null ? '—' : `${c.desvio >= 0 ? '+' : ''}${c.desvio.toFixed(1)}%`}
                              </td>
                              <td>
                                <div style={{ position: 'relative', height: 16, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pctPlan}%`, background: 'var(--purple-pale)', borderRadius: 3 }} />
                                  <div style={{ position: 'absolute', left: 0, top: 2, height: 12, width: `${pctReal}%`, background: cor, borderRadius: 3, opacity: .85 }} />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Por produto */}
                <div>
                  <div className="card-title">Por produto</div>
                  <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Categoria</th>
                          <th style={{ textAlign: 'center' }}>Planejado</th>
                          <th style={{ textAlign: 'center' }}>Realizado</th>
                          <th style={{ textAlign: 'center' }}>Desvio</th>
                          <th style={{ textAlign: 'center' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pvr.map(p => {
                          const cor = p.desvio === null ? 'neutral'
                            : p.desvio >= -5 ? 'ok'
                            : p.desvio >= -20 ? 'warning'
                            : 'danger'
                          const label = p.desvio === null ? '—'
                            : p.desvio >= -5 ? '✅ OK'
                            : p.desvio >= -20 ? '⚠️ Abaixo'
                            : '🚨 Crítico'
                          return (
                            <tr key={p.id}>
                              <td style={{ fontWeight: 600, fontSize: 13 }}>{p.nome}</td>
                              <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{p.categoria}</td>
                              <td style={{ textAlign: 'center', color: 'var(--gray-600)' }}>{fmt(p.plan)}</td>
                              <td style={{ textAlign: 'center', fontWeight: 700 }}>{fmt(p.real)}</td>
                              <td style={{ textAlign: 'center', fontWeight: 800, color: `var(--${cor === 'ok' ? 'ok' : cor === 'warning' ? 'warning' : cor === 'danger' ? 'danger' : 'gray-400'})` }}>
                                {p.desvio === null ? '—' : `${p.desvio >= 0 ? '+' : ''}${p.desvio.toFixed(1)}%`}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`pill ${cor}`}>{label}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gray-400)' }}>
                    ✅ OK = desvio dentro de 5% · ⚠️ Abaixo = até -20% · 🚨 Crítico = mais de -20% abaixo do planejado
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Desperdício */}
          <div className="card card-pad">
            <div className="card-title">⚠️ Desperdícios registrados no período</div>
            {desperdicio.length === 0 ? (
              <div className="alert-banner ok">✅ Nenhum desperdício registrado neste período.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Responsável</th>
                      <th>O que foi desperdiçado</th>
                      <th>O que aconteceu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {desperdicio.map((d, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.data_producao)}</td>
                        <td>{d.registrado_por}</td>
                        <td style={{ fontWeight: 600 }}>{d.item}</td>
                        <td style={{ color: 'var(--gray-600)' }}>{d.observacao || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
