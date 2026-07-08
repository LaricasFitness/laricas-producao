import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, Check, X } from 'lucide-react'

function pct(v, base) { return base !== 0 ? (v / base) * 100 : 0 }
function fmtPct(v) { return v.toFixed(1) + '%' }

function Celula({ valor, onSave }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef()

  function iniciar() {
    setDraft(valor !== 0 ? String(valor).replace('.', ',') : '')
    setEditando(true)
    setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30)
  }
  function confirmar() {
    const v = parseFloat(String(draft).replace(',', '.')) || 0
    onSave(v)
    setEditando(false)
  }

  if (editando) return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
      <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') setEditando(false) }}
        style={{ width: 90, padding: '3px 6px', fontSize: 12, border: '2px solid var(--purple)', borderRadius: 5, outline: 'none', textAlign: 'right' }} />
      <button onClick={confirmar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ok)', padding: 1 }}><Check size={12} /></button>
      <button onClick={() => setEditando(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 1 }}><X size={12} /></button>
    </div>
  )

  return (
    <div onClick={iniciar} title="Clique para editar"
      style={{ cursor: 'text', textAlign: 'right', minHeight: 22, padding: '1px 2px', borderRadius: 4, transition: 'background .1s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-100)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontSize: 13, color: valor !== 0 ? 'var(--gray-800)' : 'var(--gray-300)' }}>
        {valor !== 0 ? fmtR(valor) : '—'}
      </span>
    </div>
  )
}

export default function FinDRE() {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const [anoMesIni, setAnoMesIni] = useState(`${anoAtual}-01`)
  const [anoMesFim, setAnoMesFim] = useState(`${anoAtual}-${String(hoje.getMonth() + 1).padStart(2, '0')}`)
  const [mostrarPct, setMostrarPct] = useState(true)
  const [grupos, setGrupos] = useState([])
  const [grupoCats, setGrupoCats] = useState({})   // grupoId → [{id, nome}]
  const [todasCats, setTodasCats] = useState([])    // todas fin_categorias
  const [ajustes, setAjustes] = useState({})        // chave → valor
  const [loading, setLoading] = useState(true)
  const [expandidos, setExpandidos] = useState(new Set())

  const meses = (() => {
    const res = []
    const [ai, mi] = anoMesIni.split('-').map(Number)
    const [af, mf] = anoMesFim.split('-').map(Number)
    let a = ai, m = mi
    while (a < af || (a === af && m <= mf)) {
      res.push(`${a}-${String(m).padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; a++ }
    }
    return res
  })()

  const carregar = useCallback(async () => {
    setLoading(true)
    const [{ data: gs }, { data: gcs }, { data: cats }, { data: ajs }] = await Promise.all([
      supabase.from('fin_dre_grupos').select('*').eq('ativo', true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_dre_grupo_cats').select('*, fin_categorias(id,nome)'),
      supabase.from('fin_categorias').select('*').eq('ativo', true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_dre_ajustes').select('*').gte('ano_mes', anoMesIni).lte('ano_mes', anoMesFim),
    ])

    setGrupos(gs || [])
    setTodasCats(cats || [])

    const gcMap = {}
    for (const gc of (gcs || [])) {
      if (!gcMap[gc.grupo_id]) gcMap[gc.grupo_id] = []
      gcMap[gc.grupo_id].push({ id: gc.categoria_id, nome: gc.fin_categorias?.nome || '' })
    }
    setGrupoCats(gcMap)

    const ajMap = {}
    for (const aj of (ajs || [])) {
      // chave: mes__grupoId__catId  ou  mes__grupoId (sem cat)
      const key = aj.categoria_id
        ? `${aj.ano_mes}__${aj.grupo_id}__${aj.categoria_id}`
        : `${aj.ano_mes}__${aj.grupo_id}`
      ajMap[key] = aj.valor
    }
    setAjustes(ajMap)

    // Expande tudo por padrão
    const allIds = new Set([...(gs || []).map(g => g.id)])
    for (const gc of (gcs || [])) {
      allIds.add(`c-${gc.grupo_id}-${gc.categoria_id}`)
      for (const sub of (cats || []).filter(c => c.parent_id === gc.categoria_id)) {
        allIds.add(`c-${gc.grupo_id}-${sub.id}`)
      }
    }
    setExpandidos(allIds)
    setLoading(false)
  }, [anoMesIni, anoMesFim])

  useEffect(() => { carregar() }, [carregar])

  async function salvarValor(mes, grupoId, catId, valor) {
    const chave = catId ? `${mes}__${grupoId}__${catId}` : `${mes}__${grupoId}`
    // Atualiza estado imediatamente
    setAjustes(prev => ({ ...prev, [chave]: valor }))

    // Verifica se já existe registro
    let q = supabase.from('fin_dre_ajustes').select('id')
      .eq('ano_mes', mes).eq('grupo_id', grupoId)
    if (catId) q = q.eq('categoria_id', catId)
    else q = q.is('categoria_id', null)
    const { data: existing } = await q.maybeSingle()

    const usuario = JSON.parse(sessionStorage.getItem('usuario') || '{}').nome
    if (existing?.id) {
      await supabase.from('fin_dre_ajustes').update({ valor, criado_por: usuario }).eq('id', existing.id)
    } else {
      await supabase.from('fin_dre_ajustes').insert({
        ano_mes: mes, grupo_id: grupoId,
        categoria_id: catId || null, canal_id: null,
        valor, criado_por: usuario,
      })
    }
  }

  function toggleExp(id) {
    setExpandidos(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function subcatsOf(catId) {
    return todasCats.filter(c => c.parent_id === catId)
      .sort((a, b) => (a.ordem || 99) - (b.ordem || 99) || a.nome.localeCompare(b.nome))
  }

  // Valor de uma categoria (soma filhos se tiver, senão ajuste direto)
  function valorCat(mes, grupoId, catId) {
    const subs = subcatsOf(catId)
    if (subs.length > 0) return subs.reduce((s, c) => s + valorCat(mes, grupoId, c.id), 0)
    return ajustes[`${mes}__${grupoId}__${catId}`] || 0
  }

  // Valor de um grupo (soma sub-grupos, ou soma cats vinculadas, ou ajuste direto)
  function valorGrupo(mes, grupoId) {
    const subGrupos = grupos.filter(g => g.parent_id === grupoId)
    if (subGrupos.length > 0) return subGrupos.reduce((s, g) => s + valorGrupo(mes, g.id), 0)
    const cats = grupoCats[grupoId] || []
    if (cats.length > 0) return cats.reduce((s, c) => s + valorCat(mes, grupoId, c.id), 0)
    return ajustes[`${mes}__${grupoId}`] || 0
  }

  // Subtotais acumulados
  function calcSubtotais(mes) {
    const st = { fb: 0 }
    let acum = 0
    for (const g of grupos.filter(x => !x.parent_id).sort((a, b) => a.ordem - b.ordem)) {
      const v = valorGrupo(mes, g.id)
      acum += g.operacao === '+' ? v : -v
      if (g.subtotal_key) st[g.subtotal_key] = acum
    }
    st.fb = st.fb || acum
    return st
  }

  // Renderiza linhas de categoria + subcategorias recursivamente
  function renderCatRows(grupoId, catId, depth) {
    const cat = todasCats.find(c => c.id === catId)
    if (!cat) return []
    const subs = subcatsOf(catId)
    const temSubs = subs.length > 0
    const expKey = `c-${grupoId}-${catId}`
    const exp = expandidos.has(expKey)
    const indent = 28 + depth * 14
    const bg = depth === 0 ? '#fafafa' : '#f4f4f4'
    const rows = []

    rows.push(
      <tr key={expKey} style={{ borderBottom: '1px solid var(--gray-100)' }}>
        <td style={{ padding: `6px 14px 6px ${indent}px`, position: 'sticky', left: 0, background: bg, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {temSubs
              ? <button onClick={() => toggleExp(expKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple)', padding: '0 1px', fontSize: 10, lineHeight: 1, flexShrink: 0 }}>
                  {exp ? '▼' : '▶'}
                </button>
              : <span style={{ width: 12, flexShrink: 0 }} />
            }
            <span style={{ fontSize: depth === 0 ? 12 : 11, fontWeight: depth === 0 ? 500 : 400, color: 'var(--gray-600)' }}>
              {depth > 0 ? '└ ' : ''}{cat.nome}
            </span>
          </div>
        </td>
        {meses.map(m => {
          const v = valorCat(m, grupoId, catId)
          const st = calcSubtotais(m)
          const base = st.fl || st.fb || 0
          return (
            <td key={m} style={{ padding: '4px 10px', textAlign: 'right', background: bg }}>
              {!temSubs
                ? <Celula valor={v} onSave={val => salvarValor(m, grupoId, catId, val)} />
                : <span style={{ fontSize: 12, color: v !== 0 ? 'var(--gray-700)' : 'var(--gray-300)' }}>{v !== 0 ? fmtR(v) : '—'}</span>
              }
              {mostrarPct && base > 0 && v !== 0 && (
                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>
              )}
            </td>
          )
        })}
        <td style={{ padding: '4px 10px', textAlign: 'right', background: bg, fontSize: 12, color: 'var(--gray-500)' }}>
          {(() => { const t = meses.reduce((s, m) => s + valorCat(m, grupoId, catId), 0); return t !== 0 ? fmtR(t) : '—' })()}
        </td>
      </tr>
    )

    if (exp && temSubs) {
      for (const sub of subs) rows.push(...renderCatRows(grupoId, sub.id, depth + 1))
    }
    return rows
  }

  // Renderiza sub-grupo com suas categorias
  function renderSubGrupo(grupo, depth) {
    const subGrupos = grupos.filter(g => g.parent_id === grupo.id).sort((a, b) => a.ordem - b.ordem)
    const cats = grupoCats[grupo.id] || []
    const temFilhos = subGrupos.length > 0 || cats.length > 0
    const exp = expandidos.has(grupo.id)
    const indent = 14 + depth * 16
    const bg = depth === 0 ? 'var(--white)' : '#fafafa'
    const rows = []

    rows.push(
      <tr key={grupo.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
        <td style={{ padding: `7px 14px 7px ${indent}px`, position: 'sticky', left: 0, background: bg, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {temFilhos
              ? <button onClick={() => toggleExp(grupo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple)', padding: '0 1px', fontSize: 11, lineHeight: 1, flexShrink: 0 }}>
                  {exp ? '▼' : '▶'}
                </button>
              : <span style={{ width: 14, flexShrink: 0 }} />
            }
            <span style={{ width: 8, height: 8, borderRadius: 2, background: grupo.cor || 'var(--gray-300)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-700)' }}>{grupo.nome}</span>
          </div>
        </td>
        {meses.map(m => {
          const v = valorGrupo(m, grupo.id)
          const st = calcSubtotais(m)
          const base = st[grupo.base_pct || 'fl'] || st.fb || 0
          return (
            <td key={m} style={{ padding: '5px 10px', textAlign: 'right', background: bg }}>
              {!temFilhos
                ? <Celula valor={v} onSave={val => salvarValor(m, grupo.id, null, val)} />
                : <span style={{ fontWeight: 600, fontSize: 13, color: v !== 0 ? 'var(--gray-700)' : 'var(--gray-300)' }}>{v !== 0 ? fmtR(v) : '—'}</span>
              }
              {mostrarPct && base > 0 && v !== 0 && (
                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>
              )}
            </td>
          )
        })}
        <td style={{ padding: '5px 10px', textAlign: 'right', background: bg, fontWeight: 600, fontSize: 13, color: 'var(--gray-600)' }}>
          {(() => { const t = meses.reduce((s, m) => s + valorGrupo(m, grupo.id), 0); return t !== 0 ? fmtR(t) : '—' })()}
        </td>
      </tr>
    )

    if (exp) {
      for (const sg of subGrupos) rows.push(...renderSubGrupo(sg, depth + 1))
      for (const cat of cats) rows.push(...renderCatRows(grupo.id, cat.id, 0))
    }
    return rows
  }

  const gruposRaiz = grupos.filter(g => !g.parent_id).sort((a, b) => a.ordem - b.ordem)

  return (
    <>
      <div className="card card-pad">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="month" className="form-input" value={anoMesIni} onChange={e => setAnoMesIni(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="month" className="form-input" value={anoMesFim} onChange={e => setAnoMesFim(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={mostrarPct} onChange={e => setMostrarPct(e.target.checked)} style={{ accentColor: 'var(--purple)' }} />
            % sobre base
          </label>
          <button className="btn btn-ghost" onClick={carregar} style={{ marginBottom: 6 }}><RefreshCw size={14} /></button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 4 }}>
          💡 Clique em qualquer célula para digitar o valor · Configure a estrutura em Config → Cascata DRE
        </div>
      </div>

      {loading && <div className="loading"><RefreshCw size={14} className="spin" /></div>}

      {!loading && gruposRaiz.length === 0 && (
        <div className="card card-pad empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhuma cascata configurada</div>
          <div className="empty-sub">Vá em Config → Cascata DRE para montar a estrutura</div>
        </div>
      )}

      {!loading && gruposRaiz.length > 0 && (
        <div className="card"><div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 14px', minWidth: 280, background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', position: 'sticky', left: 0, zIndex: 2, fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Categoria / Linha
                </th>
                {meses.map(m => (
                  <th key={m} style={{ textAlign: 'right', padding: '10px 10px', minWidth: 120, background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', fontWeight: 700, fontSize: 12, color: 'var(--gray-600)' }}>
                    {mesLabel(m)}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '10px 10px', minWidth: 120, background: 'var(--purple-pale)', borderBottom: '2px solid var(--purple)', fontWeight: 800, color: 'var(--purple)', fontSize: 12 }}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {gruposRaiz.flatMap(grupo => {
                const rows = []
                const subGrupos = grupos.filter(g => g.parent_id === grupo.id).sort((a, b) => a.ordem - b.ordem)
                const cats = grupoCats[grupo.id] || []

                // Banner do grupo raiz
                rows.push(
                  <tr key={`banner-${grupo.id}`}>
                    <td colSpan={meses.length + 2} style={{
                      background: grupo.operacao === '+' ? '#e8fdf0' : '#fff0f0',
                      padding: '7px 14px', fontWeight: 800, fontSize: 12,
                      color: grupo.cor || 'var(--gray-700)',
                      textTransform: 'uppercase', letterSpacing: '.05em',
                      borderTop: `2px solid ${grupo.cor || 'var(--gray-300)'}`,
                    }}>
                      {grupo.nome}
                    </td>
                  </tr>
                )

                // Sub-grupos ou categorias diretas do raiz
                if (subGrupos.length > 0) {
                  for (const sg of subGrupos) rows.push(...renderSubGrupo(sg, 0))
                } else {
                  // Grupo raiz sem sub-grupos: mostra categorias vinculadas diretamente
                  for (const cat of cats) rows.push(...renderCatRows(grupo.id, cat.id, 0))
                  // Se não tem cats nem sub-grupos, linha editável direta
                  if (cats.length === 0) {
                    rows.push(
                      <tr key={`direct-${grupo.id}`} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                        <td style={{ padding: '7px 14px 7px 28px', position: 'sticky', left: 0, background: 'var(--white)', zIndex: 1 }}>
                          <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{grupo.nome}</span>
                        </td>
                        {meses.map(m => (
                          <td key={m} style={{ padding: '5px 10px', textAlign: 'right' }}>
                            <Celula valor={ajustes[`${m}__${grupo.id}`] || 0} onSave={val => salvarValor(m, grupo.id, null, val)} />
                          </td>
                        ))}
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 12, color: 'var(--gray-600)' }}>
                          {(() => { const t = meses.reduce((s, m) => s + (ajustes[`${m}__${grupo.id}`] || 0), 0); return t !== 0 ? fmtR(t) : '—' })()}
                        </td>
                      </tr>
                    )
                  }
                }

                // Subtotal (ex: Faturamento Líquido, Lucro Bruto)
                if (grupo.subtotal_label && grupo.subtotal_key) {
                  const chave = grupo.subtotal_key
                  const isRes = ['res', 'll', 'lair'].includes(chave)
                  const totPer = meses.reduce((s, m) => s + (calcSubtotais(m)[chave] || 0), 0)
                  rows.push(
                    <tr key={`st-${grupo.id}`} style={{ borderTop: '2px solid var(--gray-300)', background: isRes ? 'var(--purple-pale)' : 'var(--gray-50)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 800, fontSize: 14, color: isRes ? 'var(--purple)' : 'var(--gray-700)', position: 'sticky', left: 0, background: isRes ? 'var(--purple-pale)' : 'var(--gray-50)', zIndex: 1 }}>
                        {grupo.subtotal_label}
                      </td>
                      {meses.map(m => {
                        const s = calcSubtotais(m)
                        const v = s[chave] || 0
                        const base = s.fl || s.fb || 0
                        return (
                          <td key={m} style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 800, fontSize: 14, color: v >= 0 ? (isRes ? 'var(--purple)' : 'var(--ok)') : 'var(--danger)' }}>
                            {fmtR(v)}
                            {mostrarPct && base > 0 && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>}
                          </td>
                        )
                      })}
                      <td style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 800, fontSize: 14, color: totPer >= 0 ? (isRes ? 'var(--purple)' : 'var(--ok)') : 'var(--danger)' }}>
                        {fmtR(totPer)}
                      </td>
                    </tr>
                  )
                }

                return rows
              })}
            </tbody>
          </table>
        </div></div>
      )}
    </>
  )
}
