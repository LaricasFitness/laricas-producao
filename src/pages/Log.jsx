import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { editarProducao, excluirProducao, adicionarProducao } from '../lib/producao'
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
              <EditarQtd r={r} embs={embs} onSaved={(id, qtd) => onSaved([id], dataAtual, qtd)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ── Editar o lançamento inteiro de um dia ─────────────────────────────────────
function EditarLote({ dia, itens, embs, onClose, onSaved }) {
  const lista = Object.values(embs || {})
    .filter(e => e && e.ativo !== false && (e.tipo === 'rotulo' || e.visivel_producao))
  const cats = [...new Set(lista.map(e => e.categoria).filter(Boolean))].sort()

  const [linhas, setLinhas] = useState(
    itens.map(r => ({ id: r.id, embId: r.embalagem_id, qtd: String(r.quantidade),
                      origEmb: r.embalagem_id, origQtd: r.quantidade, novo: false, removido: false }))
  )
  const [salvando, setSalvando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [erro, setErro] = useState('')

  const setL = (id, k, v) => setLinhas(p => p.map(l => l.id === id ? { ...l, [k]: v } : l))
  const addLinha = () => setLinhas(p => [...p, {
    id: 'novo_' + Date.now(), embId: lista[0]?.id || '', qtd: '', novo: true, removido: false }])

  const alteradas = linhas.filter(l =>
    l.removido || l.novo || l.embId !== l.origEmb || parseInt(l.qtd) !== l.origQtd)

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      let n = 0
      for (const l of linhas) {
        n++
        setProgresso(`${n}/${linhas.length}`)
        if (l.removido && !l.novo) {
          await excluirProducao(l.id)
        } else if (l.novo && !l.removido) {
          const q = parseInt(l.qtd) || 0
          if (q > 0 && l.embId) {
            await adicionarProducao({ embalagemId: l.embId, quantidade: q, dataProducao: dia })
          }
        } else if (!l.removido && (l.embId !== l.origEmb || parseInt(l.qtd) !== l.origQtd)) {
          await editarProducao(l.id, { novoEmbalagemId: l.embId, novaQuantidade: parseInt(l.qtd) || 0 })
        }
      }
      setSalvando(false)
      onSaved()
    } catch (e) {
      setErro(e.message || String(e)); setSalvando(false); setProgresso('')
    }
  }

  const totalFinal = linhas.filter(l => !l.removido).reduce((s, l) => s + (parseInt(l.qtd) || 0), 0)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !salvando && onClose()}>
      <div className="modal" style={{ maxWidth: 760, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">✏️ Editar lançamento do dia</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
              {new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={salvando}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 8,
            marginBottom: 12, fontSize: 12, color: 'var(--gray-600)' }}>
            Trocar o produto ou a quantidade ajusta o estoque de embalagem e de matéria-prima
            automaticamente, nos dois sentidos.
          </div>

          {linhas.map(l => (
            <div key={l.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 90px 36px', gap: 6,
              alignItems: 'center', marginBottom: 6, padding: '6px 8px', borderRadius: 6,
              background: l.removido ? '#fff0f0' : l.novo ? '#f0faf0' : 'transparent',
              opacity: l.removido ? .55 : 1,
            }}>
              <select className="form-input" value={l.embId} disabled={l.removido}
                onChange={e => setL(l.id, 'embId', e.target.value)}
                style={{ fontSize: 13, textDecoration: l.removido ? 'line-through' : 'none' }}>
                {cats.map(cat => (
                  <optgroup key={cat} label={cat}>
                    {lista.filter(e => e.categoria === cat)
                      .sort((a, b) => a.nome.localeCompare(b.nome))
                      .map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </optgroup>
                ))}
              </select>
              <input type="number" min={0} className="form-input" value={l.qtd} disabled={l.removido}
                onChange={e => setL(l.id, 'qtd', e.target.value)}
                style={{ fontSize: 13, textAlign: 'right' }} />
              <button className="btn btn-ghost btn-sm"
                onClick={() => l.novo
                  ? setLinhas(p => p.filter(x => x.id !== l.id))
                  : setL(l.id, 'removido', !l.removido)}
                title={l.removido ? 'Desfazer remoção' : 'Remover'}
                style={{ color: l.removido ? 'var(--gray-500)' : 'var(--danger)', padding: '4px 6px' }}>
                {l.removido ? '↺' : '✕'}
              </button>
            </div>
          ))}

          <button className="btn btn-ghost btn-sm" onClick={addLinha} style={{ marginTop: 4 }}>
            + Adicionar item esquecido
          </button>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--gray-200)',
            display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--gray-500)' }}>
              {alteradas.length > 0
                ? `${alteradas.length} alteração(ões) pendente(s)`
                : 'Nenhuma alteração'}
            </span>
            <span style={{ fontWeight: 800, color: 'var(--purple)' }}>{fmt(totalFinal)} un no total</span>
          </div>

          {erro && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff0f0',
              border: '1px solid var(--danger)', borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>{erro}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || !alteradas.length}>
            {salvando
              ? <><RefreshCw size={14} className="spin" /> Aplicando {progresso}...</>
              : <><Check size={14} /> Salvar alterações</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditarQtd({ r, embs, onSaved }) {
  const [aberto, setAberto] = useState(false)
  const [qtd, setQtd] = useState(r.quantidade)
  const [embId, setEmbId] = useState(r.embalagem_id)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const trocouProduto = embId !== r.embalagem_id
  const lista = Object.values(embs || {}).filter(e => e && e.ativo !== false && (e.tipo === 'rotulo' || e.visivel_producao))
  const cats = [...new Set(lista.map(e => e.categoria).filter(Boolean))].sort()

  async function salvar() {
    setSaving(true); setErro('')
    try {
      await editarProducao(r.id, { novoEmbalagemId: embId, novaQuantidade: parseInt(qtd) || 0 })
      setSaving(false); setAberto(false)
      onSaved(r.id, parseInt(qtd) || 0, embId)
    } catch (e) {
      setErro(e.message || String(e)); setSaving(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--purple)' }}>{fmt(r.quantidade)}</span>
        <button onClick={() => { setQtd(r.quantidade); setEmbId(r.embalagem_id); setAberto(true) }}
          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-300)', opacity:.6, padding:2 }}
          title="Editar registro"><Pencil size={12}/></button>
      </div>

      {aberto && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAberto(false)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">✏️ Editar registro de produção</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                  {new Date(r.data_producao + 'T12:00:00').toLocaleDateString('pt-BR')}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setAberto(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Produto</label>
                <select className="form-input" value={embId} onChange={e => setEmbId(e.target.value)}>
                  {cats.map(cat => (
                    <optgroup key={cat} label={cat}>
                      {lista.filter(e => e.categoria === cat)
                        .sort((a,b) => a.nome.localeCompare(b.nome))
                        .map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Quantidade</label>
                <input type="number" min={0} className="form-input" value={qtd}
                  onChange={e => setQtd(e.target.value)} style={{ width: 140, textAlign: 'right' }} />
              </div>

              <div style={{ padding: '10px 14px', background: trocouProduto ? '#fff8f0' : 'var(--gray-50)',
                border: `1px solid ${trocouProduto ? 'var(--warning)' : 'var(--gray-200)'}`,
                borderRadius: 8, fontSize: 12, color: 'var(--gray-600)', lineHeight: 1.5 }}>
                {trocouProduto && <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 4 }}>
                  ⚠️ Troca de produto
                </div>}
                Ao salvar, o sistema devolve ao estoque a matéria-prima e a embalagem do registro
                atual e debita novamente conforme a ficha técnica do produto escolhido.
              </div>

              {erro && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff0f0',
                  border: '1px solid var(--danger)', borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>{erro}</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={saving}>
                {saving ? 'Recalculando...' : 'Salvar e recalcular estoque'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  const [editarLote, setEditarLote] = useState(false)
  const [detalhe, setDetalhe] = useState([])
  const [loadingDetalhe, setLoadingDetalhe] = useState(false)
  const [embs, setEmbs] = useState({})
  const [todosRegistros, setTodosRegistros] = useState([])
  const [aba, setAba] = useState('log') // 'log' | 'pvr'

  useEffect(() => {
    supabase.from('embalagens').select('id,nome,codigo,categoria,tipo,visivel_producao,ativo').then(({ data }) => {
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
        <button className={`tab${aba === 'interno' ? ' active' : ''}`} onClick={() => setAba('interno')}>
          🍫 Recheios e Coberturas
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

      {aba === 'interno' && (
        <HistoricoInterno ano={ano} mes={mes} navMes={(delta) => {
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
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {detalhe.length > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditarLote(true)}>
                      <Pencil size={12}/> Editar lançamento
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => verDetalhe(diaSel)} title="Recarregar">
                    <RefreshCw size={12}/>
                  </button>
                </div>
              </div>

              {editarLote && (
                <EditarLote
                  dia={diaSel} itens={detalhe} embs={embs}
                  onClose={() => setEditarLote(false)}
                  onSaved={() => { setEditarLote(false); verDetalhe(diaSel) }}
                />
              )}
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

// ── Histórico de Recheios e Coberturas ───────────────────────────────────────
function HistoricoInterno({ ano, mes, navMes }) {
  const [dados, setDados] = useState([])
  const [loading, setLoading] = useState(false)
  const [filtroFase, setFiltroFase] = useState('todos')

  const FASE_LABEL = {
    massa:        { label: '🍞 Massa',         cor: '#7d3c98' },
    recheio:      { label: '🥄 Recheio PM/Barra', cor: '#c0392b' },
    recheio_pote: { label: '🍮 Recheio Pote',  cor: '#d35400' },
    cobertura:    { label: '🍫 Cobertura',     cor: '#1a5276' },
    desperdicio:  { label: '⚠️ Desperdício',   cor: '#7f8c8d' },
  }
  const UNIDADE_LABEL = { receitas: 'receitas', pacotes: 'pcts' }

  useEffect(() => { load() }, [ano, mes])

  async function load() {
    setLoading(true)
    const ini = `${ano}-${String(mes+1).padStart(2,'0')}-01`
    const fim = new Date(ano, mes+1, 0).toISOString().slice(0,10)
    const { data } = await supabase
      .from('producao_interna')
      .select('*')
      .gte('data_producao', ini)
      .lte('data_producao', fim)
      .order('data_producao', { ascending: false })
      .order('registrado_em', { ascending: false })
    setDados(data || [])
    setLoading(false)
  }

  function exportarCSV() {
    const rows = [['Data','Fase','Item','Quantidade','Unidade','Responsável','Observação']]
    for (const r of dados) {
      rows.push([
        new Date(r.data_producao+'T12:00:00').toLocaleDateString('pt-BR'),
        FASE_LABEL[r.fase]?.label || r.fase,
        r.item, r.quantidade||'', r.unidade||'', r.registrado_por||'', r.observacao||''
      ])
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url
    a.download=`Recheios_Coberturas_${MESES[mes]}_${ano}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // Agrupa por item para totais do mês
  const totaisPorItem = {}
  for (const r of dados) {
    if (!r.quantidade || r.fase === 'desperdicio') continue
    const fase = filtroFase === 'todos' || filtroFase === r.fase
    if (!fase) continue
    const key = `${r.fase}||${r.item}||${r.unidade}`
    if (!totaisPorItem[key]) totaisPorItem[key] = { fase: r.fase, item: r.item, unidade: r.unidade, total: 0 }
    totaisPorItem[key].total += r.quantidade
  }

  const dadosFiltrados = filtroFase === 'todos' ? dados : dados.filter(r => r.fase === filtroFase)
  // Agrupa por data
  const porData = {}
  for (const r of dadosFiltrados) {
    if (!porData[r.data_producao]) porData[r.data_producao] = []
    porData[r.data_producao].push(r)
  }

  return (
    <>
      {/* Header */}
      <div className="card card-pad" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navMes(-1)}>‹</button>
          <span style={{ fontWeight:800, fontSize:15 }}>{MESES[mes]} {ano}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => navMes(1)}>›</button>
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {[['todos','Todos'], ...Object.entries(FASE_LABEL).map(([k,v]) => [k, v.label])].map(([v,l]) => (
            <button key={v} className={`btn btn-xs ${filtroFase===v?'btn-primary':'btn-ghost'}`}
              onClick={() => setFiltroFase(v)}>{l}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={exportarCSV} disabled={!dados.length}>
            <Download size={13}/> CSV
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={14}/></button>
        </div>
      </div>

      {/* KPIs do mês */}
      {Object.keys(totaisPorItem).length > 0 && (
        <div className="card card-pad">
          <div style={{ fontWeight:700, fontSize:13, marginBottom:10, color:'var(--gray-600)' }}>
            Totais do mês — {MESES[mes]} {ano}
          </div>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
            {Object.values(totaisPorItem)
              .sort((a,b) => a.fase.localeCompare(b.fase) || a.item.localeCompare(b.item))
              .map((t, i) => {
                const fl = FASE_LABEL[t.fase]
                return (
                  <div key={i} style={{ padding:'8px 14px', borderRadius:8, background:'var(--gray-50)', border:'1px solid var(--gray-200)', minWidth:160 }}>
                    <div style={{ fontSize:10, fontWeight:700, color: fl?.cor || 'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.04em' }}>
                      {fl?.label || t.fase}
                    </div>
                    <div style={{ fontWeight:700, fontSize:13, marginTop:2 }}>{t.item}</div>
                    <div style={{ fontSize:18, fontWeight:800, color: fl?.cor || 'var(--purple)' }}>
                      {(() => { const n = parseFloat(t.total) || 0; return n % 1 === 0 ? n : n.toFixed(1) })()}
                      <span style={{ fontSize:12, fontWeight:400, color:'var(--gray-500)', marginLeft:4 }}>
                        {UNIDADE_LABEL[t.unidade] || t.unidade}
                      </span>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Tabela por dia */}
      <div className="card">
        {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> :
          Object.keys(porData).length === 0 ? (
            <div className="empty card-pad">
              <div className="empty-icon">🍫</div>
              <div className="empty-title">Nenhum registro em {MESES[mes]}</div>
              <div className="empty-sub">Os recheios e coberturas registrados no formulário de produção aparecem aqui</div>
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)', borderBottom:'2px solid var(--gray-200)' }}>
                  <th style={{ padding:'10px 14px', textAlign:'left' }}>Data</th>
                  <th style={{ padding:'10px 10px', textAlign:'left' }}>Tipo</th>
                  <th style={{ padding:'10px 10px', textAlign:'left' }}>Item</th>
                  <th style={{ padding:'10px 10px', textAlign:'right' }}>Quantidade</th>
                  <th style={{ padding:'10px 10px', textAlign:'left' }}>Responsável</th>
                  <th style={{ padding:'10px 10px', textAlign:'left' }}>Observação</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(porData).map(([data, itens]) => {
                  const dt = new Date(data+'T12:00:00')
                  return itens.map((r, i) => {
                    const fl = FASE_LABEL[r.fase]
                    return (
                      <tr key={r.id} style={{ borderTop:'1px solid var(--gray-100)', background: i===0 && data ? '#fafafa' : '#fff' }}>
                        {i === 0 && (
                          <td rowSpan={itens.length} style={{ padding:'10px 14px', fontWeight:700, verticalAlign:'top', borderRight:'1px solid var(--gray-100)' }}>
                            {dt.toLocaleDateString('pt-BR')}
                            <div style={{ fontSize:11, color:'var(--gray-400)', fontWeight:400 }}>
                              {dt.toLocaleDateString('pt-BR',{weekday:'short'})}
                            </div>
                          </td>
                        )}
                        <td style={{ padding:'8px 10px' }}>
                          <span style={{ fontSize:11, fontWeight:700, color: fl?.cor || 'var(--gray-500)', background: fl ? fl.cor+'18' : 'var(--gray-100)', padding:'2px 7px', borderRadius:4 }}>
                            {fl?.label || r.fase}
                          </span>
                        </td>
                        <td style={{ padding:'8px 10px', fontWeight:600 }}>{r.item}</td>
                        <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:800, color:'var(--purple)' }}>
                          {r.quantidade != null ? (() => {
                            const n = parseFloat(r.quantidade) || 0
                            const v = r.fase === 'cobertura' ? n : (n % 1 === 0 ? n : n.toFixed(1))
                            return `${v} ${UNIDADE_LABEL[r.unidade] || r.unidade || ''}`
                          })() : '—'}
                        </td>
                        <td style={{ padding:'8px 10px', fontSize:12, color:'var(--gray-500)' }}>{r.registrado_por}</td>
                        <td style={{ padding:'8px 10px', fontSize:12, color:'var(--gray-500)', fontStyle: r.observacao ? 'italic' : 'normal' }}>{r.observacao || '—'}</td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          )
        }
      </div>
    </>
  )
}
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

    // Planejamentos do período — apenas o mais recente por dia
    const { data: plansAll } = await supabase
      .from('planejamentos').select('id, data_producao, criado_em')
      .gte('data_producao', ini).lte('data_producao', fim)
      .order('criado_em', { ascending: false })

    // Filtra: só o mais recente por data_producao
    const ultimoPorDia = {}
    for (const p of (plansAll || [])) {
      if (!ultimoPorDia[p.data_producao]) ultimoPorDia[p.data_producao] = p
    }
    const plans = Object.values(ultimoPorDia)

    const planIds = plans.map(p => p.id)
    const planDataMap = {}
    plans.forEach(p => { planDataMap[p.id] = p.data_producao })

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
