import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, AlertTriangle, Check, Trash2 } from 'lucide-react'
import { ocultoSazonal } from '../lib/sazonal'
import { CATEGORIAS_BASE } from '../lib/categorias'

// Logística › Delivery BV: contagem diária do estoque do delivery da Bela Vista
// (substitui a planilha "Controle Delivery" + o print no grupo).
// Todo fim de dia, depois do restock, o Gabriel lança por SKU: geladeira do delivery,
// armazenagem (estoque da produção) e a validade mais antiga da armazenagem.
// O Lucas acompanha em Situação e Histórico: estoque, valor (× CMV direto do produto),
// demanda a cobrir até a próxima contagem (delivery_previsao) e quanto falta produzir.
// Só controle: não mexe em estoque de MP/embalagem nem no Planejamento.

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
const ROT_DIA = { dom: 'Dom', seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb' }
// Dias em que há contagem: segunda a quinta. A de quinta cobre Sex+Sáb+Dom+Seg.
const DIAS_CONTAGEM = new Set([1, 2, 3, 4])
const CHAVE_RASCUNHO = 'delivery_bv_rascunho'

const usuarioAtual = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hojeISO = () => iso(new Date())
const somaDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const fmtData = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ''
const fmtDataDia = s => s ? `${ROT_DIA[DIAS[new Date(s + 'T12:00:00').getDay()]]} ${fmtData(s)}` : ''
const fmtR = (n, d = 2) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const fmtN = n => Number(n || 0).toLocaleString('pt-BR')
const int = v => Math.max(0, parseInt(v, 10) || 0)
const vazio = v => v === '' || v == null

// Dias que a contagem de `data` precisa cobrir: do dia seguinte até o próximo dia de contagem (inclusive).
// Seg→Ter · Ter→Qua · Qua→Qui · Qui→Sex+Sáb+Dom+Seg · Sex→Sáb+Dom+Seg
export function diasCobertos(data) {
  const d = new Date(data + 'T12:00:00'), dias = []
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() + 1)
    dias.push(DIAS[d.getDay()])
    if (DIAS_CONTAGEM.has(d.getDay())) break
  }
  return dias
}

const ordemCat = c => { const i = CATEGORIAS_BASE.indexOf(c); return i < 0 ? 99 : i }
const porCategoria = (a, b) => ordemCat(a.categoria) - ordemCat(b.categoria) ||
  (a.categoria || '').localeCompare(b.categoria || '') || (a.nome || '').localeCompare(b.nome || '')

// Supabase devolve no máximo 1000 linhas por consulta
async function buscarTodas(montar) {
  const todas = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    todas.push(...(data || []))
    if (!data || data.length < 1000) return todas
  }
}

function lerRascunho() { try { return JSON.parse(localStorage.getItem(CHAVE_RASCUNHO)) || null } catch { return null } }

export default function DeliveryBV() {
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [produtos, setProdutos] = useState([])     // SKUs da previsão de delivery (rótulo ativo, em temporada)
  const [previsao, setPrevisao] = useState({})     // { sku: { seg: n, ... } }
  const [custos, setCustos] = useState({})         // { sku: CMV direto mais recente }
  const [contagens, setContagens] = useState([])   // delivery_contagens (últimos 120 dias)
  const [aba, setAba] = useState(null)             // contar | situacao | historico
  const [dataSel, setDataSel] = useState(null)     // dia aberto em Situação

  async function load() {
    setLoading(true); setErro('')
    try {
      const desde = somaDias(hojeISO(), -120)
      const mesDesde = somaDias(hojeISO(), -190).slice(0, 7)
      const [prev, embs, cmv, conts] = await Promise.all([
        buscarTodas(() => supabase.from('delivery_previsao').select('sku, nome, dia_semana, quantidade').order('sku')),
        buscarTodas(() => supabase.from('embalagens').select('codigo, nome, categoria, ativo, tipo').eq('tipo', 'rotulo').order('codigo')),
        buscarTodas(() => supabase.from('cmv_historico').select('sku_produto, mes, cmv_direto, cmv_real').gte('mes', mesDesde).order('mes', { ascending: false }).order('sku_produto')),
        // separado: sem a tabela (SQL ainda não rodado) a tela de contagem abre do mesmo jeito
        buscarTodas(() => supabase.from('delivery_contagens').select('*').gte('data', desde).order('data', { ascending: false }).order('sku'))
          .catch(e => { setErro(/delivery_contagens/.test(e.message || '') ? 'A tabela delivery_contagens ainda não existe: rode o delivery_contagens.sql no Supabase.' : 'Contagens: ' + (e.message || e)); return [] }),
      ])
      const mapPrev = {}
      for (const r of prev) (mapPrev[r.sku] ??= { _nome: r.nome })[r.dia_semana] = r.quantidade || 0
      const embMap = Object.fromEntries(embs.map(e => [e.codigo, e]))
      const lista = Object.keys(mapPrev)
        .map(sku => ({ sku, emb: embMap[sku], nome: embMap[sku]?.nome || mapPrev[sku]._nome || sku, categoria: embMap[sku]?.categoria || 'Outros' }))
        .filter(p => p.emb?.ativo && !ocultoSazonal(p.emb))
        .sort(porCategoria)
      // Custo unitário = CMV direto (sem overhead) do mês mais recente, com rendimento real quando houver
      // — o mesmo valor da Ficha do Produto. O snapshot é gravado ao abrir Custos.
      const mapCusto = {}
      for (const h of cmv) if (mapCusto[h.sku_produto] == null) {
        const v = parseFloat(h.cmv_real ?? h.cmv_direto)
        if (v > 0) mapCusto[h.sku_produto] = v
      }
      setPrevisao(mapPrev); setProdutos(lista); setCustos(mapCusto); setContagens(conts)
      const ultima = conts[0]?.data || null
      setDataSel(s => s || ultima)
      setAba(a => a || (ultima === hojeISO() ? 'situacao' : 'contar'))
    } catch (e) {
      setErro(e.message || String(e))
      setAba(a => a || 'contar')
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const demandaDe = (sku, data) => diasCobertos(data).reduce((s, d) => s + (previsao[sku]?.[d] || 0), 0)

  if (loading) return <div className="loading"><RefreshCw size={16} className="spin" /> Carregando...</div>

  return (
    <>
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${aba === 'contar' ? ' active' : ''}`} onClick={() => setAba('contar')}>✍️ Contagem</button>
        <button className={`tab${aba === 'situacao' ? ' active' : ''}`} onClick={() => setAba('situacao')}>📊 Situação</button>
        <button className={`tab${aba === 'historico' ? ' active' : ''}`} onClick={() => setAba('historico')}>📋 Histórico</button>
      </div>
      {erro && <div className="alert-banner danger"><AlertTriangle size={16} /> {erro}</div>}

      {aba === 'contar' && <Contagem produtos={produtos} contagens={contagens} custos={custos} demandaDe={demandaDe}
        onSalvo={data => { setDataSel(data); setAba('situacao'); load() }} />}
      {aba === 'situacao' && <Situacao data={dataSel} setData={setDataSel} contagens={contagens} produtos={produtos}
        custos={custos} demandaDe={demandaDe} onExcluido={() => { setDataSel(null); load() }} />}
      {aba === 'historico' && <Historico contagens={contagens} custos={custos}
        onAbrir={d => { setDataSel(d); setAba('situacao') }} />}
    </>
  )
}

// ───────────── Contagem (Gabriel, no celular) ─────────────
function Contagem({ produtos, contagens, custos, demandaDe, onSalvo }) {
  const [data, setData] = useState(hojeISO())
  const [form, setForm] = useState({})       // { sku: { gel, arm, val } } — strings, '' = não contado
  const [jaSalva, setJaSalva] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // Última contagem de cada SKU antes da data (dica e validade pré-preenchida)
  const anterior = useMemo(() => {
    const m = {}
    for (const c of contagens) if (c.data < data && !m[c.sku]) m[c.sku] = c   // contagens vêm da mais nova para a mais antiga
    return m
  }, [contagens, data])

  // Ao trocar a data: contagem já gravada > rascunho do celular > em branco (validade da última contagem)
  useEffect(() => {
    const doDia = contagens.filter(c => c.data === data)
    const rasc = lerRascunho()
    const novo = {}
    for (const p of produtos) {
      const c = doDia.find(x => x.sku === p.sku)
      if (c) novo[p.sku] = { gel: String(c.geladeira), arm: String(c.armazenagem), val: c.validade || '' }
      else if (rasc?.data === data && rasc.form?.[p.sku]) novo[p.sku] = rasc.form[p.sku]
      else novo[p.sku] = { gel: '', arm: '', val: anterior[p.sku]?.validade || '' }
    }
    setForm(novo)
    setJaSalva(doDia.length > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, produtos, contagens])

  function mudar(sku, campo, valor) {
    setForm(prev => {
      const novo = { ...prev, [sku]: { ...prev[sku], [campo]: valor } }
      try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ data, form: novo })) } catch { /* sem espaço */ }
      return novo
    })
  }

  // Enter / "próximo" do teclado do celular vai para o campo seguinte
  function proximo(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const i = +e.currentTarget.dataset.ordem
    document.querySelector(`[data-ordem="${i + 1}"]`)?.focus()
  }

  const contado = sku => !vazio(form[sku]?.gel) || !vazio(form[sku]?.arm)
  const feitos = produtos.filter(p => contado(p.sku)).length

  async function salvar() {
    setErro('')
    const faltando = produtos.filter(p => !contado(p.sku))
    const semValidade = produtos.filter(p => contado(p.sku) && int(form[p.sku].arm) > 0 && !form[p.sku].val)
    if (feitos === 0) { setErro('Preencha pelo menos um produto.'); return }
    const avisos = []
    if (faltando.length) avisos.push(`Sem contagem (não serão salvos): ${faltando.map(p => p.nome).join(', ')}.\nSe não tem nenhum, digite 0.`)
    if (semValidade.length) avisos.push(`Com armazenagem e sem validade: ${semValidade.map(p => p.nome).join(', ')}.`)
    if (avisos.length && !window.confirm(avisos.join('\n\n') + '\n\nSalvar assim mesmo?')) return
    setSalvando(true)
    const agora = new Date().toISOString(), quem = usuarioAtual()
    const linhas = produtos.filter(p => contado(p.sku)).map(p => {
      const f = form[p.sku], arm = int(f.arm)
      return {
        data, sku: p.sku, nome: p.nome, categoria: p.categoria,
        geladeira: int(f.gel), armazenagem: arm, validade: arm > 0 && f.val ? f.val : null,
        demanda_cobrir: demandaDe(p.sku, data), custo_unitario: custos[p.sku] ?? null,
        registrado_por: quem, atualizado_em: agora,
      }
    })
    const { error } = await supabase.from('delivery_contagens').upsert(linhas, { onConflict: 'data,sku' })
    setSalvando(false)
    if (error) { setErro('Não consegui salvar: ' + error.message); return }
    try { localStorage.removeItem(CHAVE_RASCUNHO) } catch { /* ok */ }
    onSalvo(data)
  }

  const cobre = diasCobertos(data).map(d => ROT_DIA[d]).join('+')
  let ordem = 0
  const grupos = []
  for (const p of produtos) {
    if (grupos.at(-1)?.cat !== p.categoria) grupos.push({ cat: p.categoria, itens: [] })
    grupos.at(-1).itens.push(p)
  }
  const estiloInput = { fontSize: 16, padding: '9px 8px', textAlign: 'center', width: '100%', minWidth: 0 }

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Dia da contagem</label>
          <input type="date" className="form-input" value={data} max={hojeISO()} onChange={e => e.target.value && setData(e.target.value)} style={{ fontSize: 16 }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5 }}>
          Depois do restock. Cobre: <b>{cobre}</b><br />
          <b style={{ color: feitos === produtos.length ? 'var(--ok)' : 'var(--purple)' }}>{feitos} de {produtos.length}</b> produtos contados
        </div>
      </div>
      {jaSalva && <div className="alert-banner info"><Check size={15} /> Este dia já foi lançado. Salvar de novo corrige a contagem.</div>}

      {grupos.map(g => (
        <div key={g.cat}>
          <div className="prod-section-label" style={{ marginBottom: 6 }}>{g.cat}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.35fr', gap: '4px 8px', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, padding: '0 2px' }}>
            <span>Geladeira BV</span><span>Armazenagem</span><span>Validade mais antiga</span>
          </div>
          {g.itens.map(p => {
            const f = form[p.sku] || { gel: '', arm: '', val: '' }
            const ant = anterior[p.sku]
            const o1 = ordem++, o2 = ordem++
            return (
              <div key={p.sku} style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{contado(p.sku) && <Check size={13} style={{ color: 'var(--ok)', marginRight: 4 }} />}{p.nome}</span>
                  {ant && <span style={{ fontSize: 11, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>{fmtData(ant.data)}: {ant.geladeira} · {ant.armazenagem}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.35fr', gap: 8 }}>
                  <input className="form-input" style={estiloInput} type="number" inputMode="numeric" min={0} enterKeyHint="next"
                    data-ordem={o1} onKeyDown={proximo} value={f.gel} placeholder={ant ? String(ant.geladeira) : '0'}
                    onChange={e => mudar(p.sku, 'gel', e.target.value)} aria-label={`${p.nome} geladeira`} />
                  <input className="form-input" style={estiloInput} type="number" inputMode="numeric" min={0} enterKeyHint="next"
                    data-ordem={o2} onKeyDown={proximo} value={f.arm} placeholder={ant ? String(ant.armazenagem) : '0'}
                    onChange={e => mudar(p.sku, 'arm', e.target.value)} aria-label={`${p.nome} armazenagem`} />
                  <input className="form-input" style={{ ...estiloInput, fontSize: 14, opacity: int(f.arm) > 0 || vazio(f.arm) ? 1 : .45 }} type="date"
                    value={f.val} onChange={e => mudar(p.sku, 'val', e.target.value)} aria-label={`${p.nome} validade`} />
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {erro && <div className="alert-banner danger"><AlertTriangle size={15} /> {erro}</div>}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--white)', padding: '10px 0 2px', borderTop: '1px solid var(--gray-200)' }}>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: 15 }} onClick={salvar} disabled={salvando}>
          {salvando ? <><RefreshCw size={15} className="spin" /> Salvando...</> : <><Save size={15} /> Salvar contagem ({feitos}/{produtos.length})</>}
        </button>
      </div>
    </div>
  )
}

// Linhas calculadas de um dia de contagem
function linhasDoDia(contagens, data, custos, demandaDe) {
  return contagens.filter(c => c.data === data).map(c => {
    const total = (c.geladeira || 0) + (c.armazenagem || 0)
    const demanda = c.demanda_cobrir ?? demandaDe?.(c.sku, data) ?? 0
    const custo = c.custo_unitario != null ? parseFloat(c.custo_unitario) : custos[c.sku]
    return { ...c, total, demanda, falta: Math.max(0, demanda - total), custo, valor: custo ? total * custo : 0, semCusto: !custo }
  })
}
const somar = (ls, k) => ls.reduce((s, l) => s + (l[k] || 0), 0)

// ───────────── Situação (Lucas) ─────────────
function Situacao({ data: dataSel, setData, contagens, produtos, custos, demandaDe, onExcluido }) {
  const datas = useMemo(() => [...new Set(contagens.map(c => c.data))], [contagens])
  const data = dataSel && datas.includes(dataSel) ? dataSel : datas[0]
  const linhas = useMemo(() => data ? linhasDoDia(contagens, data, custos, demandaDe).map(l => ({
    ...l, categoria: l.categoria || produtos.find(p => p.sku === l.sku)?.categoria || 'Outros',
  })).sort(porCategoria) : [], [contagens, data, custos, produtos])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!datas.length) return <div className="card empty"><div className="empty-icon">🧊</div><div className="empty-title">Nenhuma contagem lançada ainda</div></div>

  const cobertos = diasCobertos(data)
  const ultimoCoberto = somaDias(data, cobertos.length)
  const naoContados = produtos.filter(p => !linhas.some(l => l.sku === p.sku))
  const aProduzir = linhas.filter(l => l.falta > 0)
  const semCusto = linhas.filter(l => l.semCusto && l.total > 0)
  const quem = [...new Set(linhas.map(l => l.registrado_por).filter(Boolean))].join(', ')
  const alertaValidade = v => !v ? null : v <= data ? 'danger' : v <= ultimoCoberto ? 'warning' : null

  async function excluir() {
    if (!window.confirm(`Excluir a contagem de ${fmtDataDia(data)} (${linhas.length} produtos)? Não dá para desfazer.`)) return
    const { error } = await supabase.from('delivery_contagens').delete().eq('data', data)
    if (error) { alert('Não consegui excluir: ' + error.message); return }
    onExcluido()
  }

  const grupos = []
  for (const l of linhas) {
    if (grupos.at(-1)?.cat !== l.categoria) grupos.push({ cat: l.categoria, itens: [] })
    grupos.at(-1).itens.push(l)
  }
  const thN = { textAlign: 'right' }

  return (
    <>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="form-input" value={data || ''} onChange={e => setData(e.target.value)} style={{ width: 170 }}>
          {datas.map(d => <option key={d} value={d}>{fmtDataDia(d)}</option>)}
        </select>
        <div style={{ fontSize: 12, color: 'var(--gray-500)', flex: 1, minWidth: 200 }}>
          Demanda a cobrir: <b>{cobertos.map(d => ROT_DIA[d]).join('+')}</b> (previsão de delivery)
          {quem && <> · contado por {quem}</>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={excluir} title="Excluir a contagem deste dia"><Trash2 size={13} /></button>
      </div>

      <div className="kpi-row">
        <div className="kpi neutral">
          <div className="kpi-label">Estoque total</div>
          <div className="kpi-value">{fmtN(somar(linhas, 'total'))}</div>
          <div className="kpi-detail">{fmtN(somar(linhas, 'geladeira'))} geladeira · {fmtN(somar(linhas, 'armazenagem'))} armazenagem</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">Valor em estoque</div>
          <div className="kpi-value">{fmtR(somar(linhas, 'valor'), 0)}</div>
          <div className="kpi-detail">quantidade × CMV direto do produto{semCusto.length ? ` · ${semCusto.length} sem custo` : ''}</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">Demanda a cobrir</div>
          <div className="kpi-value">{fmtN(somar(linhas, 'demanda'))}</div>
          <div className="kpi-detail">{cobertos.length === 1 ? '1 dia' : `${cobertos.length} dias`} até a próxima contagem</div>
        </div>
        <div className={`kpi ${aProduzir.length ? 'warning' : 'ok'}`}>
          <div className="kpi-label">Falta produzir</div>
          <div className="kpi-value">{fmtN(somar(linhas, 'falta'))}</div>
          <div className="kpi-detail">{aProduzir.length ? `${aProduzir.length} SKU(s) abaixo da demanda` : 'estoque cobre a demanda'}</div>
        </div>
      </div>

      {naoContados.length > 0 && (
        <div className="alert-banner warning"><AlertTriangle size={15} /> Não contados neste dia: {naoContados.map(p => p.nome).join(', ')}</div>
      )}

      <div className="card tbl-wrap">
        <table style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Produto</th><th style={thN}>Geladeira</th><th style={thN}>Armaz.</th><th style={thN}>Total</th>
              <th>Validade armaz.</th><th style={thN}>Demanda</th><th style={thN}>Falta produzir</th><th style={thN}>Custo un.</th><th style={thN}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map(g => [
              <tr key={'c' + g.cat}><td colSpan={9} style={{ fontWeight: 700, fontSize: 12, color: 'var(--purple)', background: 'var(--gray-50)', padding: '7px 12px' }}>{g.cat}</td></tr>,
              ...g.itens.map(l => {
                const av = alertaValidade(l.validade)
                return (
                  <tr key={l.sku}>
                    <td><div style={{ fontWeight: 600 }}>{l.nome || l.sku}</div><div style={{ fontSize: 10, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{l.sku}</div></td>
                    <td style={thN}>{l.geladeira}</td>
                    <td style={thN}>{l.armazenagem}</td>
                    <td style={{ ...thN, fontWeight: 700 }}>{l.total}</td>
                    <td>{l.validade ? <span className={`pill ${av || 'neutral'}`} title={av === 'danger' ? 'Vencida ou vence hoje' : av === 'warning' ? 'Vence antes da próxima contagem' : ''}>{fmtData(l.validade)}</span> : <span style={{ color: 'var(--gray-300)' }}>—</span>}</td>
                    <td style={thN}>{l.demanda}</td>
                    <td style={{ ...thN, fontWeight: 700, color: l.falta > 0 ? 'var(--warning)' : 'var(--gray-300)' }}>{l.falta > 0 ? l.falta : '—'}</td>
                    <td style={{ ...thN, color: 'var(--gray-500)' }}>{l.custo ? fmtR(l.custo) : '—'}</td>
                    <td style={thN}>{l.custo ? fmtR(l.valor) : '—'}</td>
                  </tr>
                )
              }),
            ])}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--gray-200)', fontWeight: 800 }}>
              <td>Total</td>
              <td style={thN}>{fmtN(somar(linhas, 'geladeira'))}</td>
              <td style={thN}>{fmtN(somar(linhas, 'armazenagem'))}</td>
              <td style={thN}>{fmtN(somar(linhas, 'total'))}</td>
              <td />
              <td style={thN}>{fmtN(somar(linhas, 'demanda'))}</td>
              <td style={{ ...thN, color: 'var(--warning)' }}>{fmtN(somar(linhas, 'falta'))}</td>
              <td />
              <td style={thN}>{fmtR(somar(linhas, 'valor'))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
        Falta produzir = demanda até a próxima contagem − (geladeira + armazenagem), quando positivo. Demanda e custo ficam congelados no dia da contagem.
        Validade: vermelho = vencida/vence no dia; laranja = vence antes da próxima contagem ({fmtData(ultimoCoberto)}).
      </div>
    </>
  )
}

// ───────────── Histórico ─────────────
function Historico({ contagens, custos, onAbrir }) {
  const dias = useMemo(() => {
    const datas = [...new Set(contagens.map(c => c.data))]
    return datas.map(d => {
      const ls = linhasDoDia(contagens, d, custos)
      return {
        data: d, skus: ls.length, geladeira: somar(ls, 'geladeira'), armazenagem: somar(ls, 'armazenagem'), total: somar(ls, 'total'),
        valor: somar(ls, 'valor'), demanda: somar(ls, 'demanda'), falta: somar(ls, 'falta'),
        quem: [...new Set(ls.map(l => l.registrado_por).filter(Boolean))].join(', '),
      }
    })
  }, [contagens, custos])

  if (!dias.length) return <div className="card empty"><div className="empty-icon">📋</div><div className="empty-title">Nenhuma contagem lançada ainda</div></div>
  const thN = { textAlign: 'right' }

  return (
    <div className="card tbl-wrap">
      <table style={{ minWidth: 640 }}>
        <thead>
          <tr><th>Dia</th><th style={thN}>Geladeira</th><th style={thN}>Armaz.</th><th style={thN}>Total</th><th style={thN}>Valor</th><th style={thN}>Demanda</th><th style={thN}>Falta</th><th>Contado por</th></tr>
        </thead>
        <tbody>
          {dias.map(d => (
            <tr key={d.data} onClick={() => onAbrir(d.data)} style={{ cursor: 'pointer' }} title="Abrir a situação deste dia">
              <td style={{ fontWeight: 600 }}>{fmtDataDia(d.data)} <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 400 }}>{d.skus} SKUs</span></td>
              <td style={thN}>{fmtN(d.geladeira)}</td>
              <td style={thN}>{fmtN(d.armazenagem)}</td>
              <td style={{ ...thN, fontWeight: 700 }}>{fmtN(d.total)}</td>
              <td style={thN}>{fmtR(d.valor, 0)}</td>
              <td style={thN}>{fmtN(d.demanda)}</td>
              <td style={{ ...thN, fontWeight: 700, color: d.falta > 0 ? 'var(--warning)' : 'var(--gray-300)' }}>{d.falta || '—'}</td>
              <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{d.quem}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: 'var(--gray-400)', padding: '8px 12px' }}>Últimos 120 dias. Toque num dia para ver por produto.</div>
    </div>
  )
}
