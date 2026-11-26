import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, Download } from 'lucide-react'
import { GRUPOS, carregarMes, montar, calcular } from '../lib/dreLaricas'
import { baixarXlsx } from '../lib/xlsx'

// Financeiro › DRE › Ano: a DRE de cada mês do ano lado a lado (competência ou caixa), e a conferência do caixa
// com o Bling de hoje, lançamento por lançamento (o que falta, o que sobra e o que mudou de valor).

const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const brl = v => (v < 0 ? '−' : '') + fmt(Math.abs(v))
const pct = v => isFinite(v) ? fmt(v * 100, 1) + '%' : '—'
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const dormir = ms => new Promise(ok => setTimeout(ok, ms))
async function chamarFin(corpo) {
  const r = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || (r.status === 404 ? 'Função do financeiro não encontrada (só no site publicado).' : `Erro ${r.status}`))
  return j
}

// Linhas da DRE: totais (k = chave do calcular) e grupos de contas (g)
const ESTRUTURA = [
  { g: 'rec' }, { t: 'Faturamento bruto', k: 'bruta' }, { g: 'ded' }, { t: 'Faturamento líquido', k: 'liq' },
  { g: 'cmv' }, { t: 'Lucro bruto', k: 'lb' }, { g: 'vc' }, { t: 'Margem de contribuição', k: 'mc' },
  { g: 'vm' }, { g: 'vo' }, { t: 'Margem de contribuição líquida', k: 'mcl' },
  { g: 'fo' }, { g: 'fa' }, { g: 'fm' }, { g: 'fc' }, { t: 'Total de despesas fixas', k: 'fixas', neg: true },
  { t: 'EBITDA', k: 'ebitda' }, { g: 'fin' }, { g: 'inv' }, { t: 'Lucro líquido', k: 'll' },
]
const INDICADORES = [['CMV % do fat. líquido', c => c.cmv / c.liq], ['CMO % do fat. líquido', c => c.cmo / c.liq],
  ['Margem de contribuição %', c => c.mc / c.liq], ['EBITDA %', c => c.ebitda / c.liq], ['Lucro líquido %', c => c.ll / c.liq]]

export default function FinanceiroAno({ ano }) {
  const [visao, setVisao] = useState('competencia')
  const [meses, setMeses] = useState([])        // [{ mes, d, comp, cx }]
  const [carregando, setCarregando] = useState('')
  const [erro, setErro] = useState('')
  const [abertos, setAbertos] = useState(new Set())
  const [conf, setConf] = useState({})           // mes → resultado da conferência com o Bling
  const [conferindo, setConferindo] = useState('')
  const lista = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 7)
    return MESES.map((_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`).filter(m => m <= hoje)
  }, [ano])

  async function carregar() {
    setErro(''); setMeses([])
    const out = []
    try {
      for (let i = 0; i < lista.length; i += 3) {
        setCarregando(`Carregando ${i + 1}–${Math.min(i + 3, lista.length)} de ${lista.length} meses…`)
        const parte = await Promise.all(lista.slice(i, i + 3).map(async mes => {
          const d = await carregarMes(mes, { semProvisorio: true })
          const vc = montar(d, 'competencia'), vx = montar(d, 'caixa')
          return { mes, d, vc, vx, comp: calcular(vc, d.plano), cx: calcular(vx, d.plano) }
        }))
        out.push(...parte); setMeses([...out])
      }
    } catch (e) { setErro(e.message || String(e)) }
    setCarregando('')
  }
  useEffect(() => { carregar() }, [ano])   // eslint-disable-line react-hooks/exhaustive-deps

  async function conferir() {
    setConferindo('')
    for (const m of meses) {
      setConferindo(`Conferindo ${MESES[+m.mes.slice(5) - 1]} com o Bling…`)
      let r
      for (let t = 0; t < 6; t++) {
        try { r = await chamarFin({ acao: 'resumoCaixa', mes: m.mes }) } catch (e) { r = { erro: e.message }; break }
        if (!r.pausa) break
        setConferindo(`O Bling pediu uma pausa (${MESES[+m.mes.slice(5) - 1]}), continuando…`); await dormir(4000)
      }
      if (r.erro || r.pausa) { setConf(c => ({ ...c, [m.mes]: { erro: r.erro || 'o Bling não respondeu' } })); continue }
      const bling = Object.fromEntries(r.lancamentos.map(l => [String(l.id), l]))
      const sis = Object.fromEntries(m.d.caixa.filter(l => l.id_bling).map(l => [String(l.id_bling), l]))
      const faltam = r.lancamentos.filter(l => !sis[String(l.id)])
      const sobram = m.d.caixa.filter(l => l.id_bling && !bling[String(l.id_bling)])
      const semId = m.d.caixa.filter(l => !l.id_bling).length
      const mudou = m.d.caixa.filter(l => { const b = bling[String(l.id_bling)]; return b && Math.abs(+b.valor - +l.valor) >= 0.01 })
      const saldo = ls => ls.reduce((t, l) => t + (l.credito ?? (l.tipo === 'receita' || /entrada/i.test(l.categoria || '')) ? 1 : -1) * +l.valor, 0)
      setConf(c => ({ ...c, [m.mes]: { n: r.lancamentos.length, nSis: m.d.caixa.length, faltam, sobram, mudou, semId,
        movBling: saldo(r.lancamentos), movSis: saldo(m.d.caixa) } }))
    }
    setConferindo('')
  }

  const chave = visao === 'competencia' ? 'comp' : 'cx'
  const vk = visao === 'competencia' ? 'vc' : 'vx'
  const plano = meses[0]?.d.plano || []
  const soma = f => meses.reduce((t, m) => t + (f(m) || 0), 0)
  const total = k => soma(m => m[chave][k])
  const alternar = g => setAbertos(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n })
  const valorConta = (m, id, sinal) => (m[vk][id]?.valor || 0) * sinal

  const linhas = []
  for (const e of ESTRUTURA) {
    if (e.t) {
      const s = e.neg ? -1 : 1
      linhas.push(<tr key={e.k} style={{ fontWeight: 800, background: 'var(--purple-pale)', color: 'var(--purple)' }}>
        <td>{e.t}</td>{meses.map(m => <td key={m.mes} style={{ textAlign: 'right', color: s * m[chave][e.k] < 0 ? 'var(--danger)' : undefined }}>{brl(s * m[chave][e.k])}</td>)}
        <td style={{ textAlign: 'right' }}>{brl(s * total(e.k))}</td></tr>)
      continue
    }
    const g = GRUPOS.find(x => x.id === e.g), contas = plano.filter(p => p.grupo === e.g)
    const sinal = id => id === 'fin.desp' ? -1 : g.sinal
    const doGrupo = m => contas.reduce((t, p) => t + valorConta(m, p.id, sinal(p.id)), 0) + (e.g === 'vo' ? -(m[vk]._sem?.valor || 0) : 0) + (e.g === 'rec' ? (m[vk]._semrec?.valor || 0) : 0)
    if (!meses.some(m => doGrupo(m))) continue
    const ab = abertos.has(e.g)
    linhas.push(<tr key={'g' + e.g} onClick={() => alternar(e.g)} style={{ cursor: 'pointer', fontWeight: 700, background: 'var(--gray-50)' }}>
      <td>{ab ? '▾ ' : '▸ '}{g.nome}</td>{meses.map(m => <td key={m.mes} style={{ textAlign: 'right' }}>{doGrupo(m) ? brl(doGrupo(m)) : '—'}</td>)}
      <td style={{ textAlign: 'right' }}>{brl(soma(doGrupo))}</td></tr>)
    if (ab) for (const p of contas) {
      if (!meses.some(m => valorConta(m, p.id, 1))) continue
      linhas.push(<tr key={p.id}><td style={{ paddingLeft: 26, fontSize: 12 }}>{p.nome}</td>
        {meses.map(m => <td key={m.mes} style={{ textAlign: 'right', fontSize: 12 }}>{valorConta(m, p.id, 1) ? brl(valorConta(m, p.id, sinal(p.id))) : '—'}</td>)}
        <td style={{ textAlign: 'right', fontSize: 12 }}>{brl(soma(m => valorConta(m, p.id, sinal(p.id))))}</td></tr>)
    }
  }
  const totalAno = Object.fromEntries(['liq', 'cmv', 'cmo', 'mc', 'ebitda', 'll'].map(k => [k, total(k)]))

  function exportar() {
    const rows = []
    for (const e of ESTRUTURA) {
      if (e.t) { rows.push({ linha: e.t, ...Object.fromEntries(meses.map(m => [m.mes, (e.neg ? -1 : 1) * m[chave][e.k]])), ano: (e.neg ? -1 : 1) * total(e.k) }); continue }
      const g = GRUPOS.find(x => x.id === e.g)
      for (const p of plano.filter(p => p.grupo === e.g)) {
        const s = p.id === 'fin.desp' ? -1 : g.sinal
        if (!meses.some(m => valorConta(m, p.id, 1))) continue
        rows.push({ linha: `${g.nome} › ${p.nome}`, ...Object.fromEntries(meses.map(m => [m.mes, valorConta(m, p.id, s)])), ano: soma(m => valorConta(m, p.id, s)) })
      }
    }
    baixarXlsx({ nomeArquivo: `DRE_${visao}_${ano}`, aba: String(ano), linhas: rows, colunas: [
      { header: 'Linha', key: 'linha', tipo: 'texto', largura: 50 },
      ...meses.map(m => ({ header: `${MESES[+m.mes.slice(5) - 1]}/${ano}`, key: m.mes, tipo: 'moeda', largura: 13 })),
      { header: `Total ${ano}`, key: 'ano', tipo: 'moeda', largura: 15 }] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>DRE de {ano}</b>
        <button className={`btn btn-sm ${visao === 'competencia' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setVisao('competencia')}>Competência</button>
        <button className={`btn btn-sm ${visao === 'caixa' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setVisao('caixa')}>Caixa</button>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--gray-500)' }}>{carregando || 'Clique num grupo para abrir as contas. Valores em R$.'}</span>
        <button className="btn btn-ghost btn-sm" onClick={carregar} disabled={!!carregando}><RefreshCw size={13} className={carregando ? 'spin' : ''} /></button>
        <button className="btn btn-ghost btn-sm" onClick={exportar} disabled={!meses.length}><Download size={13} /> Excel</button>
      </div>
      {erro && <div className="alert-banner danger">{erro}</div>}
      {meses.length > 0 && <div className="card tbl-wrap"><table style={{ minWidth: 300 + meses.length * 95, fontSize: 13 }}>
        <thead><tr><th>Linha</th>{meses.map(m => <th key={m.mes} style={{ textAlign: 'right' }}>
          {MESES[+m.mes.slice(5) - 1]}{m.d.comp?.fechado_em ? ' 🔒' : ''}</th>)}<th style={{ textAlign: 'right' }}>Total</th></tr></thead>
        <tbody>
          {visao === 'competencia' && <tr><td style={{ fontSize: 11, color: 'var(--gray-500)' }}>Situação</td>{meses.map(m => <td key={m.mes} style={{ textAlign: 'right', fontSize: 10, color: 'var(--warning, #b45309)' }}>
            {[!m.d.receitas.length && 'sem receitas', (!m.d.cmv.length || m.d.cmvProvisorio) && 'CMV não fechado'].filter(Boolean).join(' · ')}</td>)}<td /></tr>}
          {linhas}
          {INDICADORES.map(([nome, f]) => <tr key={nome} style={{ fontSize: 12, color: 'var(--gray-600)' }}><td>{nome}</td>
            {meses.map(m => <td key={m.mes} style={{ textAlign: 'right' }}>{m[chave].liq ? pct(f(m[chave])) : '—'}</td>)}
            <td style={{ textAlign: 'right' }}>{totalAno.liq ? pct(f(totalAno)) : '—'}</td></tr>)}
        </tbody>
      </table></div>}
      {visao === 'competencia' && meses.length > 0 && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
        Meses sem receitas lançadas ou sem CMV fechado aparecem incompletos na competência: o caixa vale para todos os meses.</div>}

      {meses.length > 0 && <div className="card">
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}><b>Caixa × Bling</b> <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            (busca o extrato de cada mês no Bling de hoje e compara lançamento por lançamento com o que está no sistema)</span></div>
          <button className="btn btn-primary btn-sm" onClick={conferir} disabled={!!conferindo}><RefreshCw size={13} className={conferindo ? 'spin' : ''} /> {conferindo || 'Conferir o ano com o Bling'}</button>
        </div>
        {Object.keys(conf).length > 0 && <div className="tbl-wrap"><table style={{ fontSize: 13 }}>
          <thead><tr><th>Mês</th><th style={{ textAlign: 'right' }}>Lançamentos Bling / sistema</th><th style={{ textAlign: 'right' }}>Movimento Bling</th><th style={{ textAlign: 'right' }}>Movimento sistema</th><th>Diferenças</th></tr></thead>
          <tbody>{meses.filter(m => conf[m.mes]).map(m => {
            const c = conf[m.mes]
            if (c.erro) return <tr key={m.mes}><td>{MESES[+m.mes.slice(5) - 1]}</td><td colSpan={4} style={{ color: 'var(--danger)' }}>{c.erro}</td></tr>
            const ok = !c.faltam.length && !c.sobram.length && !c.mudou.length
            return <tr key={m.mes}>
              <td>{MESES[+m.mes.slice(5) - 1]}</td><td style={{ textAlign: 'right' }}>{c.n} / {c.nSis}</td>
              <td style={{ textAlign: 'right' }}>{brl(c.movBling)}</td><td style={{ textAlign: 'right' }}>{brl(c.movSis)}</td>
              <td style={{ fontSize: 12 }}>{ok ? <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓ igual ao Bling</span> : <>
                {c.faltam.length > 0 && <div style={{ color: 'var(--danger)' }}>Faltam no sistema ({c.faltam.length}): {c.faltam.slice(0, 6).map(l => `${l.data.slice(8, 10)}/${l.data.slice(5, 7)} ${l.nome || l.banco} ${l.credito ? '+' : '−'}${fmt(l.valor, 2)}`).join(' · ')}{c.faltam.length > 6 ? ' …' : ''}</div>}
                {c.sobram.length > 0 && <div style={{ color: 'var(--danger)' }}>No sistema e não mais no Bling ({c.sobram.length}): {c.sobram.slice(0, 6).map(l => `${l.data.slice(8, 10)}/${l.data.slice(5, 7)} ${l.nome || l.categoria} ${fmt(+l.valor, 2)}`).join(' · ')}{c.sobram.length > 6 ? ' …' : ''}</div>}
                {c.mudou.length > 0 && <div style={{ color: 'var(--warning, #b45309)' }}>Valor mudou no Bling ({c.mudou.length})</div>}
                <div style={{ color: 'var(--gray-500)' }}>Para corrigir: Importar e classificar › Atualizar do Bling (período que inclui o mês) › Gravar o caixa.</div>
              </>}{c.semId > 0 && <div style={{ color: 'var(--gray-500)' }}>{c.semId} lançamento(s) sem id do Bling (importados por arquivo)</div>}</td>
            </tr>
          })}</tbody>
        </table></div>}
      </div>}
    </div>
  )
}
