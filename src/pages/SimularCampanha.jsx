import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, Trash2, Plus } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// Simular campanha de desconto (ex.: Black Friday).
// Mesma conta do Ranking de margem, por unidade:
//   receita líquida = preço promo × (1 − taxa − imposto − comissão)
//                     − embalagem − frete − outros (por unidade)
//   margem          = receita líquida − CMV
// O desconto da campanha SUBSTITUI o "desconto de campanhas" padrão do
// canal (não soma). Margem % sobre a receita líquida, como no Ranking.
// Volume: média diária produzida nos últimos 30 dias × dias × multiplicador.
// ═══════════════════════════════════════════════════════════════

function fmt(n, d = 2) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) }
function fmtR(n) { return `R$ ${fmt(n, 2)}` }
const fmtP = n => `${fmt(n * 100, 1)}%`

const MARGEM_ATENCAO = 0.15   // abaixo disso: laranja
const corMargem = (mc, mg) => mc < 0 ? 'var(--danger)' : mg < MARGEM_ATENCAO ? 'var(--warning)' : 'var(--ok)'
const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null }

const NOVA = { nome: '', canal_id: '', dias: 7, multiplicador: 1 }

export default function SimularCampanha({ data, cmvDe }) {
  const canais = data.canais || []
  const [campanhas, setCampanhas] = useState([])
  const [tabelaOk, setTabelaOk] = useState(true)
  const [campanhaId, setCampanhaId] = useState('')
  const [form, setForm] = useState({ ...NOVA, canal_id: canais[0]?.id || '' })
  const [itens, setItens] = useState({})          // sku → { desconto, qtd, preco } (strings dos inputs)
  const [mediaDiaria, setMediaDiaria] = useState({})
  const [sujo, setSujo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [filtroCat, setFiltroCat] = useState('Todas')
  const [busca, setBusca] = useState('')
  const [lote, setLote] = useState({ pct: '', cat: 'Todas' })

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setSujo(true) }
  const setItem = (sku, k, v) => { setItens(p => ({ ...p, [sku]: { ...p[sku], [k]: v } })); setSujo(true) }

  // Campanhas salvas
  async function carregarCampanhas() {
    const { data: rows, error } = await supabase.from('campanhas_simuladas').select('*').order('atualizado_em', { ascending: false })
    if (error) { setTabelaOk(false); return }
    setCampanhas(rows || [])
  }

  // Média diária produzida por SKU nos últimos 30 dias (produção real, sem auto-embalagem)
  async function carregarVolume() {
    const desde = new Date(); desde.setDate(desde.getDate() - 30)
    const codigoPorEmb = {}
    for (const p of data.produtos) codigoPorEmb[p.emb.id] = p.emb.codigo
    const total = {}
    for (let de = 0; ; de += 1000) {
      const { data: rows } = await supabase.from('producao_diaria')
        .select('id, embalagem_id, quantidade')
        .gte('data_producao', desde.toISOString().slice(0, 10))
        .not('registrado_por', 'ilike', '%(auto-embalagem)%')
        .order('id').range(de, de + 999)
      for (const r of (rows || [])) {
        const sku = codigoPorEmb[r.embalagem_id]
        if (sku) total[sku] = (total[sku] || 0) + (parseFloat(r.quantidade) || 0)
      }
      if (!rows || rows.length < 1000) break
    }
    const media = {}
    for (const [sku, t] of Object.entries(total)) media[sku] = t / 30
    setMediaDiaria(media)
  }

  useEffect(() => { carregarCampanhas(); carregarVolume() }, [])

  async function abrirCampanha(id) {
    if (sujo && !window.confirm('Há alterações não salvas. Abrir outra campanha mesmo assim?')) return
    setCampanhaId(id); setMsg('')
    if (!id) { setForm({ ...NOVA, canal_id: canais[0]?.id || '' }); setItens({}); setSujo(false); return }
    const c = campanhas.find(x => x.id === id)
    setForm({ nome: c.nome, canal_id: c.canal_id, dias: c.dias, multiplicador: c.multiplicador })
    const { data: rows } = await supabase.from('campanha_simulada_itens').select('*').eq('campanha_id', id)
    const m = {}
    for (const r of (rows || [])) m[r.sku_produto] = {
      desconto: r.desconto_pct ?? '', qtd: r.qtd_estimada ?? '', preco: r.preco_base ?? '',
    }
    setItens(m); setSujo(false)
  }

  async function salvar() {
    if (!form.nome.trim()) { setMsg('Dê um nome à campanha antes de salvar.'); return }
    setSalvando(true); setMsg('')
    try {
      const cab = {
        nome: form.nome.trim(), canal_id: form.canal_id,
        dias: parseInt(form.dias) || 1, multiplicador: num(form.multiplicador) || 1,
        atualizado_em: new Date().toISOString(),
      }
      let id = campanhaId
      if (id) {
        const { error } = await supabase.from('campanhas_simuladas').update(cab).eq('id', id)
        if (error) throw error
      } else {
        const { data: nova, error } = await supabase.from('campanhas_simuladas').insert(cab).select().single()
        if (error) throw error
        id = nova.id
      }
      await supabase.from('campanha_simulada_itens').delete().eq('campanha_id', id)
      const rows = Object.entries(itens)
        .map(([sku, it]) => ({ campanha_id: id, sku_produto: sku,
          desconto_pct: num(it.desconto), qtd_estimada: num(it.qtd), preco_base: num(it.preco) }))
        .filter(r => r.desconto_pct !== null || r.qtd_estimada !== null || r.preco_base !== null)
      if (rows.length) {
        const { error } = await supabase.from('campanha_simulada_itens').insert(rows)
        if (error) throw error
      }
      setCampanhaId(id); setSujo(false); setMsg('✓ Campanha salva')
      await carregarCampanhas()
    } catch (e) { setMsg('Erro ao salvar: ' + (e.message || e)) }
    setSalvando(false)
  }

  async function excluir() {
    if (!campanhaId || !window.confirm(`Excluir a simulação "${form.nome}"? Não afeta preços nem estoque.`)) return
    await supabase.from('campanhas_simuladas').delete().eq('id', campanhaId)
    setCampanhaId(''); setForm({ ...NOVA, canal_id: canais[0]?.id || '' }); setItens({}); setSujo(false)
    await carregarCampanhas()
  }

  function aplicarLote() {
    const pct = lote.pct
    if (pct === '' || num(pct) === null) return
    setItens(p => {
      const n = { ...p }
      for (const prod of data.produtos) {
        if (lote.cat !== 'Todas' && prod.emb.categoria !== lote.cat) continue
        n[prod.emb.codigo] = { ...n[prod.emb.codigo], desconto: pct }
      }
      return n
    })
    setSujo(true)
  }

  const canal = canais.find(c => c.id === form.canal_id) || canais[0]
  const categorias = useMemo(() => [...new Set(data.produtos.map(p => p.emb.categoria).filter(Boolean))].sort(), [data])
  const dias = parseInt(form.dias) || 0
  const mult = num(form.multiplicador) || 1

  const linhas = useMemo(() => {
    if (!canal) return []
    // Sem o desconto padrão do canal: o da campanha o substitui
    const pctCampanha = canal.taxa + canal.imposto + canal.comissao
    return data.produtos.filter(p => p.cmvTotal > 0).map(p => {
      const sku = p.emb.codigo
      const it = itens[sku] || {}
      const cmv = cmvDe(p)
      const preco = num(it.preco) ?? (parseFloat(p.precosCanal?.[canal.id]) || null)
      const desc = num(it.desconto) || 0
      const qtdBase = Math.round((mediaDiaria[sku] || 0) * dias)
      const qtdAuto = Math.round((mediaDiaria[sku] || 0) * dias * mult)
      const qtd = num(it.qtd) ?? qtdAuto
      if (!preco) return { p, sku, cmv, preco: null, desc, qtd, qtdAuto, qtdBase, it }
      const promo = preco * (1 - desc / 100)
      const recLiq = promo * (1 - pctCampanha) - canal.totalFixo
      const mc = recLiq - cmv
      const mg = recLiq > 0 ? mc / recLiq : 0
      const precoMin = pctCampanha < 1 ? (cmv + canal.totalFixo) / (1 - pctCampanha) : Infinity
      const descMax = Number.isFinite(precoMin) ? Math.max(0, (1 - precoMin / preco) * 100) : 0
      // Hoje, sem campanha (com o desconto padrão do canal)
      const recHoje = preco * (1 - canal.totalPct) - canal.totalFixo
      const mcHoje = recHoje - cmv
      return { p, sku, cmv, preco, desc, promo, recLiq, mc, mg, descMax, qtd, qtdAuto, qtdBase, it,
        mcHoje, mgHoje: recHoje > 0 ? mcHoje / recHoje : 0 }
    }).sort((a, b) => (a.p.emb.categoria || '').localeCompare(b.p.emb.categoria || '') || a.p.emb.nome.localeCompare(b.p.emb.nome))
  }, [data, canal, itens, mediaDiaria, dias, mult, cmvDe])

  const visiveis = linhas.filter(l =>
    (filtroCat === 'Todas' || l.p.emb.categoria === filtroCat) &&
    (!busca || l.p.emb.nome.toLowerCase().includes(busca.toLowerCase())))

  const comPreco = linhas.filter(l => l.preco)
  const tot = comPreco.reduce((t, l) => ({
    receita: t.receita + l.qtd * l.promo,
    recLiq: t.recLiq + l.qtd * l.recLiq,
    mc: t.mc + l.qtd * l.mc,
    unid: t.unid + l.qtd,
    mcHoje: t.mcHoje + l.qtdBase * l.mcHoje,
    prejuizo: t.prejuizo + (l.mc < 0 ? 1 : 0),
  }), { receita: 0, recLiq: 0, mc: 0, unid: 0, mcHoje: 0, prejuizo: 0 })
  const semPreco = linhas.filter(l => !l.preco).length

  if (!canal) return <div className="card card-pad">Cadastre os canais em Admin › Canais.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Campanha */}
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 200, flex: '1 1 200px' }}>
            <label className="form-label">Simulação</label>
            <select className="form-input" value={campanhaId} onChange={e => abrirCampanha(e.target.value)} disabled={!tabelaOk}>
              <option value="">+ Nova simulação</option>
              {campanhas.map(c => <option key={c.id} value={c.id}>{c.nome} · {canais.find(x => x.id === c.canal_id)?.label || c.canal_id}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: '2 1 220px' }}>
            <label className="form-label">Nome</label>
            <input className="form-input" value={form.nome} placeholder="Ex.: Black Friday 2026" onChange={e => set('nome', e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: '1 1 150px' }}>
            <label className="form-label">Canal</label>
            <select className="form-input" value={form.canal_id} onChange={e => set('canal_id', e.target.value)}>
              {canais.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ width: 90 }}>
            <label className="form-label">Dias</label>
            <input type="number" min={1} className="form-input" value={form.dias} onChange={e => set('dias', e.target.value)} />
          </div>
          <div className="form-group" style={{ width: 100 }}>
            <label className="form-label" title="Volume esperado durante a campanha em relação ao normal">Volume ×</label>
            <input type="number" min={0.1} step={0.1} className="form-input" value={form.multiplicador} onChange={e => set('multiplicador', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando || !tabelaOk}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Salvar{sujo ? ' *' : ''}
          </button>
          {campanhaId && <button className="btn btn-ghost btn-sm" onClick={excluir} style={{ color: 'var(--danger)' }}><Trash2 size={13} /> Excluir</button>}
          {msg && <span style={{ fontSize: 12, fontWeight: 600, color: msg.startsWith('✓') ? 'var(--ok)' : 'var(--danger)' }}>{msg}</span>}
          {!tabelaOk && <span style={{ fontSize: 12, color: 'var(--warning)' }}>Para salvar simulações, aplique criar_campanhas_simuladas.sql no Supabase.</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray-500)', lineHeight: 1.6 }}>
          <b>{canal.label}:</b> taxa {fmt(canal.taxa * 100, 1)}% · imposto {fmt(canal.imposto * 100, 1)}% · comissão {fmt(canal.comissao * 100, 1)}% ·
          custos por unidade {fmtR(canal.totalFixo)} (embalagem {fmtR(canal.embalagem)}, frete {fmtR(canal.frete)}, outros {fmtR(canal.outros)}).
          {canal.desconto > 0 && <> O desconto padrão do canal ({fmt(canal.desconto * 100, 1)}%) é <b>substituído</b> pelo desconto da campanha.</>}
          {' '}Volume = média diária dos últimos 30 dias × {dias} dias × {fmt(mult, 1)}.
        </div>
      </div>

      {/* Totais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          ['Receita da campanha', fmtR(tot.receita), `${fmt(tot.unid, 0)} unidades`, 'var(--gray-800)'],
          ['Margem total', fmtR(tot.mc), tot.recLiq > 0 ? `${fmtP(tot.mc / tot.recLiq)} da receita líquida` : '—', tot.mc < 0 ? 'var(--danger)' : 'var(--ok)'],
          ['Mesmo período sem campanha', fmtR(tot.mcHoje), 'margem com preço cheio e volume normal', 'var(--gray-600)'],
          ['Diferença', `${tot.mc - tot.mcHoje >= 0 ? '+' : '−'}${fmtR(Math.abs(tot.mc - tot.mcHoje))}`,
            tot.mc >= tot.mcHoje ? 'a campanha rende mais' : 'a campanha rende menos', tot.mc >= tot.mcHoje ? 'var(--ok)' : 'var(--danger)'],
        ].map(([l, v, s, c]) => (
          <div key={l} className="card card-pad" style={{ padding: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c, margin: '2px 0' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{s}</div>
          </div>
        ))}
      </div>
      {(tot.prejuizo > 0 || semPreco > 0) && (
        <div className="alert-banner warning" style={{ fontSize: 12 }}>
          {tot.prejuizo > 0 && <span>⚠️ {tot.prejuizo} produto(s) com prejuízo por unidade no desconto escolhido.</span>}
          {semPreco > 0 && <span>{semPreco} produto(s) sem preço cadastrado em {canal.label}: digite o preço na linha para simular.</span>}
        </div>
      )}

      {/* Produtos */}
      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-200)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="form-input" placeholder="Buscar produto..." value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: '1 1 160px' }} />
          <select className="form-input" value={filtroCat} onChange={e => setFiltroCat(e.target.value)} style={{ flex: '0 1 170px' }}>
            <option>Todas</option>{categorias.map(c => <option key={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>Aplicar</span>
            <input type="number" className="form-input" placeholder="%" value={lote.pct} onChange={e => setLote(p => ({ ...p, pct: e.target.value }))} style={{ width: 70 }} />
            <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>em</span>
            <select className="form-input" value={lote.cat} onChange={e => setLote(p => ({ ...p, cat: e.target.value }))} style={{ width: 150 }}>
              <option value="Todas">todos os produtos</option>{categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={aplicarLote}><Plus size={13} /> Aplicar</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Produto</th>
              <th style={{ textAlign: 'right' }}>Preço</th>
              <th style={{ textAlign: 'right' }}>Desconto</th>
              <th style={{ textAlign: 'right' }}>Preço promo</th>
              <th style={{ textAlign: 'right' }} title="Preço promo − taxas, imposto, comissão e custos por unidade">Rec. líquida</th>
              <th style={{ textAlign: 'right' }}>CMV</th>
              <th style={{ textAlign: 'right' }}>Margem</th>
              <th style={{ textAlign: 'right' }} title="Desconto em que a margem zera">Desc. máx.</th>
              <th style={{ textAlign: 'right' }}>Qtd</th>
              <th style={{ textAlign: 'right' }}>Margem total</th>
            </tr></thead>
            <tbody>
              {visiveis.map(l => (
                <tr key={l.sku}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.p.emb.nome}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{l.p.emb.categoria}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.it.preco !== undefined && l.it.preco !== '' || !l.p.precosCanal?.[canal.id]
                      ? <input type="number" step="0.01" className="qty-input" style={{ width: 84, fontSize: 13 }} placeholder="preço"
                          value={l.it.preco ?? ''} onChange={e => setItem(l.sku, 'preco', e.target.value)} />
                      : fmtR(l.preco)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <input type="number" min={0} max={100} step="1" className="qty-input" style={{ width: 64, fontSize: 13 }} placeholder="0"
                      value={l.it.desconto ?? ''} onChange={e => setItem(l.sku, 'desconto', e.target.value)} /> %
                  </td>
                  {l.preco ? <>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtR(l.promo)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--gray-600)' }}>{fmtR(l.recLiq)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--gray-600)' }}>{fmtR(l.cmv)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: corMargem(l.mc, l.mg) }}>{fmtR(l.mc)} · {fmtP(l.mg)}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>hoje {fmtP(l.mgHoje)}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: l.desc > l.descMax ? 'var(--danger)' : 'var(--gray-600)' }}>{fmt(l.descMax, 1)}%</td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" min={0} className="qty-input" style={{ width: 70, fontSize: 13 }} placeholder={String(l.qtdAuto)}
                        value={l.it.qtd ?? ''} onChange={e => setItem(l.sku, 'qtd', e.target.value)} />
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: l.mc < 0 ? 'var(--danger)' : 'var(--gray-800)' }}>{fmtR(l.qtd * l.mc)}</td>
                  </> : <td colSpan={7} style={{ color: 'var(--gray-400)', fontSize: 12 }}>sem preço em {canal.label} — digite ao lado</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--gray-500)', borderTop: '1px solid var(--gray-100)' }}>
          Margem: <span style={{ color: 'var(--ok)', fontWeight: 700 }}>verde</span> ≥ {fmt(MARGEM_ATENCAO * 100, 0)}% ·{' '}
          <span style={{ color: 'var(--warning)', fontWeight: 700 }}>laranja</span> abaixo disso ·{' '}
          <span style={{ color: 'var(--danger)', fontWeight: 700 }}>vermelho</span> prejuízo. % sobre a receita líquida, como no Ranking de margem.
          Qtd vazia usa a estimativa (cinza); digite para sobrescrever.
        </div>
      </div>
    </div>
  )
}
