import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, Lock, LockOpen, Plus, Trash2, Download } from 'lucide-react'
import {
  GRUPOS, NOME_GRUPO, CANAIS, carregarMes, montar, calcular, ponte, classificar, regraDe, totalPedidos, mesAnterior,
  parcelaDoMes, fimRateio, custoMarketing, TIPOS_MKT, conciliacaoCMV, ultimoDia, sinalCaixa,
  PROVA_DESDE, ITENS_PROVA, prova, abertoEm, correiosAPagarEm,
} from '../lib/dreLaricas'
import { baixarXlsx } from '../lib/xlsx'
import FinanceiroAno from './FinanceiroAno'
import ExtratosBanco, { carregarExtratos, conferirExtratos } from './FinanceiroExtratos'
import { lerArquivoFrete, ORIGENS_FRETE, situacaoFretes } from '../lib/fretes'

// Financeiro › DRE: regras em src/lib/dreLaricas.js. Abas na ordem do fechamento do mês.

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const brl = v => (v < 0 ? '−' : '') + 'R$ ' + fmt(Math.abs(v))
const pct = v => isFinite(v) ? fmt(v * 100, 1) + '%' : '—'
const dt = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '—'
const num = s => { const t = String(s ?? '').trim(); if (!t) return 0; return parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0 }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = m => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`
const usuario = () => { try { return JSON.parse(sessionStorage.getItem('usuario')) || {} } catch { return {} } }
const ehAdmin = () => usuario().perfil === 'admin'
const COMO = { manual: ['à mão', 'warning'], fornecedor: ['regra do fornecedor', 'purple'], categoria: ['regra da categoria', 'neutral'] }
const erroMsg = e => /does not exist|schema cache|42P01/i.test(e?.message || '') ? 'Aplique o dre_laricas.sql no Supabase.' : (e?.message || String(e))

const ABAS = [['passos', '✅ Passo a passo'], ['dre', '📋 DRE'], ['ano', '📅 Ano'], ['auditoria', '🔎 Auditoria'], ['lanc', '🧾 Lançamentos'], ['receitas', '💰 Receitas'], ['manuais', '✍️ Manuais'], ['plano', '🗂️ Plano e regras']]

export default function FinanceiroDRE() {
  const [mes, setMes] = useState(mesAnterior(new Date().toISOString().slice(0, 7)))
  const [aba, setAba] = useState('passos')
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const mesAtual = useRef(mes)
  mesAtual.current = mes
  async function load() {
    const alvo = mes
    setLoading(true); setErro('')
    try { const r = await carregarMes(alvo); if (mesAtual.current === alvo) setD(r) } catch (e) { if (mesAtual.current === alvo) { setErro(erroMsg(e)); setD(null) } }
    if (mesAtual.current === alvo) setLoading(false)   // trocou de mês no meio: quem manda é a carga do mês novo
  }
  useEffect(() => { load() }, [mes])   // eslint-disable-line react-hooks/exhaustive-deps
  const fechado = !!d?.comp?.fechado_em
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>DRE Laricas</div>
        <input type="month" className="form-input" value={mes} onChange={e => e.target.value && setMes(e.target.value)} style={{ width: 170 }} />
        {d && <span className={`pill ${fechado ? 'ok' : 'warning'}`}>{fechado ? <><Lock size={11} /> fechado em {new Date(d.comp.fechado_em).toLocaleDateString('pt-BR')}</> : 'aberto'}</span>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>
      <div className="tabs" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
        {ABAS.map(([id, nome]) => <button key={id} className={`tab${aba === id ? ' active' : ''}`} onClick={() => setAba(id)}>{nome}</button>)}
      </div>
      {erro && <div className="alert-banner danger">{erro}</div>}
      {/* key por mês: ao trocar o mês, cada aba recomeça com os dados do mês novo (sem levar o que estava digitado) */}
      {!d || d.mes !== mes ? (loading && <div className="loading"><RefreshCw size={14} className="spin" /></div>) : <Fragment key={d.mes}>
        {aba === 'dre' && <TelaDRE d={d} />}
        {aba === 'auditoria' && <TelaAuditoria d={d} fechado={fechado} onSalvo={load} />}
        {aba === 'lanc' && <TelaLancamentos d={d} fechado={fechado} onSalvo={load} />}
        {aba === 'receitas' && <TelaReceitas d={d} fechado={fechado} onSalvo={load} />}
        {aba === 'manuais' && <TelaManuais d={d} fechado={fechado} onSalvo={load} />}
        {aba === 'plano' && <TelaPlano d={d} onSalvo={load} />}
        {aba === 'passos' && <TelaPassos d={d} onSalvo={load} irPara={setAba} />}
      </Fragment>}
      {aba === 'ano' && <FinanceiroAno key={mes.slice(0, 4)} ano={mes.slice(0, 4)} />}
    </div>
  )
}

// Descrição de um item (DRE, auditoria)
function DescItem({ x, visao }) {
  if (x.tipo === 'receita') return <>{x.r.canal} <span className="pill neutral">{x.parte}</span></>
  if (x.tipo === 'receitaLiq') return <>{x.r.canal}: bruto {brl(+x.r.bruto)} − descontos {brl(+x.r.descontos)} − comissão {brl(+x.r.comissao)}</>
  if (x.tipo === 'cmv') return <>Fechamento de estoque: {x.c.nome} {x.c.ef_origem === 'calculado' && <span className="pill warning">estoque final calculado</span>}{x.c.ef_origem === 'producao' && <span className="pill warning">pela produção</span>}</>
  if (x.tipo === 'envio') return <>{fmt(x.pedidos, 0)} pedidos × R$ {fmt(x.valor / x.pedidos)} por pedido</>
  if (x.tipo === 'sacola') return <>Ativação: {fmt(x.pedidos, 0)} vendas × 1 sacola de R$ {fmt(x.unit)}</>
  if (x.tipo === 'manual') return <>Manual: {x.m.descricao}</>
  if (x.tipo === 'frete') return <>Fretes {ORIGENS_FRETE[x.f.origem]}: {x.f.envios} lançamento(s) pela data do envio <span style={{ color: 'var(--gray-500)' }}>({x.f.docs.join(', ')})</span></>
  if (x.tipo === 'estorno') return <>Reembolso recebido: {dt(x.l.data)} · <b>{x.l.nome}</b> · {x.l.historico || x.l.categoria} <span className="pill neutral">reduz a despesa</span></>
  if (x.tipo === 'rateio') return <>Rateio: {x.r.descricao} <span className="pill neutral">parcela {x.parcela}/{x.r.parcelas}</span></>
  if (x.tipo === 'cmvmkt') return <>Produtos sem venda: {x.g.nome} ({x.g.pedidos} pedido(s), custo da ficha)</>
  const l = x.l
  return <>
    <span style={{ color: 'var(--gray-500)' }}>{x.tipo === 'pagar' ? `comp. ${dt(l.competencia)} · venc. ${dt(l.vencimento)}` : `${dt(l.data)} · ${l.banco}`}</span> · <b>{l.nome || '—'}</b>
    {(l.observacoes || l.historico) && <span style={{ color: 'var(--gray-500)' }}> · {l.observacoes || l.historico}</span>}
    <span style={{ color: 'var(--gray-400)' }}> · {l.categoria || 'sem categoria'}</span>
    {x.c?.como && <span className={`pill ${COMO[x.c.como][1]}`} style={{ marginLeft: 4 }}>{COMO[x.c.como][0]}</span>}
  </>
}

// ── DRE ───────────────────────────────────────────────────────────────────────
function TelaDRE({ d }) {
  const [visao, setVisao] = useState('competencia')
  const [abertos, setAbertos] = useState(new Set())
  const v = useMemo(() => montar(d, visao), [d, visao])
  const c = calcular(v, d.plano), base = c.liq || 1
  const alternar = id => setAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const linhas = []
  const linha = (id, nome, valor, sinal) => {
    const it = v[id]?.itens || [], ab = abertos.has(id)
    linhas.push(
      <tr key={id} onClick={() => it.length && alternar(id)} style={{ cursor: it.length ? 'pointer' : 'default' }}>
        <td style={{ paddingLeft: 26 }}>{it.length ? (ab ? '▾ ' : '▸ ') : ''}{nome} {it.length > 0 && <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>({it.length})</span>}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{valor ? brl(sinal * valor) : '—'}</td>
        <td style={{ textAlign: 'right', color: 'var(--gray-500)' }}>{valor ? pct(valor / base) : ''}</td>
      </tr>)
    if (ab) linhas.push(<tr key={id + ':d'}><td colSpan={3} style={{ background: 'var(--gray-50)', padding: 0 }}>
      <table style={{ width: '100%', fontSize: 12 }}><tbody>{it.slice().sort((a, b) => b.valor - a.valor).map((x, i) => (
        <tr key={i}><td style={{ padding: '4px 10px 4px 34px' }}><DescItem x={x} visao={visao} /></td><td style={{ textAlign: 'right', padding: '4px 10px', whiteSpace: 'nowrap' }}>{brl(x.valor)}</td></tr>))}
      </tbody></table></td></tr>)
  }
  const total = (nome, valor) => linhas.push(<tr key={'t' + nome} style={{ fontWeight: 800, background: 'var(--purple-pale)', color: 'var(--purple)' }}><td>{nome}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: valor < 0 ? 'var(--danger)' : undefined }}>{brl(valor)}</td><td style={{ textAlign: 'right' }}>{pct(valor / base)}</td></tr>)
  const grupo = id => {
    const g = GRUPOS.find(x => x.id === id), contas = d.plano.filter(p => p.grupo === id)
    linhas.push(<tr key={'g' + id}><td colSpan={3} style={{ fontWeight: 700, background: 'var(--gray-50)' }}>{g.nome}</td></tr>)
    for (const p of contas) if (v[p.id]) linha(p.id, p.nome, v[p.id].valor, p.id === 'fin.desp' ? -1 : g.sinal)
  }
  grupo('rec'); if (v._semrec) linha('_semrec', '⚠ Receita sem classificação', v._semrec.valor, 1)
  total('Faturamento bruto', c.bruta); grupo('ded'); total('Faturamento líquido', c.liq)
  grupo('cmv'); total('Lucro bruto', c.lb); grupo('vc'); total('Margem de contribuição', c.mc)
  grupo('vm'); grupo('vo'); if (v._sem) linha('_sem', '⚠ Despesa sem classificação', v._sem.valor, -1); total('Margem de contribuição líquida', c.mcl)
  grupo('fo'); grupo('fa'); grupo('fm'); grupo('fc'); total('Total de despesas fixas', -c.fixas)
  total('EBITDA', c.ebitda); grupo('fin'); grupo('inv'); total('Lucro líquido', c.ll)
  if (visao === 'competencia' && v._socaixa) { linhas.push(<tr key="gsc"><td colSpan={3} style={{ fontWeight: 700, background: 'var(--gray-50)' }}>Pagos no Bling, fora da competência</td></tr>); linha('_socaixa', 'Compras de estoque (CMV vem do fechamento) e mídia paga (vem da planilha da agência)', v._socaixa.valor, -1) }
  if (visao === 'competencia' && v._rateado) { linhas.push(<tr key="grt"><td colSpan={3} style={{ fontWeight: 700, background: 'var(--gray-50)' }}>Rateados (entram pelas parcelas)</td></tr>); linha('_rateado', 'Contas do Bling divididas em parcelas mensais', v._rateado.valor, -1) }
  if (visao === 'caixa') { linhas.push(<tr key="gfo"><td colSpan={3} style={{ fontWeight: 700, background: 'var(--gray-50)' }}>Fora do resultado</td></tr>); for (const p of d.plano.filter(p => p.grupo === 'fora')) if (v[p.id]) linha(p.id, p.nome, v[p.id].valor, 1) }
  const pe = c.mcl > 0 ? c.fixas / (c.mcl / base) : NaN
  const K = [
    ['Faturamento líquido', brl(c.liq), 'bruto ' + brl(c.bruta)],
    ['CMV', pct(c.cmv / base), brl(c.cmv) + (visao === 'caixa' ? ' (compras pagas)' : d.cmvProvisorio ? ' (provisório)' : '')],
    ['CMO (mão de obra)', pct(c.cmo / base), brl(c.cmo)],
    ['Prime cost (CMV + CMO)', pct((c.cmv + c.cmo) / base), 'referência em alimentação: até 60–65%'],
    ['Margem de contribuição', pct(c.mc / base), `${brl(c.mc)} · líquida ${pct(c.mcl / base)}`],
    ['EBITDA', brl(c.ebitda), pct(c.ebitda / base) + ' do faturamento líquido'],
    ['Ponto de equilíbrio', isFinite(pe) ? brl(pe) : '—', 'faturamento líquido que paga as despesas fixas'],
  ]
  function exportar() {
    const rows = []
    for (const [k, x] of Object.entries(v)) for (const it of x.itens) rows.push({
      conta: d.plano.find(p => p.id === k)?.nome || k, grupo: NOME_GRUPO[d.plano.find(p => p.id === k)?.grupo] || '',
      origem: it.tipo, data: it.l?.competencia || it.l?.data || '', fornecedor: it.l?.nome || it.r?.canal || it.m?.descricao || it.c?.nome || '',
      categoria_bling: it.l?.categoria || '', historico: it.l?.observacoes || it.l?.historico || '', valor: it.valor,
    })
    baixarXlsx({ nomeArquivo: `DRE_${visao}_${d.mes}`, aba: rotuloMes(d.mes), linhas: rows, colunas: [
      { header: 'Grupo', key: 'grupo', tipo: 'texto', largura: 28 }, { header: 'Conta', key: 'conta', tipo: 'texto', largura: 34 }, { header: 'Origem', key: 'origem', tipo: 'texto', largura: 10 },
      { header: 'Data', key: 'data', tipo: 'texto', largura: 11 }, { header: 'Fornecedor / canal', key: 'fornecedor', tipo: 'texto', largura: 32 },
      { header: 'Categoria no Bling', key: 'categoria_bling', tipo: 'texto', largura: 24 }, { header: 'Histórico', key: 'historico', tipo: 'texto', largura: 36 }, { header: 'Valor', key: 'valor', tipo: 'moeda', largura: 14 }] })
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 12, alignItems: 'start' }} className="grade-px">
      <div className="card">
        <div style={{ display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid var(--gray-100)', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={`btn btn-sm ${visao === 'competencia' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setVisao('competencia'); setAbertos(new Set()) }}>Competência</button>
          <button className={`btn btn-sm ${visao === 'caixa' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setVisao('caixa'); setAbertos(new Set()) }}>Caixa</button>
          <span style={{ fontSize: 12, color: 'var(--gray-500)', flex: 1 }}>Clique numa linha para ver os lançamentos que a somam.</span>
          <button className="btn btn-ghost btn-sm" onClick={exportar}><Download size={13} /> Excel</button>
        </div>
        <div className="tbl-wrap"><table><thead><tr><th>Linha</th><th style={{ textAlign: 'right' }}>Valor</th><th style={{ textAlign: 'right' }}>% fat. líq.</th></tr></thead><tbody>{linhas}</tbody></table></div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {K.map(([r, val, f]) => <div key={r} className="card card-pad"><div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{r}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{val}</div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{f}</div></div>)}
        {d.comp?.fechado_em && d.comp?.valores?.ll != null && Math.abs(d.comp.valores.ll - c.ll) > 1 && visao === 'competencia' && (
          <div className="alert-banner warning">No fechamento o lucro líquido era {brl(d.comp.valores.ll)}; hoje dá {brl(c.ll)}. Algo mudou depois (regras ou plano).</div>)}
      </div>
    </div>
  )
}

// ── Auditoria ─────────────────────────────────────────────────────────────────
// CMV do caixa ao consumo: compras pagas → compras recebidas → estoque inicial e final → CMV da DRE
function ConciliacaoCMV({ d }) {
  const c = useMemo(() => conciliacaoCMV(d), [d])
  const L = (t, v, det, forte) => <tr style={forte ? { fontWeight: 800, background: 'var(--purple-pale)' } : undefined}><td>{t}{det && <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{det}</div>}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{v == null ? '' : brl(v)}</td></tr>
  const bloco = (nome, x, pago) => [
    <tr key={nome}><td colSpan={2} style={{ fontWeight: 700, background: 'var(--gray-50)' }}>{nome}</td></tr>,
    L('Compras pagas no mês (caixa)', pago, 'o que saiu do banco para fornecedores desta categoria'),
    L('Compras recebidas no mês (entradas de estoque)', x.compras, 'diferença para as pagas = compras a prazo deste mês − pagamentos de compras de meses anteriores'),
    L('+ Estoque no início do mês', x.ei), L('− Estoque no fim do mês', -x.ef, 'contagem (ou calculado, se não houve contagem)'),
    L('= Consumido pelo estoque', x.cmvEstoque, null, true),
    x.pelaProducao ? L('+ Itens sem contagem, pela produção × ficha', x.pelaProducao) : null,
  ]
  return (
    <div className="card">
      <div style={{ padding: '10px 14px', fontWeight: 800, borderBottom: '1px solid var(--gray-100)' }}>CMV: do caixa ao consumo <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-500)' }}>
        (o caixa mostra as compras; o CMV é o que foi consumido: estoque inicial + compras − estoque final)</span></div>
      {d.cmvProvisorio && <div className="alert-banner warning" style={{ margin: 10 }}>CMV provisório: o mês ainda não teve o estoque fechado.</div>}
      <div className="tbl-wrap"><table><tbody>
        {bloco('Matéria-prima', c.mp, c.pagoMP)}
        {bloco('Embalagem do produto', c.emb, c.pagoEmb)}
        {(c.revenda.ei || c.revenda.compras || c.revenda.ef || c.pagoRevenda) ? bloco('Mercadoria para revenda (Wafer)', c.revenda, c.pagoRevenda) : null}
        <tr><td colSpan={2} style={{ fontWeight: 700, background: 'var(--gray-50)' }}>Ajustes da DRE</td></tr>
        {L('+ Embalagem de envio (pedidos × R$ por pedido)', c.envio, `pago no caixa: ${brl(c.pagoEnvio)}`)}
        {L('+ Insumos auxiliares (contas a pagar por competência)', c.insumos, `pago no caixa: ${brl(c.pagoInsumos)}`)}
        {c.marketing ? L('− Produtos que saíram sem venda (vão para marketing)', -c.marketing) : null}
        {c.manuais ? L('± Lançamentos manuais no CMV', c.manuais) : null}
        {L('= CMV da DRE de competência', c.cmvDRE, `CMV do caixa (tudo que foi pago): ${brl(c.pagoTotal)}`, true)}
      </tbody></table></div>
    </div>
  )
}

// Prova da competência: lucro por competência − caixa = variação do que ficou pendente (saldos conferidos por fora)
function ProvaCompetencia({ d, fechado }) {
  const [bal, setBal] = useState(null)
  const [balAnt, setBalAnt] = useState([])
  const [correios, setCorreios] = useState(null)
  const [form, setForm] = useState({})
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg] = useState(null)
  const ant = mesAnterior(d.mes), fim = ultimoDia(d.mes), fimAnt = ultimoDia(ant)
  async function carregar() {
    try {
      const [{ data: b, error }, { data: a }, ci, cf] = await Promise.all([
        supabase.from('dre_balanco').select('*').eq('mes', d.mes), supabase.from('dre_balanco').select('*').eq('mes', ant),
        correiosAPagarEm(fimAnt), correiosAPagarEm(fim)])
      if (error) throw error
      setBal(b || []); setBalAnt(a || []); setCorreios({ ini: ci, fim: cf })
      const f = {}
      for (const it of ITENS_PROVA.filter(x => !x.auto)) {
        const r = (b || []).find(x => x.item === it.id), ra = (a || []).find(x => x.item === it.id)
        f[it.id] = { ini: r?.saldo_ini != null ? String(r.saldo_ini).replace('.', ',') : ra ? String(ra.saldo).replace('.', ',') : '', fim: r ? String(r.saldo).replace('.', ',') : '', iniTravado: !!ra }
      }
      setForm(f)
    } catch (e) { setMsg({ tipo: 'danger', txt: /dre_balanco/.test(e.message || '') ? 'Aplique o dre_laricas_5.sql no Supabase.' : erroMsg(e) }) }
  }
  useEffect(() => { if (d.mes >= PROVA_DESDE) carregar() }, [d.mes])   // eslint-disable-line react-hooks/exhaustive-deps
  if (d.mes < PROVA_DESDE) return <div className="card card-pad" style={{ fontSize: 13, color: 'var(--gray-600)' }}><b>Prova da competência:</b> começa em {rotuloMes(PROVA_DESDE)} (precisa dos saldos a receber e das carteiras no fim do mês anterior).</div>
  if (!bal) return <div className="card card-pad"><RefreshCw size={13} className="spin" /> Prova da competência…</div>
  const p = prova(d, bal, balAnt, correios)
  async function salvarManuais() {
    setOcupado('Salvando…'); setMsg(null)
    try {
      const rows = Object.entries(form).filter(([, v]) => String(v.fim).trim() !== '').map(([item, v]) => ({
        mes: d.mes, item, saldo: num(v.fim), saldo_ini: String(v.ini).trim() === '' ? null : num(v.ini), origem: 'manual', por: usuario().nome || null, em: new Date().toISOString() }))
      const { error } = await supabase.from('dre_balanco').upsert(rows, { onConflict: 'mes,item' })
      if (error) throw error
      await carregar()
    } catch (e) { setMsg({ tipo: 'danger', txt: erroMsg(e) }) }
    setOcupado('')
  }
  async function calcularBling() {
    setMsg(null)
    try {
      const hoje = new Date().toISOString().slice(0, 10), mais1 = s => new Date(Date.parse(s) + 864e5).toISOString().slice(0, 10)
      const rows = []
      for (const tipo of ['pagar', 'receber']) {
        setOcupado(`Lendo no Bling as contas a ${tipo} pagas depois de ${dt(fimAnt)}…`)
        // pagas depois de cada data = estavam em aberto nela (o Bling filtra pela data de pagamento)
        const pagasIni = await chamarFin({ acao: 'pagas', tipo, de: mais1(fimAnt), ate: hoje })
        const pagasFim = await chamarFin({ acao: 'pagas', tipo, de: mais1(fim), ate: hoje })
        const [i, f] = await Promise.all([abertoEm(tipo, fimAnt, pagasIni.contas.map(c => c.id)), abertoEm(tipo, fim, pagasFim.contas.map(c => c.id))])
        rows.push({ mes: d.mes, item: `${tipo}:bling`, saldo_ini: i.saldo, saldo: f.saldo, origem: 'auto', por: usuario().nome || null, em: new Date().toISOString(),
          detalhe: { contas_ini: i.n, contas_fim: f.n, parciais: i.parciais + f.parciais, calculado_em: new Date().toISOString() } })
      }
      const { error } = await supabase.from('dre_balanco').upsert(rows, { onConflict: 'mes,item' })
      if (error) throw error
      await carregar()
    } catch (e) { setMsg({ tipo: 'danger', txt: erroMsg(e) }) }
    setOcupado('')
  }
  const v = x => x == null ? <span style={{ color: 'var(--gray-400)' }}>—</span> : brl(x)
  const ok = p.naoExplicado != null && Math.abs(p.naoExplicado) < 1
  return (
    <div className="card">
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
        <b>Prova da competência</b> <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
          (lucro por competência − resultado de caixa = o que ficou pendente. Cada saldo é conferido fora da DRE; o que sobrar é erro na competência)</span>
      </div>
      <div className="kpi-row" style={{ padding: 10 }}>
        <div className="kpi neutral"><div className="kpi-label">Lucro por competência</div><div className="kpi-value">{brl(p.ll)}</div></div>
        <div className="kpi neutral"><div className="kpi-label">Resultado de caixa (sem transferências e aportes)</div><div className="kpi-value">{brl(p.resOper)}</div></div>
        <div className="kpi neutral"><div className="kpi-label">Diferença a explicar</div><div className="kpi-value">{brl(p.alvo)}</div></div>
        <div className={`kpi ${p.naoExplicado == null ? 'neutral' : ok ? 'ok' : 'danger'}`}><div className="kpi-label">Não explicado</div>
          <div className="kpi-value">{p.naoExplicado == null ? '—' : ok ? '✓ 0,00' : brl(p.naoExplicado)}</div>
          <div className="kpi-detail">{p.naoExplicado == null ? `faltam ${p.faltam.length} saldo(s)` : ok ? 'competência provada' : 'erro em algum lugar da competência'}</div></div>
      </div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Saldo</th><th style={{ textAlign: 'right' }}>Fim de {rotuloMes(ant)}</th><th style={{ textAlign: 'right' }}>Fim de {rotuloMes(d.mes)}</th><th style={{ textAlign: 'right' }}>Explica</th></tr></thead>
        <tbody>
          {p.itens.map(it => <tr key={it.id}>
            <td>{it.nome} {it.auto ? <span className="pill neutral">automático</span> : <span style={{ fontSize: 11, color: 'var(--gray-500)' }}><br />{it.onde}</span>}
              {it.detalhe?.contas_fim != null && <span style={{ fontSize: 11, color: 'var(--gray-500)' }}> · {it.detalhe.contas_ini} → {it.detalhe.contas_fim} contas{it.detalhe.parciais ? ` (${it.detalhe.parciais} com pagamento parcial: valor cheio)` : ''}</span>}</td>
            <td style={{ textAlign: 'right' }}>{it.auto || fechado || form[it.id]?.iniTravado ? v(it.ini)
              : <input className="form-input" style={{ width: 110, textAlign: 'right' }} inputMode="decimal" value={form[it.id]?.ini ?? ''} onChange={e => setForm(f => ({ ...f, [it.id]: { ...f[it.id], ini: e.target.value } }))} />}</td>
            <td style={{ textAlign: 'right' }}>{it.auto || fechado ? v(it.fim)
              : <input className="form-input" style={{ width: 110, textAlign: 'right' }} inputMode="decimal" value={form[it.id]?.fim ?? ''} onChange={e => setForm(f => ({ ...f, [it.id]: { ...f[it.id], fim: e.target.value } }))} />}</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{v(it.efeito)}</td>
          </tr>)}
          {p.estimativas.map(e => <tr key={e.id}><td>{e.nome} <span className="pill warning">estimativa</span></td><td /><td /><td style={{ textAlign: 'right', fontWeight: 700 }}>{brl(e.efeito)}</td></tr>)}
          <tr style={{ fontWeight: 800, background: 'var(--gray-50)' }}><td colSpan={3}>Explicado</td><td style={{ textAlign: 'right' }}>{brl(p.explicado)}</td></tr>
          <tr style={{ fontWeight: 800, background: ok ? 'var(--purple-pale)' : undefined, color: p.naoExplicado != null && !ok ? 'var(--danger)' : undefined }}>
            <td colSpan={3}>Diferença a explicar − explicado = não explicado</td><td style={{ textAlign: 'right' }}>{p.naoExplicado == null ? '—' : brl(p.naoExplicado)}</td></tr>
        </tbody>
      </table></div>
      {p.ajuste ? <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--warning, #b45309)' }}>Ajustes de saldo no Bling neste mês: {brl(p.ajuste)} (fora da conta: não é resultado nem pendência).</div> : null}
      {!fechado && <div style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={salvarManuais} disabled={!!ocupado}><Save size={13} /> Salvar saldos</button>
        <button className="btn btn-ghost btn-sm" onClick={calcularBling} disabled={!!ocupado}><RefreshCw size={13} className={ocupado ? 'spin' : ''} /> Calcular a pagar e a receber no Bling</button>
        {ocupado && <span style={{ fontSize: 12 }}>{ocupado}</span>}
      </div>}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ margin: 10 }}>{msg.txt}</div>}
      <div style={{ padding: '0 14px 10px', fontSize: 11, color: 'var(--gray-500)' }}>
        Se sobrar diferença: abra a ponte abaixo e procure a linha cuja diferença não bate com a variação do saldo correspondente
        (ex.: receitas do delivery × variação do a receber do iFood). Venda lançada a mais, despesa esquecida ou CMV errado aparecem aqui.
      </div>
    </div>
  )
}

function TelaAuditoria({ d, fechado, onSalvo }) {
  const p = useMemo(() => ponte(d), [d])
  const [abertos, setAbertos] = useState(new Set())
  const [saldos, setSaldos] = useState(() => Object.fromEntries(p.porBanco.map(b => [b.banco, b.fim ?? ''])))
  const [salvando, setSalvando] = useState(false)
  // saldos gravados por fora (importação do extrato) entram nos campos quando o mês recarrega
  useEffect(() => { setSaldos(Object.fromEntries(p.porBanco.map(b => [b.banco, b.fim ?? '']))) }, [p])
  const dif = p.linhas.reduce((t, l) => t + l.ec - l.ex, 0)
  async function salvarSaldos() {
    setSalvando(true)
    try {
      const linhas = Object.entries(saldos).filter(([, v]) => String(v).trim() !== '').map(([conta, v]) => ({ mes: d.mes, conta, saldo: num(v), por: usuario().nome || null, em: new Date().toISOString() }))
      const { error } = await supabase.from('dre_saldos').upsert(linhas, { onConflict: 'mes,conta' })
      if (error) throw error
      onSalvo()
    } catch (e) { alert(erroMsg(e)) }
    setSalvando(false)
  }
  const alternar = id => setAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const varBancos = p.porBanco.every(b => b.varBanco != null) && p.porBanco.length ? p.porBanco.reduce((t, b) => t + b.varBanco, 0) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kpi-row">
        <div className="kpi neutral"><div className="kpi-label">Lucro líquido por competência</div><div className="kpi-value">{brl(p.ll)}</div></div>
        <div className="kpi neutral"><div className="kpi-label">Diferenças explicadas abaixo</div><div className="kpi-value">{brl(-dif)}</div></div>
        <div className="kpi neutral"><div className="kpi-label">Resultado de caixa (extrato do Bling)</div><div className="kpi-value">{brl(p.resCx)}</div></div>
        <div className={`kpi ${varBancos == null ? 'neutral' : Math.abs(varBancos - p.resCx) < 1 ? 'ok' : 'warning'}`}><div className="kpi-label">Variação nos bancos</div>
          <div className="kpi-value">{varBancos == null ? '—' : brl(varBancos)}</div>
          <div className="kpi-detail">{varBancos == null ? 'lance os saldos do mês e do anterior' : Math.abs(varBancos - p.resCx) < 1 ? '✓ bate com o extrato do Bling' : `faltam ${brl(varBancos - p.resCx)} no Bling`}</div></div>
      </div>
      <div className="card">
        <div style={{ padding: '10px 14px', fontWeight: 800, borderBottom: '1px solid var(--gray-100)' }}>Saldos dos bancos no fim de {rotuloMes(d.mes)} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-500)' }}>(do extrato de cada banco; o do mês anterior vem do lançado lá)</span></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Conta</th><th style={{ textAlign: 'right' }}>Saldo inicial</th><th style={{ textAlign: 'right' }}>Saldo final</th><th style={{ textAlign: 'right' }}>Variação no banco</th><th style={{ textAlign: 'right' }}>Movimento no Bling</th><th style={{ textAlign: 'right' }}>Diferença</th></tr></thead>
          <tbody>{p.porBanco.map(b => {
            const fim = String(saldos[b.banco] ?? '').trim() === '' ? null : num(saldos[b.banco]), vb = b.ini != null && fim != null ? fim - b.ini : null
            return <tr key={b.banco}>
              <td>{b.banco}</td><td style={{ textAlign: 'right' }}>{b.ini == null ? <span style={{ color: 'var(--gray-400)' }}>não lançado</span> : brl(b.ini)}</td>
              <td style={{ textAlign: 'right' }}><input className="form-input" style={{ width: 130, textAlign: 'right' }} inputMode="decimal" disabled={fechado} value={saldos[b.banco] ?? ''} onChange={e => setSaldos(s => ({ ...s, [b.banco]: e.target.value }))} /></td>
              <td style={{ textAlign: 'right' }}>{vb == null ? '—' : brl(vb)}</td><td style={{ textAlign: 'right' }}>{brl(b.mov)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: vb == null ? 'var(--gray-400)' : Math.abs(vb - b.mov) < 1 ? 'var(--ok)' : 'var(--danger)' }}>{vb == null ? '—' : Math.abs(vb - b.mov) < 1 ? '✓' : brl(vb - b.mov)}</td>
            </tr>
          })}</tbody>
        </table></div>
        {!fechado && <div style={{ padding: 10 }}><button className="btn btn-primary btn-sm" onClick={salvarSaldos} disabled={salvando}><Save size={13} /> Salvar saldos</button></div>}
      </div>
      <ExtratosBanco d={d} contas={p.porBanco.map(b => b.banco)} onSalvo={onSalvo} />
      <ProvaCompetencia d={d} fechado={fechado} />
      <ConciliacaoCMV d={d} />
      <div className="card">
        <div style={{ padding: '10px 14px', fontWeight: 800, borderBottom: '1px solid var(--gray-100)' }}>Ponte competência → caixa <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-500)' }}>(efeito de cada linha no resultado; clique para ver os lançamentos dos dois lados)</span></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Linha</th><th style={{ textAlign: 'right' }}>Competência</th><th style={{ textAlign: 'right' }}>Caixa</th><th style={{ textAlign: 'right' }}>Diferença</th></tr></thead>
          <tbody>
            {p.linhas.flatMap(l => {
              const ab = abertos.has(l.id), r = [<tr key={l.id} onClick={() => alternar(l.id)} style={{ cursor: 'pointer' }}>
                <td>{ab ? '▾ ' : '▸ '}{l.nome}</td><td style={{ textAlign: 'right' }}>{brl(l.ec)}</td><td style={{ textAlign: 'right' }}>{brl(l.ex)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{Math.abs(l.ec - l.ex) < 0.01 ? '—' : brl(l.ec - l.ex)}</td></tr>]
              if (ab) r.push(<tr key={l.id + ':d'}><td colSpan={4} style={{ background: 'var(--gray-50)' }}>
                <div style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 6 }}>{l.porque}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 10 }}>
                  {[['Competência', l.comp, 'competencia'], ['Caixa', l.cx, 'caixa']].map(([t, xs, vis]) => <div key={t}>
                    <b style={{ fontSize: 12 }}>{t}</b>
                    <table style={{ width: '100%', fontSize: 12 }}><tbody>{xs.length ? xs.slice().sort((a, b) => Math.abs(b.ef) - Math.abs(a.ef)).map((x, i) => (
                      <tr key={i}><td style={{ padding: '3px 6px' }}><DescItem x={x} visao={vis} /></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '3px 6px' }}>{brl(x.ef)}</td></tr>))
                      : <tr><td style={{ color: 'var(--gray-400)' }}>nada</td></tr>}</tbody></table>
                  </div>)}
                </div></td></tr>)
              return r
            })}
            <tr style={{ fontWeight: 800, background: 'var(--purple-pale)' }}><td>Lucro por competência → resultado de caixa</td><td style={{ textAlign: 'right' }}>{brl(p.ll)}</td><td style={{ textAlign: 'right' }}>{brl(p.resCx)}</td><td style={{ textAlign: 'right' }}>{brl(dif)}</td></tr>
          </tbody>
        </table></div>
      </div>
    </div>
  )
}

// ── Lançamentos do Bling, com a classificação de cada um ─────────────────────
function OpcoesConta({ plano }) {
  return GRUPOS.map(g => <optgroup key={g.id} label={g.nome}>{plano.filter(p => p.grupo === g.id && p.ativo !== false).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</optgroup>)
}
function TelaLancamentos({ d, fechado, onSalvo }) {
  const [origem, setOrigem] = useState('pagar')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const lista = (origem === 'pagar' ? d.pagar : d.caixa).map(l => ({ l, c: classificar(l, origem, d) })).filter(({ l, c }) => {
    const g = d.plano.find(p => p.id === c.conta)?.grupo
    if (filtro === '_sem' ? c.conta : filtro && g !== filtro) return false
    return !busca || `${l.nome} ${l.categoria} ${l.observacoes || ''} ${l.historico || ''}`.toLowerCase().includes(busca.toLowerCase())
  })
  async function mudar(l, conta) {
    try {
      if (!conta) { const { error } = await supabase.from('dre_classificacao').delete().eq('origem', origem).eq('id_bling', String(l.id_bling)); if (error) throw error }
      else { const { error } = await supabase.from('dre_classificacao').upsert({ origem, id_bling: String(l.id_bling), conta, por: usuario().nome || null, em: new Date().toISOString() }, { onConflict: 'origem,id_bling' }); if (error) throw error }
      onSalvo()
    } catch (e) { alert(erroMsg(e)) }
  }
  const semConta = (origem === 'pagar' ? d.pagar : d.caixa).filter(l => !classificar(l, origem, d).conta).length
  const rateioDe = l => l.id_bling && (d.rateios || []).find(r => String(r.id_bling) === String(l.id_bling))
  async function ratear(l, c) {
    const n = parseInt(window.prompt(`Dividir ${brl(+l.valor)} (${l.nome}) em quantas parcelas mensais, a partir de ${rotuloMes(l.competencia.slice(0, 7))}?`, '12'), 10)
    if (!n || n < 2) return
    const { error } = await supabase.from('dre_rateios').insert({ descricao: `${l.nome}: ${l.observacoes || l.categoria || ''}`.slice(0, 200), conta: c.conta || 'vo.outras',
      valor_total: +l.valor, parcelas: Math.min(n, 60), mes_inicio: l.competencia.slice(0, 7), id_bling: String(l.id_bling), por: usuario().nome || null })
    if (error) alert(erroMsg(error)); else onSalvo()
  }
  async function desfazerRateio(rt) {
    if (!window.confirm(`Desfazer o rateio "${rt.descricao}"? A conta volta inteira para ${rotuloMes(rt.mes_inicio)}.`)) return
    const { error } = await supabase.from('dre_rateios').delete().eq('id', rt.id)
    if (error) alert(erroMsg(error)); else onSalvo()
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" value={origem} onChange={e => setOrigem(e.target.value)} style={{ width: 260 }}>
          <option value="pagar">Contas a pagar (competência)</option><option value="caixa">Extrato (caixa)</option>
        </select>
        <select className="form-input" value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: 230 }}>
          <option value="">Todas as classificações</option><option value="_sem">⚠ Sem classificação</option>
          {GRUPOS.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
        </select>
        <input className="form-input" placeholder="Buscar fornecedor, categoria ou histórico" value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        {semConta > 0 && <span className="pill danger">{semConta} sem classificação</span>}
      </div>
      <div className="card tbl-wrap"><table style={{ minWidth: 880 }}>
        <thead><tr><th>{origem === 'pagar' ? 'Competência' : 'Data'}</th><th>{origem === 'pagar' ? 'Vencimento' : 'Conta'}</th><th>Fornecedor / histórico</th><th>Categoria no Bling</th><th>Conta Laricas</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
        <tbody>{lista.map(({ l, c }, i) => (
          <tr key={l.id || i}>
            <td>{dt(origem === 'pagar' ? l.competencia : l.data)}</td><td>{origem === 'pagar' ? dt(l.vencimento) : l.banco}</td>
            <td><b>{l.nome || '—'}</b><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{l.observacoes || l.historico}</div></td>
            <td>{l.categoria || <span style={{ color: 'var(--danger)' }}>sem categoria</span>}</td>
            <td>
              <select className="form-input" style={{ fontSize: 12, padding: '4px 6px', maxWidth: 260 }} value={c.como === 'manual' ? c.conta : ''} disabled={fechado || !l.id_bling}
                title={!l.id_bling ? 'Lançamento importado por arquivo: atualize do Bling para poder classificar um a um' : undefined}
                onChange={e => mudar(l, e.target.value)}>
                <option value="">{c.conta && c.como !== 'manual' ? `pela regra: ${d.plano.find(p => p.id === c.conta)?.nome}` : '— sem classificação —'}</option>
                <OpcoesConta plano={d.plano} />
              </select>
              {c.como && <span className={`pill ${COMO[c.como][1]}`} style={{ marginLeft: 4 }}>{COMO[c.como][0]}{c.como === 'manual' && c.por ? ` · ${c.por}` : ''}</span>}
              {!c.conta && <span className="pill danger" style={{ marginLeft: 4 }}>falta</span>}
              {origem === 'pagar' && l.id_bling && (rateioDe(l)
                ? <span className="pill purple" style={{ marginLeft: 4, cursor: fechado ? 'default' : 'pointer' }} title="Clique para desfazer" onClick={() => !fechado && desfazerRateio(rateioDe(l))}>rateado em {rateioDe(l).parcelas}x</span>
                : !fechado && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4, fontSize: 11 }} onClick={() => ratear(l, c)}>Ratear</button>)}
            </td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{origem === 'caixa' && l.tipo === 'receita' ? '' : '−'}{brl(+l.valor)}</td>
          </tr>))}</tbody>
      </table></div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{lista.length} lançamento(s) · {brl(lista.reduce((t, { l }) => t + +l.valor, 0))}. Escolher uma conta aqui vale só para este lançamento e continua quando o Bling for atualizado; para mudar todos de uma categoria, use Plano e regras.</div>
    </div>
  )
}

// ── Receitas do mês ───────────────────────────────────────────────────────────
function TelaReceitas({ d, fechado, onSalvo }) {
  const inicial = () => {
    const ja = Object.fromEntries(d.receitas.map(r => [r.canal, r]))
    const base = CANAIS.map(([canal, conta], i) => ja[canal] || { canal, conta, bruto: 0, descontos: 0, comissao: 0, pedidos: 0, ordem: i })
    return [...base, ...d.receitas.filter(r => !CANAIS.some(([c]) => c === r.canal))].map(r => ({ ...r, bruto: +r.bruto || '', descontos: +r.descontos || '', comissao: +r.comissao || '', pedidos: r.pedidos || '' }))
  }
  const [linhas, setLinhas] = useState(inicial)
  const [pedBling, setPedBling] = useState(d.comp?.extras?.pedidos_bling ?? '')
  const [porLoja, setPorLoja] = useState(d.comp?.extras?.pedidos_bling_lojas || [])
  const [envio, setEnvio] = useState(String(d.envioPorPedido).replace('.', ','))
  const [sacola, setSacola] = useState(d.sacolaAtivacao ? String(d.sacolaAtivacao).replace('.', ',') : '')
  const [msg, setMsg] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const set = (i, k, v) => setLinhas(ls => ls.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const tot = k => linhas.reduce((t, r) => t + num(r[k]), 0)
  const pedAtiv = linhas.filter(r => r.conta === 'rec.ativ').reduce((t, r) => t + num(r.pedidos), 0)
  const pedTotal = linhas.filter(r => r.conta === 'rec.delivery').reduce((t, r) => t + num(r.pedidos), 0) + num(pedBling)

  // Preenche o que estiver vazio com o que o sistema já tem: plataformas (Importar e classificar) e vendas do Bling
  async function preencher() {
    setOcupado(true); setMsg(null)
    try {
      const { data: canais, error } = await supabase.from('dre_canal_competencia').select('canal, unidade, vendas, promocoes, taxas, servicos, ajustes, detalhes').eq('mes', d.mes)
      if (error) throw error
      const r = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'pedidos', mes: d.mes }) })
      const bl = await r.json().catch(() => ({}))
      const nomeCanal = c => ({ 'iFood': `iFood ${c.unidade}`, '99 Food': `99 Food ${c.unidade}`, 'Anota.AI': `Anota.AI ${c.unidade}`, 'Clube': 'Clube de assinatura' }[c.canal] || c.canal).trim()
      let n = 0
      setLinhas(ls => ls.map(row => {
        const c = (canais || []).find(x => nomeCanal(x) === row.canal)
        const loja = (bl.lojas || []).find(l => new RegExp(`^${row.canal === 'Venda direta' ? 'venda direta' : row.canal}`, 'i').test(l.nome))
        // nº de vendas do relatório ("Vendas (133)"), para a sacola da ativação e os pedidos dos deliverys
        const nVendas = +(String((c?.detalhes || []).find(x => x.grupo === 'vendas')?.descricao || '').match(/\((\d+)/) || [])[1] || 0
        if (num(row.bruto)) return nVendas && !num(row.pedidos) ? { ...row, pedidos: nVendas } : row
        if (row.conta === 'rec.outras') {
          // multas de cancelamento do clube e reembolsos recebidos: competência = mês em que entraram no caixa
          const v = d.caixa.filter(l => sinalCaixa(l) > 0 && classificar(l, 'caixa', d).conta === 'rec.outras').reduce((t, l) => t + +l.valor, 0)
          if (v) { n++; return { ...row, bruto: Math.round(v * 100) / 100 } }
          return row
        }
        if (row.canal === 'Balcão') {
          // Balcão = maquininha "Loja" (relatório do Mercado Pago) + PIX direto (loja Balcão do Bling); competência = caixa
          const pix = (bl.lojas || []).find(l => /balc/i.test(l.nome))
          if (!c && !pix) return row
          n++
          const r2 = v => Math.round(v * 100) / 100
          return { ...row, bruto: r2((+c?.vendas || 0) + (pix?.totalProdutos || 0)) || '',
            descontos: r2((+c?.promocoes || 0) + Math.max(0, (pix?.totalProdutos || 0) - (pix?.total || 0))) || '',
            comissao: r2((+c?.taxas || 0) + (+c?.servicos || 0) - (+c?.ajustes || 0)) || '', pedidos: (nVendas + (pix?.pedidos || 0)) || '' }
        }
        if (c) { n++; return { ...row, pedidos: num(row.pedidos) || nVendas || '', bruto: +c.vendas || '', descontos: +c.promocoes || '', comissao: ((+c.taxas || 0) + (+c.servicos || 0) - (+c.ajustes || 0)) || '' } }
        if (loja && ['Revenda', 'Venda direta'].includes(row.canal)) { n++; return { ...row, bruto: loja.totalProdutos || loja.total, descontos: Math.max(0, Math.round(((loja.totalProdutos || 0) - (loja.total || 0)) * 100) / 100) || '' } }
        return row
      }))
      if (r.ok) { setPedBling(bl.pedidos); setPorLoja(bl.lojas || []) }
      setMsg({ tipo: r.ok ? 'ok' : 'warning', txt: `${n} canal(is) preenchido(s) com o que estava vazio.${r.ok ? ` Bling: ${bl.pedidos} pedidos atendidos/em aberto (sem a loja "nenhuma").` : ' Não consegui ler os pedidos do Bling: ' + (bl.erro || r.status)} Confira e salve.` })
    } catch (e) { setMsg({ tipo: 'danger', txt: erroMsg(e) }) }
    setOcupado(false)
  }
  async function salvar() {
    setOcupado(true); setMsg(null)
    try {
      const quem = usuario().nome || null, agora = new Date().toISOString()
      const rows = linhas.filter(r => r.id || num(r.bruto) || num(r.descontos) || num(r.comissao) || num(r.pedidos)).map((r, i) => ({
        mes: d.mes, canal: r.canal, conta: r.conta, bruto: num(r.bruto), descontos: num(r.descontos), comissao: num(r.comissao), pedidos: Math.round(num(r.pedidos)), ordem: r.ordem ?? i, por: quem, em: agora }))
      if (rows.length) { const { error } = await supabase.from('dre_receitas').upsert(rows, { onConflict: 'mes,canal' }); if (error) throw error }
      const { error: e2 } = await supabase.from('dre_mes').upsert({ mes: d.mes, visao: 'competencia', extras: { ...(d.comp?.extras || {}), pedidos_bling: Math.round(num(pedBling)), pedidos_bling_lojas: porLoja }, atualizado_em: agora }, { onConflict: 'mes,visao' })
      if (e2) throw e2
      if (num(envio) && num(envio) !== d.envioPorPedido) { const { error: e3 } = await supabase.from('configuracoes').update({ valor: String(num(envio)) }).eq('chave', 'dre_embalagem_envio'); if (e3) throw e3 }
      if (num(sacola) !== d.sacolaAtivacao) { const { error: e4 } = await supabase.from('configuracoes').upsert({ chave: 'dre_sacola_ativacao', valor: String(num(sacola)), descricao: 'DRE: custo da sacola por venda de ativação' }, { onConflict: 'chave' }); if (e4) throw e4 }
      onSalvo()
    } catch (e) { setMsg({ tipo: 'danger', txt: erroMsg(e) }) }
    setOcupado(false)
  }
  const inp = (i, k, w = 110) => <input className="form-input" style={{ width: w, textAlign: 'right' }} inputMode="decimal" disabled={fechado} value={linhas[i][k]} onChange={e => set(i, k, e.target.value)} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="card card-pad" style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.6 }}>
        Receita por competência, por canal: <b>bruto</b> no faturamento, <b>descontos e promoções</b> pagos pela Laricas nas deduções,
        <b> comissão da plataforma</b> nas despesas variáveis comerciais. Os <b>pedidos</b> (de cada delivery + os do Bling) × R$ por pedido viram a embalagem de envio no CMV.
        Revenda e venda direta: pelas vendas do Bling. Balcão: Mercado Pago + PIX. Keeta: bruto.
        {!fechado && <div style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={preencher} disabled={ocupado}><RefreshCw size={13} className={ocupado ? 'spin' : ''} /> Preencher o que está vazio com plataformas e Bling</button></div>}
      </div>
      <div className="card tbl-wrap"><table style={{ minWidth: 760 }}>
        <thead><tr><th>Canal</th><th>Linha</th><th style={{ textAlign: 'right' }}>Bruto</th><th style={{ textAlign: 'right' }}>Descontos e promoções</th><th style={{ textAlign: 'right' }}>Comissão</th><th style={{ textAlign: 'right' }}>Pedidos</th></tr></thead>
        <tbody>
          {linhas.map((r, i) => <tr key={r.canal}>
            <td style={{ fontWeight: 600 }}>{r.canal}</td><td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{d.plano.find(p => p.id === r.conta)?.nome}</td>
            <td style={{ textAlign: 'right' }}>{inp(i, 'bruto')}</td><td style={{ textAlign: 'right' }}>{inp(i, 'descontos')}</td><td style={{ textAlign: 'right' }}>{inp(i, 'comissao')}</td>
            <td style={{ textAlign: 'right' }}>{['rec.delivery', 'rec.ativ'].includes(r.conta) ? inp(i, 'pedidos', 80) : <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>no Bling</span>}</td>
          </tr>)}
          <tr style={{ fontWeight: 700, background: 'var(--gray-50)' }}><td>Total</td><td /><td style={{ textAlign: 'right' }}>{brl(tot('bruto'))}</td><td style={{ textAlign: 'right' }}>{brl(tot('descontos'))}</td><td style={{ textAlign: 'right' }}>{brl(tot('comissao'))}</td><td style={{ textAlign: 'right' }}>{fmt(tot('pedidos'), 0)}</td></tr>
        </tbody>
      </table></div>
      <div className="card card-pad" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        <label>Pedidos do Bling (atendidos + em aberto, sem a loja "nenhuma") <input className="form-input" style={{ width: 90, textAlign: 'right' }} disabled={fechado} value={pedBling} onChange={e => setPedBling(e.target.value)} /></label>
        <label>R$ por pedido <input className="form-input" style={{ width: 70, textAlign: 'right' }} disabled={fechado} value={envio} onChange={e => setEnvio(e.target.value)} /></label>
        <span><b>{fmt(pedTotal, 0)}</b> pedidos × R$ {envio} = <b>{brl(pedTotal * num(envio))}</b> de embalagem de envio</span>
        <label>Sacola por venda de ativação R$ <input className="form-input" style={{ width: 70, textAlign: 'right' }} disabled={fechado} placeholder="0,00" value={sacola} onChange={e => setSacola(e.target.value)} /></label>
        <span>{pedAtiv ? <><b>{fmt(pedAtiv, 0)}</b> vendas de ativação × R$ {sacola || '0'} = <b>{brl(pedAtiv * num(sacola))}</b></> : <span style={{ color: 'var(--gray-500)' }}>informe o nº de vendas na linha Ativação</span>}{pedAtiv > 0 && !num(sacola) && <span className="pill warning" style={{ marginLeft: 4 }}>falta o custo da sacola</span>}</span>
        {porLoja.length > 0 && <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{porLoja.map(l => `${l.nome}: ${l.pedidos}`).join(' · ')}</span>}
      </div>
      {msg && <div className={`alert-banner ${msg.tipo}`}>{msg.txt}</div>}
      {!fechado && <div><button className="btn btn-primary" onClick={salvar} disabled={ocupado}><Save size={14} /> Salvar receitas</button></div>}
    </div>
  )
}

// ── Lançamentos manuais ───────────────────────────────────────────────────────
const SUGESTOES = [
  ['Pagar.me: taxas descontadas na venda', 'vc.cartao'], ['Shopify Payments: taxas', 'vc.cartao'],
  ['Shopify: checkout abandonado', 'vc.cartao'], ['Meta (planilha da agência)', 'vm.midia'], ['Google (planilha da agência)', 'vm.midia'],
  ['Fidelimax: anuidade ÷ 12', 'vm.ferr'],
]
function TelaManuais({ d, fechado, onSalvo }) {
  const [novo, setNovo] = useState({ descricao: '', conta: '', valor: '' })
  const [msg, setMsg] = useState('')
  async function adicionar(item = novo) {
    if (!item.descricao || !item.conta || !num(item.valor)) { setMsg('Preencha descrição, conta e valor (negativo para tirar de uma conta, ex.: produtos que saem do CMV).'); return }
    const { error } = await supabase.from('dre_manuais').insert({ mes: d.mes, descricao: item.descricao, conta: item.conta, valor: num(item.valor), por: usuario().nome || null })
    if (error) { setMsg(erroMsg(error)); return }
    setNovo({ descricao: '', conta: '', valor: '' }); setMsg(''); onSalvo()
  }
  async function excluir(m) {
    if (!window.confirm(`Excluir "${m.descricao}" (${brl(+m.valor)})?`)) return
    const { error } = await supabase.from('dre_manuais').delete().eq('id', m.id)
    if (error) { alert(erroMsg(error)); return }
    onSalvo()
  }
  const faltam = SUGESTOES.filter(([desc]) => !d.manuais.some(m => m.descricao.toLowerCase().startsWith(desc.split(':')[0].split(' (')[0].toLowerCase())))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="card card-pad" style={{ fontSize: 13, color: 'var(--gray-600)' }}>O que não passa pelo contas a pagar do Bling: taxas descontadas na venda, mídia da planilha da agência, acertos sem caixa, reclassificações (valor negativo) e anuidades divididas por 12. Entram só na competência.</div>
      <div className="card tbl-wrap"><table>
        <thead><tr><th>Descrição</th><th>Conta</th><th style={{ textAlign: 'right' }}>Valor</th><th>Por</th><th /></tr></thead>
        <tbody>
          {d.manuais.map(m => <tr key={m.id}><td>{m.descricao}</td><td style={{ fontSize: 12 }}>{d.plano.find(p => p.id === m.conta)?.nome || m.conta}</td><td style={{ textAlign: 'right' }}>{brl(+m.valor)}</td><td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{m.por}</td>
            <td>{!fechado && <button className="btn btn-ghost btn-sm" onClick={() => excluir(m)}><Trash2 size={12} /></button>}</td></tr>)}
          {!fechado && <tr>
            <td><input className="form-input" placeholder="Descrição" value={novo.descricao} onChange={e => setNovo(n => ({ ...n, descricao: e.target.value }))} /></td>
            <td><select className="form-input" value={novo.conta} onChange={e => setNovo(n => ({ ...n, conta: e.target.value }))}><option value="">Conta…</option><OpcoesConta plano={d.plano} /></select></td>
            <td><input className="form-input" style={{ width: 110, textAlign: 'right' }} placeholder="0,00" value={novo.valor} onChange={e => setNovo(n => ({ ...n, valor: e.target.value }))} /></td>
            <td colSpan={2}><button className="btn btn-primary btn-sm" onClick={() => adicionar()}><Plus size={12} /> Adicionar</button></td>
          </tr>}
          <tr style={{ fontWeight: 700, background: 'var(--gray-50)' }}><td>Total</td><td /><td style={{ textAlign: 'right' }}>{brl(d.manuais.reduce((t, m) => t + +m.valor, 0))}</td><td colSpan={2} /></tr>
        </tbody>
      </table></div>
      {msg && <div className="alert-banner warning">{msg}</div>}
      {!fechado && faltam.length > 0 && <div className="card card-pad" style={{ fontSize: 12 }}>
        <b>Costumam entrar todo mês:</b> {faltam.map(([desc, conta]) => <button key={desc} className="btn btn-ghost btn-sm" style={{ margin: 3 }} onClick={() => setNovo({ descricao: desc, conta, valor: '' })}>+ {desc}</button>)}
      </div>}
      <Fretes d={d} fechado={fechado} onSalvo={onSalvo} />
      <ProdutosMarketing d={d} fechado={fechado} onSalvo={onSalvo} />
      <Rateios d={d} fechado={fechado} onSalvo={onSalvo} />
    </div>
  )
}

// ── Fretes por competência: relatórios dos Correios, da Lalamove e do Melhor Envio ─────────────
function Fretes({ d, fechado, onSalvo }) {
  const [lidos, setLidos] = useState([])
  const [msg, setMsg] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [auto, setAuto] = useState('')
  // Automático (mês aberto): Melhor Envio pela API e Lalamove pelas corridas chamadas pelo sistema.
  // O relatório de cada um, se importado depois, completa e corrige (mesma chave: não duplica).
  async function buscarAuto() {
    setAuto('buscando…')
    const quem = usuario().nome || null, linhas = [], partes = []
    try {
      const j = await chamarFin({ acao: 'melhorenvio', mes: d.mes })
      const ok = (j.envios || []).filter(e => !/cancel/i.test(e.status || '') && e.preco)
      linhas.push(...ok.map(e => ({ origem: 'melhorenvio', chave: `melhorenvio:${e.codigo}`, data: e.data, mes: e.data.slice(0, 7), valor: e.preco,
        descricao: `${e.transportadora} ${e.servico} · ${e.cidade} · ${e.status}`.slice(0, 160), documento: 'API Melhor Envio', por: quem })))
      partes.push(`Melhor Envio: ${ok.length} etiqueta(s)`)
    } catch (e) { partes.push(`Melhor Envio: ${e.message}`) }
    try {
      const { corridas: c } = await chamarFin({ acao: 'lalamove', mes: d.mes })
      const ok = (c || []).filter(x => x.order_id && +x.preco && !/CANCEL|REJECT|EXPIRE/i.test(x.status || ''))
      linhas.push(...ok.map(x => { const data = new Date(x.criado_em).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
        return { origem: 'lalamove', chave: `lalamove:${x.order_id}`, data, mes: data.slice(0, 7), valor: +x.preco, descricao: `${x.status} · ${x.rota_label || ''}`.slice(0, 160), documento: 'corridas do sistema', por: quem } }))
      partes.push(`Lalamove: ${ok.length} corrida(s) chamadas pelo sistema`)
    } catch (e) { partes.push(`Lalamove: ${e.message}`) }
    try {
      // não sobrescreve o que já veio do relatório (que tem o valor final cobrado)
      const { data: ja } = await supabase.from('dre_fretes').select('chave, documento').in('chave', linhas.map(l => l.chave).slice(0, 1000))
      const doRelatorio = new Set((ja || []).filter(x => !/^API|corridas do sistema/.test(x.documento || '')).map(x => x.chave))
      const novas = linhas.filter(l => !doRelatorio.has(l.chave) && l.mes === d.mes)
      if (novas.length) { const { error } = await supabase.from('dre_fretes').upsert(novas, { onConflict: 'chave' }); if (error) throw error }
      setAuto(partes.join(' · ') + '.')
      if (novas.length) onSalvo()
    } catch (e) { setAuto(partes.join(' · ') + `. Não gravei: ${erroMsg(e)}`) }
  }
  useEffect(() => { if (!fechado && d.mes <= new Date().toISOString().slice(0, 7)) buscarAuto() }, [d.mes])   // eslint-disable-line react-hooks/exhaustive-deps
  async function ler(files) {
    setMsg(null); const out = []
    for (const f of files) { try { out.push({ nome: f.name, ...(await lerArquivoFrete(f)) }) } catch (e) { setMsg({ tipo: 'danger', txt: e.message }) } }
    setLidos(out)
  }
  async function gravar() {
    setOcupado(true); setMsg(null)
    try {
      const quem = usuario().nome || null
      const linhas = lidos.flatMap(l => l.linhas).map(l => ({ ...l, por: quem }))
      for (let i = 0; i < linhas.length; i += 500) {
        let { error } = await supabase.from('dre_fretes').upsert(linhas.slice(i, i + 500), { onConflict: 'chave' })
        // antes do dre_laricas_5.sql não existe a coluna vencimento
        if (error && /vencimento/.test(error.message)) ({ error } = await supabase.from('dre_fretes').upsert(linhas.slice(i, i + 500).map(({ vencimento, ...l }) => l), { onConflict: 'chave' }))
        if (error) throw error
      }
      setLidos([]); setMsg({ tipo: 'ok', txt: `${linhas.length} envio(s) gravados. Cada um conta no mês da data do envio.` }); onSalvo()
    } catch (e) { setMsg({ tipo: 'danger', txt: /fechado/i.test(e.message) ? e.message + ' (algum envio é de um mês já fechado)' : erroMsg(e) }) }
    setOcupado(false)
  }
  const doMes = {}
  for (const f of d.fretes || []) { const o = doMes[f.origem] ||= { n: 0, v: 0 }; o.n++; o.v += +f.valor }
  const resumo = l => { const m = {}; for (const x of l.linhas) m[x.mes] = (m[x.mes] || 0) + x.valor; return Object.entries(m).sort().map(([k, v]) => `${rotuloMes(k)}: ${brl(v)}`).join(' · ') }
  return (
    <div className="card">
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}><b>Fretes pela data do envio</b> <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
        (Correios: extrato analítico da fatura, .csv · Lalamove: Order Report, .xlsx · Melhor Envio: relatório de envios, .xlsx. As faturas e recargas dessas três no Bling ficam só no caixa)</span></div>
      <div style={{ padding: 10, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
        {auto && <span style={{ width: '100%', fontSize: 12, color: 'var(--gray-500)' }}>Automático: {auto} {!fechado && <button className="btn btn-ghost btn-sm" onClick={() => buscarAuto()}><RefreshCw size={12} /> buscar de novo</button>}</span>}
        {Object.entries(ORIGENS_FRETE).map(([k, nome]) => <span key={k}>{nome}: {doMes[k] ? <b>{brl(doMes[k].v)}</b> : <span style={{ color: 'var(--danger)' }}>sem relatório</span>}{doMes[k] && <span style={{ color: 'var(--gray-500)' }}> ({doMes[k].n})</span>}</span>)}
      </div>
      {!fechado && <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input type="file" multiple accept=".csv,.xlsx" onChange={e => ler([...e.target.files])} />
        {lidos.map(l => <div key={l.nome} style={{ fontSize: 12 }}>
          <b>{ORIGENS_FRETE[l.origem]}</b> · {l.documento} · {l.linhas.length} lançamento(s) · {brl(l.linhas.reduce((t, x) => t + x.valor, 0))}
          {l.totalArquivo != null && (Math.abs(l.totalArquivo - l.linhas.reduce((t, x) => t + x.valor, 0)) < 0.01 ? <span className="pill ok" style={{ marginLeft: 4 }}>bate com o total da fatura</span> : <span className="pill danger" style={{ marginLeft: 4 }}>total da fatura: {brl(l.totalArquivo)}</span>)}
          <div style={{ color: 'var(--gray-500)' }}>{resumo(l)}</div>
        </div>)}
        {lidos.length > 0 && <div><button className="btn btn-primary btn-sm" onClick={gravar} disabled={ocupado}><Save size={13} /> Gravar fretes</button></div>}
      </div>}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ margin: 10 }}>{msg.txt}</div>}
    </div>
  )
}

// ── Produto que saiu sem venda: sai do CMV e entra no marketing ──────────────
async function chamarFin(corpo) {
  const r = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || (r.status === 404 ? 'Função do financeiro não encontrada (só no site publicado).' : `Erro ${r.status}`))
  return j
}
function ProdutosMarketing({ d, fechado, onSalvo }) {
  const grupos = d.comp?.extras?.cmv_marketing || []
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  async function buscar() {
    setErro(''); setOcupado('Lendo os pedidos do mês no Bling…')
    try {
      const { marketing = [] } = await chamarFin({ acao: 'pedidos', mes: d.mes })
      const itens = {}
      let faltam = marketing.map(p => String(p.id))
      for (let volta = 0; faltam.length && volta < 60; volta++) {
        setOcupado(`Lendo os itens: ${marketing.length - faltam.length}/${marketing.length}`)
        const r = await chamarFin({ acao: 'itens', ids: faltam.slice(0, 40) })
        for (const p of r.pedidos) itens[p.id] = p
        faltam = [...(r.faltam || []), ...faltam.slice(40)]
        if (r.faltam?.length) await new Promise(ok => setTimeout(ok, 3000))
      }
      if (faltam.length) throw new Error(`O Bling não devolveu ${faltam.length} pedido(s). Tente de novo em instantes.`)
      setOcupado('Calculando o custo pela ficha…')
      const novos = await custoMarketing(marketing.map(p => ({ ...p, ...(itens[String(p.id)] || { itens: [] }) })))
      const agora = new Date().toISOString()
      const { error } = await supabase.from('dre_mes').upsert({ mes: d.mes, visao: 'competencia', extras: { ...(d.comp?.extras || {}), cmv_marketing: novos, cmv_marketing_em: agora }, atualizado_em: agora }, { onConflict: 'mes,visao' })
      if (error) throw error
      onSalvo()
    } catch (e) { setErro(erroMsg(e)) }
    setOcupado('')
  }
  const total = grupos.reduce((t, g) => t + g.mp + g.emb, 0)
  return (
    <div className="card">
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}><b>Produtos que saíram sem venda</b> <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
          (lojas do Bling {Object.values(TIPOS_MKT).filter(([n]) => !/Shopify/.test(n)).map(([n]) => n).join(', ')} e pedidos da Shopify com voucher):
          saem do CMV pelo custo da ficha e entram no marketing</span></div>
        {!fechado && <button className="btn btn-ghost btn-sm" onClick={buscar} disabled={!!ocupado}><RefreshCw size={13} className={ocupado ? 'spin' : ''} /> {grupos.length ? 'Atualizar do Bling' : 'Buscar no Bling'}</button>}
      </div>
      {ocupado && <div style={{ padding: 10, fontSize: 12 }}>{ocupado}</div>}
      {erro && <div className="alert-banner danger" style={{ margin: 10 }}>{erro}</div>}
      {grupos.length > 0 && <div className="tbl-wrap"><table>
        <thead><tr><th>Origem</th><th>Vai para</th><th style={{ textAlign: 'right' }}>Pedidos</th><th style={{ textAlign: 'right' }}>Matéria-prima</th><th style={{ textAlign: 'right' }}>Embalagem</th><th style={{ textAlign: 'right' }}>Sai do CMV</th></tr></thead>
        <tbody>
          {grupos.flatMap(g => [
            <tr key={g.tipo} onClick={() => setAberto(a => a === g.tipo ? null : g.tipo)} style={{ cursor: 'pointer' }}>
              <td>{aberto === g.tipo ? '▾ ' : '▸ '}{g.nome}{g.semFicha?.length > 0 && <span className="pill warning" style={{ marginLeft: 4 }}>{g.semFicha.length} item(ns) sem ficha</span>}</td>
              <td style={{ fontSize: 12 }}>{d.plano.find(p => p.id === g.conta)?.nome || g.conta}</td>
              <td style={{ textAlign: 'right' }}>{g.pedidos}</td><td style={{ textAlign: 'right' }}>{brl(g.mp)}</td><td style={{ textAlign: 'right' }}>{brl(g.emb)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{brl(g.mp + g.emb)}</td>
            </tr>,
            aberto === g.tipo && <tr key={g.tipo + ':d'}><td colSpan={6} style={{ background: 'var(--gray-50)', fontSize: 12 }}>
              {g.itens.map(it => <div key={it.codigo}>{fmt(it.qtd, Number.isInteger(it.qtd) ? 0 : 1)} × {it.descricao || it.codigo} <span style={{ color: 'var(--gray-500)' }}>({it.codigo}: {brl(it.mpUnit + it.embUnit)} cada)</span></div>)}
              {g.semFicha?.length > 0 && <div style={{ color: 'var(--danger)', marginTop: 4 }}>Sem ficha no sistema (não entraram; se precisar, lance em Manuais): {g.semFicha.map(x => `${x.qtd} × ${x.codigo}`).join(', ')}</div>}
            </td></tr>,
          ])}
          <tr style={{ fontWeight: 700, background: 'var(--gray-50)' }}><td colSpan={5}>Total que sai do CMV e entra no marketing</td><td style={{ textAlign: 'right' }}>{brl(total)}</td></tr>
        </tbody>
      </table></div>}
      {d.comp?.extras?.cmv_marketing_em && <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--gray-500)' }}>Lido do Bling em {new Date(d.comp.extras.cmv_marketing_em).toLocaleString('pt-BR')}</div>}
    </div>
  )
}

// ── Rateios: despesa dividida em parcelas mensais ────────────────────────────
function Rateios({ d, fechado, onSalvo }) {
  const [novo, setNovo] = useState({ descricao: '', conta: 'vo.equip', valor_total: '', parcelas: '12', mes_inicio: d.mes })
  const ativos = (d.rateios || []).map(r => ({ r, p: parcelaDoMes(r, d.mes) })).filter(x => x.p)
  const futuros = (d.rateios || []).filter(r => r.mes_inicio > d.mes)
  const vMes = montar(d, 'competencia')
  const doBling = ['vo.equip', 'vo.manut'].flatMap(k => (vMes[k]?.itens || []).filter(x => x.tipo === 'pagar').map(x => ({ ...x, conta: k }))).sort((a, b) => b.valor - a.valor)
  async function adicionar() {
    if (!novo.descricao || !num(novo.valor_total) || !(+novo.parcelas >= 2)) return alert('Preencha descrição, valor total e parcelas (2 ou mais).')
    const { error } = await supabase.from('dre_rateios').insert({ ...novo, valor_total: num(novo.valor_total), parcelas: +novo.parcelas, por: usuario().nome || null })
    if (error) return alert(erroMsg(error))
    setNovo(n => ({ ...n, descricao: '', valor_total: '' })); onSalvo()
  }
  async function excluir(r) {
    if (!window.confirm(`Excluir o rateio "${r.descricao}"? Some de todos os meses.`)) return
    const { error } = await supabase.from('dre_rateios').delete().eq('id', r.id)
    if (error) alert(erroMsg(error)); else onSalvo()
  }
  return (
    <div className="card">
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}><b>Rateios</b> <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
        (despesa dividida em parcelas mensais. Conta do Bling: use "Ratear" em Lançamentos; ela sai do mês da compra e entra só pelas parcelas.
        Os "Planilha: …" são os rateios antigos que ainda não terminaram)</span></div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Descrição</th><th>Conta</th><th style={{ textAlign: 'right' }}>Total</th><th>Parcela</th><th>Até</th><th style={{ textAlign: 'right' }}>Neste mês</th><th /></tr></thead>
        <tbody>
          {ativos.map(({ r, p }) => <tr key={r.id}>
            <td>{r.descricao} {r.id_bling ? <span className="pill neutral">Bling</span> : r.obs ? <span className="pill neutral">{r.obs}</span> : null}</td>
            <td style={{ fontSize: 12 }}>{d.plano.find(x => x.id === r.conta)?.nome || r.conta}</td>
            <td style={{ textAlign: 'right' }}>{brl(+r.valor_total)}</td><td>{p.n}/{r.parcelas}</td><td>{rotuloMes(fimRateio(r))}</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{brl(p.valor)}</td>
            <td>{!fechado && <button className="btn btn-ghost btn-sm" onClick={() => excluir(r)}><Trash2 size={12} /></button>}</td>
          </tr>)}
          {!ativos.length && <tr><td colSpan={7} style={{ color: 'var(--gray-400)' }}>Nenhum rateio neste mês.</td></tr>}
          {!fechado && <tr>
            <td><input className="form-input" placeholder="Descrição" value={novo.descricao} onChange={e => setNovo(n => ({ ...n, descricao: e.target.value }))} /></td>
            <td><select className="form-input" value={novo.conta} onChange={e => setNovo(n => ({ ...n, conta: e.target.value }))}><OpcoesConta plano={d.plano} /></select></td>
            <td><input className="form-input" style={{ width: 100, textAlign: 'right' }} placeholder="Total" value={novo.valor_total} onChange={e => setNovo(n => ({ ...n, valor_total: e.target.value }))} /></td>
            <td><input className="form-input" style={{ width: 60 }} value={novo.parcelas} onChange={e => setNovo(n => ({ ...n, parcelas: e.target.value }))} /></td>
            <td><input type="month" className="form-input" style={{ width: 150 }} value={novo.mes_inicio} onChange={e => setNovo(n => ({ ...n, mes_inicio: e.target.value }))} title="Mês da 1ª parcela" /></td>
            <td colSpan={2}><button className="btn btn-primary btn-sm" onClick={adicionar}><Plus size={12} /> Rateio</button></td>
          </tr>}
          <tr style={{ fontWeight: 700, background: 'var(--gray-50)' }}><td colSpan={5}>Total do mês</td><td style={{ textAlign: 'right' }}>{brl(ativos.reduce((t, x) => t + x.p.valor, 0))}</td><td /></tr>
        </tbody>
      </table></div>
      {futuros.length > 0 && <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--gray-500)' }}>{futuros.length} rateio(s) começam depois deste mês.</div>}
      {doBling.length > 0 && <details style={{ padding: '6px 14px 10px', fontSize: 12 }}>
        <summary style={{ cursor: 'pointer' }}>Equipamentos e manutenção que vêm do Bling neste mês: {doBling.length} lançamento(s) · <b>{brl(doBling.reduce((t, x) => t + x.valor, 0))}</b>
          <span style={{ color: 'var(--gray-500)' }}> (compras parceladas no cartão já estão no Bling uma parcela por mês; por isso não aparecem como rateio)</span></summary>
        {doBling.map((x, i) => <div key={i} style={{ padding: '2px 0' }}>{x.l.nome}: {x.l.observacoes || x.l.categoria} · <b>{brl(x.valor)}</b> <span style={{ color: 'var(--gray-500)' }}>({d.plano.find(p => p.id === x.conta)?.nome})</span></div>)}
      </details>}
    </div>
  )
}

// ── Plano de contas e regras ──────────────────────────────────────────────────
function TelaPlano({ d, onSalvo }) {
  const [nova, setNova] = useState({ categoria: '', fornecedor: '', conta: '', so_caixa: false })
  const [conta, setConta] = useState({ grupo: 'vo', nome: '' })
  const cats = [...new Set([...d.pagar, ...d.caixa].map(l => l.categoria || '').filter(Boolean))].sort()
  const semRegra = cats.filter(c => !d.regras.some(r => r.categoria === c))
  const usos = c => [...d.pagar, ...d.caixa].filter(l => l.categoria === c).length
  const salvar = async (p, err) => { const { error } = await p; if (error) alert(erroMsg(error)); else onSalvo(); return !error && !err }
  async function addRegra() {
    if (!nova.categoria || !nova.conta) return alert('Escolha a categoria do Bling e a conta.')
    if (await salvar(supabase.from('dre_regras').insert({ categoria: nova.categoria, fornecedor: nova.fornecedor.trim() || null, conta: nova.conta, so_caixa: nova.so_caixa }))) setNova({ categoria: '', fornecedor: '', conta: '', so_caixa: false })
  }
  async function addConta() {
    if (!conta.nome.trim()) return
    const slug = conta.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24)
    const ordem = Math.max(0, ...d.plano.filter(p => p.grupo === conta.grupo).map(p => p.ordem)) + 10
    if (await salvar(supabase.from('dre_plano').insert({ id: `${conta.grupo}.${slug}`, grupo: conta.grupo, nome: conta.nome.trim(), ordem }))) setConta({ grupo: conta.grupo, nome: '' })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {semRegra.length > 0 && <div className="alert-banner warning">Categorias do Bling deste mês sem regra: {semRegra.map(c => <button key={c} className="btn btn-ghost btn-sm" style={{ margin: 2 }} onClick={() => setNova(n => ({ ...n, categoria: c }))}>{c} ({usos(c)})</button>)}</div>}
      <div className="card">
        <div style={{ padding: '10px 14px', fontWeight: 800, borderBottom: '1px solid var(--gray-100)' }}>Regras: categoria do Bling → conta <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-500)' }}>(a regra com fornecedor vale antes; "só no caixa" = na competência a conta vem de outra fonte)</span></div>
        <div className="tbl-wrap"><table style={{ minWidth: 760 }}>
          <thead><tr><th>Categoria no Bling</th><th>Fornecedor ou histórico contém</th><th>Conta Laricas</th><th>Só no caixa</th><th style={{ textAlign: 'right' }}>Lançamentos no mês</th><th /></tr></thead>
          <tbody>
            {d.regras.slice().sort((a, b) => a.categoria.localeCompare(b.categoria) || (a.fornecedor ? -1 : 1)).map(r => <tr key={r.id}>
              <td>{r.categoria}</td><td>{r.fornecedor || <span style={{ color: 'var(--gray-300)' }}>qualquer</span>}</td>
              <td><select className="form-input" style={{ fontSize: 12, padding: '4px 6px' }} value={r.conta} onChange={e => salvar(supabase.from('dre_regras').update({ conta: e.target.value }).eq('id', r.id))}><OpcoesConta plano={d.plano} /></select></td>
              <td><input type="checkbox" checked={r.so_caixa} onChange={e => salvar(supabase.from('dre_regras').update({ so_caixa: e.target.checked }).eq('id', r.id))} /></td>
              <td style={{ textAlign: 'right' }}>{[...d.pagar, ...d.caixa].filter(l => regraDe(l, d.regras)?.id === r.id).length || ''}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => window.confirm(`Excluir a regra "${r.categoria}${r.fornecedor ? ' + ' + r.fornecedor : ''}"?`) && salvar(supabase.from('dre_regras').delete().eq('id', r.id))}><Trash2 size={12} /></button></td>
            </tr>)}
            <tr>
              <td><input className="form-input" list="cats-bling" placeholder="Categoria do Bling" value={nova.categoria} onChange={e => setNova(n => ({ ...n, categoria: e.target.value }))} /><datalist id="cats-bling">{cats.map(c => <option key={c} value={c} />)}</datalist></td>
              <td><input className="form-input" placeholder="ex.: leovini, multa" value={nova.fornecedor} onChange={e => setNova(n => ({ ...n, fornecedor: e.target.value }))} /></td>
              <td><select className="form-input" value={nova.conta} onChange={e => setNova(n => ({ ...n, conta: e.target.value }))}><option value="">Conta…</option><OpcoesConta plano={d.plano} /></select></td>
              <td><input type="checkbox" checked={nova.so_caixa} onChange={e => setNova(n => ({ ...n, so_caixa: e.target.checked }))} /></td>
              <td colSpan={2}><button className="btn btn-primary btn-sm" onClick={addRegra}><Plus size={12} /> Regra</button></td>
            </tr>
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <div style={{ padding: '10px 14px', fontWeight: 800, borderBottom: '1px solid var(--gray-100)' }}>Plano de contas</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 10, padding: 10 }}>
          {GRUPOS.map(g => <div key={g.id} style={{ border: '1px solid var(--gray-100)', borderRadius: 8 }}>
            <div style={{ padding: '6px 10px', fontWeight: 700, background: 'var(--gray-50)', fontSize: 13 }}>{g.nome}</div>
            {d.plano.filter(p => p.grupo === g.id).map(p => <div key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px', fontSize: 13, opacity: p.ativo === false ? .5 : 1 }}>
              <input className="form-input" style={{ fontSize: 12, padding: '3px 6px', flex: 1 }} defaultValue={p.nome} onBlur={e => e.target.value.trim() && e.target.value !== p.nome && salvar(supabase.from('dre_plano').update({ nome: e.target.value.trim() }).eq('id', p.id))} />
              <label title="Entra no CMO (mão de obra)" style={{ fontSize: 11, whiteSpace: 'nowrap' }}><input type="checkbox" checked={p.cmo} onChange={e => salvar(supabase.from('dre_plano').update({ cmo: e.target.checked }).eq('id', p.id))} /> CMO</label>
            </div>)}
          </div>)}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 260 }} value={conta.grupo} onChange={e => setConta(c => ({ ...c, grupo: e.target.value }))}>{GRUPOS.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
          <input className="form-input" placeholder="Nova conta" value={conta.nome} onChange={e => setConta(c => ({ ...c, nome: e.target.value }))} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn btn-primary btn-sm" onClick={addConta}><Plus size={12} /> Conta</button>
        </div>
      </div>
    </div>
  )
}

// ── Passo a passo do mês (e o cadeado no fim) ────────────────────────────────
// Cada passo tem ✓ automática quando o sistema encontra o que foi feito; os que dependem de conferência (ou que
// não se aplicam no mês) são marcados à mão e ficam em dre_mes.extras.passos.
function TelaPassos({ d, onSalvo, irPara }) {
  const vc = montar(d, 'competencia'), vx = montar(d, 'caixa'), c = calcular(vc, d.plano), p = ponte(d)
  const fechado = !!d.comp?.fechado_em
  const marcados = d.comp?.extras?.passos || {}
  const semComp = vc._sem?.itens.length || 0, semCx = (vx._sem?.itens.length || 0) + (vx._semrec?.itens.length || 0)
  const ultimaSync = [...d.pagar, ...d.caixa].map(l => l.importado_em).filter(Boolean).sort().pop()
  const syncOk = !!ultimaSync && ultimaSync.slice(0, 10) > ultimoDia(d.mes)
  const temRec = canais => canais.filter(canal => !d.receitas.some(r => r.canal === canal && (+r.bruto || +r.descontos)))
  const nomes = conta => CANAIS.filter(([, k]) => k === conta).map(([n]) => n)
  const faltaDelivery = temRec([...nomes('rec.delivery'), ...nomes('rec.mkt')])
  const faltaSite = temRec(['Site', 'Clube de assinatura', 'Balcão'])
  const faltaB2b = temRec(['Revenda', 'Venda direta'])
  const fr = situacaoFretes(d.fretes || [], d.mes)
  const manuaisDe = re => d.manuais.filter(m => re.test(m.conta))
  const bancosOk = p.porBanco.length > 0 && p.porBanco.every(b => b.varBanco != null && Math.abs(b.varBanco - b.mov) < 1)
  const mkt = d.comp?.extras?.cmv_marketing
  // extratos dos bancos importados no mês: quais contas têm extrato e o que falta no Bling em cada uma
  const [extratos, setExtratos] = useState(null)
  useEffect(() => { carregarExtratos(d.mes).then(setExtratos, () => setExtratos([])) }, [d.mes])
  const confExt = useMemo(() => extratos ? conferirExtratos(d, extratos) : [], [extratos, d])
  const contasBanco = p.porBanco.map(b => b.banco)
  const semExtrato = contasBanco.filter(b => !confExt.some(x => x.conta === b))
  const extDif = confExt.filter(x => Math.abs(x.liquida) >= 1)
  const PASSOS = [
    { grupo: '1. Bling' },
    { id: 'bling', t: 'Atualizar do Bling depois do fim do mês', auto: syncOk, det: ultimaSync ? `última gravação: ${new Date(ultimaSync).toLocaleString('pt-BR')}` : 'nunca atualizado',
      como: 'Financeiro › Importar e classificar › Atualizar do Bling › Gravar as três fontes. Repita se mudar algo no Bling.' },
    { id: 'classificar', t: 'Classificar os lançamentos sem conta', auto: !semComp && !semCx, aba: 'lanc', det: semComp || semCx ? `${semComp} na competência e ${semCx} no caixa sem conta` : 'nenhum sem conta',
      como: 'Lançamentos › filtro "⚠ Sem classificação", nas contas a pagar e no extrato. Se uma categoria inteira está errada, corrija em Plano e regras.' },
    { id: 'rateios', t: 'Ratear compras grandes do mês (equipamento, obra) e conferir os rateios', aba: 'lanc', det: `${(d.rateios || []).filter(r => parcelaDoMes(r, d.mes)).length} rateio(s) correndo neste mês`,
      como: 'Lançamentos › botão "Ratear" na conta do Bling. Os rateios do mês aparecem no fim da aba Manuais.' },
    { grupo: '2. Receitas' },
    { id: 'rec_delivery', t: 'Deliverys e marketplace: bruto, promoções, comissão e pedidos', auto: !faltaDelivery.length, aba: 'receitas', det: faltaDelivery.length ? `sem valor: ${faltaDelivery.join(', ')}` : 'todos com valor',
      como: 'Lance o faturamento das plataformas (Importar e classificar › Faturamento das plataformas: iFood, 99, Keeta e Anota.AI por print ou planilha; Ativação e Balcão pelo botão "buscar no Mercado Pago") e use "Preencher" na aba Receitas. Keeta pelo bruto. Canal sem venda no mês: marque à mão.' },
    { id: 'rec_site', t: 'Site, clube e balcão', auto: !faltaSite.length, aba: 'receitas', det: faltaSite.length ? `sem valor: ${faltaSite.join(', ')}` : 'todos com valor',
      como: 'Site: bruto com o cupom em descontos. Balcão: Mercado Pago + PIX direto. Ativação e licenciamento, se houver.' },
    { id: 'rec_b2b', t: 'Revenda e venda direta, e os pedidos do Bling', auto: !faltaB2b.length && totalPedidos(d) > 0, aba: 'receitas',
      det: `${faltaB2b.length ? `sem valor: ${faltaB2b.join(', ')} · ` : ''}${fmt(totalPedidos(d), 0)} pedidos no mês`,
      como: 'Receitas › "Preencher o que está vazio": traz as vendas de Revenda e Venda direta e o nº de pedidos do Bling. Confira e salve.' },
    { grupo: '3. Planilhas' },
    { id: 'frete_correios', t: 'Correios: as duas faturas que cobrem o mês', auto: fr.correios.ok, aba: 'manuais', det: fr.correios.detalhe,
      como: 'Correios Empresas › Faturas › extrato analítico (.csv) da fatura que fecha dia 15 deste mês e da que fecha dia 15 do mês seguinte. Manuais › Fretes pela data do envio.' },
    { id: 'frete_lalamove', t: 'Lalamove: Order Report do mês', auto: fr.lalamove.ok, aba: 'manuais', det: fr.lalamove.detalhe,
      como: 'As corridas chamadas pelo sistema entram sozinhas ao abrir o mês, com o valor final cobrado (a API da Lalamove só enxerga essas). Se alguma corrida foi chamada pelo app (ex.: coleta em fornecedor), importe o Order Report do mês (portal › Relatórios, .xlsx) em Manuais › Fretes; não duplica.' },
    { id: 'frete_melhorenvio', t: 'Melhor Envio: relatório de envios do mês', auto: fr.melhorenvio.ok, aba: 'manuais', det: fr.melhorenvio.detalhe,
      como: 'Vem sozinho pela API do Melhor Envio ao abrir o mês (precisa do MELHORENVIO_TOKEN na Vercel). Sem o token: Melhor Envio › Relatórios › Relatório de envios do mês (.xlsx) › Manuais › Fretes. Mês sem envio: marque à mão.' },
    { id: 'midia', t: 'Meta e Google pela planilha da agência', auto: manuaisDe(/^vm\.midia$/).length > 0, aba: 'manuais', det: `${manuaisDe(/^vm\.midia$/).length} lançamento(s) de mídia`,
      como: 'Manuais › "+ Meta (planilha da agência)" e "+ Google (planilha da agência)" com o investimento do mês.' },
    { id: 'taxas', t: 'Taxas descontadas na venda (Mercado Pago, Pagar.me, Shopify, checkout)', auto: manuaisDe(/^vc\.cartao$/).length > 0, aba: 'manuais', det: `${manuaisDe(/^vc\.cartao$/).length} lançamento(s) de taxas`,
      como: 'Mercado Pago: vem sozinho ao importar o relatório de Vendas (Importar e classificar › Faturamento das plataformas); Balcão e Ativação já trazem as taxas na comissão e o Mercado Livre, pela planilha dele. Não lance a fatura do Mercado Pago: ela mistura tudo isso. Pagar.me, Shopify Payments e checkout abandonado: um lançamento manual para cada.' },
    { id: 'anuidades', t: 'Anuidades ÷ 12 e acertos sem caixa', aba: 'manuais', det: `${d.manuais.length} lançamento(s) manuais no mês`,
      como: 'Manuais › Fidelimax (4.190 ÷ 12) e acertos como o da Dark Store. Marque quando conferir.' },
    { grupo: '4. CMV' },
    { id: 'cmv', t: 'CMV fechado pelo estoque', auto: !d.cmvProvisorio && d.cmv.length > 0, aba: 'auditoria', det: d.cmvProvisorio ? 'provisório: o CMV fecha sozinho a partir do dia 5' : `${brl(c.cmv)} no CMV`,
      como: 'Depende da contagem do último dia do mês: matéria-prima e embalagem em Estoque › Conferência, e a mercadoria para revenda (Wafer) em Estoque › Produtos prontos (revenda), em displays + unidades. Compra da Wafer: registre lá mesmo (display com 12 un). Confira em Auditoria › CMV do caixa ao consumo.' },
    { id: 'mkt', t: 'Produtos que saíram sem venda (degustação, premiação, bonificação, marketing, vouchers)', auto: !!d.comp?.extras?.cmv_marketing_em, aba: 'manuais',
      det: mkt ? `${brl(mkt.reduce((t, g) => t + g.mp + g.emb, 0))} saem do CMV e vão para marketing` : 'não buscado',
      como: 'Manuais › Produtos que saíram sem venda › Buscar no Bling. Itens sem ficha aparecem em vermelho.' },
    { grupo: '5. Conferência' },
    { id: 'extratos', t: 'Importar o extrato do mês de cada conta (corrente e investimentos)', auto: extratos != null && contasBanco.length > 0 && !semExtrato.length, aba: 'auditoria',
      det: extratos == null ? 'verificando…' : !contasBanco.length ? 'nenhuma conta no caixa do mês' : semExtrato.length ? `sem extrato: ${semExtrato.join(', ')}` : 'todas as contas com extrato',
      como: 'Auditoria › Importar extrato do banco: C6 › Exportar Excel; Inter › Extrato › CSV; outros bancos e investimentos em Excel, CSV ou OFX (com data, valor e saldo). Pegue do dia 1 ao último dia do mês (pode ser um período maior: reimportar não duplica) e escolha a conta do Bling de cada arquivo. O saldo do último dia vai sozinho para os saldos. Conta sem movimento no mês: marque à mão.' },
    { id: 'extrato_bling', t: 'Extrato do banco × caixa do Bling: nada faltando', auto: confExt.length > 0 && !semExtrato.length && !extDif.length, aba: 'auditoria',
      det: !confExt.length ? 'importe os extratos primeiro' : extDif.length ? `diferença: ${extDif.map(x => `${x.conta} ${brl(x.liquida)}`).join(' · ')}` : 'todas as contas batem',
      como: 'Auditoria › Extratos dos bancos × Bling: abra a conta com diferença e veja as linhas "Só no banco" (lançar no Bling) e "Só no Bling" (conferir ou apagar no Bling). Fatura de cartão e repasses semanais aparecem dos dois lados quando a soma não fecha. Depois de corrigir no Bling, Atualizar do Bling de novo.' },
    { id: 'saldos', t: 'Saldos dos bancos batem com o Bling', auto: bancosOk, aba: 'auditoria', det: bancosOk ? 'todas as contas conferem' : 'lance os saldos do fim do mês e do anterior',
      como: 'Os saldos do fim do mês vêm do extrato importado no passo acima (Auditoria › saldos por conta). Conta sem arquivo: digite o saldo do extrato do último dia. Se não bater, o passo de cima mostra o lançamento que falta.' },
    ...(d.mes >= PROVA_DESDE ? [{ id: 'prova', t: 'Prova da competência: "não explicado" = 0', aba: 'auditoria', det: 'saldos a receber e das carteiras no fim do mês + cálculo no Bling',
      como: 'Auditoria › Prova da competência: lance o a receber de cada plataforma e o saldo das carteiras no último dia do mês (o do mês anterior já vem), clique em "Calcular a pagar e a receber no Bling" e salve. Se sobrar diferença, ela aponta um erro na competência: procure na ponte. Marque quando zerar.' }] : []),
    { id: 'ponte', t: 'Revisar a ponte competência → caixa e a DRE', aba: 'auditoria', det: `lucro por competência ${brl(c.ll)} · resultado de caixa ${brl(p.resCx)}`,
      como: 'Auditoria › abra as linhas com diferença grande e veja se o motivo faz sentido. Depois olhe a DRE linha a linha. Marque quando estiver ok.' },
  ]
  const passos = PASSOS.filter(x => x.id).map(x => ({ ...x, manual: marcados[x.id] || null, ok: !!x.auto || !!marcados[x.id] }))
  const prontos = passos.filter(x => x.ok).length
  async function marcar(id, valor) {
    const extras = { ...(d.comp?.extras || {}), passos: { ...marcados } }
    if (valor) extras.passos[id] = { por: usuario().nome || null, em: new Date().toISOString() }; else delete extras.passos[id]
    const { error } = await supabase.from('dre_mes').upsert({ mes: d.mes, visao: 'competencia', extras, atualizado_em: new Date().toISOString() }, { onConflict: 'mes,visao' })
    if (error) alert(erroMsg(error)); else onSalvo()
  }
  async function fechar() {
    if (!window.confirm(`Fechar ${rotuloMes(d.mes)}?\n\nReceitas, manuais, saldos, fretes e os lançamentos do Bling deste mês ficam travados. Só um administrador reabre.${prontos < passos.length ? `\n\nAtenção: ${passos.length - prontos} passo(s) ainda sem ✓.` : ''}`)) return
    const agora = new Date().toISOString(), quem = usuario().nome || null
    for (const visao of ['competencia', 'caixa']) {
      const { error } = await supabase.from('dre_mes').upsert({ mes: d.mes, visao, fechado_em: agora, fechado_por: quem, valores: visao === 'competencia' ? { ...c, gravado_em: agora } : calcular(vx, d.plano), atualizado_em: agora }, { onConflict: 'mes,visao' })
      if (error) { alert(erroMsg(error)); return }
    }
    onSalvo()
  }
  async function reabrir() {
    if (!window.confirm(`Reabrir ${rotuloMes(d.mes)}? Os números poderão mudar.`)) return
    for (const visao of ['competencia', 'caixa']) {
      const { error } = await supabase.from('dre_mes').update({ fechado_em: null, fechado_por: null }).eq('mes', d.mes).eq('visao', visao)
      if (error) { alert(erroMsg(error)); return }
    }
    onSalvo()
  }
  const [aberto, setAberto] = useState(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 900 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800 }}>{prontos} de {passos.length} passos com ✓</div>
          <div style={{ height: 6, background: 'var(--gray-100)', borderRadius: 3, marginTop: 6 }}><div style={{ height: 6, width: `${prontos / passos.length * 100}%`, background: 'var(--ok)', borderRadius: 3 }} /></div>
        </div>
        <div style={{ fontSize: 13 }}>lucro líquido <b>{brl(c.ll)}</b> · EBITDA <b>{brl(c.ebitda)}</b></div>
      </div>
      <div className="card">
        {PASSOS.map(x => {
          if (x.grupo) return <div key={x.grupo} style={{ padding: '8px 14px', fontWeight: 800, fontSize: 12, background: 'var(--gray-50)', borderTop: '1px solid var(--gray-100)' }}>{x.grupo}</div>
          const s = passos.find(y => y.id === x.id)
          return <div key={x.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px' }}>
              <span style={{ fontSize: 18, width: 18, color: s.ok ? 'var(--ok)' : 'var(--warning)' }}>{s.ok ? '✓' : '○'}</span>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setAberto(a => a === x.id ? null : x.id)}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{x.t} <span style={{ fontWeight: 400, color: 'var(--gray-400)', fontSize: 11 }}>{aberto === x.id ? '▾ como fazer' : '▸ como fazer'}</span></div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{x.det}{!x.auto && s.manual ? ` · marcado por ${s.manual.por || '—'} em ${new Date(s.manual.em).toLocaleDateString('pt-BR')}` : ''}</div>
              </div>
              {x.aba && <button className="btn btn-ghost btn-sm" onClick={() => irPara(x.aba)}>Abrir</button>}
              {!fechado && !x.auto && <label style={{ fontSize: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!s.manual} onChange={e => marcar(x.id, e.target.checked)} /> feito</label>}
            </div>
            {aberto === x.id && <div style={{ padding: '0 14px 10px 42px', fontSize: 12, color: 'var(--gray-600)' }}>{x.como}</div>}
          </div>
        })}
      </div>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, fontSize: 13 }}><b>6. Fechar o mês.</b> O cadeado trava competência e caixa e guarda os totais.</div>
        {ehAdmin() && (fechado
          ? <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={reabrir}><LockOpen size={14} /> Reabrir mês</button>
          : <button className="btn btn-primary" onClick={fechar}><Lock size={14} /> Fechar {rotuloMes(d.mes)}</button>)}
      </div>
    </div>
  )
}
