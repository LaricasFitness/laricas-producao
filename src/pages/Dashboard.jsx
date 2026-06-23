import { useState, useEffect } from 'react'
import { carregarStatusCompleto, statusConfig } from '../lib/data'
import { RefreshCw } from 'lucide-react'

export default function Dashboard({ onNovoPedido }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try { setData(await carregarStatusCompleto()) } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const criticos = data.filter(d => d.status === 'critico')
  const atencao  = data.filter(d => d.status === 'atencao')
  const precisam = data.filter(d => d.qtdPedido > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Resumo */}
      <div className="summary-row">
        <div className="sum-card" style={{ borderTop: '3px solid var(--danger)' }}>
          <div className="sum-label">🚨 Crítico</div>
          <div className="sum-value" style={{ color: 'var(--danger)' }}>{criticos.length}</div>
          <div className="sum-detail">pedir urgente</div>
        </div>
        <div className="sum-card" style={{ borderTop: '3px solid var(--warning)' }}>
          <div className="sum-label">⚠️ Atenção</div>
          <div className="sum-value" style={{ color: 'var(--warning)' }}>{atencao.length}</div>
          <div className="sum-detail">abaixo do mínimo</div>
        </div>
        <div className="sum-card" style={{ borderTop: '3px solid var(--ok)' }}>
          <div className="sum-label">✅ OK</div>
          <div className="sum-value" style={{ color: 'var(--ok)' }}>{data.filter(d => d.status === 'ok').length}</div>
          <div className="sum-detail">estoque suficiente</div>
        </div>
      </div>

      {precisam.length > 0 && (
        <div className="alert alert-warning">
          ⚠️ <div>
            <strong>{precisam.length} embalagem(ns) precisam de pedido.</strong>
            {' '}
            <button className="btn btn-gold btn-sm" style={{ marginLeft: 8 }} onClick={onNovoPedido}>
              Gerar pedido agora
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Situação das embalagens</div>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>

        {loading ? (
          <div className="loading">Calculando estoque...</div>
        ) : data.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📦</div>
            <div className="empty-text">Nenhuma embalagem cadastrada</div>
            <div className="empty-sub">Vá em Admin → Embalagens para cadastrar</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Embalagem</th>
                  <th>Categoria</th>
                  <th>Estoque atual</th>
                  <th>Mínimo ideal</th>
                  <th>Dias restantes</th>
                  <th>Status</th>
                  <th>Pedir</th>
                </tr>
              </thead>
              <tbody>
                {data.map(emb => {
                  const cfg = statusConfig(emb.status)
                  return (
                    <tr key={emb.id} className={cfg.rowCls}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{emb.nome}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{emb.codigo}</div>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--gray-600)' }}>{emb.categoria}</td>
                      <td style={{ fontWeight: 700 }}>{(emb.estoque_atual || 0).toLocaleString('pt-BR')}</td>
                      <td style={{ color: 'var(--gray-600)' }}>
                        {emb.minimoIdeal > 0 ? emb.minimoIdeal.toLocaleString('pt-BR') : '—'}
                      </td>
                      <td>
                        {emb.diasRestantes !== null
                          ? <span style={{ fontWeight: 600, color: emb.diasRestantes <= emb.dias_producao ? 'var(--danger)' : 'var(--gray-800)' }}>
                              {emb.diasRestantes}d
                            </span>
                          : <span style={{ color: 'var(--gray-400)' }}>—</span>
                        }
                      </td>
                      <td><span className={`pill ${cfg.cls}`}>{cfg.label}</span></td>
                      <td>
                        {emb.qtdPedido > 0
                          ? <span style={{ fontWeight: 700, color: emb.status === 'critico' ? 'var(--danger)' : 'var(--warning)' }}>
                              {emb.qtdPedido.toLocaleString('pt-BR')} un
                            </span>
                          : <span style={{ color: 'var(--gray-400)' }}>—</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
