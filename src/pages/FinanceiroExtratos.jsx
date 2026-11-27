import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, Upload } from 'lucide-react'
import { lerExtrato, conciliarExtrato } from '../lib/extratoBanco'
import { sinalCaixa } from '../lib/dreLaricas'

// Financeiro › DRE › Auditoria: extratos dos bancos (conta corrente e investimentos).
// Importar: guarda as linhas do extrato (dre_extrato_banco) e grava o saldo de cada fim de mês em dre_saldos
// (mês fechado não muda). Conferir: cada linha do banco no mês × caixa do Bling da mesma conta.

const fmt = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const brl = v => (v < 0 ? '−' : '') + 'R$ ' + fmt(Math.abs(v))
const dt = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '—'
const dtc = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—'
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = m => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`
const usuario = () => { try { return JSON.parse(sessionStorage.getItem('usuario')) || {} } catch { return {} } }
const CHAVE_CONTAS = 'dre_extrato_contas'   // nº da conta no extrato → conta no Bling
const faltaSQL = e => /dre_extrato_banco|does not exist|schema cache|42P01/i.test(e?.message || '')
const erroMsg = e => faltaSQL(e) ? 'Aplique o dre_extratos.sql no Supabase.' : (e?.message || String(e))
const somar = xs => xs.reduce((t, x) => t + (+x.valor), 0)
const addDias = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10)
const ultimoDia = mes => { const [a, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}` }

async function lerTudo(montar) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

// ── Importar ──
function Importar({ contas, onGravado }) {
  const [arqs, setArqs] = useState([])        // [{ nome, ext, conta, erro, saldos: {mes: saldo lançado}, fechados: Set }]
  const [mapa, setMapa] = useState({})
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    supabase.from('configuracoes').select('valor').eq('chave', CHAVE_CONTAS).maybeSingle()
      .then(({ data }) => { try { setMapa(JSON.parse(data?.valor || '{}')) } catch { /* vazio */ } })
  }, [])

  async function situacaoDe(conta, meses) {
    if (!conta || !meses.length) return { saldos: {}, fechados: new Set() }
    const [{ data: s }, { data: f }] = await Promise.all([
      supabase.from('dre_saldos').select('mes, saldo').eq('conta', conta).in('mes', meses),
      supabase.from('dre_mes').select('mes').in('mes', meses).not('fechado_em', 'is', null)])
    return { saldos: Object.fromEntries((s || []).map(x => [x.mes, +x.saldo])), fechados: new Set((f || []).map(x => x.mes)) }
  }
  async function escolher(files) {
    setMsg(null); setOcupado('Lendo…')
    const novos = []
    for (const f of files) {
      try {
        const ext = await lerExtrato(f.name, await f.arrayBuffer())
        const conta = mapa[ext.id] || ''
        novos.push({ nome: f.name, ext, conta, ...(await situacaoDe(conta, ext.meses.map(m => m.mes))) })
      } catch (e) { novos.push({ nome: f.name, erro: e.message }) }
    }
    setArqs(novos); setOcupado('')
  }
  async function trocarConta(i, conta) {
    const a = arqs[i]
    const sit = await situacaoDe(conta, a.ext.meses.map(m => m.mes))
    setArqs(as => as.map((x, j) => j === i ? { ...x, conta, ...sit } : x))
  }
  async function gravar() {
    setMsg(null)
    const prontos = arqs.filter(a => a.ext && a.conta)
    if (!prontos.length) return setMsg({ tipo: 'warning', txt: 'Escolha a conta do Bling de cada extrato.' })
    try {
      const quem = usuario().nome || null, em = new Date().toISOString()
      let nLinhas = 0, nSaldos = 0
      const novoMapa = { ...mapa }
      for (const a of prontos) {
        setOcupado(`Gravando ${a.nome}…`)
        const rows = a.ext.linhas.map(l => ({ conta: a.conta, chave: l.chave, mes: l.data.slice(0, 7), data: l.data, valor: l.valor, descricao: l.descricao.slice(0, 300), arquivo: a.nome.slice(0, 120), por: quem, em }))
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from('dre_extrato_banco').upsert(rows.slice(i, i + 500), { onConflict: 'conta,chave' })
          if (error) throw error
        }
        nLinhas += rows.length
        const saldos = a.ext.meses.filter(m => !a.fechados.has(m.mes) && (a.saldos[m.mes] == null || Math.abs(a.saldos[m.mes] - m.saldo) >= 0.005))
          .map(m => ({ mes: m.mes, conta: a.conta, saldo: m.saldo, por: quem, em }))
        if (saldos.length) {
          const { error } = await supabase.from('dre_saldos').upsert(saldos, { onConflict: 'mes,conta' })
          if (error) throw error
        }
        nSaldos += saldos.length
        novoMapa[a.ext.id] = a.conta
      }
      await supabase.from('configuracoes').upsert({ chave: CHAVE_CONTAS, valor: JSON.stringify(novoMapa),
        descricao: 'Extratos dos bancos: nº da conta no extrato → conta no Bling (Financeiro › DRE › Auditoria).', atualizado_em: em }, { onConflict: 'chave' })
      setMapa(novoMapa); setArqs([])
      setMsg({ tipo: 'ok', txt: `${nLinhas} linhas guardadas; ${nSaldos} saldo(s) de fim de mês gravados.` })
      onGravado()
    } catch (e) { setMsg({ tipo: 'danger', txt: erroMsg(e) }) }
    setOcupado('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={13} /> Importar extrato do banco
          <input type="file" multiple accept=".ofx,.csv,.xlsx,.txt" style={{ display: 'none' }} onChange={e => { escolher([...e.target.files]); e.target.value = '' }} />
        </label>
        <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>OFX, CSV ou Excel (.xlsx) de qualquer período, um ou vários arquivos. C6: Extrato › Exportar Excel · Inter: Extrato › Exportar CSV.
          O saldo de cada fim de mês coberto pelo extrato vai para a tabela acima (mês fechado não muda).</span>
      </div>
      {arqs.map((a, i) => a.erro
        ? <div key={i} className="alert-banner danger"><b>{a.nome}:</b> {a.erro}</div>
        : <div key={i} style={{ border: '1px solid var(--gray-100)', borderRadius: 8, padding: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>{a.nome}</b>
            <span style={{ color: 'var(--gray-500)' }}>{a.ext.banco} conta {a.ext.conta || '?'} · {dtc(a.ext.de)} a {dtc(a.ext.ate)} · {a.ext.linhas.length} linhas</span>
            <span style={{ flex: 1 }} />
            <span>Conta no Bling:</span>
            <select className="form-input" style={{ width: 'auto' }} value={a.conta} onChange={e => trocarConta(i, e.target.value)}>
              <option value="">escolha…</option>
              {contas.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {a.ext.saldoIni == null
            ? <div className="alert-banner warning" style={{ marginTop: 6 }}>Este arquivo não traz o saldo (o OFX do C6, por exemplo): as linhas servem para a conferência, mas os saldos de fim de mês não. Para os saldos, use o Excel ou CSV do banco.</div>
            : a.ext.meses.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 6 }}>O extrato não chega ao último dia de nenhum mês: só as linhas serão guardadas.</div>
              : <table style={{ fontSize: 12, marginTop: 6 }}><thead><tr><th>Fim de</th><th style={{ textAlign: 'right' }}>Saldo no extrato</th><th style={{ textAlign: 'right' }}>Lançado no sistema</th><th /></tr></thead><tbody>
                {a.ext.meses.map(m => {
                  const lanc = a.saldos[m.mes], igual = lanc != null && Math.abs(lanc - m.saldo) < 0.005
                  return <tr key={m.mes}><td>{rotuloMes(m.mes)}</td><td style={{ textAlign: 'right' }}>{brl(m.saldo)}</td>
                    <td style={{ textAlign: 'right' }}>{lanc == null ? '—' : brl(lanc)}</td>
                    <td style={{ color: igual ? 'var(--ok)' : a.fechados.has(m.mes) ? 'var(--danger)' : 'var(--gray-600)' }}>
                      {!a.conta ? '' : igual ? '✓ igual' : a.fechados.has(m.mes) ? `mês fechado: não muda${lanc != null ? ` (diferença ${brl(m.saldo - lanc)})` : ''}` : lanc == null ? 'será gravado' : `será trocado (${brl(m.saldo - lanc)})`}</td></tr>
                })}
              </tbody></table>}
          <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>Saldo calculado: {a.ext.como || '—'}.</div>
        </div>)}
      {arqs.some(a => a.ext) && <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={gravar} disabled={!!ocupado}><Save size={13} /> Gravar extratos</button>}
      {ocupado && <span style={{ fontSize: 12 }}><RefreshCw size={12} className="spin" /> {ocupado}</span>}
      {msg && <div className={`alert-banner ${msg.tipo}`}>{msg.txt}</div>}
    </div>
  )
}

// ── Conferir: banco × Bling no mês ──
function ListaLinhas({ titulo, linhas, vazio, campos }) {
  return <div>
    <b style={{ fontSize: 12 }}>{titulo} ({linhas.length}{linhas.length ? ` · ${brl(somar(linhas))}` : ''})</b>
    {linhas.length ? <table style={{ width: '100%', fontSize: 12 }}><tbody>
      {linhas.map((l, i) => <tr key={i}><td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>{dt(l.data)}</td><td style={{ padding: '2px 6px' }}>{campos(l)}</td>
        <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: l.valor < 0 ? 'var(--danger)' : undefined }}>{brl(+l.valor)}</td></tr>)}
    </tbody></table> : <div style={{ fontSize: 12, color: 'var(--ok)' }}>{vazio}</div>}
  </div>
}

export default function ExtratosBanco({ d, contas, onSalvo }) {
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState(null)
  const ini = `${d.mes}-01`, fim = ultimoDia(d.mes)
  async function carregar() {
    setErro('')
    try {
      setLinhas(await lerTudo(() => supabase.from('dre_extrato_banco').select('conta, data, valor, descricao')
        .gte('data', addDias(ini, -5)).lte('data', addDias(fim, 5)).order('data').order('chave')))
    } catch (e) { setErro(erroMsg(e)); setLinhas([]) }
  }
  useEffect(() => { carregar() }, [d.mes])   // eslint-disable-line react-hooks/exhaustive-deps

  const porConta = useMemo(() => {
    if (!linhas) return []
    const nomes = [...new Set(linhas.filter(l => l.data >= ini && l.data <= fim).map(l => l.conta))].sort()
    return nomes.map(conta => {
      const banco = linhas.filter(l => l.conta === conta).map(l => ({ ...l, valor: +l.valor }))
      const bling = d.caixa.filter(l => l.banco === conta).map(l => ({ data: l.data, valor: Math.round(sinalCaixa(l) * (+l.valor) * 100) / 100, nome: l.nome, historico: l.historico, categoria: l.categoria }))
      const c = conciliarExtrato(banco, bling)
      const doMes = x => x.data >= ini && x.data <= fim
      const bancoMes = banco.filter(doMes)
      return { conta, nBanco: bancoMes.length, nBling: bling.length, movBanco: somar(bancoMes), movBling: somar(bling),
        soBanco: c.soBanco.filter(doMes), soBling: c.soBling, casados: c.pares.filter(p => doMes(p.banco)).length + c.grupos.reduce((t, g) => t + g.banco.filter(doMes).length, 0), grupos: c.grupos.length }
    })
  }, [linhas, d.caixa, ini, fim])

  return (
    <div className="card">
      <div style={{ padding: '10px 14px', fontWeight: 800, borderBottom: '1px solid var(--gray-100)' }}>Extratos dos bancos × Bling em {rotuloMes(d.mes)}
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-500)' }}> (cada linha do extrato do banco casada com um lançamento do Bling de mesmo valor, até 4 dias de diferença na data)</span></div>
      <Importar contas={contas} onGravado={() => { carregar(); onSalvo() }} />
      {erro && <div className="alert-banner danger" style={{ margin: 10 }}>{erro}</div>}
      {linhas == null ? <div style={{ padding: 10 }}><RefreshCw size={13} className="spin" /> Extratos…</div>
        : !porConta.length ? <div style={{ padding: '0 14px 12px', fontSize: 13, color: 'var(--gray-500)' }}>Nenhum extrato importado com linhas em {rotuloMes(d.mes)}.</div>
          : <div className="tbl-wrap"><table>
            <thead><tr><th>Conta</th><th style={{ textAlign: 'right' }}>Linhas no banco</th><th style={{ textAlign: 'right' }}>No Bling</th><th style={{ textAlign: 'right' }}>Casadas</th>
              <th style={{ textAlign: 'right' }}>Só no banco (falta no Bling)</th><th style={{ textAlign: 'right' }}>Só no Bling (não está no banco)</th><th style={{ textAlign: 'right' }}>Diferença líquida</th></tr></thead>
            <tbody>{porConta.flatMap(c => {
              const ok = !c.soBanco.length && !c.soBling.length, ab = aberta === c.conta
              const r = [<tr key={c.conta} onClick={() => setAberta(ab ? null : c.conta)} style={{ cursor: 'pointer' }}>
                <td>{ab ? '▾ ' : '▸ '}{c.conta}</td><td style={{ textAlign: 'right' }}>{c.nBanco}</td><td style={{ textAlign: 'right' }}>{c.nBling}</td><td style={{ textAlign: 'right' }}>{c.casados}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: c.soBanco.length ? 'var(--danger)' : 'var(--ok)' }}>{c.soBanco.length ? `${c.soBanco.length} · ${brl(somar(c.soBanco))}` : '✓'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: c.soBling.length ? 'var(--danger)' : 'var(--ok)' }}>{c.soBling.length ? `${c.soBling.length} · ${brl(somar(c.soBling))}` : '✓'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }} title="só no banco − só no Bling: é o que falta (ou sobra) no caixa do Bling">{brl(somar(c.soBanco) - somar(c.soBling))}</td></tr>]
              if (ab) r.push(<tr key={c.conta + ':d'}><td colSpan={7} style={{ background: 'var(--gray-50)' }}>
                {ok ? <div style={{ fontSize: 12, color: 'var(--ok)' }}>✓ Todas as linhas do banco estão no Bling e vice-versa.</div> : <>
                  <div style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 6 }}>
                    Movimento no banco {brl(c.movBanco)} × no Bling {brl(c.movBling)}. Um lançamento do Bling que junta várias linhas do banco (ou o contrário)
                    aparece dos dois lados: confira se as somas batem antes de lançar algo.{c.grupos ? ` ${c.grupos} grupo(s) já casados pela soma (ex.: iFood da semana, fatura do cartão).` : ''}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 10 }}>
                    <ListaLinhas titulo="Só no banco" linhas={c.soBanco} vazio="nada" campos={l => l.descricao} />
                    <ListaLinhas titulo="Só no Bling" linhas={c.soBling} vazio="nada" campos={l => [l.nome, l.categoria, l.historico].filter(Boolean).join(' · ')} />
                  </div></>}
              </td></tr>)
              return r
            })}</tbody>
          </table></div>}
    </div>
  )
}
