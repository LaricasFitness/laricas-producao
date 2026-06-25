import { useState, useEffect, useCallback } from 'react'
import { carregarLog, reverterAcao, labelAcao } from '../lib/log'
import { RefreshCw, RotateCcw } from 'lucide-react'

function fmtData(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function LogGeral({ onReverteu }) {
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [revertendo, setRevertendo] = useState(null)
  const [confirmando, setConfirmando] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLog(await carregarLog(20))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function confirmarReverter(entry) {
    setRevertendo(entry.id)
    setConfirmando(null)
    const res = await reverterAcao(entry)
    if (res.ok) {
      await load()
      onReverteu?.()
    } else {
      alert('Erro ao desfazer: ' + res.erro)
    }
    setRevertendo(null)
  }

  if (loading) return <div className="loading"><RefreshCw size={14} className="spin" /> Carregando...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🕓 Minhas ações recentes</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
            Últimas {log.length} ações · só você vê isso · clique em ↩ para desfazer
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {log.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhuma ação registrada ainda</div>
          <div className="empty-sub">As ações aparecem aqui conforme você usa o sistema</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {log.map((entry, idx) => (
            <div key={entry.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px',
              background: idx === 0 ? 'var(--purple-ghost)' : 'var(--white)',
              border: `1px solid ${idx === 0 ? 'var(--purple-pale)' : 'var(--gray-100)'}`,
              borderRadius: 8,
              opacity: revertendo === entry.id ? 0.5 : 1,
              transition: 'opacity .2s',
            }}>
              {/* Número do passo */}
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: idx === 0 ? 'var(--purple)' : 'var(--gray-200)',
                color: idx === 0 ? '#fff' : 'var(--gray-500)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, flexShrink: 0,
              }}>
                {idx + 1}
              </div>

              {/* Conteúdo */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', marginBottom: 2 }}>
                  {labelAcao(entry.acao)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entry.descricao}
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                  {fmtData(entry.criado_em)}
                </div>
              </div>

              {/* Botão desfazer */}
              {confirmando === entry.id ? (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-danger btn-sm" onClick={() => confirmarReverter(entry)} disabled={!!revertendo}>
                    {revertendo === entry.id ? <RefreshCw size={12} className="spin" /> : '✓ Confirmar'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmando(null)}>Cancelar</button>
                </div>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmando(entry.id)}
                  disabled={!!revertendo}
                  title="Desfazer esta ação"
                  style={{ flexShrink: 0, color: 'var(--purple)', fontWeight: 700 }}
                >
                  <RotateCcw size={13} /> Desfazer
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 11, color: 'var(--gray-400)', lineHeight: 1.6 }}>
        ℹ️ Desfazer exclui o registro do banco e reverte o efeito (ex: estoque volta ao valor anterior).
        Ações marcadas como "apenas log" não podem ser desfeitas pois afetam dados externos.
      </div>
    </div>
  )
}
