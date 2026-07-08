import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR, mesLabel } from '../lib/financeiro'
import { RefreshCw, Check, X, Edit3 } from 'lucide-react'

function pct(v, base) { return base !== 0 ? (v / base) * 100 : 0 }
function fmtPct(v) { return v.toFixed(1) + '%' }

// Célula editável — clique para editar valor
function Celula({ valor, onSave }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef()

  function iniciar() {
    setDraft(valor !== 0 ? String(valor) : '')
    setEditando(true)
    setTimeout(() => ref.current?.select(), 30)
  }
  function salvar() {
    const v = parseFloat(String(draft).replace(',', '.')) || 0
    onSave(v)
    setEditando(false)
  }

  if (editando) return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
      <input ref={ref} type="number" step={0.01} value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setEditando(false) }}
        style={{ width: 96, padding: '3px 6px', fontSize: 12, border: '2px solid var(--purple)', borderRadius: 5, outline: 'none' }} />
      <button onClick={salvar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ok)', padding: 2 }}><Check size={12} /></button>
      <button onClick={() => setEditando(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}><X size={12} /></button>
    </div>
  )

  return (
    <div onClick={iniciar} title="Clique para editar"
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end', minHeight: 24 }}>
      <span style={{ color: valor !== 0 ? 'var(--gray-800)' : 'var(--gray-200)', fontWeight: valor !== 0 ? 500 : 400, fontSize: 13 }}>
        {valor !== 0 ? fmtR(valor) : '—'}
      </span>
      <Edit3 size={9} style={{ opacity: .25, flexShrink: 0 }} />
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
  const [grupoCats, setGrupoCats] = useState({})  // grupoId → [{id, nome, subcats}]
  const [todasCats, setTodasCats] = useState([])   // todas as fin_categorias
  const [ajustes, setAjustes] = useState({})       // "mes__grupoId__catId" ou "mes__grupoId" → valor
  const [loading, setLoading] = useState(true)
  const [expandidos, setExpandidos] = useState(new Set())

  // Gera lista de meses do período
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

  // Carrega estrutura (grupos + vínculos de categoria) e ajustes salvos
  const carregar = useCallback(async () => {
    setLoading(true)
    const [{ data: gs }, { data: gcs }, { data: cats }, { data: ajs }] = await Promise.all([
      supabase.from('fin_dre_grupos').select('*').eq('ativo', true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_dre_grupo_cats').select('*, fin_categorias(id,nome)'),
      supabase.from('fin_categorias').select('*').eq('ativo', true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_dre_ajustes').select('*')
        .gte('ano_mes', anoMesIni).lte('ano_mes', anoMesFim),
    ])

    setGrupos(gs || [])
    setTodasCats(cats || [])

    // Expande grupos e categorias vinculadas
    const allGrupoIds = (gs || []).map(g => g.id)
    const catExpIds = []
    for (const gc of (gcs || [])) {
      catExpIds.push(`cat-${gc.grupo_id}-${gc.categoria_id}`)
      // Expande subcategorias também
      const subs = (cats || []).filter(c => c.parent_id === gc.categoria_id)
      for (const s of subs) catExpIds.push(`cat-${gc.grupo_id}-${s.id}`)
    }
    setExpandidos(new Set([...allGrupoIds, ...catExpIds]))

    const gcMap = {}
    for (const gc of (gcs || [])) {
      if (!gcMap[gc.grupo_id]) gcMap[gc.grupo_id] = []
      gcMap[gc.grupo_id].push({ id: gc.categoria_id, nome: gc.fin_categorias?.nome || '' })
    }
    setGrupoCats(gcMap)

    const ajMap = {}
    for (const aj of (ajs || [])) {
      // suporta chave com ou sem catId
      const key = aj.categoria_id
        ? `${aj.ano_mes}__${aj.grupo_id}__${aj.categoria_id}`
        : `${aj.ano_mes}__${aj.grupo_id}`
      ajMap[key] = aj.valor
    }
    setAjustes(ajMap)
    setLoading(false)
  }, [anoMesIni, anoMesFim])

  useEffect(() => { carregar() }, [carregar])

  // Salva ajuste — suporta nível de grupo ou categoria dentro de grupo
  async function salvarValor(mes, grupoId, valor, catId = null) {
    const usuario = JSON.parse(sessionStorage.getItem('usuario') || '{}').nome
    const key = catId ? `${mes}__${grupoId}__${catId}` : `${mes}__${grupoId}`
    setAjustes(prev => ({ ...prev, [key]: valor }))

    await supabase.from('fin_dre_ajustes').upsert(
      { ano_mes: mes, grupo_id: grupoId, categoria_id: catId || null, canal_id: null, valor, criado_por: usuario },
      { onConflict: 'ano_mes,categoria_id,grupo_id,canal_id' }
    )
  }

  // Retorna subcategorias diretas de uma categoria (dentro de todasCats)
  function subcatsOf(catId) {
    return todasCats.filter(c => c.parent_id === catId).sort((a,b) => (a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))
  }

  // Valor de uma categoria (folha ou soma de filhos) num grupo/mês
  function valorCat(mes, grupoId, catId) {
    const subs = subcatsOf(catId)
    if (subs.length > 0) return subs.reduce((s,c) => s + valorCat(mes, grupoId, c.id), 0)
    return ajustes[`${mes}__${grupoId}__${catId}`] || 0
  }

  // Valor de um grupo = soma das categorias vinculadas (cada cat pode ter subs)
  // Se grupo não tem cats vinculadas, usa ajuste direto do grupo
  function valorGrupo(mes, grupo) {
    const filhos = grupos.filter(g => g.parent_id === grupo.id)
    if (filhos.length > 0) return filhos.reduce((s, f) => s + valorGrupo(mes, f), 0)
    const cats = grupoCats[grupo.id] || []
    if (cats.length > 0) return cats.reduce((s,c) => s + valorCat(mes, grupo.id, c.id), 0)
    return ajustes[`${mes}__${grupo.id}`] || 0
  }

  // Renderiza linhas de categorias vinculadas a um grupo (com hierarquia)
  function renderCatRows(grupoId, catId, nivel, indent) {
    const cat = todasCats.find(c => c.id === catId)
    if (!cat) return []
    const subs = subcatsOf(catId)
    const temSubs = subs.length > 0
    const rows = []
    const bg = nivel === 1 ? '#fafafa' : '#f5f5f5'
    const fs = nivel === 1 ? 12 : 11
    const fw = nivel === 1 ? 500 : 400
    const expKey = `cat-${grupoId}-${catId}`
    const exp = expandidos.has(expKey)

    rows.push(
      <tr key={expKey} style={{ borderBottom: '1px solid var(--gray-100)' }}>
        <td style={{ padding: `6px 14px 6px ${indent}px`, position: 'sticky', left: 0, background: bg, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {temSubs
              ? <button onClick={() => toggleExp(expKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple)', padding: '0 1px', fontSize: 10, lineHeight: 1, flexShrink: 0 }}>
                  {exp ? '▼' : '▶'}
                </button>
              : <span style={{ width: 14, flexShrink: 0 }} />
            }
            <span style={{ fontWeight: fw, fontSize: fs, color: 'var(--gray-600)' }}>{cat.nome}</span>
          </div>
        </td>
        {meses.map(m => {
          const v = valorCat(m, grupoId, catId)
          const st = calcSubtotais(m)
          const base = st.fl || st.fb || 0
          return (
            <td key={m} style={{ padding: '4px 10px', textAlign: 'right', background: bg }}>
              {!temSubs
                ? <Celula valor={v} onSave={val => salvarValor(m, grupoId, val, catId)} />
                : <span style={{ fontWeight: 600, fontSize: fs, color: v !== 0 ? 'var(--gray-700)' : 'var(--gray-300)' }}>{v !== 0 ? fmtR(v) : '—'}</span>
              }
              {mostrarPct && base > 0 && v !== 0 && (
                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>
              )}
            </td>
          )
        })}
        <td style={{ padding: '4px 10px', textAlign: 'right', background: bg, fontSize: fs, fontWeight: fw, color: 'var(--gray-500)' }}>
          {(() => { const t = meses.reduce((s,m)=>s+valorCat(m,grupoId,catId),0); return t !== 0 ? fmtR(t) : '—' })()}
        </td>
      </tr>
    )

    // Renderiza subcategorias se expandido
    if (exp && temSubs) {
      for (const sub of subs) {
        rows.push(...renderCatRows(grupoId, sub.id, nivel + 1, indent + 14))
      }
    }

    return rows
  }

  // Calcula subtotais acumulados por mês
  function calcSubtotais(mes) {
    const st = {}
    let acum = 0
    for (const g of grupos.filter(x => !x.parent_id).sort((a, b) => a.ordem - b.ordem)) {
      const v = valorGrupo(mes, g)
      acum += g.operacao === '+' ? v : -v
      if (g.subtotal_key) st[g.subtotal_key] = acum
    }
    return st
  }

  // Total de um grupo no período completo
  function totalPeriodo(grupo) {
    return meses.reduce((s, m) => s + valorGrupo(m, grupo), 0)
  }

  function toggleExp(id) {
    setExpandidos(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Renderiza grupo recursivamente com categorias vinculadas
  function renderGrupo(grupo, nivel = 1) {
    const filhos = grupos.filter(g => g.parent_id === grupo.id).sort((a, b) => a.ordem - b.ordem)
    const temFilhos = filhos.length > 0
    const cats = grupoCats[grupo.id] || []
    const temCats = cats.length > 0
    const exp = expandidos.has(grupo.id)
    const indent = 14 + (nivel - 1) * 18
    const bg = nivel === 1 ? 'var(--white)' : nivel === 2 ? '#fafafa' : '#f7f7f7'
    const fs = nivel === 1 ? 13 : nivel === 2 ? 12 : 11
    const fw = nivel === 1 ? 600 : nivel === 2 ? 500 : 400

    const rows = []

    // Linha do grupo
    rows.push(
      <tr key={grupo.id} style={{ borderBottom: (exp && (temFilhos || temCats)) ? 'none' : '1px solid var(--gray-100)' }}>
        <td style={{ padding: `7px 14px 7px ${indent}px`, position: 'sticky', left: 0, background: bg, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {(temFilhos || temCats)
              ? <button onClick={() => toggleExp(grupo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple)', padding: '0 1px', fontSize: 11, lineHeight: 1, flexShrink: 0 }}>
                  {exp ? '▼' : '▶'}
                </button>
              : <span style={{ width: 14, flexShrink: 0 }} />
            }
            <span style={{ width: 8, height: 8, borderRadius: 2, background: grupo.cor || 'var(--gray-300)', flexShrink: 0 }} />
            <span style={{ fontWeight: fw, fontSize: fs, color: nivel === 1 ? 'var(--gray-700)' : 'var(--gray-600)' }}>{grupo.nome}</span>
          </div>
        </td>
        {meses.map(m => {
          const v = valorGrupo(m, grupo)
          const st = calcSubtotais(m)
          const base = st[grupo.base_pct || 'fl'] || st.fb || 0
          return (
            <td key={m} style={{ padding: '5px 10px', textAlign: 'right', background: bg }}>
              {/* Grupo sem filhos nem cats = editável direto */}
              {!temFilhos && !temCats
                ? <Celula valor={v} onSave={val => salvarValor(m, grupo.id, val)} />
                : <span style={{ fontWeight: 700, fontSize: fs, color: v !== 0 ? 'var(--gray-700)' : 'var(--gray-300)' }}>{v !== 0 ? fmtR(v) : '—'}</span>
              }
              {mostrarPct && base > 0 && v !== 0 && (
                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>
              )}
            </td>
          )
        })}
        <td style={{ padding: '5px 10px', textAlign: 'right', background: bg, fontWeight: fw, fontSize: fs, color: 'var(--gray-600)' }}>
          {(() => { const t = totalPeriodo(grupo); return t !== 0 ? fmtR(t) : '—' })()}
        </td>
      </tr>
    )

    if (exp) {
      // Sub-grupos
      if (temFilhos) {
        for (const f of filhos) rows.push(...renderGrupo(f, nivel + 1))
      }
      // Categorias vinculadas (com hierarquia de subcategorias)
      if (temCats) {
        for (const cat of cats) {
          rows.push(...renderCatRows(grupo.id, cat.id, 1, indent + 18))
        }
      }
      rows.push(<tr key={`${grupo.id}__sep`}><td colSpan={meses.length + 2} style={{ height: 1, background: 'var(--gray-100)' }} /></tr>)
    }

    return rows
  }

  const gruposRaiz = grupos.filter(g => !g.parent_id).sort((a, b) => a.ordem - b.ordem)

  return (
    <>
      {/* Filtros */}
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
          💡 Clique em qualquer célula para inserir ou editar o valor manualmente · Configure a estrutura em Config → Cascata DRE
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
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 14px', minWidth: 260, background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)', position: 'sticky', left: 0, zIndex: 2, fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
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
                {gruposRaiz.map(grupo => {
                  const rows = []

                  // Cabeçalho do grupo principal (seção)
                  rows.push(
                    <tr key={`h-${grupo.id}`}>
                      <td colSpan={meses.length + 2} style={{
                        background: grupo.operacao === '+' ? '#e8fdf0' : '#fff0f0',
                        padding: '6px 14px', fontWeight: 800, fontSize: 11,
                        color: grupo.cor || 'var(--gray-700)',
                        textTransform: 'uppercase', letterSpacing: '.05em',
                        borderTop: '2px solid ' + (grupo.cor || 'var(--gray-300)'),
                      }}>
                        {grupo.nome}
                      </td>
                    </tr>
                  )

                  // Sub-grupos (filhos do raiz)
                  const filhos = grupos.filter(g => g.parent_id === grupo.id).sort((a, b) => a.ordem - b.ordem)
                  if (filhos.length > 0) {
                    for (const f of filhos) rows.push(...renderGrupo(f, 1))
                  } else {
                    // Grupo raiz sem filhos = linha editável diretamente
                    rows.push(
                      <tr key={`v-${grupo.id}`} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                        <td style={{ padding: '7px 14px 7px 28px', position: 'sticky', left: 0, background: 'var(--white)', zIndex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: grupo.cor || 'var(--gray-300)', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--gray-600)' }}>{grupo.nome}</span>
                            {(grupoCats[grupo.id] || []).length > 0 && (
                              <span style={{ fontSize: 10, color: 'var(--gray-300)' }}>
                                ({(grupoCats[grupo.id] || []).map(c => c.nome).join(', ')})
                              </span>
                            )}
                          </div>
                        </td>
                        {meses.map(m => {
                          const v = valorGrupo(m, grupo)
                          const st = calcSubtotais(m)
                          const base = st[grupo.base_pct || 'fl'] || st.fb || 0
                          return (
                            <td key={m} style={{ padding: '5px 10px', textAlign: 'right' }}>
                              <Celula valor={v} onSave={val => salvarValor(m, grupo.id, val)} />
                              {mostrarPct && base > 0 && v !== 0 && (
                                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>
                              )}
                            </td>
                          )
                        })}
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontSize: 12, color: 'var(--gray-600)' }}>
                          {(() => { const t = totalPeriodo(grupo); return t !== 0 ? fmtR(t) : '—' })()}
                        </td>
                      </tr>
                    )
                  }

                  // Subtotal (Faturamento Líquido, Lucro Bruto, etc.)
                  if (grupo.subtotal_label && grupo.subtotal_key) {
                    const chave = grupo.subtotal_key
                    const totPer = meses.reduce((s, m) => s + (calcSubtotais(m)[chave] || 0), 0)
                    rows.push(
                      <tr key={`st-${grupo.id}`} style={{ borderTop: '2px solid var(--gray-300)', background: chave === 'res' || chave === 'll' ? 'var(--purple-pale)' : 'var(--gray-50)' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 800, fontSize: 14, color: chave === 'res' || chave === 'll' ? 'var(--purple)' : 'var(--gray-700)', position: 'sticky', left: 0, background: chave === 'res' || chave === 'll' ? 'var(--purple-pale)' : 'var(--gray-50)', zIndex: 1 }}>
                          {grupo.subtotal_label}
                        </td>
                        {meses.map(m => {
                          const s = calcSubtotais(m)
                          const v = s[chave] || 0
                          const base = s[grupo.base_pct || 'fl'] || s.fb || 0
                          const isRes = chave === 'res' || chave === 'll'
                          return (
                            <td key={m} style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 800, fontSize: 14, color: v >= 0 ? (isRes ? 'var(--purple)' : 'var(--ok)') : 'var(--danger)' }}>
                              {fmtR(v)}
                              {mostrarPct && base > 0 && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--gray-400)' }}>{fmtPct(pct(v, base))}</div>}
                            </td>
                          )
                        })}
                        <td style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 800, fontSize: 14, color: totPer >= 0 ? (chave === 'res' || chave === 'll' ? 'var(--purple)' : 'var(--ok)') : 'var(--danger)' }}>
                          {fmtR(totPer)}
                        </td>
                      </tr>
                    )
                  }

                  return rows
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
