import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, AlertTriangle, Download, Pencil, Check, X } from 'lucide-react'

function getMesGrid(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1)
  const ultimoDia = new Date(ano, mes + 1, 0)
  const startDow = primeiroDia.getDay()
  const dias = []
  for (let i = 0; i < startDow; i++) dias.push(null)
  for (let d = 1; d <= ultimoDia.getDate(); d++) dias.push(new Date(ano, mes, d))
  return dias
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

// Linha editável do detalhe
function fmt(n) { return (n || 0).toLocaleString('pt-BR') }
function fmtHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// Agrupa por timestamp exato do lote (mesmo criado_em = mesmo insert batch)
// Ignora auto-embalagem (gerado automaticamente junto com o lote principal)
function agruparLotes(registros) {
  if (!registros.length) return []

  // Filtra auto-embalagem — aparece junto mas não é um lote separado do operador
  const principal = registros.filter(r => !r.registrado_por?.includes('auto-embalagem'))
  const sorted = [...principal].sort((a,b) => (a.criado_em||'').localeCompare(b.criado_em||''))

  const mapa = {} // criado_em → lote
  for (const r of sorted) {
    const key = r.criado_em || `sem-ts-${r.registrado_por}`
    if (!mapa[key]) {
      mapa[key] = {
        criado_em: r.criado_em,
        registrado_por: r.registrado_por,
        itens: [],
      }
    }
    mapa[key].itens.push(r)
  }

  return Object.values(mapa).sort((a,b) => (a.criado_em||'').localeCompare(b.criado_em||''))
}

function BlocoLote({ lote, embs, dataAtual, onSaved }) {
  const [editandoData, setEditandoData] = useState(false)
  const [novaData, setNovaData] = useState(dataAtual)
  const [saving, setSaving] = useState(false)

  async function moverLote() {
    if (novaData === dataAtual) { setEditandoData(false); return }
    setSaving(true)
    const ids = lote.itens.map(r => r.id)
    await supabase.from('producao_diaria').update({ data_producao: novaData }).in('id', ids)
    setSaving(false)
    setEditandoData(false)
    onSaved(ids, novaData)
  }

  const total = lote.itens.reduce((s, r) => s + r.quantidade, 0)

  return (
    <div style={{ marginBottom: 14, border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header do lote */}
      <div style={{ padding: '8px 12px', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="pill purple" style={{ fontSize: 11 }}>👤 {lote.registrado_por || 'Sem responsável'}</span>
          {lote.criado_em && (
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>⏱ {fmtHora(lote.criado_em)}</span>
          )}
          <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 700 }}>{total} un · {lote.itens.length} itens</span>
        </div>

        {/* Mover lote para outra data */}
        {editandoData ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', border: '2px solid var(--purple)', borderRadius: 6, outline: 'none' }} />
            <button onClick={moverLote} disabled={saving}
              style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {saving ? '...' : '✓ Mover'}
            </button>
            <button onClick={() => { setNovaData(dataAtual); setEditandoData(false) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
        ) : (
          <button onClick={() => setEditandoData(true)}
            style={{ background: 'none', border: '1px solid var(--gray-300)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 4 }}>
            📅 Mover lote
          </button>
        )}
      </div>

      {/* Itens do lote */}
      <div style={{ padding: '6px 12px' }}>
        {lote.itens.map((r, i) => {
          const emb = embs[r.embalagem_id]
          return (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: i < lote.itens.length-1 ? '1px solid var(--gray-100)' : 'none' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{emb?.nome || '—'}</span>
                <span style={{ fontSize: 10, color: 'var(--gray-400)', fontFamily: 'monospace', marginLeft: 6 }}>{emb?.codigo}</span>
              </div>
              <EditarQtd r={r} onSaved={(id, qtd) => onSaved([id], dataAtual, qtd)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EditarQtd({ r, onSaved }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState(r.quantidade)
  const [saving, setSaving] = useState(false)

  async function salvar() {
    const qtd = parseInt(draft) || 0
    setSaving(true)
    await supabase.from('producao_diaria').update({ quantidade: qtd }).eq('id', r.id)
    setSaving(false)
    setEditando(false)
    onSaved(r.id, qtd)
  }

  if (editando) return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input type="number" min={0} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key==='Enter') salvar(); if (e.key==='Escape') setEditando(false) }}
        autoFocus style={{ width: 64, padding: '3px 6px', fontSize: 13, fontWeight: 700, border: '2px solid var(--purple)', borderRadius: 6, outline: 'none', textAlign: 'right' }} />
      <button onClick={salvar} disabled={saving} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ok)' }}>
        {saving ? '...' : <Check size={14}/>}
      </button>
      <button onClick={() => setEditando(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)' }}>
        <X size={14}/>
      </button>
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--purple)' }}>{fmt(r.quantidade)}</span>
      <button onClick={() => { setDraft(r.quantidade); setEditando(true) }}
        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-300)', opacity: .6, padding: 2 }}
        title="Editar quantidade"><Pencil size={12}/></button>
    </div>
  )
}

function LoteLinha({ lote, embs, onDataSalva }) {
  const [editandoData, setEditandoData] = useState(false)
  const [novaData, setNovaData] = useState(lote.data_producao)
  const [saving, setSaving] = useState(false)

  const total = lote.itens.reduce((s, r) => s + r.quantidade, 0)
  const skus = [...new Set(lote.itens.map(r => embs[r.embalagem_id]?.nome).filter(Boolean))]
  const d = new Date(lote.data_producao + 'T12:00:00')

  async function salvarData() {
    if (!novaData || novaData === lote.data_producao) { setEditandoData(false); return }
    setSaving(true)
    const ids = lote.itens.map(r => r.id)
    await supabase.from('producao_diaria').update({ data_producao: novaData }).in('id', ids)
    setSaving(false)
    setEditandoData(false)
    onDataSalva(novaData)
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--gray-100)' }}>
      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
        {editandoData ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)}
              autoFocus style={{ fontSize: 12, padding: '3px 6px', border: '2px solid var(--purple)', borderRadius: 5, outline: 'none', width: 130 }} />
            <button onClick={salvarData} disabled={saving}
              style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {saving ? '...' : '✓'}
            </button>
            <button onClick={() => { setNovaData(lote.data_producao); setEditandoData(false) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        ) : (
          <span style={{ cursor: 'default' }}>{d.toLocaleDateString('pt-BR')}</span>
        )}
      </td>
      <td style={{ color: 'var(--gray-400)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {lote.criado_em ? fmtHora(lote.criado_em) : d.toLocaleDateString('pt-BR', { weekday: 'short' })}
      </td>
      <td>
        <span className="pill purple" style={{ fontSize: 11 }}>{lote.registrado_por || '—'}</span>
      </td>
      <td style={{ fontSize: 12, color: 'var(--gray-600)', maxWidth: 300 }}>
        {skus.slice(0,4).join(', ')}{skus.length > 4 ? ` +${skus.length - 4}` : ''}
      </td>
      <td style={{ fontWeight: 800, color: 'var(--purple)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {fmt(total)} un
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {!editandoData && (
          <button onClick={() => { setNovaData(lote.data_producao); setEditandoData(true) }}
            style={{ background: 'none', border: '1px solid var(--gray-200)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
            📅 Data
          </button>
        )}
      </td>
    </tr>
  )
}

export default function Log() {
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())
  const [dados, setDados] = useState({})
  const [loading, setLoading] = useState(true)
  const [diaSel, setDiaSel] = useState(null)
  const [detalhe, setDetalhe] = useState([])
  const [loadingDetalhe, setLoadingDetalhe] = useState(false)
  const [embs, setEmbs] = useState({})
  const [todosRegistros, setTodosRegistros] = useState([])
  const [aba, setAba] = useState('log') // 'log' | 'pvr'

  useEffect(() => {
    supabase.from('embalagens').select('id,nome,codigo,categoria').then(({ data }) => {
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
        .select('id, data_producao, criado_em, registrado_por, quantidade, embalagem_id, embalagens!inner(tipo)')
        .eq('embalagens.tipo', 'rotulo')
        .gte('data_producao', ini)
        .lte('data_producao', fim)

      const map = {}
      for (const r of (data || [])) {
        if (!map[r.data_producao]) map[r.data_producao] = []
        map[r.data_producao].push(r)
      }
      setDados(map)
      setTodosRegistros(data || [])
      setLoading(false)
    }
    load()
  }, [ano, mes])

  async function verDetalhe(dateStr) {
    setDiaSel(dateStr)
    setLoadingDetalhe(true)
    const { data } = await supabase
      .from('producao_diaria')
      .select('id, data_producao, embalagem_id, quantidade, registrado_por, embalagens!inner(tipo)')
      .eq('embalagens.tipo', 'rotulo')
      .eq('data_producao', dateStr)
      .order('quantidade', { ascending: false })
    setDetalhe(data || [])
    setLoadingDetalhe(false)
  }

  function atualizarDetalhe(ids, novaData, novaQtd) {
    const idsArr = Array.isArray(ids) ? ids : [ids]
    const dataMudou = novaData && novaData !== diaSel
    if (dataMudou) {
      setDetalhe(prev => prev.filter(r => !idsArr.includes(r.id)))
      setDados(prev => {
        const clone = { ...prev }
        if (clone[diaSel]) clone[diaSel] = clone[diaSel].filter(r => !idsArr.includes(r.id))
        return clone
      })
    } else if (novaQtd !== undefined) {
      const id = idsArr[0]
      setDetalhe(prev => prev.map(r => r.id === id ? { ...r, quantidade: novaQtd } : r))
      setDados(prev => {
        const clone = { ...prev }
        if (diaSel && clone[diaSel]) clone[diaSel] = clone[diaSel].map(r => r.id === id ? { ...r, quantidade: novaQtd } : r)
        return clone
      })
    }
  }

  function exportarCSV() {
    const rows = [['Data', 'Dia Semana', 'Produto', 'Código', 'Categoria', 'Quantidade', 'Responsável']]
    const sorted = [...todosRegistros].sort((a,b) => a.data_producao.localeCompare(b.data_producao))
    for (const r of sorted) {
      const emb = embs[r.embalagem_id]
      const d = new Date(r.data_producao + 'T12:00:00')
      rows.push([
        d.toLocaleDateString('pt-BR'),
        d.toLocaleDateString('pt-BR', { weekday: 'long' }),
        emb?.nome || '—',
        emb?.codigo || '—',
        emb?.categoria || '—',
        r.quantidade,
        r.registrado_por || '—',
      ])
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `Producao_${MESES[mes]}_${ano}.csv`
    a.click(); URL.revokeObjectURL(url)
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
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`tab${aba === 'log' ? ' active' : ''}`} onClick={() => setAba('log')}>
          📋 Log de Produção
        </button>
        <button className={`tab${aba === 'pvr' ? ' active' : ''}`} onClick={() => setAba('pvr')}>
          📊 Previsto × Realizado
        </button>
      </div>

      {aba === 'pvr' && (
        <PvrDia ano={ano} mes={mes} embs={embs} navMes={(delta) => {
          let nm = mes + delta, na = ano
          if (nm < 0) { nm = 11; na-- }
          if (nm > 11) { nm = 0; na++ }
          setMes(nm); setAno(na)
        }} />
      )}

      {aba === 'log' && (<>
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
                <div className="empty-sub">para ver e editar o detalhe da produção</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: 15 }}>
                  {new Date(diaSel + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => verDetalhe(diaSel)} title="Recarregar">
                  <RefreshCw size={12}/>
                </button>
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
                    Lotes de produção · 📅 Mover lote · ✏️ Editar quantidade
                  </div>
                  <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                    {agruparLotes(detalhe).map((lote, i) => (
                      <BlocoLote key={i} lote={lote} embs={embs} dataAtual={diaSel} onSaved={atualizarDetalhe} />
                    ))}
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

      {/* Tabela completa do mês — uma linha por lote */}
      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Todos os registros — {MESES[mes]} {ano}</span>
          <button className="btn btn-ghost btn-sm" onClick={exportarCSV} disabled={todosRegistros.length === 0}>
            <Download size={13}/> Exportar CSV
          </button>
        </div>
        {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Horário</th>
                  <th>Responsável</th>
                  <th>Itens registrados</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Usa todosRegistros que tem criado_em, não o mapa dados
                  const principal = todosRegistros.filter(r => !r.registrado_por?.includes('auto-embalagem'))
                  const lotesMap = {}
                  for (const r of principal) {
                    const key = r.criado_em || `sem-${r.data_producao}-${r.registrado_por}`
                    if (!lotesMap[key]) lotesMap[key] = {
                      criado_em: r.criado_em,
                      data_producao: r.data_producao,
                      registrado_por: r.registrado_por,
                      itens: []
                    }
                    lotesMap[key].itens.push(r)
                  }
                  const lotes = Object.values(lotesMap)
                    .sort((a,b) => (b.criado_em||b.data_producao).localeCompare(a.criado_em||a.data_producao))

                  if (!lotes.length) return (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--gray-400)' }}>Nenhum registro neste mês</td></tr>
                  )

                  return lotes.map((lote, i) => (
                    <LoteLinha key={lote.criado_em || i} lote={lote} embs={embs}
                      onDataSalva={(novaData) => {
                        // Atualiza data_producao localmente
                        setDados(prev => {
                          const clone = { ...prev }
                          const ids = lote.itens.map(r => r.id)
                          // Remove do dia antigo
                          const dataAntiga = lote.data_producao
                          if (clone[dataAntiga]) {
                            clone[dataAntiga] = clone[dataAntiga].filter(r => !ids.includes(r.id))
                            if (!clone[dataAntiga].length) delete clone[dataAntiga]
                          }
                          // Adiciona no novo dia
                          if (!clone[novaData]) clone[novaData] = []
                          clone[novaData] = [...clone[novaData], ...lote.itens.map(r => ({...r, data_producao: novaData}))]
                          return clone
                        })
                        lote.data_producao = novaData
                      }}
                    />
                  ))
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>)} {/* fim aba log */}
    </>
  )
}

// ── Previsto × Realizado por dia ─────────────────────────────────────────────
function PvrDia({ ano, mes, embs, navMes }) {
  const [dados, setDados] = useState([]) // [{data, previsto, realizado, desvio, itens}]
  const [loading, setLoading] = useState(false)
  const [diaSel, setDiaSel] = useState(null)
  const [detalheItens, setDetalheItens] = useState([])

  useEffect(() => { load() }, [ano, mes])

  async function load() {
    setLoading(true)
    setDiaSel(null)
    const ini = `${ano}-${String(mes+1).padStart(2,'0')}-01`
    const fim = new Date(ano, mes+1, 0).toISOString().slice(0,10)

    // Planejamentos do período — usa data_producao igual à Análise
    const { data: plans } = await supabase
      .from('planejamentos').select('id, data_producao')
      .gte('data_producao', ini).lte('data_producao', fim)

    const planIds = (plans||[]).map(p => p.id)
    const planDataMap = {}
    ;(plans||[]).forEach(p => { planDataMap[p.id] = p.data_producao })

    // Itens planejados
    let planPorData = {}
    if (planIds.length) {
      const { data: itens } = await supabase
        .from('planejamento_itens').select('planejamento_id, embalagem_id, quantidade_total')
        .in('planejamento_id', planIds)
      for (const i of (itens||[])) {
        const dt = planDataMap[i.planejamento_id]
        if (!dt) continue
        if (!planPorData[dt]) planPorData[dt] = {}
        planPorData[dt][i.embalagem_id] = (planPorData[dt][i.embalagem_id]||0) + i.quantidade_total
      }
    }

    // Produção real — só rótulos, igual à Análise
    const { data: embsRotulo } = await supabase
      .from('embalagens').select('id').eq('tipo', 'rotulo')
    const idsRotulo = (embsRotulo||[]).map(e => e.id)

    const { data: prod } = await supabase
      .from('producao_diaria').select('data_producao, embalagem_id, quantidade')
      .gte('data_producao', ini).lte('data_producao', fim)
      .in('embalagem_id', idsRotulo)

    const realPorData = {}
    for (const r of (prod||[])) {
      if (!realPorData[r.data_producao]) realPorData[r.data_producao] = {}
      realPorData[r.data_producao][r.embalagem_id] = (realPorData[r.data_producao][r.embalagem_id]||0) + r.quantidade
    }

    // Consolida por dia
    const todasDatas = [...new Set([...Object.keys(planPorData), ...Object.keys(realPorData)])].sort()
    const resultado = todasDatas.map(dt => {
      const pMap = planPorData[dt] || {}
      const rMap = realPorData[dt] || {}
      const previsto = Object.values(pMap).reduce((s,v)=>s+v,0)
      const realizado = Object.values(rMap).reduce((s,v)=>s+v,0)
      const desvio = previsto > 0 ? ((realizado - previsto) / previsto) * 100 : null

      // Detalhe por produto
      const todosEmbs = [...new Set([...Object.keys(pMap), ...Object.keys(rMap)])]
      const itens = todosEmbs.map(id => ({
        id, nome: embs[id]?.nome || '?',
        previsto: pMap[id]||0, realizado: rMap[id]||0,
        desvio: pMap[id] > 0 ? ((rMap[id]||0) - pMap[id]) / pMap[id] * 100 : null
      })).sort((a,b) => b.previsto - a.previsto)

      return { data: dt, previsto, realizado, desvio, itens }
    })

    setDados(resultado)
    setLoading(false)
  }

  function statusIcon(desvio, previsto) {
    if (previsto === 0) return { icon: '—', cor: 'var(--gray-300)' }
    if (desvio === null) return { icon: '—', cor: 'var(--gray-300)' }
    if (desvio >= -5) return { icon: '✅', cor: 'var(--ok)' }
    if (desvio >= -20) return { icon: '⚠️', cor: 'var(--warning)' }
    return { icon: '🚨', cor: 'var(--danger)' }
  }

  const totalPrevisto = dados.reduce((s,d)=>s+d.previsto,0)
  const totalRealizado = dados.reduce((s,d)=>s+d.realizado,0)
  const desvioGeral = totalPrevisto > 0 ? ((totalRealizado-totalPrevisto)/totalPrevisto*100) : null

  return (
    <>
      {/* Header */}
      <div className="card card-pad" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button className="btn btn-ghost btn-sm" onClick={()=>navMes(-1)}>‹</button>
          <span style={{ fontWeight:800, fontSize:15 }}>{MESES[mes]} {ano}</span>
          <button className="btn btn-ghost btn-sm" onClick={()=>navMes(1)}>›</button>
        </div>
        {/* KPIs */}
        <div style={{ display:'flex', gap:20 }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:11, color:'var(--gray-400)', fontWeight:700, textTransform:'uppercase' }}>Previsto</div>
            <div style={{ fontSize:18, fontWeight:800, color:'var(--gray-700)' }}>{fmt(totalPrevisto)} un</div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:11, color:'var(--gray-400)', fontWeight:700, textTransform:'uppercase' }}>Realizado</div>
            <div style={{ fontSize:18, fontWeight:800, color:'var(--purple)' }}>{fmt(totalRealizado)} un</div>
          </div>
          {desvioGeral !== null && (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:11, color:'var(--gray-400)', fontWeight:700, textTransform:'uppercase' }}>Desvio</div>
              <div style={{ fontSize:18, fontWeight:800, color: desvioGeral >= -5 ? 'var(--ok)' : desvioGeral >= -20 ? 'var(--warning)' : 'var(--danger)' }}>
                {desvioGeral > 0 ? '+' : ''}{desvioGeral.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={14}/></button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:16 }}>
        {/* Tabela por dia */}
        <div className="card">
          {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
            dados.length === 0 ? (
              <div className="empty card-pad">
                <div className="empty-icon">📊</div>
                <div className="empty-title">Nenhum planejamento ou produção em {MESES[mes]}</div>
              </div>
            ) : (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>
                    <th style={{ padding:'10px 14px', textAlign:'left' }}>Data</th>
                    <th style={{ padding:'10px 10px', textAlign:'right' }}>Previsto</th>
                    <th style={{ padding:'10px 10px', textAlign:'right' }}>Realizado</th>
                    <th style={{ padding:'10px 10px', textAlign:'right' }}>Desvio</th>
                    <th style={{ padding:'10px 10px', textAlign:'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.map((d, i) => {
                    const dt = new Date(d.data + 'T12:00:00')
                    const { icon, cor } = statusIcon(d.desvio, d.previsto)
                    const sel = diaSel === d.data
                    return (
                      <tr key={d.data}
                        onClick={() => { setDiaSel(sel ? null : d.data); setDetalheItens(d.itens) }}
                        style={{ borderTop:'1px solid var(--gray-100)', cursor:'pointer',
                          background: sel ? 'var(--purple-pale)' : i%2===0?'#fff':'#fafafa' }}>
                        <td style={{ padding:'10px 14px', fontWeight:700 }}>
                          {dt.toLocaleDateString('pt-BR')}
                          <span style={{ marginLeft:8, fontSize:11, color:'var(--gray-400)', fontWeight:400 }}>
                            {dt.toLocaleDateString('pt-BR',{weekday:'short'})}
                          </span>
                        </td>
                        <td style={{ padding:'10px 10px', textAlign:'right', color:'var(--gray-600)' }}>
                          {d.previsto > 0 ? `${fmt(d.previsto)} un` : '—'}
                        </td>
                        <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700, color:'var(--purple)' }}>
                          {d.realizado > 0 ? `${fmt(d.realizado)} un` : '—'}
                        </td>
                        <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:700,
                          color: d.desvio === null ? 'var(--gray-300)' : d.desvio >= 0 ? 'var(--ok)' : d.desvio >= -20 ? 'var(--warning)' : 'var(--danger)' }}>
                          {d.desvio !== null ? `${d.desvio > 0 ? '+' : ''}${d.desvio.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding:'10px 10px', textAlign:'center', fontSize:16 }}>{icon}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'2px solid var(--gray-200)', background:'var(--gray-50)' }}>
                    <td style={{ padding:'10px 14px', fontWeight:800 }}>Total {MESES[mes]}</td>
                    <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:800, color:'var(--gray-600)' }}>{fmt(totalPrevisto)} un</td>
                    <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:800, color:'var(--purple)' }}>{fmt(totalRealizado)} un</td>
                    <td style={{ padding:'10px 10px', textAlign:'right', fontWeight:800,
                      color: desvioGeral === null ? 'var(--gray-300)' : desvioGeral >= 0 ? 'var(--ok)' : desvioGeral >= -20 ? 'var(--warning)' : 'var(--danger)' }}>
                      {desvioGeral !== null ? `${desvioGeral > 0 ? '+' : ''}${desvioGeral.toFixed(1)}%` : '—'}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )
          )}
        </div>

        {/* Painel detalhe do dia */}
        <div className="card" style={{ alignSelf:'start', position:'sticky', top:0 }}>
          {!diaSel ? (
            <div className="empty card-pad">
              <div className="empty-icon">📅</div>
              <div className="empty-title">Clique em um dia</div>
              <div className="empty-sub">para ver o detalhe produto a produto</div>
            </div>
          ) : (
            <>
              <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-200)', fontWeight:800, fontSize:14 }}>
                {new Date(diaSel+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}
              </div>
              <div style={{ maxHeight:520, overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'var(--gray-50)', position:'sticky', top:0 }}>
                      <th style={{ padding:'8px 12px', textAlign:'left' }}>Produto</th>
                      <th style={{ padding:'8px 8px', textAlign:'right', color:'var(--gray-500)' }}>Prev.</th>
                      <th style={{ padding:'8px 8px', textAlign:'right', color:'var(--purple)' }}>Real.</th>
                      <th style={{ padding:'8px 8px', textAlign:'right' }}>Δ%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalheItens.map(it => (
                      <tr key={it.id} style={{ borderTop:'1px solid var(--gray-100)' }}>
                        <td style={{ padding:'7px 12px', fontWeight:600, fontSize:12 }}>{it.nome}</td>
                        <td style={{ padding:'7px 8px', textAlign:'right', color:'var(--gray-500)' }}>
                          {it.previsto > 0 ? fmt(it.previsto) : '—'}
                        </td>
                        <td style={{ padding:'7px 8px', textAlign:'right', fontWeight:700, color:'var(--purple)' }}>
                          {it.realizado > 0 ? fmt(it.realizado) : '—'}
                        </td>
                        <td style={{ padding:'7px 8px', textAlign:'right', fontSize:11, fontWeight:700,
                          color: it.desvio === null ? 'var(--gray-300)' : it.desvio >= -5 ? 'var(--ok)' : it.desvio >= -20 ? 'var(--warning)' : 'var(--danger)' }}>
                          {it.desvio !== null ? `${it.desvio > 0 ? '+' : ''}${it.desvio.toFixed(0)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding:'10px 14px', borderTop:'2px solid var(--gray-200)', display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:800 }}>
                <span>Total</span>
                <span>
                  <span style={{ color:'var(--gray-500)', marginRight:16 }}>
                    {fmt(detalheItens.reduce((s,i)=>s+i.previsto,0))} prev.
                  </span>
                  <span style={{ color:'var(--purple)' }}>
                    {fmt(detalheItens.reduce((s,i)=>s+i.realizado,0))} real.
                  </span>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop:12, fontSize:11, color:'var(--gray-400)' }}>
        ✅ OK = desvio dentro de 5% · ⚠️ Abaixo = até -20% · 🚨 Crítico = mais de -20% abaixo do planejado
      </div>
    </>
  )
}
