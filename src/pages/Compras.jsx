import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { registrarAcao } from '../lib/log'
import { Plus, RefreshCw, Save, Package, Pencil } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function fmt(n) { return (n || 0).toLocaleString('pt-BR') }
function fmtR(n) { return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

function ModalEditarCompra({ recebimento, embalagens, onClose, onSaved }) {
  const [nf, setNf] = useState(recebimento.numero_nf || '')
  const [dataRec, setDataRec] = useState(recebimento.data_recebimento || new Date().toISOString().slice(0, 10))
  const [obs, setObs] = useState(recebimento.observacao || '')
  const [itens, setItens] = useState(
    (recebimento.recebimento_itens || []).map(i => ({
      id: i.id,
      embalagem_id: i.embalagem_id,
      quantidade: String(i.quantidade_recebida),
      valor_unitario: i.valor_unitario ? String(i.valor_unitario) : '',
    }))
  )
  const [saving, setSaving] = useState(false)

  function addItem() { setItens(prev => [...prev, { id: null, embalagem_id: '', quantidade: '', valor_unitario: '' }]) }
  function updItem(i, k, v) { setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it)) }
  function remItem(i) { setItens(prev => prev.filter((_, idx) => idx !== i)) }

  const totalGeral = itens.reduce((s, it) => {
    return s + (parseFloat(it.quantidade) || 0) * (parseFloat(it.valor_unitario) || 0)
  }, 0)

  async function salvar() {
    const itensFiltrados = itens.filter(it => it.embalagem_id && it.quantidade > 0)
    if (!itensFiltrados.length) { alert('Adicione pelo menos um item.'); return }
    setSaving(true)
    try {
      // Atualiza cabeçalho
      await supabase.from('recebimentos').update({
        numero_nf: nf || null,
        data_recebimento: dataRec,
        observacao: obs || null,
        valor_total: totalGeral || null,
      }).eq('id', recebimento.id)

      // Deleta itens antigos e reinssere
      await supabase.from('recebimento_itens').delete().eq('recebimento_id', recebimento.id)
      await supabase.from('recebimento_itens').insert(
        itensFiltrados.map(it => ({
          recebimento_id: recebimento.id,
          embalagem_id: it.embalagem_id,
          quantidade_recebida: parseInt(it.quantidade),
          valor_unitario: parseFloat(it.valor_unitario) || null,
        }))
      )

      onSaved()
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <div className="modal-title">✏️ Editar recebimento</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Data de recebimento</label>
              <input type="date" className="form-input" value={dataRec} onChange={e => setDataRec(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Número da NF</label>
              <input className="form-input" placeholder="NF-001234" value={nf} onChange={e => setNf(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={obs} onChange={e => setObs(e.target.value)} />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
              Itens recebidos
            </div>
            {itens.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select className="form-input" value={it.embalagem_id} onChange={e => updItem(i, 'embalagem_id', e.target.value)}>
                  <option value="">Selecione...</option>
                  {embalagens.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <input type="number" min={0} className="form-input" placeholder="Qtd" value={it.quantidade} onChange={e => updItem(i, 'quantidade', e.target.value)} />
                <input type="number" min={0} step={0.01} className="form-input" placeholder="R$ unit." value={it.valor_unitario} onChange={e => updItem(i, 'valor_unitario', e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={() => remItem(i)} style={{ color: 'var(--danger)', padding: '7px' }}>✕</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addItem}><Plus size={12} /> Adicionar item</button>
          </div>

          {totalGeral > 0 && (
            <div style={{ background: 'var(--purple-pale)', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
              <span>Total</span>
              <span style={{ color: 'var(--purple)', fontSize: 16 }}>{fmtR(totalGeral)}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : <><Save size={14} /> Salvar alterações</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalNovaCompra({ pedidos, embalagens, onClose, onSaved }) {
  const [pedidoId, setPedidoId] = useState('')
  const [nf, setNf] = useState('')
  const [dataRec, setDataRec] = useState(new Date().toISOString().slice(0, 10))
  const [obs, setObs] = useState('')
  const [itens, setItens] = useState([{ embalagem_id: '', nome_livre: '', quantidade: '', valor_unitario: '' }])
  const [saving, setSaving] = useState(false)
  const [pedidoItens, setPedidoItens] = useState([])

  async function carregarItensPedido(pid) {
    if (!pid) { setItens([{ embalagem_id: '', quantidade: '', valor_unitario: '' }]); return }
    const { data } = await supabase
      .from('pedido_itens')
      .select('embalagem_id, quantidade_solicitada')
      .eq('pedido_id', pid)
    setPedidoItens(data || [])
    setItens((data || []).map(i => ({
      embalagem_id: i.embalagem_id,
      nome_livre: '',
      quantidade: i.quantidade_solicitada,
      valor_unitario: '',
    })))
  }

  function addItem() { setItens(prev => [...prev, { embalagem_id: '', nome_livre: '', quantidade: '', valor_unitario: '' }]) }
  function updItem(i, k, v) { setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it)) }
  function remItem(i) { setItens(prev => prev.filter((_, idx) => idx !== i)) }

  const totalGeral = itens.reduce((s, it) => {
    const qtd = parseFloat(it.quantidade) || 0
    const val = parseFloat(it.valor_unitario) || 0
    return s + qtd * val
  }, 0)

  async function salvar() {
    const itensFiltrados = itens.filter(it => (it.embalagem_id || it.nome_livre?.trim()) && it.quantidade > 0)
    if (!itensFiltrados.length) { alert('Adicione pelo menos um item.'); return }
    setSaving(true)
    try {
      const { data: rec, error: re } = await supabase.from('recebimentos').insert({
        pedido_id: pedidoId || null,
        numero_nf: nf || null,
        data_recebimento: dataRec,
        observacao: obs || null,
        valor_total: totalGeral || null,
      }).select().single()
      if (re) throw re

      // Itens cadastrados + livres
      const itensInsert = itensFiltrados.map(it => ({
        recebimento_id: rec.id,
        embalagem_id: it.embalagem_id || null,
        nome_livre: it.embalagem_id ? null : it.nome_livre?.trim(),
        quantidade_recebida: parseInt(it.quantidade),
        valor_unitario: parseFloat(it.valor_unitario) || null,
      }))
      await supabase.from('recebimento_itens').insert(itensInsert)

      // Atualiza custo_unitario das embalagens cadastradas
      for (const it of itensFiltrados.filter(i => i.embalagem_id && i.valor_unitario)) {
        await supabase.from('embalagens')
          .update({ custo_unitario: parseFloat(it.valor_unitario) })
          .eq('id', it.embalagem_id)
      }

      // Atualiza status do pedido vinculado
      if (pedidoId) {
        await supabase.from('pedidos_grafica').update({ status: 'recebido_total' }).eq('id', pedidoId)
      }

      // Cria Conta a Pagar se tiver valor
      if (totalGeral > 0) {
        const { data: fornecedor } = await supabase
          .from('fin_fornecedores').select('id').eq('nome_fantasia', 'PressPlate').maybeSingle()
        const venc = new Date(dataRec); venc.setDate(venc.getDate() + 30)
        const { data: lanc } = await supabase.from('fin_lancamentos').insert({
          tipo: 'despesa',
          descricao: `Embalagens gráfica${nf ? ` — NF ${nf}` : ''}${pedidoId ? ` — Pedido vinculado` : ''}`,
          valor_total: totalGeral,
          fornecedor_id: fornecedor?.id || null,
          total_parcelas: 1,
          observacao: obs || null,
          criado_por: 'sistema',
        }).select().single()
        if (lanc) {
          await supabase.from('fin_parcelas').insert({
            lancamento_id: lanc.id, numero_parcela: 1, valor: totalGeral,
            data_vencimento: venc.toISOString().slice(0, 10),
            data_competencia: dataRec, status: 'em_aberto',
          })
        }
      }

      await registrarAcao({
        acao: 'recebimento',
        descricao: `Recebimento de ${itensFiltrados.length} tipo(s)${nf ? ` — NF ${nf}` : ''}${totalGeral ? ` — R$ ${totalGeral.toFixed(2)}` : ''}`,
        tabela: 'recebimentos', registroId: rec.id,
        dadosNovos: { numero_nf: nf, valor_total: totalGeral },
      })

      onSaved()
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <div className="modal-title">📥 Registrar recebimento de embalagens</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Info básica */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Pedido vinculado (opcional)</label>
              <select className="form-input" value={pedidoId} onChange={e => { setPedidoId(e.target.value); carregarItensPedido(e.target.value) }}>
                <option value="">Sem pedido vinculado</option>
                {pedidos.map(p => <option key={p.id} value={p.id}>{p.numero} — {new Date(p.enviado_em || p.criado_em).toLocaleDateString('pt-BR')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Data de recebimento</label>
              <input type="date" className="form-input" value={dataRec} onChange={e => setDataRec(e.target.value)} />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Número da NF (opcional)</label>
              <input className="form-input" placeholder="NF-001234" value={nf} onChange={e => setNf(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Observação</label>
              <input className="form-input" placeholder="Ex: Chegou com atraso" value={obs} onChange={e => setObs(e.target.value)} />
            </div>
          </div>

          {/* Itens */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
              Itens recebidos
            </div>
            {itens.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px auto', gap: 8, marginBottom: 8, alignItems: 'start' }}>
                <div>
                  <select className="form-input" value={it.embalagem_id} onChange={e => updItem(i, 'embalagem_id', e.target.value)}>
                    <option value="">— Não cadastrado / digitar nome —</option>
                    {embalagens.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  {!it.embalagem_id && (
                    <input className="form-input" placeholder="Nome do item recebido"
                      value={it.nome_livre || ''} onChange={e => updItem(i, 'nome_livre', e.target.value)}
                      style={{ fontSize: 12, marginTop: 4 }} />
                  )}
                </div>
                <input type="number" min={0} className="form-input" placeholder="Qtd" value={it.quantidade} onChange={e => updItem(i, 'quantidade', e.target.value)} />
                <input type="number" min={0} step={0.01} className="form-input" placeholder="R$ unit." value={it.valor_unitario} onChange={e => updItem(i, 'valor_unitario', e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={() => remItem(i)} style={{ color: 'var(--danger)', padding: '7px' }}>✕</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addItem}><Plus size={12} /> Adicionar item</button>
          </div>

          {totalGeral > 0 && (
            <div style={{ background: 'var(--purple-pale)', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
              <span>Total a pagar à gráfica</span>
              <span style={{ color: 'var(--purple)', fontSize: 16 }}>{fmtR(totalGeral)}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <><RefreshCw size={14} className="spin" /> Salvando...</> : <><Save size={14} /> Salvar e atualizar estoque</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function gerarPDFCompras(recebimentos) {
  const doc = new jsPDF()
  const hoje = new Date()

  doc.setFillColor(82, 46, 100)
  doc.rect(0, 0, 210, 36, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(18); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 16)
  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text('Relatório de Compras — Embalagens', 14, 24)
  doc.text(`Gerado em ${hoje.toLocaleDateString('pt-BR')}`, 14, 31)

  const totalGeral = recebimentos.reduce((s, r) => s + (r.valor_total || 0), 0)

  autoTable(doc, {
    startY: 44,
    head: [['Data', 'NF', 'Itens', 'Total pago']],
    body: recebimentos.map(r => [
      new Date(r.data_recebimento + 'T12:00:00').toLocaleDateString('pt-BR'),
      r.numero_nf || '—',
      (r.recebimento_itens || []).map(i => `${i.embalagens?.nome}: ${fmt(i.quantidade_recebida)} un`).join('\n'),
      r.valor_total ? fmtR(r.valor_total) : '—',
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [103, 63, 124], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 240, 248] },
    columnStyles: { 3: { halign: 'right', fontStyle: 'bold' } },
    columnWidths: [30, 30, 110, 30],
  })

  const fy = doc.lastAutoTable.finalY + 10
  doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(30,30,30)
  doc.text(`Total pago no período: ${fmtR(totalGeral)}`, 14, fy)

  doc.save(`Compras_Embalagens_${hoje.toISOString().slice(0,10)}.pdf`)
}

export default function Compras({ tipo = 'rotulo' }) {
  const hoje = new Date()
  const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const [ini, setIni] = useState(mesIni)
  const [fim, setFim] = useState(hoje.toISOString().slice(0,10))
  const [recebimentos, setRecebimentos] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [embalagens, setEmbalagens] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [expandido, setExpandido] = useState(null)
  const [editando, setEditando] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: recs }, { data: peds }, { data: embs }] = await Promise.all([
      supabase.from('recebimentos')
        .select('*, recebimento_itens(*, embalagens(nome, codigo))')
        .gte('data_recebimento', ini).lte('data_recebimento', fim)
        .order('data_recebimento', { ascending: false }),
      supabase.from('pedidos_grafica').select('id, numero, enviado_em, criado_em').order('criado_em', { ascending: false }).limit(20),
      supabase.from('embalagens').select('id, nome, codigo').eq('ativo', true).eq('tipo', tipo).order('nome'),
    ])
    setRecebimentos(recs || [])
    setPedidos(peds || [])
    setEmbalagens(embs || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [ini, fim])

  const totalPeriodo = recebimentos.reduce((s, r) => s + (r.valor_total || 0), 0)
  const totalUnidades = recebimentos.reduce((s, r) =>
    s + (r.recebimento_itens || []).reduce((ss, i) => ss + i.quantidade_recebida, 0), 0)

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e => setIni(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e => setFim(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={14} /> Atualizar</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {recebimentos.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={() => gerarPDFCompras(recebimentos)}>
                📄 Exportar PDF
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> Registrar recebimento
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-row">
        <div className="kpi neutral">
          <div className="kpi-label">📦 Recebimentos</div>
          <div className="kpi-value">{recebimentos.length}</div>
          <div className="kpi-detail">no período</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">🔢 Unidades recebidas</div>
          <div className="kpi-value">{fmt(totalUnidades)}</div>
          <div className="kpi-detail">total de embalagens</div>
        </div>
        <div className="kpi neutral" style={{ borderTop: '3px solid var(--purple)' }}>
          <div className="kpi-label">💰 Total pago à gráfica</div>
          <div className="kpi-value" style={{ fontSize: 22, color: 'var(--purple)' }}>{fmtR(totalPeriodo)}</div>
          <div className="kpi-detail">no período selecionado</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">📊 Custo médio/recebimento</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{recebimentos.length > 0 ? fmtR(totalPeriodo / recebimentos.length) : '—'}</div>
          <div className="kpi-detail">valor médio por entrada</div>
        </div>
      </div>

      {/* Tabela */}
      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 700, fontSize: 14 }}>
          Histórico de recebimentos
        </div>
        {loading ? (
          <div className="loading"><RefreshCw size={14} className="spin" /></div>
        ) : recebimentos.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Package size={32} color="var(--gray-300)" /></div>
            <div className="empty-title">Nenhum recebimento no período</div>
            <div className="empty-sub">Clique em "Registrar recebimento" para adicionar</div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Data</th>
                  <th>NF</th>
                  <th>Itens</th>
                  <th>Total un.</th>
                  <th>Valor pago</th>
                  <th>Observação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recebimentos.map(r => {
                  const totalUn = (r.recebimento_itens || []).reduce((s, i) => s + i.quantidade_recebida, 0)
                  const exp = expandido === r.id
                  return (
                    <>
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setExpandido(exp ? null : r.id)}>
                        <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{exp ? '▼' : '▶'}</td>
                        <td style={{ fontWeight: 700 }}>{new Date(r.data_recebimento + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                        <td style={{ color: 'var(--gray-500)' }}>{r.numero_nf || '—'}</td>
                        <td><span className="pill purple">{(r.recebimento_itens || []).length} itens</span></td>
                        <td style={{ fontWeight: 700 }}>{fmt(totalUn)} un</td>
                        <td style={{ fontWeight: 800, color: r.valor_total ? 'var(--purple)' : 'var(--gray-400)' }}>
                          {r.valor_total ? fmtR(r.valor_total) : '—'}
                        </td>
                        <td style={{ color: 'var(--gray-500)', fontSize: 12 }}>{r.observacao || '—'}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setEditando(r)} title="Editar">
                            <Pencil size={12} />
                          </button>
                        </td>
                      </tr>
                      {exp && (
                        <tr key={r.id + '-exp'}>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <div style={{ background: 'var(--purple-ghost)', padding: '12px 20px 12px 40px' }}>
                              <table style={{ fontSize: 12 }}>
                                <thead>
                                  <tr>
                                    <th>Embalagem</th>
                                    <th>Qtd recebida</th>
                                    <th>Valor unit.</th>
                                    <th>Subtotal</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(r.recebimento_itens || []).map(i => (
                                    <tr key={i.id}>
                                      <td>
                                        <div style={{ fontWeight: 600 }}>{i.embalagens?.nome}</div>
                                        <div style={{ fontSize: 10, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{i.embalagens?.codigo}</div>
                                      </td>
                                      <td>{fmt(i.quantidade_recebida)} un</td>
                                      <td>{i.valor_unitario ? fmtR(i.valor_unitario) : '—'}</td>
                                      <td style={{ fontWeight: 700 }}>{i.valor_total ? fmtR(i.valor_total) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <ModalNovaCompra
          pedidos={pedidos}
          embalagens={embalagens}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
      {editando && (
        <ModalEditarCompra
          recebimento={editando}
          embalagens={embalagens}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); load() }}
        />
      )}
    </>
  )
}
