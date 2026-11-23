import { useState, useEffect, Fragment } from 'react'
import { RefreshCw } from 'lucide-react'
import { MENU } from '../lib/menu'
import { TAREFAS, carregarAcompanhamento, rotuloData } from '../lib/tarefas'

// Admin › Acompanhamento de tarefas: as tarefas da página Hoje de todas as áreas nos últimos dias
// trabalhados — feita (sozinha ou à mão), por quem e a que horas, ou pendente.
const hora = ts => ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
const dataHora = ts => ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const primeiroNome = s => String(s || '').split(/[ ,/]/)[0]

function Celula({ l, dia, hoje }) {
  if (!l) return <td style={{ textAlign: 'center', color: 'var(--gray-200)' }}>—</td>
  const pendenteHoje = !l.feito && dia === hoje && !l.atrasada
  const cor = l.feito ? (l.auto ? 'var(--ok)' : '#2563eb') : pendenteHoje ? 'var(--warning)' : 'var(--danger)'
  const fundo = l.feito ? (l.auto ? '#eef8ee' : '#eef3fd') : pendenteHoje ? '#fff8f0' : '#fff1f1'
  const titulo = [l.titulo, l.detalhe,
    l.feito ? `${l.auto ? 'Feita' : 'Marcada à mão'}${l.por ? ` por ${l.por}` : ''}${l.em ? ` em ${dataHora(l.em)}` : ''}` : (pendenteHoje ? 'Pendente hoje' : 'Não feita'),
  ].filter(Boolean).join('\n')
  return (
    <td title={titulo} style={{ textAlign: 'center', background: fundo, padding: '6px 4px', minWidth: 74, cursor: 'help' }}>
      <div style={{ fontWeight: 800, color: cor, fontSize: 14, lineHeight: 1 }}>{l.feito ? '✓' : pendenteHoje ? '⏳' : '✗'}</div>
      <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 2, whiteSpace: 'nowrap' }}>
        {l.feito ? <>{l.por ? primeiroNome(l.por) : (l.auto ? 'sistema' : '—')} {hora(l.em)}</> : (l.atrasada && l.prazo < dia ? `prazo ${rotuloData(l.prazo).split(', ')[1] || ''}` : '')}
      </div>
    </td>
  )
}

export default function AcompanhamentoTarefas() {
  const [n, setN] = useState(7)
  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  async function load(qtd = n) {
    setLoading(true); setErro('')
    try { setDados(await carregarAcompanhamento(qtd)) } catch (e) { setErro(e.message || String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const dias = dados ? [...dados.dias].reverse() : []   // mais antigo à esquerda, hoje à direita
  const hoje = dados?.dias[0]
  const linha = (dia, id) => (dados?.porDia[dia]?.linhas || []).find(l => l.id === id)
  const tarefasVistas = TAREFAS.filter(t => dias.some(d => linha(d, t.id)))
  const areas = MENU.filter(m => tarefasVistas.some(t => t.area === m.id))

  // resumo por área: hoje e no período
  const resumo = area => {
    const doPeriodo = dias.flatMap(d => (dados.porDia[d]?.linhas || []).filter(l => l.area === area && !(d === hoje && !l.feito && !l.atrasada)))
    const deHoje = (dados.porDia[hoje]?.linhas || []).filter(l => l.area === area)
    return { hoje: deHoje.filter(l => l.feito).length, hojeTotal: deHoje.length,
      pct: doPeriodo.length ? Math.round(doPeriodo.filter(l => l.feito).length / doPeriodo.length * 100) : null,
      atrasadas: deHoje.filter(l => !l.feito && l.atrasada).length }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Acompanhamento de tarefas</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
            As tarefas da página Hoje de cada área: feita, por quem e a que horas. Passe o mouse numa célula para ver o detalhe.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <select className="form-input" value={n} onChange={e => { const v = +e.target.value; setN(v); load(v) }} style={{ width: 170, fontSize: 13 }}>
          {[5, 7, 10, 15].map(v => <option key={v} value={v}>Últimos {v} dias trabalhados</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => load()} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>

      {erro && <div className="alert-banner danger">Erro: {erro}</div>}
      {loading && !dados ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : dados && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            {areas.map(({ id, label, Icon }) => {
              const r = resumo(id)
              return (
                <div key={id} className="card card-pad">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13 }}><Icon size={15} /> {label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0', color: r.hoje === r.hojeTotal ? 'var(--ok)' : 'var(--purple)' }}>
                    {r.hojeTotal ? `${r.hoje} de ${r.hojeTotal}` : '—'} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)' }}>hoje</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                    {r.pct !== null ? `${r.pct}% feitas no período` : ''}
                    {r.atrasadas > 0 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · {r.atrasadas} atrasada(s)</span>}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="card tbl-wrap">
            <table style={{ minWidth: 300 + dias.length * 80 }}>
              <thead>
                <tr>
                  <th>Tarefa</th>
                  {dias.map(d => <th key={d} style={{ textAlign: 'center', whiteSpace: 'nowrap', color: d === hoje ? 'var(--purple)' : undefined }}>{d === hoje ? 'Hoje' : rotuloData(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {areas.map(({ id, label }) => (
                  <Fragment key={id}>
                    <tr><td colSpan={dias.length + 1} style={{ fontWeight: 700, fontSize: 12, color: 'var(--purple)', background: 'var(--gray-50)', padding: '7px 12px' }}>{label}</td></tr>
                    {tarefasVistas.filter(t => t.area === id).map(t => (
                      <tr key={t.id}>
                        <td style={{ fontSize: 12, fontWeight: 600, minWidth: 220 }}>{t.titulo}<div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 400 }}>{t.quando}</div></td>
                        {dias.map(d => <Celula key={d} l={linha(d, t.id)} dia={d} hoje={hoje} />)}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
            <b style={{ color: 'var(--ok)' }}>✓</b> feita (o sistema achou o registro) · <b style={{ color: '#2563eb' }}>✓</b> marcada à mão ·
            <b style={{ color: 'var(--warning)' }}> ⏳</b> pendente hoje · <b style={{ color: 'var(--danger)' }}>✗</b> não feita · — não se aplica no dia.
            Nome e hora: de quem fez o registro (produção, picking, rota, contagem, baixa) ou de quem marcou.
          </div>
        </>
      )}
    </div>
  )
}
