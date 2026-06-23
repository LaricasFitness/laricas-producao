import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, AlertTriangle } from 'lucide-react'

function fmt(n) { return (n || 0).toLocaleString('pt-BR') }

function getMesGrid(ano, mes) {
  // mes: 0-indexed
  const primeiroDia = new Date(ano, mes, 1)
  const ultimoDia = new Date(ano, mes + 1, 0)
  const startDow = primeiroDia.getDay() // 0=dom
  const dias = []
  for (let i = 0; i < startDow; i++) dias.push(null) // vazios no início
  for (let d = 1; d <= ultimoDia.getDate(); d++) dias.push(new Date(ano, mes, d))
  return dias
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

export default function Log() {
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())
  const [dados, setDados] = useState({}) // { 'YYYY-MM-DD': [registros] }
  const [loading, setLoading] = useState(true)
  const [diaSel, setDiaSel] = useState(null)
  const [detalhe, setDetalhe] = useState([])
  const [loadingDetalhe, setLoadingDetalhe] = useState(false)
  const [embs, setEmbs] = useState({})

  useEffect(() => {
    supabase.from('embalagens').select('id,nome,codigo').then(({ data }) => {
      const m = {}
      ;(data || []).forEach(e => { m[e.id] = e })
      setEmbs(m)
    })
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const ini = `${ano}-${String(mes + 1).padStart(2, '0')}-01`
      const fim = new Date(ano, mes + 1, 0).toISOString().slice(0, 10)

      const { data } = await supabase
        .from('producao_diaria')
        .select('data_producao, registrado_por, quantidade, embalagem_id')
        .gte('data_producao', ini)
        .lte('data_producao', fim)

      const map = {}
      for (const r of (data || [])) {
        if (!map[r.data_producao]) map[r.data_producao] = []
        map[r.data_producao].push(r)
      }
      setDados(map)
      setLoading(false)
    }
    load()
  }, [ano, mes])

  async function verDetalhe(dateStr) {
    setDiaSel(dateStr)
    setLoadingDetalhe(true)
    const { data } = await supabase
      .from('producao_diaria')
      .select('embalagem_id, quantidade, registrado_por')
      .eq('data_producao', dateStr)
      .order('quantidade', { ascending: false })
    setDetalhe(data || [])
    setLoadingDetalhe(false)
  }

  const grid = getMesGrid(ano, mes)
  const diasUteis = grid.filter(d => d && d.getDay() !== 0 && d.getDay() !== 6) // exclui sábado e domingo
  const diasComDados = diasUteis.filter(d => dados[d.toISOString().slice(0, 10)])
  const diasSemDados = diasUteis.filter(d => {
    const str = d.toISOString().slice(0, 10)
    return str <= hoje.toISOString().slice(0, 10) && !dados[str]
  })
  const totalUnidades = Object.values(dados).flat().reduce((s, r) => s + r.quantidade, 0)
  const responsaveis = [...new Set(Object.values(dados).flat().map(r => r.registrado_por).filter(Boolean))]

  function navMes(delta) {
    let nm = mes + delta, na = ano
    if (nm < 0) { nm = 11; na-- }
    if (nm > 11) { nm = 0; na++ }
    setMes(nm); setAno(na); setDiaSel(null)
  }

  return (
    <>
      {/* Alertas */}
      {diasSemDados.length > 0 && (
        <div className="alert-banner danger">
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <div>
            <strong>{diasSemDados.length} dia(s) sem registro</strong> em {MESES[mes]}:{' '}
            {diasSemDados.slice(0, 5).map(d => d.getDate() + '/' + String(d.getMonth()+1).padStart(2,'0')).join(', ')}
            {diasSemDados.length > 5 && ` e mais ${diasSemDados.length - 5}`}.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        {/* Calendário */}
        <div className="card">
          {/* Header do calendário */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--gray-200)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navMes(-1)}>‹</button>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{MESES[mes]} {ano}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navMes(1)}>›</button>
          </div>

          {/* Resumo do mês */}
          <div style={{ display: 'flex', gap: 20, padding: '12px 20px', borderBottom: '1px solid var(--gray-100)', flexWrap: 'wrap' }}>
            <div><span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}>DIAS COM REGISTRO</span><br/>
              <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--ok)' }}>{diasComDados.length}</span>
              <span style={{ color: 'var(--gray-400)', fontSize: 12 }}> / {diasUteis.filter(d => d.toISOString().slice(0,10) <= hoje.toISOString().slice(0,10)).length} dias úteis (seg–sex)</span>
            </div>
            <div><span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}>DIAS SEM REGISTRO</span><br/>
              <span style={{ fontWeight: 800, fontSize: 18, color: diasSemDados.length > 0 ? 'var(--danger)' : 'var(--ok)' }}>{diasSemDados.length}</span>
            </div>
            <div><span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}>TOTAL PRODUZIDO</span><br/>
              <span style={{ fontWeight: 800, fontSize: 18 }}>{fmt(totalUnidades)} un</span>
            </div>
            <div><span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 700 }}>RESPONSÁVEIS</span><br/>
              <span style={{ fontWeight: 800, fontSize: 18 }}>{responsaveis.join(', ') || '—'}</span>
            </div>
          </div>

          <div style={{ padding: '16px 20px' }}>
            {/* Labels dias da semana */}
            <div className="cal-grid" style={{ marginBottom: 6 }}>
              {DIAS_SEMANA.map(d => (
                <div key={d} className="cal-day-label">{d}</div>
              ))}
            </div>

            {loading ? (
              <div className="loading"><RefreshCw size={14} className="spin" /> Carregando...</div>
            ) : (
              <div className="cal-grid">
                {grid.map((d, i) => {
                  if (!d) return <div key={i} className="cal-day empty-slot" />
                  const str = d.toISOString().slice(0, 10)
                  const isFuture = str > hoje.toISOString().slice(0, 10)
                  const hasData = !!dados[str]
                  const isSelected = diaSel === str
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6

                  let cls = 'cal-day '
                  if (isFuture || isWeekend) cls += 'future'
                  else if (hasData) cls += 'has-data'
                  else cls += 'no-data'

                  const total = (dados[str] || []).reduce((s, r) => s + r.quantidade, 0)
                  const resp = [...new Set((dados[str] || []).map(r => r.registrado_por).filter(Boolean))]

                  return (
                    <div
                      key={str}
                      className={cls}
                      style={{
                        cursor: (hasData && !isFuture) ? 'pointer' : 'default',
                        outline: isSelected ? '2px solid var(--gold)' : 'none',
                        outlineOffset: 1,
                      }}
                      onClick={() => hasData && !isFuture && verDetalhe(str)}
                      title={hasData ? `${fmt(total)} un — ${resp.join(', ')}` : isFuture ? 'Futuro' : isWeekend ? 'Fim de semana' : 'Sem registro'}
                    >
                      <span>{d.getDate()}</span>
                      {hasData && <span style={{ fontSize: 8, opacity: .8 }}>{fmt(total)}</span>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Legenda */}
            <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
              {[
                { cls: 'has-data', label: 'Com registro' },
                { cls: 'no-data', label: 'Sem registro' },
                { cls: 'future', label: 'Fim de semana / Futuro' },
              ].map(l => (
                <div key={l.cls} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={`cal-day ${l.cls}`} style={{ width: 16, height: 16, minHeight: 16, fontSize: 0, borderRadius: 4 }} />
                  <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detalhe do dia */}
        <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: 0 }}>
          {!diaSel ? (
            <div style={{ padding: 24 }}>
              <div className="empty">
                <div className="empty-icon">📅</div>
                <div className="empty-title">Clique em um dia</div>
                <div className="empty-sub">para ver o detalhe da produção</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 800, fontSize: 15 }}>
                {new Date(diaSel + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              {loadingDetalhe ? (
                <div className="loading"><RefreshCw size={14} className="spin" /></div>
              ) : (
                <div style={{ padding: '14px 20px' }}>
                  <div style={{ marginBottom: 12 }}>
                    {[...new Set(detalhe.map(r => r.registrado_por).filter(Boolean))].map(r => (
                      <span key={r} className="pill purple" style={{ marginRight: 4 }}>👤 {r}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Itens produzidos
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                    {detalhe.map((r, i) => {
                      const emb = embs[r.embalagem_id]
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--gray-100)' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{emb?.nome || '—'}</div>
                            <div style={{ fontSize: 10, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{emb?.codigo}</div>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--purple)' }}>{fmt(r.quantidade)}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '2px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                    <span>Total</span>
                    <span style={{ color: 'var(--purple)' }}>{fmt(detalhe.reduce((s, r) => s + r.quantidade, 0))} un</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabela completa do mês */}
      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 700, fontSize: 14 }}>
          Todos os registros — {MESES[mes]} {ano}
        </div>
        {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Dia</th>
                  <th>Responsável</th>
                  <th>Itens registrados</th>
                  <th>Total produzido</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(dados).sort(([a],[b]) => b.localeCompare(a)).map(([dateStr, rows]) => {
                  const d = new Date(dateStr + 'T12:00:00')
                  const total = rows.reduce((s, r) => s + r.quantidade, 0)
                  const resp = [...new Set(rows.map(r => r.registrado_por).filter(Boolean))]
                  const skus = [...new Set(rows.map(r => embs[r.embalagem_id]?.nome).filter(Boolean))]
                  return (
                    <tr key={dateStr} style={{ cursor: 'pointer' }} onClick={() => verDetalhe(dateStr)}>
                      <td style={{ fontWeight: 700 }}>{d.toLocaleDateString('pt-BR')}</td>
                      <td style={{ color: 'var(--gray-500)' }}>{d.toLocaleDateString('pt-BR', { weekday: 'long' })}</td>
                      <td>{resp.map(r => <span key={r} className="pill purple" style={{ marginRight: 4 }}>{r}</span>)}</td>
                      <td style={{ fontSize: 12, color: 'var(--gray-600)', maxWidth: 260 }}>
                        {skus.slice(0,4).join(', ')}{skus.length > 4 ? ` +${skus.length - 4}` : ''}
                      </td>
                      <td style={{ fontWeight: 800, color: 'var(--purple)' }}>{fmt(total)} un</td>
                    </tr>
                  )
                })}
                {Object.keys(dados).length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--gray-400)' }}>Nenhum registro neste mês</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
