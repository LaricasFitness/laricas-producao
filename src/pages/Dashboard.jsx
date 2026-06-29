import { useState, useEffect } from 'react'
import { carregarStatusCompleto, statusCfg, consumoSemanal } from '../lib/data'
import { RefreshCw } from 'lucide-react'

function TrendIcon({ dir }) {
  if (dir === 'up')   return <span className="trend up">↑ Alta</span>
  if (dir === 'down') return <span className="trend down">↓ Baixa</span>
  return <span className="trend flat">→ Estável</span>
}

function MiniChart({ embId }) {
  const [dados, setDados] = useState([])
  useEffect(() => {
    consumoSemanal(embId, 8).then(setDados)
  }, [embId])

  if (!dados.length) return <span className="text-muted text-xs">—</span>
  const max = Math.max(...dados.map(d => d.total), 1)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }}>
      {dados.map((d, i) => (
        <div
          key={i}
          title={`Sem ${d.semana}: ${d.total} un`}
          style={{
            flex: 1, background: 'var(--purple-light)',
            borderRadius: '2px 2px 0 0',
            height: `${Math.max(4, (d.total / max) * 28)}px`,
            opacity: i === dados.length - 1 ? 1 : 0.45,
            transition: 'height .3s',
          }}
        />
      ))}
    </div>
  )
}

function BarEstoque({ pct, status }) {
  const cls = status === 'critico' ? 'danger' : status === 'atencao' ? 'warning' : 'ok'
  return (
    <div className="prog-bar" style={{ width: 90 }}>
      <div className={`prog-fill ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

export default function Dashboard({ onNovoPedido, tipo = 'rotulo' }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('todos')
  const [expandido, setExpandido] = useState(null)

  async function load() {
    setLoading(true)
    try { setData(await carregarStatusCompleto(tipo)) } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [tipo])

  const criticos  = data.filter(d => d.status === 'critico')
  const atencao   = data.filter(d => d.status === 'atencao')
  const oks       = data.filter(d => d.status === 'ok')
  const semDados  = data.filter(d => d.status === 'sem-dados')
  const precisam  = data.filter(d => d.qtdPedido > 0)

  const filtered = filtro === 'todos' ? data
    : data.filter(d => d.status === filtro)

  return (
    <>
      {/* KPIs */}
      <div className="kpi-row">
        <div className="kpi danger" style={{ cursor: 'pointer' }} onClick={() => setFiltro(f => f === 'critico' ? 'todos' : 'critico')}>
          <div className="kpi-label">🚨 Crítico</div>
          <div className="kpi-value" style={{ color: 'var(--danger)' }}>{criticos.length}</div>
          <div className="kpi-detail">pedido urgente</div>
        </div>
        <div className="kpi warning" style={{ cursor: 'pointer' }} onClick={() => setFiltro(f => f === 'atencao' ? 'todos' : 'atencao')}>
          <div className="kpi-label">⚠️ Atenção</div>
          <div className="kpi-value" style={{ color: 'var(--warning)' }}>{atencao.length}</div>
          <div className="kpi-detail">abaixo do mínimo</div>
        </div>
        <div className="kpi ok" style={{ cursor: 'pointer' }} onClick={() => setFiltro(f => f === 'ok' ? 'todos' : 'ok')}>
          <div className="kpi-label">✅ OK</div>
          <div className="kpi-value" style={{ color: 'var(--ok)' }}>{oks.length}</div>
          <div className="kpi-detail">estoque suficiente</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">📦 Embalagens ativas</div>
          <div className="kpi-value">{data.length}</div>
          <div className="kpi-detail">{semDados.length} sem histórico</div>
        </div>
      </div>

      {/* Alertas */}
      {criticos.length > 0 && (
        <div className="alert-banner danger">
          <span>🚨</span>
          <div>
            <strong>{criticos.length} embalagem(ns) em nível crítico:</strong>{' '}
            {criticos.slice(0, 3).map(e => e.nome).join(', ')}{criticos.length > 3 ? ` e mais ${criticos.length - 3}` : ''}.
            {' '}
            <button className="btn btn-gold btn-sm" onClick={onNovoPedido} style={{ marginLeft: 8 }}>
              Gerar pedido agora
            </button>
          </div>
        </div>
      )}

      {precisam.length > 0 && criticos.length === 0 && (
        <div className="alert-banner warning">
          <span>⚠️</span>
          <div>
            <strong>{precisam.length} embalagem(ns)</strong> estão abaixo do mínimo ideal.
            <button className="btn btn-gold btn-sm" onClick={onNovoPedido} style={{ marginLeft: 8 }}>
              Gerar pedido
            </button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--gray-200)' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Status das embalagens</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {[['todos','Todas'], ['critico','Críticas'], ['atencao','Atenção'], ['ok','OK']].map(([v, l]) => (
              <button key={v} className={`btn btn-xs ${filtro === v ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFiltro(v)}>{l}</button>
            ))}
            <button className="btn btn-ghost btn-xs" onClick={load} disabled={loading}>
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading"><RefreshCw size={16} className="spin" /> Calculando estoque e médias...</div>
        ) : filtered.length === 0 ? (
          <div className="empty"><div className="empty-icon">✅</div><div className="empty-title">Tudo OK neste filtro</div></div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Embalagem</th>
                  <th>Status</th>
                  <th>Estoque atual</th>
                  <th>Dias restantes</th>
                  <th>Cobertura</th>
                  <th>Consumo/dia</th>
                  <th>Tendência</th>
                  <th>Últimas 8 semanas</th>
                  <th>Sugestão pedido</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emb => {
                  const cfg = statusCfg(emb.status)
                  const pct = emb.minimoIdeal > 0 ? (emb.estoque_atual / emb.minimoIdeal) * 100 : 100
                  return (
                    <tr key={emb.id} className={`row-${cfg.cls}`}>
                      <td>
                        <div className="fw-bold" style={{ fontSize: 13 }}>{emb.nome}</div>
                        <div className="text-xs text-muted" style={{ fontFamily: 'monospace' }}>{emb.codigo}</div>
                      </td>
                      <td><span className={`pill ${cfg.cls}`}>{cfg.icon} {cfg.label}</span></td>
                      <td className="fw-bold">{(emb.estoque_atual || 0).toLocaleString('pt-BR')} un</td>
                      <td>
                        {emb.diasRestantes !== null ? (
                          <span style={{ fontWeight: 700, color: emb.diasRestantes <= emb.dias ? 'var(--danger)' : emb.diasRestantes <= emb.dias * 2 ? 'var(--warning)' : 'var(--ok)' }}>
                            {emb.diasRestantes}d
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td style={{ minWidth: 100 }}>
                        {emb.minimoIdeal > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <BarEstoque pct={pct} status={emb.status} />
                            <span className="text-xs text-muted">{Math.round(pct)}%</span>
                          </div>
                        ) : <span className="text-muted text-xs">—</span>}
                      </td>
                      <td className="text-muted">
                        {emb.media > 0 ? `${emb.media}/dia` : '—'}
                      </td>
                      <td><TrendIcon dir={emb.tendencia} /></td>
                      <td style={{ minWidth: 80 }}>
                        <MiniChart embId={emb.id} />
                      </td>
                      <td>
                        {emb.qtdPedido > 0 ? (
                          <span style={{ fontWeight: 800, color: emb.status === 'critico' ? 'var(--danger)' : 'var(--warning)' }}>
                            {emb.qtdPedido.toLocaleString('pt-BR')} un
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid var(--gray-100)', fontSize: 11, color: 'var(--gray-400)', display: 'flex', gap: 16 }}>
            <span>Mínimo ideal = média diária × dias de antecedência × 110% (margem)</span>
            <span>•</span>
            <span>Tendência = comparação últimas 4 semanas vs 8 semanas</span>
            <span>•</span>
            <span>Clique nos cards para filtrar</span>
          </div>
        )}
      </div>
    </>
  )
}
