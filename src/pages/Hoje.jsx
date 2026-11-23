import { useState, useEffect } from 'react'
import { RefreshCw, Check, ChevronRight } from 'lucide-react'
import { MENU } from '../lib/menu'
import { carregarTarefas, marcarTarefa, desmarcarTarefa, rotuloData } from '../lib/tarefas'

// Página inicial: tarefas do dia das áreas que o usuário acessa (regras em src/lib/tarefas.js)
const hora = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function Hoje({ areas, usuario, onIr }) {
  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(null)

  async function load() {
    setLoading(true); setErro('')
    try { setDados(await carregarTarefas(areas)) } catch (e) { setErro(e.message || String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function alternar(l) {
    if (l.auto) return   // concluída pelo próprio sistema
    if (l.manual && !window.confirm(`Desmarcar "${l.titulo}"?\n\nMarcada por ${l.manual.marcado_por || '—'} às ${hora(l.manual.marcado_em)}.`)) return
    setSalvando(`${l.id}|${l.ref}`)
    try {
      if (l.manual) await desmarcarTarefa(l.id, l.ref)
      else await marcarTarefa(l.id, l.ref, usuario?.nome)
      await load()
    } catch (e) { alert(e.message) }
    setSalvando(null)
  }

  const linhas = dados?.linhas || []
  const feitas = linhas.filter(l => l.feito).length
  const areasComTarefa = MENU.filter(m => linhas.some(l => l.area === m.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
      <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Tarefas de hoje</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
            {dados ? <>
              {rotuloData(dados.hoje)}
              {!dados.hojeTrabalhado && <> · <b>{dados.motivoFolga || 'dia sem produção'}</b>: só aparecem as pendências</>}
            </> : ' '}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {linhas.length > 0 && (
          <div style={{ fontWeight: 800, fontSize: 15, color: feitas === linhas.length ? 'var(--ok)' : 'var(--purple)' }}>
            {feitas} de {linhas.length} concluídas
          </div>
        )}
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading} title="Atualizar">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {erro && <div className="alert-banner danger">Erro ao carregar as tarefas: {erro}</div>}
      {dados?.semTabela && <div className="alert-banner warning">Para marcar tarefas à mão, aplique o tarefas.sql no Supabase.</div>}

      {loading && !dados ? <div className="loading"><RefreshCw size={14} className="spin" /></div>
        : !linhas.length ? (
          <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Nenhuma tarefa para hoje. 🎉</div>
        ) : areasComTarefa.map(({ id, label, Icon }) => (
          <div key={id} className="card">
            <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--gray-100)', fontWeight: 800, fontSize: 13 }}>
              <Icon size={16} strokeWidth={1.8} /> {label}
            </div>
            {linhas.filter(l => l.area === id).map(l => {
              const chave = `${l.id}|${l.ref}`
              return (
                <div key={chave} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                  borderTop: '1px solid var(--gray-100)', background: l.feito ? '#f6fbf6' : l.atrasada ? '#fff8f0' : '#fff' }}>
                  <button onClick={() => alternar(l)} disabled={salvando === chave}
                    title={l.auto ? 'Concluída pelo sistema' : l.manual ? 'Desmarcar' : 'Marcar como concluída'}
                    style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, cursor: l.auto ? 'default' : 'pointer',
                      border: `2px solid ${l.feito ? 'var(--ok)' : 'var(--gray-300)'}`, background: l.feito ? 'var(--ok)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    {salvando === chave ? <RefreshCw size={12} className="spin" style={{ color: 'var(--gray-400)' }} /> : l.feito && <Check size={16} strokeWidth={3} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: l.feito ? 'var(--gray-500)' : undefined }}>
                      {l.titulo}
                      {l.atrasada && !l.feito && <span className="pill" style={{ marginLeft: 6, fontSize: 10, background: 'var(--warning)', color: '#fff' }}>atrasada · prazo {rotuloData(l.prazo)}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>
                      {l.detalhe}
                      {l.auto && <span style={{ color: 'var(--ok)', fontWeight: 700 }}> · ✓ feita{l.por ? ` por ${l.por}` : ''}{l.em ? ` às ${hora(l.em)}` : ''}</span>}
                      {!l.auto && l.manual && <span style={{ color: 'var(--ok)', fontWeight: 700 }}> · ✓ marcada por {l.manual.marcado_por || '—'} às {hora(l.manual.marcado_em)}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 1 }}>{l.quando}</div>
                  </div>
                  {l.ir && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onIr(...l.ir)} title="Abrir a tela">
                      Abrir <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}
