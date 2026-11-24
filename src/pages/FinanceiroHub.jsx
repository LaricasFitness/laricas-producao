import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Upload, Save, ChevronDown, ChevronRight, X, Lock, Camera, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  LINHAS, lerContasCompetencia, lerBalancete, lerExtratoCaixa, linhasBling,
  PLATAFORMAS, siglaUnidade, rotuloCanal, custoCanal, marketingCanal, liquidoCanal, linhaReceitaCanal,
} from '../lib/dre'
import { arquivoParaEnvio } from '../lib/arquivoEnvio'
import { lerPlanilha99 } from '../lib/planilha99'
import { lerPlanilhaKeeta } from '../lib/planilhaKeeta'
import { lerRelatorioMercadoPago } from '../lib/relatorioMercadoPago'
import FinanceiroDRE from './FinanceiroDRE'
import { margemPorCanal, POOLS_ENVIO } from '../lib/margemCanal'

// Financeiro: DRE (FinanceiroDRE.jsx, regras em src/lib/dreLaricas.js), margem por canal e importação do Bling
// e das plataformas (leitura dos arquivos em src/lib/dre.js).

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtPct = n => `${fmt(n * 100, 1)}%`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = m => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`
const AVISO_SQL = 'As tabelas da DRE ainda não existem no banco: aplique o arquivo financeiro_dre.sql no Supabase.'
const semTabela = e => /does not exist|relation .* not exist|42P01|schema cache/i.test(e?.message || '') || e?.code === '42P01'

function usuarioNome() {
  try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || null } catch { return null }
}

// Supabase devolve no máximo 1000 linhas por consulta
async function buscarTudo(montar) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

export default function FinanceiroHub({ sub: subMenu, onSub }) {
  const [subLocal, setSubLocal] = useState('dre')
  const sub = subMenu ?? subLocal
  const setSub = onSub ?? setSubLocal
  return (
    <>
      <div className="tabs hub-tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'dre' ? ' active' : ''}`} onClick={() => setSub('dre')}>📋 DRE</button>
        <button className={`tab${sub === 'margem' ? ' active' : ''}`} onClick={() => setSub('margem')}>📊 Margem por canal</button>
        <button className={`tab${sub === 'importar' ? ' active' : ''}`} onClick={() => setSub('importar')}>⬆️ Importar e classificar</button>
      </div>
      {sub === 'dre' && <FinanceiroDRE />}
      {sub === 'margem' && <TelaMargem />}
      {sub === 'importar' && <TelaImportar />}
    </>
  )
}

// ── Dados ─────────────────────────────────────────────────────────────────────
async function carregarAno(ano) {
  const ini = `${ano}-01-01`, fim = `${ano}-12-31`
  const [contas, caixa, receitas, mapaDB, cmvRows] = await Promise.all([
    buscarTudo(() => supabase.from('dre_contas_competencia').select('*')
      .gte('competencia', `${ano - 1}-12-01`).lte('competencia', fim).order('competencia')),
    buscarTudo(() => supabase.from('dre_caixa').select('mes, tipo, categoria, valor').like('mes', `${ano}-%`)),
    buscarTudo(() => supabase.from('dre_receita_competencia').select('mes, linha, valor').like('mes', `${ano}-%`)),
    buscarTudo(() => supabase.from('dre_mapa').select('origem, categoria, nome, linha')),
    buscarTudo(() => supabase.from('fechamento_cmv').select('mes, cmv_valor').like('mes', `${ano}-%`)),
  ])
  const cmvSistema = {}
  for (const r of cmvRows) cmvSistema[r.mes] = (cmvSistema[r.mes] || 0) + (Number(r.cmv_valor) || 0)
  // dre_mes (conferência e cadeado) existe a partir do financeiro_dre_2.sql
  let mesInfo = [], semTabelaMes = false
  try { mesInfo = await buscarTudo(() => supabase.from('dre_mes').select('*').like('mes', `${ano}-%`)) }
  catch (e) { if (semTabela(e)) semTabelaMes = true; else throw e }
  // dre_canal_competencia (faturamento das plataformas) existe a partir do financeiro_dre_3.sql
  let canais = []
  try { canais = await buscarTudo(() => supabase.from('dre_canal_competencia').select('*').gte('mes', `${ano - 1}-12`).lte('mes', `${ano}-12`)) }
  catch (e) { if (!semTabela(e)) throw e }
  // dre_caixa_lancamentos (extrato de Caixas e Bancos) existe a partir do financeiro_dre_4.sql
  let caixaLanc = []
  try { caixaLanc = await buscarTudo(() => supabase.from('dre_caixa_lancamentos').select('mes, data, tipo, categoria, nome, historico, valor, banco').like('mes', `${ano}-%`).order('data')) }
  catch (e) { if (!semTabela(e)) throw e }
  // dre_receber_competencia (contas a receber por competência do Bling) existe a partir do financeiro_dre_5.sql
  let receber = []
  try { receber = await buscarTudo(() => supabase.from('dre_receber_competencia').select('mes, competencia, categoria, nome, historico, valor, situacao').like('mes', `${ano}-%`)) }
  catch (e) { if (!semTabela(e)) throw e }
  return { contas, caixa, caixaLanc, receitas, receber, canais, mapaDB, cmvSistema, mesInfo, semTabelaMes, ini }
}

// ── Margem por canal (competência das receitas + CMV teórico) ────────────────
const AVISO_SQL_6 = 'Aplique o arquivo financeiro_dre_6.sql no Supabase para guardar o % de custo de cada canal.'
function TelaMargem() {
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [dados, setDados] = useState(null)
  const [pctCanal, setPctCanal] = useState({})
  const [editando, setEditando] = useState({})
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [msg, setMsg] = useState(null)
  const [semTab, setSemTab] = useState(false)

  useEffect(() => {
    setDados(null)
    carregarAno(ano).then(setDados).catch(e => setMsg({ tipo: 'danger', txt: semTabela(e) ? AVISO_SQL : e.message || String(e) }))
    supabase.from('dre_cmv_canal').select('canal, pct').then(({ data, error }) => {
      if (error) { setSemTab(semTabela(error)); return }
      setPctCanal(Object.fromEntries((data || []).map(r => [r.canal, Number(r.pct)])))
    })
  }, [ano])

  // meses com receita de plataformas ou do Bling; padrão: do primeiro ao último
  const mesesComDado = useMemo(() => !dados ? [] : [...new Set([...dados.canais.map(r => r.mes), ...(dados.receber || []).map(r => r.mes)])]
    .filter(m => m.startsWith(String(ano))).sort(), [dados, ano])
  useEffect(() => { if (mesesComDado.length) { setDe(mesesComDado[0]); setAte(mesesComDado[mesesComDado.length - 1]) } }, [mesesComDado])
  const meses = mesesComDado.filter(m => (!de || m >= de) && (!ate || m <= ate))
  const res = useMemo(() => dados && meses.length ? margemPorCanal({ meses, ...dados, pctCanal }) : null, [dados, de, ate, pctCanal])

  async function salvarPct(canal) {
    const v = parseFloat(String(editando[canal]).replace(',', '.'))
    if (!Number.isFinite(v) || v < 0 || v > 100) { setMsg({ tipo: 'danger', txt: 'Use um % entre 0 e 100.' }); return }
    const { error } = await supabase.from('dre_cmv_canal').upsert({ canal, pct: v, atualizado_em: new Date().toISOString() }, { onConflict: 'canal' })
    if (error) { setMsg({ tipo: 'danger', txt: semTabela(error) ? AVISO_SQL_6 : error.message }); return }
    setPctCanal(p => ({ ...p, [canal]: v })); setEditando(e => { const n = { ...e }; delete n[canal]; return n })
    setMsg({ tipo: 'ok', txt: `% de custo de ${canal} salvo: ${fmt(v, 1)}%.` })
  }

  const th = { padding: '8px 10px', textAlign: 'right', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }
  const pctDe = (v, base) => base ? fmtPct(v / base) : '—'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Margem por canal</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5 }}>
              Receita por competência (plataformas, Shopify, Mercado Pago e Bling) menos descontos, comissões e taxas,
              menos o CMV (% de custo de cada canal pela DRE-3.0 da planilha, com embalagens, sacolas e caixas) e o frete do e-commerce.
            </div>
          </div>
          <select className="form-input" value={ano} onChange={e => setAno(+e.target.value)} style={{ width: 100 }}>
            {[anoAtual, anoAtual - 1].map(a => <option key={a}>{a}</option>)}
          </select>
          <select className="form-input" value={de} onChange={e => setDe(e.target.value)} style={{ width: 110 }}>
            {mesesComDado.map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>a</span>
          <select className="form-input" value={ate} onChange={e => setAte(e.target.value)} style={{ width: 110 }}>
            {mesesComDado.map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
          </select>
        </div>
        {semTab && <div className="alert-banner info" style={{ marginTop: 10 }}>{AVISO_SQL_6} Até lá a tela usa os % da DRE-3.0 da planilha (jul a set/26).</div>}
        {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
      </div>

      {!dados ? <div className="card card-pad" style={{ color: 'var(--gray-500)' }}><RefreshCw size={14} className="spin" /> Carregando…</div> : !res ? (
        <div className="card card-pad" style={{ color: 'var(--gray-500)' }}>Sem receita lançada no período.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1000 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--gray-200)' }}>
                <th style={{ ...th, textAlign: 'left' }}>Canal</th>
                <th style={th}>Receita bruta</th><th style={th}>Descontos</th><th style={th}>Comissões e taxas</th>
                <th style={th}>Receita líquida</th><th style={th} title="% de custo sobre a receita bruta do canal (DRE-3.0 da planilha, jul a set/26), com embalagens, sacolas e caixas">% custo</th>
                <th style={th}>CMV</th><th style={th} title="Frete pago no caixa, rateado pela receita entre Site e Clube">Frete</th><th style={th}>Margem</th><th style={th}>Margem %</th><th style={th}>Peso na margem</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map(x => (
                <tr key={x.canal} style={{ borderTop: '1px solid var(--gray-100)' }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{x.canal}</td>
                  <td style={td}>{fmt(x.bruta, 0)}</td>
                  <td style={td}>{fmt(x.descontos, 0)} <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{pctDe(x.descontos, x.bruta)}</span></td>
                  <td style={td}>{fmt(x.taxas, 0)} <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{pctDe(x.taxas, x.bruta)}</span></td>
                  <td style={td}>{fmt(x.liquida, 0)} <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{pctDe(x.liquida, x.bruta)}</span></td>
                  <td style={td}>
                    {editando[x.canal] != null ? (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <input className="form-input" value={editando[x.canal]} onChange={e => setEditando(s => ({ ...s, [x.canal]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && salvarPct(x.canal)} style={{ width: 60, padding: '2px 6px', textAlign: 'right' }} autoFocus />
                        <button className="btn btn-primary btn-sm" onClick={() => salvarPct(x.canal)}><Save size={12} /></button>
                      </span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditando(s => ({ ...s, [x.canal]: String(x.pct).replace('.', ',') }))} title="Alterar o % de custo deste canal">
                        {fmt(x.pct, 1)}% <Pencil size={11} />
                      </button>
                    )}
                  </td>
                  <td style={td}>{fmt(x.cmv, 0)}</td>
                  <td style={td} title={Object.entries(x.envioPor || {}).filter(([, v]) => v).map(([k, v]) => `${POOLS_ENVIO[k].nome}: R$ ${fmt(v, 0)}`).join('\n')}>
                    {x.envio ? <>{fmt(x.envio, 0)} <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{pctDe(x.envio, x.bruta)}</span></> : '—'}
                  </td>
                  <td style={{ ...td, fontWeight: 800, color: x.margem < 0 ? 'var(--danger)' : undefined }}>{fmt(x.margem, 0)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{pctDe(x.margem, x.bruta)}</td>
                  <td style={td}>{pctDe(x.margem, res.total.margem)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--gray-300)', fontWeight: 800 }}>
                <td style={{ ...td, textAlign: 'left' }}>Total</td>
                <td style={td}>{fmt(res.total.bruta, 0)}</td><td style={td}>{fmt(res.total.descontos, 0)}</td><td style={td}>{fmt(res.total.taxas, 0)}</td>
                <td style={td}>{fmt(res.total.liquida, 0)}</td><td style={td}>{pctDe(res.total.cmv, res.total.bruta)}</td>
                <td style={td}>{fmt(res.total.cmv, 0)}</td><td style={td}>{fmt(res.total.envio, 0)}</td><td style={td}>{fmt(res.total.margem, 0)}</td><td style={td}>{pctDe(res.total.margem, res.total.bruta)}</td><td style={td} />
              </tr>
            </tbody>
          </table>
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--gray-600)', lineHeight: 1.6, borderTop: '1px solid var(--gray-100)' }}>
            <b>CMV × compras no caixa</b> ({rotuloMes(meses[0])} a {rotuloMes(meses[meses.length - 1])}): teórico R$ {fmt(res.total.cmv, 0)} ·
            compras de matéria-prima e embalagens R$ {fmt(res.compras, 0)}
            {res.compras > 0 && <> · diferença <b>R$ {fmt(res.compras - res.total.cmv, 0)}</b> ({pctDe(res.compras - res.total.cmv, res.total.bruta)} da receita bruta):
              perdas, brindes, vouchers, testes e estoque que sobrou ou faltou no período.</>}
            {' '}O % de custo de cada canal pode ser ajustado na coluna "% custo".
            <br /><b>Frete</b> pago no caixa no período: R$ {fmt(res.pools.frete, 0)}, rateado pela receita entre {POOLS_ENVIO.frete.canais.join(' e ')}.
            {' '}Embalagens, sacolas e caixas já estão no % de custo.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Importar e classificar ───────────────────────────────────────────────────
function TelaImportar() {
  const atualizado = () => {} // DRE e lançamentos recarregam ao abrir Financeiro › DRE
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AtualizarBling onImportou={atualizado} />
      <details>
        <summary style={{ fontSize: 12, color: 'var(--gray-500)', cursor: 'pointer' }}>Importar por arquivo exportado do Bling (reserva)</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
          <ImportarCompetencia onImportou={atualizado} />
          <ImportarExtratoCaixa onImportou={atualizado} />
        </div>
      </details>
      <details>
        <summary style={{ fontSize: 12, color: 'var(--gray-500)', cursor: 'pointer' }}>Caixa pelo Balancete (antigo, só totais por categoria)</summary>
        <div style={{ marginTop: 8 }}><ImportarBalancete onImportou={atualizado} /></div>
      </details>
      <FaturamentoPlataformas onMudou={atualizado} />
    </div>
  )
}

// ── Atualizar do Bling (API, só leitura no Bling) ────────────────────────────
// Busca pela função /api/financeiro o caixa, as contas a pagar e as a receber do mês atual e dos 2 anteriores,
// mostra a comparação com o que está no sistema e só grava depois do clique. Gravar segue as regras da
// importação por arquivo: substitui cada mês do período, menos os fechados no cadeado.
const FONTES_BLING = [
  { id: 'caixa', nome: 'Caixa (Caixas e Bancos)', visao: 'caixa' },
  { id: 'pagar', nome: 'Contas a pagar (competência)', visao: 'competencia' },
  { id: 'receber', nome: 'Contas a receber (competência)', visao: 'competencia' },
]
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const somaMes = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const fimMes = ym => `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0')}`

async function chamarFinanceiro(corpo) {
  const r = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(j.erro || (r.status === 404 ? 'Função do financeiro não encontrada (só funciona no site publicado).' : `Erro ${r.status}`))
    e.reconectar = !!j.reconectar
    throw e
  }
  return j
}

// Resumo por mês: { 'AAAA-MM': { n, entradas, saidas } } (contas: tudo em "saidas" ou "entradas")
function resumoMeses(fonte, linhas) {
  const out = {}
  for (const l of linhas) {
    const m = fonte === 'caixa' ? l.mes : fonte === 'pagar' ? l.competencia.slice(0, 7) : l.mes
    const r = out[m] || (out[m] = { n: 0, entradas: 0, saidas: 0 })
    r.n++
    const v = Number(l.valor) || 0
    if (fonte === 'caixa') { if (l.tipo === 'receita') r.entradas += v; else if (l.tipo === 'despesa') r.saidas += v }
    else if (fonte === 'pagar') r.saidas += v
    else r.entradas += v
  }
  return out
}

function AtualizarBling({ onImportou }) {
  const [res, setRes] = useState(null)       // { periodo, fontes: { caixa: { linhas, novo, atual } ... }, fechados }
  const [prog, setProg] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [completo, setCompleto] = useState(false)
  const [msg, setMsg] = useState(null)

  const hoje = hojeSP(), mesAtual = hoje.slice(0, 7)
  const meses = [somaMes(mesAtual, -2), somaMes(mesAtual, -1), mesAtual]
  const de = `${meses[0]}-01`
  // caixa até hoje; contas até o fim do mês (competência futura do mês atual)
  const ateDe = fonte => fonte === 'caixa' ? hoje : fimMes(mesAtual)

  async function atuais(fonte) {
    const ate = ateDe(fonte)
    if (fonte === 'caixa') return buscarTudo(() => supabase.from('dre_caixa_lancamentos').select('mes, tipo, valor').gte('data', de).lte('data', ate))
    if (fonte === 'pagar') return buscarTudo(() => supabase.from('dre_contas_competencia').select('competencia, valor').gte('competencia', de).lte('competencia', ate))
    return buscarTudo(() => supabase.from('dre_receber_competencia').select('mes, valor').gte('competencia', de).lte('competencia', ate))
  }

  async function buscar() {
    setOcupado(true); setMsg(null); setRes(null)
    try {
      const fontes = {}
      for (const f of FONTES_BLING) {
        let cursor = null, itens = null
        setProg(`${f.nome}: começando…`)
        while (!itens) {
          const j = await chamarFinanceiro({ acao: 'bling', fonte: f.id, de, ate: ateDe(f.id), cursor, completo })
          if (j.pronto) itens = j.itens
          else {
            cursor = j.cursor; setProg(`${f.nome}: ${j.progresso?.texto || '…'}`)
            if (j.pausa) await new Promise(ok => setTimeout(ok, 4000))
          }
        }
        const linhas = linhasBling(f.id, itens, hoje)
        fontes[f.id] = { linhas, novo: resumoMeses(f.id, linhas), atual: resumoMeses(f.id, await atuais(f.id)) }
      }
      const { data: fech } = await supabase.from('dre_mes').select('mes, visao').not('fechado_em', 'is', null).in('mes', meses)
      setRes({ fontes, fechados: new Set((fech || []).map(r => `${r.mes}|${r.visao}`)) })
    } catch (e) {
      setMsg({ tipo: 'danger', txt: e.reconectar ? `${e.message} Reconecte em Expedição › Conectar o Bling.` : 'Erro ao buscar no Bling: ' + e.message })
    }
    setProg(''); setOcupado(false)
  }

  async function gravar() {
    setOcupado(true); setMsg(null)
    try {
      const pulados = []
      let n = 0
      for (const f of FONTES_BLING) {
        const { linhas } = res.fontes[f.id]
        const ate = ateDe(f.id)
        const abertos = meses.filter(m => { const fechado = res.fechados.has(`${m}|${f.visao}`); if (fechado) pulados.push(`${f.nome} ${rotuloMes(m)}`); return !fechado })
        const mesDe = l => f.id === 'pagar' ? l.competencia.slice(0, 7) : l.mes
        const novas = linhas.filter(l => abertos.includes(mesDe(l)))
        const tabela = f.id === 'caixa' ? 'dre_caixa_lancamentos' : f.id === 'pagar' ? 'dre_contas_competencia' : 'dre_receber_competencia'
        const campo = f.id === 'caixa' ? 'data' : 'competencia'
        for (const m of abertos) {
          const fim = fimMes(m) < ate ? fimMes(m) : ate
          const { error } = await supabase.from(tabela).delete().gte(campo, `${m}-01`).lte(campo, fim)
          if (error) throw error
        }
        for (let i = 0; i < novas.length; i += 500) {
          const lote = novas.slice(i, i + 500)
          let { error } = f.id === 'pagar'
            ? await supabase.from(tabela).insert(lote)
            : await supabase.from(tabela).upsert(lote, { onConflict: 'id_bling' })
          // antes do dre_laricas.sql as contas a pagar não têm id_bling
          if (error && f.id === 'pagar' && /id_bling/.test(error.message)) ({ error } = await supabase.from(tabela).insert(lote.map(({ id_bling, ...r }) => r)))
          if (error) throw error
        }
        n += novas.length
      }
      setMsg({ tipo: 'ok', txt: `${n} lançamentos gravados (${rotuloMes(meses[0])} a ${rotuloMes(meses[2])}).`
        + (pulados.length ? ` Meses fechados não foram alterados: ${pulados.join(', ')}.` : '') })
      setRes(null); onImportou()
    } catch (e) { setMsg({ tipo: 'danger', txt: 'Erro ao gravar: ' + (e.message || e) + ' Os meses podem ter ficado incompletos: atualize de novo.' }) }
    setOcupado(false)
  }

  const td = { padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }
  const dif = (a, b) => Math.abs((a || 0) - (b || 0)) >= 0.01
  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 800, fontSize: 14 }}>Atualizar do Bling</div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Lê no Bling o caixa (Caixas e Bancos), as contas a pagar e as a receber de <b>{rotuloMes(meses[0])} a {rotuloMes(meses[2])}</b>.
        Nada é alterado no Bling. Antes de gravar, mostra a comparação com o que já está no sistema; gravar substitui esses meses
        (menos os fechados no cadeado).
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={buscar} disabled={ocupado}>
          {ocupado && !res ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />} Buscar no Bling
        </button>
        <label style={{ fontSize: 12, color: 'var(--gray-600)', display: 'flex', gap: 6, alignItems: 'center' }}
          title="Lê de novo o detalhe de todas as contas. Use quando mudou a categoria ou a competência de contas já lidas. Demora mais.">
          <input type="checkbox" checked={completo} onChange={e => setCompleto(e.target.checked)} disabled={ocupado} />
          Ler de novo o detalhe de todas as contas
        </label>
        {prog && <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{prog}</span>}
      </div>
      {res && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', color: 'var(--gray-500)' }}>
                <th style={{ ...td, textAlign: 'left' }}>Fonte</th><th style={{ ...td, textAlign: 'left' }}>Mês</th>
                <th style={td}>No sistema</th><th style={td}>No Bling</th><th style={td}>Total no sistema</th><th style={td}>Total no Bling</th><th style={td} />
              </tr>
            </thead>
            <tbody>
              {FONTES_BLING.flatMap(f => meses.map(m => {
                const a = res.fontes[f.id].atual[m] || {}, b = res.fontes[f.id].novo[m] || {}
                const tot = r => f.id === 'caixa' ? `+${fmt(r.entradas)} / −${fmt(r.saidas)}` : fmt(f.id === 'pagar' ? r.saidas : r.entradas)
                const mudou = (a.n || 0) !== (b.n || 0) || dif(a.entradas, b.entradas) || dif(a.saidas, b.saidas)
                const fechado = res.fechados.has(`${m}|${f.visao}`)
                return (
                  <tr key={f.id + m} style={{ borderTop: '1px solid var(--gray-100)' }}>
                    <td style={{ ...td, textAlign: 'left' }}>{f.nome}</td><td style={{ ...td, textAlign: 'left' }}>{rotuloMes(m)}</td>
                    <td style={td}>{a.n || 0}</td><td style={td}>{b.n || 0}</td>
                    <td style={td}>{tot(a)}</td><td style={{ ...td, fontWeight: mudou ? 800 : 400 }}>{tot(b)}</td>
                    <td style={{ ...td, textAlign: 'left', color: fechado ? 'var(--gray-400)' : mudou ? 'var(--warning)' : 'var(--ok)' }}>
                      {fechado ? '🔒 fechado, não muda' : mudou ? 'muda' : 'igual'}
                    </td>
                  </tr>
                )
              }))}
            </tbody>
          </table>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={gravar} disabled={ocupado}>
            {ocupado ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Gravar no sistema
          </button>
          <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 10 }}>Transferências entre contas entram no caixa, mas ficam fora da DRE (como no arquivo).</span>
        </div>
      )}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
    </div>
  )
}

function CampoArquivo({ onTexto, rotulo }) {
  const ref = useRef()
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => ref.current?.click()}><Upload size={13} /> {rotulo}</button>
      <input ref={ref} type="file" accept=".csv,.txt" style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          const r = new FileReader()
          r.onload = () => onTexto(String(r.result), f.name)
          r.readAsText(f, 'utf-8')
        }} />
    </>
  )
}

function ImportarCompetencia({ onImportou }) {
  const [prev, setPrev] = useState(null)
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)

  function ler(texto, nome) {
    setMsg(null)
    try {
      const contas = lerContasCompetencia(texto)
      const meses = [...new Set(contas.map(c => c.competencia.slice(0, 7)))].sort()
      setPrev({ contas, meses, nome, total: contas.reduce((s, c) => s + c.valor, 0) })
    } catch (e) { setPrev(null); setMsg({ tipo: 'danger', txt: e.message }) }
  }

  async function importar() {
    setSalvando(true); setMsg(null)
    try {
      // Mês fechado (cadeado) não é substituído
      const { data: fech, error: eF } = await supabase.from('dre_mes').select('mes').eq('visao', 'competencia').not('fechado_em', 'is', null)
      const fechados = new Set(eF ? [] : (fech || []).map(r => r.mes))
      const meses = prev.meses.filter(m => !fechados.has(m))
      let contas = prev.contas.filter(c => !fechados.has(c.competencia.slice(0, 7)))
      // Antes do financeiro_dre_2.sql as colunas de data não existem
      const { error: eCol } = await supabase.from('dre_contas_competencia').select('data_baixa').limit(1)
      if (eCol) contas = contas.map(({ vencimento, data_baixa, ...c }) => c)
      for (const m of meses) {
        const fim = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()
        const { error } = await supabase.from('dre_contas_competencia').delete()
          .gte('competencia', `${m}-01`).lte('competencia', `${m}-${fim}`)
        if (error) throw error
      }
      for (let i = 0; i < contas.length; i += 500) {
        const { error } = await supabase.from('dre_contas_competencia').insert(contas.slice(i, i + 500))
        if (error) throw error
      }
      const pulados = prev.meses.filter(m => fechados.has(m))
      const semBaixa = !prev.contas.some(c => c.data_baixa)
      setMsg({ tipo: 'ok', txt: `${contas.length} contas importadas (${meses.length} meses substituídos).`
        + (pulados.length ? ` Meses fechados não foram alterados: ${pulados.map(rotuloMes).join(', ')}.` : '')
        + (semBaixa ? ' O arquivo não tem a coluna de data de pagamento: a data de baixa fica em branco.' : '') })
      setPrev(null); onImportou()
    } catch (e) { setMsg({ tipo: 'danger', txt: semTabela(e) ? AVISO_SQL : 'Erro ao importar: ' + (e.message || e) }) }
    setSalvando(false)
  }

  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 800, fontSize: 14 }}>Despesas por competência</div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Bling › Financeiro › Relatórios › <b>Contas a pagar por competência</b> › Visualizar › Exportar (CSV).
        Pode exportar tudo: cada mês do arquivo substitui o que já estava no sistema (menos os meses fechados).
        Para ter a data de baixa de cada conta, inclua no relatório do Bling (Configurar › +) a coluna de data de pagamento.
      </div>
      <CampoArquivo rotulo="Escolher arquivo" onTexto={ler} />
      {prev && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div><b>{prev.contas.length}</b> contas · {rotuloMes(prev.meses[0])} a {rotuloMes(prev.meses[prev.meses.length - 1])} · R$ {fmt(prev.total)}</div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={importar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Importar
          </button>
        </div>
      )}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
    </div>
  )
}

// Caixa lançamento a lançamento: extrato de Caixas e Bancos do Bling (todas as contas, qualquer período).
// O período do arquivo substitui o que já estava no sistema nesse intervalo (menos meses fechados).
const AVISO_SQL_4 = 'Aplique o arquivo financeiro_dre_4.sql no Supabase para importar o extrato do caixa.'
function ImportarExtratoCaixa({ onImportou }) {
  const [prev, setPrev] = useState(null)
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)

  function ler(texto, nome) {
    setMsg(null)
    try {
      const e = lerExtratoCaixa(texto)
      if (!e.lancamentos.length) throw new Error('Nenhum lançamento no arquivo.')
      const meses = [...new Set(e.lancamentos.map(l => l.mes))].sort()
      const soma = t => e.lancamentos.filter(l => l.tipo === t).reduce((s, l) => s + l.valor, 0)
      setPrev({ ...e, meses, nome, entradas: soma('receita'), saidas: soma('despesa'), transf: e.lancamentos.filter(l => l.tipo === 'transferencia').length })
    } catch (err) { setPrev(null); setMsg({ tipo: 'danger', txt: err.message }) }
  }

  async function importar() {
    setSalvando(true); setMsg(null)
    try {
      const { data: fech, error: eF } = await supabase.from('dre_mes').select('mes').eq('visao', 'caixa').not('fechado_em', 'is', null)
      const fechados = new Set(eF ? [] : (fech || []).map(r => r.mes))
      const { ini, fim } = prev.periodo
      // apaga o período do arquivo, mês a mês (o cadeado protege os meses fechados)
      for (const m of prev.meses.filter(m => !fechados.has(m))) {
        const de = ini > `${m}-01` ? ini : `${m}-01`
        const ultimo = `${m}-${String(new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()).padStart(2, '0')}`
        const ate = fim < ultimo ? fim : ultimo
        const { error } = await supabase.from('dre_caixa_lancamentos').delete().gte('data', de).lte('data', ate)
        if (error) throw error
      }
      const linhas = prev.lancamentos.filter(l => !fechados.has(l.mes))
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from('dre_caixa_lancamentos').upsert(linhas.slice(i, i + 500), { onConflict: 'id_bling' })
        if (error) throw error
      }
      const pulados = prev.meses.filter(m => fechados.has(m))
      setMsg({ tipo: 'ok', txt: `${linhas.length} lançamento(s) importado(s) de ${prev.bancos.length} conta(s).`
        + (pulados.length ? ` Meses fechados não foram alterados: ${pulados.map(rotuloMes).join(', ')}.` : '') })
      setPrev(null); onImportou()
    } catch (e) { setMsg({ tipo: 'danger', txt: semTabela(e) ? AVISO_SQL_4 : 'Erro ao importar: ' + (e.message || e) }) }
    setSalvando(false)
  }

  const dataBR = d => d ? d.split('-').reverse().join('/') : ''
  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 800, fontSize: 14 }}>Caixa (extrato do Bling)</div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Bling › Financeiro › <b>Caixas e Bancos</b> › conta <b>Todas contas</b> › período › <b>Exportar extrato</b> (CSV).
        Pode ser de vários meses: o período do arquivo substitui o que estava no sistema (menos os meses fechados).
      </div>
      <CampoArquivo rotulo="Escolher arquivo" onTexto={ler} />
      {prev && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
          <div><b>{prev.lancamentos.length}</b> lançamentos · {dataBR(prev.periodo.ini)} a {dataBR(prev.periodo.fim)}</div>
          <div>Entradas R$ {fmt(prev.entradas)} · saídas R$ {fmt(prev.saidas)} · {prev.transf} transferência(s) entre contas (fora da DRE)</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Contas: {prev.bancos.join(', ')}</div>
          {prev.bancos.length < 2 && (
            <div className="alert-banner warning" style={{ marginTop: 6 }}>O arquivo tem só uma conta. Exporte com "Todas contas" para o caixa completo.</div>
          )}
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={importar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Importar
          </button>
        </div>
      )}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
    </div>
  )
}

function ImportarBalancete({ onImportou }) {
  const [prev, setPrev] = useState(null)
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)

  function ler(texto) {
    setMsg(null)
    try {
      const b = lerBalancete(texto)
      const soma = t => b.linhas.filter(l => l.tipo === t).reduce((s, l) => s + l.valor, 0)
      setPrev({ ...b, receitas: soma('receita'), despesas: soma('despesa') })
    } catch (e) { setPrev(null); setMsg({ tipo: 'danger', txt: e.message }) }
  }

  async function importar() {
    setSalvando(true); setMsg(null)
    try {
      const { data: fech } = await supabase.from('dre_mes').select('fechado_em').eq('mes', prev.mes).eq('visao', 'caixa').maybeSingle()
      if (fech?.fechado_em) throw new Error(`${rotuloMes(prev.mes)} está fechado no caixa (cadeado). Abra o cadeado antes de importar de novo.`)
      const { error: e1 } = await supabase.from('dre_caixa').delete().eq('mes', prev.mes)
      if (e1) throw e1
      // Mesma categoria repetida no arquivo (raro): soma
      const porChave = {}
      for (const l of prev.linhas) {
        const k = `${l.tipo}|${l.categoria}`
        porChave[k] = porChave[k] ? { ...porChave[k], valor: porChave[k].valor + l.valor } : { mes: prev.mes, ...l }
      }
      const { error: e2 } = await supabase.from('dre_caixa').insert(Object.values(porChave))
      if (e2) throw e2
      if (prev.totais['Saldo final'] != null) // para a conferência com o saldo dos bancos
        await supabase.from('dre_mes').upsert({ mes: prev.mes, visao: 'caixa', saldo_final_bling: prev.totais['Saldo final'], atualizado_em: new Date().toISOString() }, { onConflict: 'mes,visao' })
      setMsg({ tipo: 'ok', txt: `Balancete de ${rotuloMes(prev.mes)} importado.` })
      setPrev(null); onImportou()
    } catch (e) { setMsg({ tipo: 'danger', txt: semTabela(e) ? AVISO_SQL : 'Erro ao importar: ' + (e.message || e) }) }
    setSalvando(false)
  }

  const confere = prev && Math.abs(prev.receitas - (prev.totais['Total de receitas'] ?? prev.receitas)) < 0.01
    && Math.abs(prev.despesas - (prev.totais['Total de despesas'] ?? prev.despesas)) < 0.01

  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 800, fontSize: 14 }}>Caixa (Balancete)</div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Bling › Financeiro › Relatórios › <b>Balancete</b> › "Do mês" › Visualizar › Exportar (CSV). Um mês por arquivo.
      </div>
      <CampoArquivo rotulo="Escolher arquivo" onTexto={ler} />
      {prev && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div><b>{rotuloMes(prev.mes)}</b> · receitas R$ {fmt(prev.receitas)} · despesas R$ {fmt(prev.despesas)}</div>
          <div style={{ fontSize: 12, color: confere ? 'var(--ok)' : 'var(--danger)' }}>
            {confere ? '✓ Bate com os totais do Balancete' : '⚠️ Não bate com os totais do Balancete — confira o arquivo'}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={importar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Importar
          </button>
        </div>
      )}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
    </div>
  )
}

// ── Faturamento das plataformas (iFood, 99 Food, Keeta, Anota.AI) ────────────
// Um lançamento por mês × canal × unidade, lido do print do portal ou digitado.
// Vai para a DRE: vendas → Receita Delivery; promoções → Deduções; taxas + serviços − ajustes → Comercial;
// pacote de anúncios → Marketing.
const AVISO_SQL_3 = 'Aplique o arquivo financeiro_dre_3.sql no Supabase para lançar o faturamento das plataformas.'
const CAMPOS_CANAL = [
  ['vendas', 'Valor das vendas', 'Receita bruta · Delivery'],
  ['promocoes', 'Promoções', 'Deduções · promoções'],
  ['taxas', 'Taxas e comissões', 'Comercial · comissão e taxas'],
  ['servicos', 'Serviços sem anúncios (entrega sob demanda…)', 'Comercial · comissão e taxas'],
  ['marketing', 'Pacote de anúncios', 'Marketing'],
  ['ajustes', 'Ajustes (+ a favor da loja)', 'abate de comissão e taxas'],
]
const numTxt = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const txtNum = v => v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ',')
const mesPassado = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const naFila = x => ({ ...x, _k: Date.now() + Math.random() })
const ORIGENS = { print: 'print', portal: 'portal iFood', planilha: 'planilha', shopify: 'Shopify', digitado: 'digitado' }
const rotuloOrigem = o => ORIGENS[o] || 'digitado'
const normalizarCanal = p => {
  const k = String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return PLATAFORMAS.find(x => x.canal.toLowerCase().replace(/[^a-z0-9]/g, '') === k)?.canal || (p || 'iFood')
}
// Linha do banco → formulário (valores em texto, com vírgula)
const paraForm = r => ({
  ...r, ...Object.fromEntries(CAMPOS_CANAL.map(([k]) => [k, txtNum(r[k])])), total_faturamento: txtNum(r.total_faturamento),
})
const doForm = f => ({
  vendas: numTxt(f.vendas), promocoes: numTxt(f.promocoes), taxas: numTxt(f.taxas), servicos: numTxt(f.servicos),
  marketing: numTxt(f.marketing), ajustes: numTxt(f.ajustes),
  total_faturamento: String(f.total_faturamento ?? '').trim() === '' ? null : numTxt(f.total_faturamento),
})

// Taxas do Mercado Pago das vendas que não são Balcão nem Ativação (Pix do site, links de pagamento): vão para a
// DRE de competência pelo mês da venda, como "Cartão e meios de pagamento" (dre_manuais, um lançamento por mês,
// refeito a cada importação). As de Balcão e Ativação já ficam na comissão desses canais; as do Mercado Livre,
// na comissão do Mercado Livre (planilha do ML). A fatura do Mercado Pago (cobrança) fica só no caixa.
const DESC_TAXAS_MP = 'Mercado Pago: taxas do Pix do site e links (relatório de vendas)'
async function gravarTaxasMercadoPago(taxasFora) {
  const txt = {}
  for (const [mes, valor] of Object.entries(taxasFora || {})) {
    if (!valor) continue
    try {
      const { data: ja, error } = await supabase.from('dre_manuais').select('id, descricao, valor').eq('mes', mes).ilike('descricao', 'Mercado Pago%')
      if (error) throw error
      const antigos = (ja || []).filter(m => m.descricao !== DESC_TAXAS_MP)
      if (antigos.length && window.confirm(`${rotuloMes(mes)}: o relatório de vendas dá R$ ${fmt(valor)} de taxas do Mercado Pago (Pix do site e links).\n\nApagar o(s) lançamento(s) manual(is) ${antigos.map(m => `"${m.descricao}" (R$ ${fmt(+m.valor)})`).join(', ')}, que viriam em dobro com as comissões do Mercado Livre, do Balcão e da Ativação?`)) {
        const { error: e1 } = await supabase.from('dre_manuais').delete().in('id', antigos.map(m => m.id)); if (e1) throw e1
      }
      const { error: e2 } = await supabase.from('dre_manuais').delete().eq('mes', mes).eq('descricao', DESC_TAXAS_MP); if (e2) throw e2
      const { error: e3 } = await supabase.from('dre_manuais').insert({ mes, descricao: DESC_TAXAS_MP, conta: 'vc.cartao', valor, por: usuarioNome() }); if (e3) throw e3
      txt[mes] = `Taxas do Mercado Pago do Pix do site e links em ${rotuloMes(mes)}: R$ ${fmt(valor)}, lançadas na DRE (Cartão e meios de pagamento).`
    } catch (e) {
      txt[mes] = `Taxas do Mercado Pago do Pix do site e links em ${rotuloMes(mes)}: R$ ${fmt(valor)}. Não consegui lançar na DRE: ${/fechado/i.test(e.message) ? 'o mês está fechado.' : semTabela(e) ? 'aplique o dre_laricas.sql.' : e.message}`
    }
  }
  return txt
}

function FaturamentoPlataformas({ onMudou }) {
  const [mes, setMes] = useState(mesPassado)
  const [todas, setTodas] = useState([])   // todos os meses: ensina nome da loja → unidade
  const [fechados, setFechados] = useState(new Set())
  const [semTab, setSemTab] = useState(false)
  const [fila, setFila] = useState([])     // lançamentos para revisar (prints lidos, novo, edição)
  const [lendo, setLendo] = useState(0)
  const [buscandoSite, setBuscandoSite] = useState(false)
  const [msg, setMsg] = useState(null)
  const ref = useRef()

  // Site: pedidos do mês direto da Shopify (brindes da régua já ficam de fora) → fila de revisão
  async function buscarShopify() {
    setBuscandoSite(true); setMsg(null)
    try {
      const r = await fetch(`/api/shopify-faturamento?mes=${mes}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Falha ao buscar na Shopify (${r.status})`)
      const e = j.faturamento
      const fora = [e.fora.cancelados && `${e.fora.cancelados} cancelado(s)`, e.fora.naoPagos && `${e.fora.naoPagos} não pago(s)`, e.fora.teste && `${e.fora.teste} de teste`].filter(Boolean)
      setFila(q => [...q, naFila({
        ...paraForm(e), origem: 'shopify', arquivo: 'Shopify',
        aviso: [`${e.pedidos} pedido(s) de ${rotuloMes(e.mes)}${fora.length ? ` (fora: ${fora.join(', ')})` : ''}.`,
          e.brindes.quantidade ? `Brindes da régua fora da receita: ${e.brindes.quantidade} un., R$ ${fmt(e.brindes.valor)}.` : '',
          e.vouchers?.quantidade ? `Vouchers de influenciadores fora da receita: ${e.vouchers.quantidade}, R$ ${fmt(e.vouchers.valor)} (custo dos produtos já está no CMV).` : '', ...e.avisos].filter(Boolean).join(' '),
      })])
    } catch (e) { setMsg({ tipo: 'danger', txt: `Shopify: ${e.message || e}` }) }
    setBuscandoSite(false)
  }

  async function carregar() {
    const [{ data, error }, { data: fech }] = await Promise.all([
      supabase.from('dre_canal_competencia').select('*').order('canal').order('unidade'),
      supabase.from('dre_mes').select('mes').eq('visao', 'competencia').not('fechado_em', 'is', null),
    ])
    if (error) { if (semTabela(error)) setSemTab(true); else setMsg({ tipo: 'danger', txt: error.message }); return }
    setSemTab(false); setTodas(data || []); setFechados(new Set((fech || []).map(r => r.mes)))
  }
  useEffect(() => { carregar() }, [])

  // Print: lê cada arquivo e põe na fila de revisão (nada é salvo sem conferir)
  async function lerArquivos(files) {
    const ehPlanilha = f => /\.xlsx$/i.test(f.name || '')
    const ehCsv = f => /\.csv$/i.test(f.name || '')
    const lista = [...files].filter(f => /^image\/|pdf$/.test(f.type) || ehPlanilha(f) || ehCsv(f))
    if (!lista.length) return
    setMsg(null); setLendo(n => n + lista.length)
    for (const file of lista) {
      try {
        if (ehCsv(file)) {
          // Mercado Pago (relatório de Vendas): Ativação e Balcão por mês da compra
          const { meses, fora, taxasFora } = lerRelatorioMercadoPago(await file.text())
          if (!meses.length) throw new Error('Nenhuma venda das lojas Ativação ou Loja no arquivo.')
          const txtFora = Object.entries(fora).map(([k, v]) => `${k}: R$ ${fmt(v)}`).join('; ')
          const taxasTxt = await gravarTaxasMercadoPago(taxasFora)
          setFila(q => [...q, ...meses.map(e => naFila({
            ...paraForm(e), origem: 'planilha', arquivo: file.name,
            aviso: `${e.pedidos} venda(s) de ${rotuloMes(e.mes)} no Mercado Pago (as taxas delas já entram na comissão deste canal).`
              + (txtFora ? ` Fora da DRE neste arquivo (já vêm de outras fontes): ${txtFora}.` : '')
              + (taxasTxt[e.mes] ? ` ${taxasTxt[e.mes]}` : ''),
          }))])
          setLendo(n => n - 1)
          continue
        }
        if (ehPlanilha(file)) {
          // 99 Food ou Keeta: uma entrada por loja × mês da planilha
          const dados = await file.arrayBuffer()
          let meses
          try { meses = await lerPlanilha99(dados, todas.filter(x => x.canal === '99 Food')) } catch (e99) {
            if (!/Não achei a aba/.test(e99.message)) throw e99
            try { meses = await lerPlanilhaKeeta(dados) } catch (eK) {
              if (!/Não achei a aba/.test(eK.message)) throw eK
              throw new Error('planilha não reconhecida: use a "Detalhes da fatura" da 99 Food ou o "Billing report" da Keeta.')
            }
          }
          if (!meses.length) throw new Error('Nenhum pedido encontrado na planilha.')
          setFila(q => [...q, ...meses.map(e => naFila({
            ...paraForm(e), origem: 'planilha', arquivo: file.name,
            aviso: [`${e.pedidos} pedido(s) de ${rotuloMes(e.mes)} somados da planilha.`, ...e.avisos].join(' '),
          }))])
          setLendo(n => n - 1)
          continue
        }
        const corpo = await arquivoParaEnvio(file, { rotuloPdf: 'envie um print da tela' })
        const r = await fetch('/api/ler-faturamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || `Falha na leitura (${r.status})`)
        const p = j.faturamento
        const canal = normalizarCanal(p.plataforma)
        const unidade = siglaUnidade(p.unidade, todas.filter(x => x.canal === canal))
          || (PLATAFORMAS.find(x => x.canal === canal)?.unidades.length === 1 ? PLATAFORMAS.find(x => x.canal === canal).unidades[0] : '')
        setFila(q => [...q, naFila({
          ...paraForm({ ...p, total_faturamento: p.total_faturamento }),
          mes: /^\d{4}-\d{2}$/.test(p.mes) ? p.mes : mes, canal, unidade,
          unidade_print: p.unidade || null, detalhes: p.linhas || [], origem: 'print',
          aviso: p.legivel ? (p.problemas || '') : (p.problemas || 'Leitura incompleta: confira todos os valores.'),
          ilegivel: !p.legivel, arquivo: file.name || 'print colado',
        })])
      } catch (e) { setMsg({ tipo: 'danger', txt: `${file.name || 'Print'}: ${e.message || e}` }) }
      setLendo(n => n - 1)
    }
  }

  // Ctrl+V de um print em qualquer lugar da tela de importação
  useEffect(() => {
    const colar = e => {
      const arqs = [...(e.clipboardData?.files || [])]
      if (arqs.some(f => f.type.startsWith('image/'))) { e.preventDefault(); lerArquivos(arqs) }
    }
    document.addEventListener('paste', colar)
    return () => document.removeEventListener('paste', colar)
  })

  async function excluir(r) {
    if (!window.confirm(`Excluir o faturamento de ${rotuloCanal(r)} em ${rotuloMes(r.mes)}?`)) return
    const { error } = await supabase.from('dre_canal_competencia').delete().eq('id', r.id)
    if (error) { setMsg({ tipo: 'danger', txt: error.message }); return }
    setMsg({ tipo: 'ok', txt: `${rotuloCanal(r)} de ${rotuloMes(r.mes)} excluído.` }); carregar(); onMudou()
  }

  const doMes = todas.filter(r => r.mes === mes)
  const fechado = fechados.has(mes)
  const soma = k => doMes.reduce((s, r) => s + (typeof k === 'function' ? k(r) : Number(r[k]) || 0), 0)
  const th = { padding: '6px 8px', textAlign: 'right', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700, whiteSpace: 'nowrap' }
  const td = { padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Faturamento das plataformas (competência)</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5, marginTop: 2 }}>
            <b>iFood:</b> Financeiro › Faturamento do mês, uma loja por print (com os grupos abertos); envie ou cole (Ctrl+V).{' '}
            <b>99 Food:</b> planilha "Detalhes da fatura" (.xlsx) de cada loja; pode ser de vários meses, o sistema separa pelo mês da cobrança.{' '}
            <b>Keeta:</b> Financials › Download › Billing report (.xlsx) do mês.{' '}
            <b>Site:</b> busca os pedidos do mês direto na Shopify (brindes da régua ficam fora da receita e dos descontos).{' '}
            <b>Mercado Pago:</b> Relatórios › Vendas (.csv): lojas Ativação e Loja (Balcão, desde jul/26).
            Você confere cada loja × mês antes de salvar.
          </div>
        </div>
        <input type="month" className="form-input" value={mes} onChange={e => setMes(e.target.value)} style={{ width: 160, fontSize: 13 }} />
        <button className="btn btn-primary btn-sm" disabled={semTab || lendo > 0} onClick={() => ref.current?.click()}>
          {lendo > 0 ? <RefreshCw size={13} className="spin" /> : <Camera size={13} />} {lendo > 0 ? `Lendo ${lendo} arquivo(s)…` : 'Ler print ou planilha'}
        </button>
        <button className="btn btn-primary btn-sm" disabled={semTab || fechado || buscandoSite} onClick={buscarShopify} title="Pedidos do mês na Shopify, sem os brindes da régua">
          {buscandoSite ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />} {buscandoSite ? 'Buscando na Shopify…' : 'Site: buscar na Shopify'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={semTab || fechado}
          onClick={() => setFila(q => [...q, naFila(paraForm({ mes, canal: 'iFood', unidade: 'BV', origem: 'digitado' }))])}>
          <Plus size={13} /> Digitar
        </button>
        <input ref={ref} type="file" multiple accept="image/*,application/pdf,.xlsx,.csv" style={{ display: 'none' }}
          onChange={e => { const fs = e.target.files; lerArquivos(fs); e.target.value = '' }} />
      </div>

      {semTab && <div className="alert-banner info" style={{ marginTop: 10 }}>{AVISO_SQL_3}</div>}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
      {fechado && <div style={{ fontSize: 12, color: 'var(--ok)', marginTop: 8 }}><Lock size={12} style={{ verticalAlign: -2 }} /> {rotuloMes(mes)} fechado na DRE: abra o cadeado para alterar.</div>}

      {!semTab && (doMes.length ? (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--gray-200)' }}>
                <th style={{ ...th, textAlign: 'left' }}>Loja</th>
                <th style={th}>Vendas</th><th style={th}>Promoções</th><th style={th}>Comissão e taxas</th><th style={th}>Anúncios</th>
                <th style={th} title="vendas − promoções − comissão e taxas − anúncios">Recebido</th><th style={th}>Portal</th><th />
              </tr>
            </thead>
            <tbody>
              {doMes.map(r => {
                const bate = r.total_faturamento == null ? null : Math.abs(liquidoCanal(r) - Number(r.total_faturamento)) < 0.05
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700 }}>
                      {rotuloCanal(r)}
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--gray-400)' }}> · {rotuloOrigem(r.origem)}</span>
                    </td>
                    <td style={td}>{fmt(r.vendas)}</td>
                    <td style={td}>{fmt(r.promocoes)}</td>
                    <td style={td} title={`taxas ${fmt(r.taxas)} + serviços ${fmt(r.servicos)} − ajustes ${fmt(r.ajustes)}`}>{fmt(custoCanal(r))}</td>
                    <td style={td}>{marketingCanal(r) ? fmt(marketingCanal(r)) : '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmt(liquidoCanal(r))}</td>
                    <td style={{ ...td, fontSize: 12, color: bate == null ? 'var(--gray-300)' : bate ? 'var(--ok)' : 'var(--danger)' }}
                      title={r.total_faturamento == null ? 'Sem total do portal' : `Total do faturamento no portal: R$ ${fmt(r.total_faturamento)}`}>
                      {bate == null ? '—' : bate ? '✓ bate' : `⚠ ${fmt(r.total_faturamento)}`}
                    </td>
                    <td style={{ ...td, width: 70 }}>
                      {!fechado && <>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => setFila(q => [...q, naFila(paraForm(r))])}><Pencil size={12} /></button>
                        <button className="btn btn-ghost btn-xs" title="Excluir" onClick={() => excluir(r)}><Trash2 size={12} /></button>
                      </>}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '2px solid var(--gray-200)', fontWeight: 800 }}>
                <td style={{ padding: '6px 8px' }}>Total {rotuloMes(mes)}</td>
                <td style={td}>{fmt(soma('vendas'))}</td><td style={td}>{fmt(soma('promocoes'))}</td>
                <td style={td}>{fmt(soma(custoCanal))}</td><td style={td}>{fmt(soma(marketingCanal))}</td><td style={td}>{fmt(soma(liquidoCanal))}</td><td /><td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 10 }}>Nenhuma loja lançada em {rotuloMes(mes)}.</div>
      ))}

      {fila.length > 0 && (
        <ModalCanal key={fila[0]._k} inicial={fila[0]} restantes={fila.length - 1} todas={todas} fechados={fechados}
          onFechar={() => setFila(q => q.slice(1))}
          onSalvou={m => { setFila(q => q.slice(1)); setMes(m); carregar(); onMudou() }} />
      )}
    </div>
  )
}

function ModalCanal({ inicial, restantes, todas, fechados, onFechar, onSalvou }) {
  const [f, setF] = useState(inicial)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [verLinhas, setVerLinhas] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v, alterado: p.alterado || CAMPOS_CANAL.some(([c]) => c === k) }))

  const v = doForm(f)
  const custo = custoCanal(v), anuncios = marketingCanal(v), liquido = liquidoCanal(v)
  const bate = v.total_faturamento == null ? null : Math.abs(liquido - v.total_faturamento) < 0.05
  const unidades = PLATAFORMAS.find(x => x.canal === f.canal)?.unidades || []
  const existente = todas.find(r => r.mes === f.mes && r.canal === f.canal && r.unidade === (f.unidade || '') && r.id !== f.id)
  const fechado = fechados.has(f.mes)

  async function salvar() {
    setErro('')
    if (!/^\d{4}-\d{2}$/.test(f.mes || '')) return setErro('Escolha o mês do faturamento.')
    if (!f.canal) return setErro('Escolha a plataforma.')
    if (unidades.length > 1 && !f.unidade) return setErro(`Escolha a unidade (${unidades.join(', ')}).`)
    if (!(v.vendas > 0)) return setErro('Valor das vendas em branco.')
    if (fechado) return setErro(`${rotuloMes(f.mes)} está fechado na DRE: abra o cadeado antes.`)
    if (existente && !window.confirm(`${rotuloCanal(f)} já tem faturamento em ${rotuloMes(f.mes)} (vendas R$ ${fmt(existente.vendas)}). Substituir?`)) return
    if (bate === false && !window.confirm(`As linhas dão R$ ${fmt(liquido)} e o total do portal é R$ ${fmt(v.total_faturamento)}. Salvar mesmo assim?`)) return
    setSalvando(true)
    const linha = {
      mes: f.mes, canal: f.canal, unidade: f.unidade || '', ...v,
      unidade_print: f.unidade_print || null, detalhes: f.detalhes || null, origem: f.alterado || !ORIGENS[f.origem] ? 'digitado' : f.origem,
      atualizado_em: new Date().toISOString(), atualizado_por: usuarioNome(),
    }
    const { error } = await supabase.from('dre_canal_competencia').upsert(linha, { onConflict: 'mes,canal,unidade' })
    // Edição que mudou mês, canal ou unidade: apaga o lançamento antigo
    if (!error && f.id) {
      const orig = todas.find(r => r.id === f.id)
      if (orig && (orig.mes !== linha.mes || orig.canal !== linha.canal || orig.unidade !== linha.unidade))
        await supabase.from('dre_canal_competencia').delete().eq('id', f.id)
    }
    setSalvando(false)
    if (error) return setErro(semTabela(error) ? AVISO_SQL_3 : error.message)
    onSalvou(f.mes)
  }

  const lbl = { fontSize: 12 }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className="modal" style={{ maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{f.id ? 'Editar faturamento' : f.origem === 'print' ? 'Conferir print' : f.origem === 'planilha' ? 'Conferir planilha' : 'Digitar faturamento'}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
              {['print', 'planilha'].includes(f.origem) && f.arquivo ? `Lido de ${f.arquivo}${f.unidade_print ? ` · loja: "${f.unidade_print}"` : ''}` : 'Valores do Faturamento do portal'}
              {restantes > 0 && ` · mais ${restantes} na fila`}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onFechar}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {f.aviso && <div className={`alert-banner ${f.ilegivel ? 'danger' : 'warning'}`} style={{ marginBottom: 10 }}>{f.aviso}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={lbl}>Mês (competência)</label>
              <input type="month" className="form-input" value={f.mes || ''} onChange={e => set('mes', e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={lbl}>Plataforma</label>
              <select className="form-input" value={f.canal} onChange={e => {
                const c = e.target.value, us = PLATAFORMAS.find(x => x.canal === c)?.unidades || []
                setF(p => ({ ...p, canal: c, unidade: us.includes(p.unidade) ? p.unidade : (us.length === 1 ? us[0] : '') }))
              }}>
                {[...new Set([...PLATAFORMAS.map(x => x.canal), f.canal])].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={lbl}>Unidade</label>
              <input className="form-input" list="unidades-canal" value={f.unidade || ''} placeholder={unidades.join(', ') || '—'}
                onChange={e => set('unidade', e.target.value.toUpperCase().trim())}
                style={{ borderColor: unidades.length > 1 && !f.unidade ? 'var(--danger)' : undefined }} />
              <datalist id="unidades-canal">{unidades.filter(Boolean).map(u => <option key={u} value={u} />)}</datalist>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {CAMPOS_CANAL.map(([k, nome, destino]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{k === 'marketing' && f.canal === 'Site' ? 'Vouchers de influenciadores' : nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{k === 'vendas' ? `Receita bruta · ${LINHAS[linhaReceitaCanal(f)].nome}` : destino}</div>
                </div>
                <input className="form-input" inputMode="decimal" placeholder="0,00" value={f[k] ?? ''} onChange={e => set(k, e.target.value)} style={{ textAlign: 'right' }} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, alignItems: 'center', borderTop: '1px solid var(--gray-100)', paddingTop: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Total do faturamento no portal</div>
                <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>opcional, só para conferir</div>
              </div>
              <input className="form-input" inputMode="decimal" placeholder="0,00" value={f.total_faturamento ?? ''} onChange={e => set('total_faturamento', e.target.value)} style={{ textAlign: 'right' }} />
            </div>
          </div>

          <div style={{ marginTop: 12, background: 'var(--gray-50)', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>Vai para a DRE de {f.mes ? rotuloMes(f.mes) : '—'} como {rotuloCanal(f) || f.canal}</div>
            <div>Receita bruta · {LINHAS[linhaReceitaCanal(f)].nome}: <b>R$ {fmt(v.vendas)}</b></div>
            <div>Deduções · promoções: <b>− R$ {fmt(v.promocoes)}</b></div>
            <div>Comercial · comissão e taxas: <b>− R$ {fmt(custo)}</b>
              <span style={{ color: 'var(--gray-500)' }}> ({fmt(v.taxas)} + {fmt(v.servicos)} − {fmt(v.ajustes)} de ajustes)</span></div>
            {anuncios !== 0 && <div>Marketing · {f.canal === 'Site' ? 'influenciadores (vouchers)' : 'anúncios'}: <b>− R$ {fmt(anuncios)}</b></div>}
            <div style={{ color: bate == null ? 'var(--gray-500)' : bate ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 }}>
              Recebido pela loja: R$ {fmt(liquido)}
              {bate == null ? '' : bate ? ' ✓ bate com o total do portal' : ` ⚠ o portal diz R$ ${fmt(v.total_faturamento)} (diferença R$ ${fmt(liquido - v.total_faturamento)})`}
            </div>
          </div>

          {f.detalhes?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-xs" onClick={() => setVerLinhas(x => !x)}>
                {verLinhas ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Linhas lidas ({f.detalhes.length})
              </button>
              {verLinhas && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 4 }}>
                  <tbody>
                    {f.detalhes.map((d, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                        <td style={{ padding: '3px 6px', color: 'var(--gray-400)' }}>{d.grupo}</td>
                        <td style={{ padding: '3px 6px' }}>{d.descricao}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: d.valor < 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmt(d.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {existente && <div className="alert-banner warning" style={{ marginTop: 10 }}>Já existe {rotuloCanal(existente)} em {rotuloMes(existente.mes)} (vendas R$ {fmt(existente.vendas)}): salvar substitui.</div>}
          {erro && <div className="alert-banner danger" style={{ marginTop: 10 }}>{erro}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onFechar}>{restantes > 0 ? 'Pular' : 'Cancelar'}</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || fechado}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

