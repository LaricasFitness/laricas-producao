import { useState } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save } from 'lucide-react'
import { recalcularCustoMP, ajustarEstoqueCompra } from './MatPrimas'
import { perguntarSeJaContada } from '../lib/contagem'
import { saldos, custoLote, lotesValidos, gravarComponentes } from '../lib/revenda'

// Estoque › Conferência › Revenda: display e filme guardados na MM, custo de cada wafer, lotes recebidos
// e o lançamento de um lote novo (regra em src/lib/revenda.js).

const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const brl = v => 'R$ ' + fmt(v, 2)
const dataBR = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—'
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const casas = c => c.unidade === 'kg' ? 3 : 0
const totalLote = l => (+l.wafer || 0) + (+l.frete || 0) + Object.values(l.uso || {}).reduce((t, u) => t + (+u.valor || 0), 0)

export function MaterialNaMM({ cfg, compraIds, onMudou, onFrete }) {
  const ss = saldos(cfg, compraIds)
  const [nova, setNova] = useState(null)   // compra nova de display ou filme
  const lotes = lotesValidos(cfg, compraIds).slice().sort((a, b) => b.data.localeCompare(a.data))
  const porWafer = ss.reduce((t, c) => t + c.porWafer, 0)
  const setN = (k, v) => setNova(n => ({ ...n, [k]: v }))

  function gravarNova() {
    onMudou({ ...cfg, componentes: cfg.componentes.map(c => c.id === nova.comp
      ? { ...c, compras: [...c.compras, { data: nova.data, nf: nova.nf, fornecedor: nova.fornecedor, qtd: +nova.qtd, valor: +nova.valor }] } : c) })
    setNova(null)
  }

  return (
    <div className="card">
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}><b>Display e filme guardados na MM</b>
        <span style={{ fontSize: 12, color: 'var(--gray-500)' }}> (comprados por nós; cada lote de wafer usa 1 display a cada 12 wafers e 1 filme por wafer, e esse custo entra no lote: {brl(porWafer)} por wafer hoje)</span></div>
      {cfg.padrao && <div className="alert-banner warning" style={{ margin: 10 }}>Valores iniciais do sistema (NF 10.795 do display, NF 10.508 do filme, 1º lote de 3.504 wafers). Ficam gravados ao lançar o próximo lote ou uma compra de display ou filme.</div>}
      <div className="tbl-wrap"><table style={{ fontSize: 13 }}>
        <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Comprado</th><th style={{ textAlign: 'right' }}>Usado nos lotes</th><th style={{ textAlign: 'right' }}>Saldo na MM</th>
          <th style={{ textAlign: 'right' }}>Dá para</th><th style={{ textAlign: 'right' }}>Custo</th><th style={{ textAlign: 'right' }}>Por wafer</th><th style={{ textAlign: 'right' }}>Valor do saldo</th></tr></thead>
        <tbody>{ss.map(c => <tr key={c.id}>
          <td>{c.nome}<div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{c.compras.map(x => `NF ${x.nf} (${dataBR(x.data)})`).join(' · ')}</div></td>
          <td style={{ textAlign: 'right' }}>{fmt(c.comprado, casas(c))} {c.unidade}</td>
          <td style={{ textAlign: 'right' }}>{fmt(c.usado, casas(c))} {c.unidade}</td>
          <td style={{ textAlign: 'right', fontWeight: 700, color: c.saldo < 0 ? 'var(--danger)' : undefined }}>{fmt(c.saldo, casas(c))} {c.unidade}</td>
          <td style={{ textAlign: 'right' }}>{fmt(c.rendeSaldo)} wafers</td>
          <td style={{ textAlign: 'right' }}>{brl(c.unit)}/{c.unidade}</td>
          <td style={{ textAlign: 'right' }}>{brl(c.porWafer)}</td>
          <td style={{ textAlign: 'right' }}>{brl(c.valorSaldo)}</td></tr>)}</tbody>
      </table></div>
      <div style={{ padding: '8px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', fontSize: 12 }}>
        {!nova ? <button className="btn btn-ghost btn-sm" onClick={() => setNova({ comp: cfg.componentes[0].id, data: hojeSP(), nf: '', fornecedor: '', qtd: '', valor: '' })}>+ Compra de display ou filme</button> : <>
          <label>Material<br /><select className="form-input" value={nova.comp} onChange={e => setN('comp', e.target.value)}>{cfg.componentes.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.unidade})</option>)}</select></label>
          <label>Data da NF<br /><input className="form-input" type="date" value={nova.data} onChange={e => setN('data', e.target.value)} /></label>
          <label>NF<br /><input className="form-input" style={{ width: 100 }} value={nova.nf} onChange={e => setN('nf', e.target.value)} /></label>
          <label>Fornecedor<br /><input className="form-input" value={nova.fornecedor} onChange={e => setN('fornecedor', e.target.value)} /></label>
          <label>Quantidade<br /><input className="form-input" type="number" style={{ width: 110 }} value={nova.qtd} onChange={e => setN('qtd', e.target.value)} /></label>
          <label>Total pago (com frete e impostos)<br /><input className="form-input" type="number" style={{ width: 150 }} value={nova.valor} onChange={e => setN('valor', e.target.value)} /></label>
          <button className="btn btn-primary btn-sm" disabled={!(+nova.qtd > 0 && +nova.valor > 0)} onClick={gravarNova}><Save size={13} /> Gravar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setNova(null)}>Cancelar</button></>}
      </div>
      <div style={{ padding: '0 14px 12px', fontSize: 12 }}>
        <b>Lotes</b>
        {lotes.map(l => <div key={l.id} style={{ marginTop: 4 }}>
          {dataBR(l.data)} · NF {l.nf} · {fmt(l.unidades)} wafers
          {l.historico ? <span style={{ color: 'var(--gray-500)' }}> · {l.obs}</span> : <>
            {' '}· wafer {brl(l.wafer)} + frete {l.frete ? brl(l.frete) : <b style={{ color: 'var(--warning, #b45309)' }}>falta</b>}
            {Object.entries(l.uso || {}).map(([k, u]) => ` + ${(cfg.componentes.find(c => c.id === k)?.nome || k).toLowerCase()} ${brl(u.valor)}`).join('')}
            {' '}= <b>{brl(totalLote(l))}</b> ({brl(totalLote(l) / (+l.unidades || 1))} por wafer)
            {!l.frete && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => { const v = prompt('Valor do frete deste lote (R$):'); if (v) onFrete(l, v) }}>Lançar frete</button>}</>}
        </div>)}
      </div>
    </div>
  )
}

export function ModalLote({ item, cfg, compraIds, onClose, onSalvo }) {
  const [f, setF] = useState({ data: hojeSP(), nf: '', unidades: '3600', wafer: '', frete: '' })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const c = custoLote(cfg, f)
  const ss = saldos(cfg, compraIds)
  const n = +f.unidades || 0

  async function salvar() {
    setErro('')
    if (!(n > 0) || !(+f.wafer > 0)) { setErro('Informe as unidades e o valor da NF da MM.'); return }
    const fora = await perguntarSeJaContada('mp', [{ id: item.id, nome: item.nome }], f.data)
    if (!fora) return
    setSalvando(true)
    try {
      const partes = [`wafer ${brl(+f.wafer)}`, +f.frete ? `frete ${brl(+f.frete)}` : null,
        ...cfg.componentes.map(x => `${x.nome.toLowerCase()} ${fmt(c.uso[x.id].qtd, casas(x))} ${x.unidade} ${brl(c.uso[x.id].valor)}`)].filter(Boolean)
      const { data: compra, error } = await supabase.from('mp_compras').insert({
        materia_prima_id: item.id, quantidade: n, custo_total: c.total, data_compra: f.data,
        fornecedor: item.fornecedor || 'MM Produtos Alimenticios Ltda', numero_nf: f.nf || null,
        observacao: 'Lote: ' + partes.join(' + '),
        unidade_compra: 'display', qtd_compra: n / 12, conteudo_embalagem: 12, unidade_conteudo: 'un',
        ...(fora.has(item.id) ? { entrou_no_saldo: false } : {}),
      }).select('id').single()
      if (error) throw error
      if (!fora.has(item.id)) await ajustarEstoqueCompra(item.id, n)
      await recalcularCustoMP(item.id)
      const novo = { ...cfg, lotes: [...cfg.lotes, { id: 'lote-' + compra.id, data: f.data, nf: f.nf, unidades: n, wafer: +f.wafer, frete: +f.frete || 0, compraId: compra.id, uso: c.uso }] }
      await gravarComponentes(novo)
      onSalvo(novo)
    } catch (e) { setErro(e.message || String(e)); setSalvando(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header"><div className="modal-title">Lote de {item.nome} recebido</div><button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button></div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="form-label">Data da NF<input className="form-input" type="date" value={f.data} onChange={e => set('data', e.target.value)} /></label>
          <label className="form-label">Nº da NF da MM<input className="form-input" value={f.nf} onChange={e => set('nf', e.target.value)} /></label>
          <label className="form-label">Unidades de wafer<input className="form-input" type="number" value={f.unidades} onChange={e => set('unidades', e.target.value)} />
            <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>{fmt(n / 12, n % 12 ? 1 : 0)} displays</span></label>
          <label className="form-label">Valor da NF da MM (só o wafer)<input className="form-input" type="number" step="0.01" value={f.wafer} onChange={e => set('wafer', e.target.value)} /></label>
          <label className="form-label">Frete do lote<input className="form-input" type="number" step="0.01" value={f.frete} onChange={e => set('frete', e.target.value)} />
            <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>se a fatura ainda não chegou, deixe em branco e lance depois</span></label>
          <div />
          <div style={{ gridColumn: '1 / -1', background: 'var(--purple-pale)', borderRadius: 6, padding: 10, fontSize: 13 }}>
            {cfg.componentes.map(x => {
              const s = ss.find(y => y.id === x.id)
              return <div key={x.id}>{x.nome}: {fmt(c.uso[x.id].qtd, casas(x))} {x.unidade} = {brl(c.uso[x.id].valor)}
                {s && s.saldo < c.uso[x.id].qtd - 1e-6 && <span style={{ color: 'var(--danger)' }}> (só há {fmt(s.saldo, casas(x))} {x.unidade} na MM)</span>}</div>
            })}
            <div style={{ fontWeight: 800, marginTop: 4 }}>Custo do lote {brl(c.total)} · {brl(c.porWafer)} por wafer · {brl(c.porWafer * 12)} por display</div>
          </div>
          {erro && <div className="alert-banner danger" style={{ gridColumn: '1 / -1' }}>{erro}</div>}
        </div>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? <RefreshCw size={14} className="spin" /> : <Save size={14} />} Gravar lote</button></div>
      </div>
    </div>
  )
}
