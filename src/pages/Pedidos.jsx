import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { carregarStatusCompleto, gerarNumeroPedido, statusConfig } from '../lib/data'
import { FileText, RefreshCw, CheckCircle, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function gerarPDF(numero, itens, obs) {
  const doc = new jsPDF()
  const hoje = new Date()
  const prev = new Date(); prev.setDate(hoje.getDate() + 10)

  doc.setFillColor(82, 46, 100)
  doc.rect(0, 0, 210, 40, 'F')
  doc.setTextColor(234, 183, 130)
  doc.setFontSize(20); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 17)
  doc.setFontSize(10); doc.setFont(undefined, 'normal')
  doc.setTextColor(255, 255, 255)
  doc.text('Ordem de Pedido — Embalagens', 14, 26)
  doc.text(`Pedido: ${numero}`, 14, 33)

  doc.setTextColor(42, 31, 40); doc.setFontSize(10)
  doc.text(`Emissão: ${hoje.toLocaleDateString('pt-BR')}`, 14, 50)
  doc.text(`Prazo estimado: ${prev.toLocaleDateString('pt-BR')} (10 dias corridos)`, 14, 57)
  if (obs) doc.text(`Obs: ${obs}`, 14, 64)

  autoTable(doc, {
    startY: obs ? 72 : 65,
    head: [['Código', 'Embalagem', 'Qtd solicitada']],
    body: itens.map(i => [i.codigo, i.nome, `${i.qtd.toLocaleString('pt-BR')} un`]),
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: [103, 63, 124], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 240, 248] },
    columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
  })

  const fy = doc.lastAutoTable.finalY + 12
  const total = itens.reduce((s, i) => s + i.qtd, 0)
  doc.setFont(undefined, 'bold'); doc.setFontSize(11)
  doc.text(`Total: ${total.toLocaleString('pt-BR')} unidades`, 14, fy)
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 150)
  doc.text('Laricas Fitness — Sistema de Controle de Embalagens', 14, 285)
  doc.text(hoje.toLocaleString('pt-BR'), 155, 285)
  doc.save(`Pedido_${numero}.pdf`)
}

function ModalNovoPedido({ onClose, onSaved }) {
  const [status, setStatus] = useState([])
  const [qtds, setQtds] = useState({})
  const [obs, setObs] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    carregarStatusCompleto().then(d => {
      setStatus(d)
      const pre = {}
      d.filter(e => e.qtdPedido > 0).forEach(e => { pre[e.id] = e.qtdPedido })
      setQtds(pre)
      setLoading(false)
    })
  }, [])

  const selecionadas = status.filter(e => parseInt(qtds[e.id] || 0) > 0)

  async function salvar() {
    if (selecionadas.length === 0) { alert('Selecione pelo menos uma embalagem.'); return }
    setSaving(true)
    try {
      const numero = gerarNumeroPedido()
      const hoje = new Date().toISOString().slice(0, 10)
      const prev = new Date(); prev.setDate(prev.getDate() + 10)

      const { data: pedido, error: pe } = await supabase
        .from('pedidos_grafica')
        .insert({ numero, status: 'enviado', enviado_em: hoje, previsao_entrega: prev.toISOString().slice(0, 10), observacoes: obs || null })
        .select().single()
      if (pe) throw pe

      await supabase.from('pedido_itens').insert(
        selecionadas.map(e => ({
          pedido_id: pedido.id,
          embalagem_id: e.id,
          quantidade_solicitada: parseInt(qtds[e.id]),
        }))
      )

      gerarPDF(numero, selecionadas.map(e => ({ codigo: e.codigo, nome: e.nome, qtd: parseInt(qtds[e.id]) })), obs)
      onSaved()
    } catch (e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div className="modal-title">Novo pedido para a gráfica</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? <div className="loading"><RefreshCw size={16} className="spin" /> Calculando...</div> : (
            <>
              <div className="alert alert-tip">
                💡 Itens pré-selecionados com base no estoque atual. Ajuste as quantidades se necessário.
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th><input type="checkbox" onChange={e => {
                        const m = {}
                        if (e.target.checked) status.forEach(s => { m[s.id] = s.qtdPedido || 100 })
                        setQtds(m)
                      }} /></th>
                      <th>Embalagem</th>
                      <th>Status</th>
                      <th>Qtd a pedir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.map(emb => {
                      const cfg = statusConfig(emb.status)
                      return (
                        <tr key={emb.id}>
                          <td>
                            <input type="checkbox"
                              checked={parseInt(qtds[emb.id] || 0) > 0}
                              onChange={e => setQtds(prev => ({ ...prev, [emb.id]: e.target.checked ? (emb.qtdPedido || 100) : 0 }))} />
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{emb.nome}</div>
                            <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{emb.codigo}</div>
                          </td>
                          <td><span className={`pill ${cfg.cls}`}>{cfg.label}</span></td>
                          <td>
                            <input type="number" min={0} className="qty-input"
                              value={qtds[emb.id] || ''}
                              disabled={!parseInt(qtds[emb.id] || 0)}
                              onChange={e => setQtds(prev => ({ ...prev, [emb.id]: e.target.value }))}
                              style={{ width: 90 }} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="form-group">
                <label className="form-label">Observação para a gráfica (opcional)</label>
                <input className="form-input" placeholder="Ex: Urgente, precisamos até sexta" value={obs} onChange={e => setObs(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-gold" onClick={salvar} disabled={saving || selecionadas.length === 0}>
            {saving ? <><RefreshCw size={14} className="spin" /> Gerando...</> : <><FileText size={14} /> Confirmar e baixar PDF</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalConferencia({ pedido, onClose, onSaved }) {
  const [itens, setItens] = useState([])
  const [recebidos, setRecebidos] = useState({})
  const [dataRec, setDataRec] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('pedido_itens').select('*, embalagens(id, codigo, nome, estoque_atual)')
      .eq('pedido_id', pedido.id)
      .then(({ data: d }) => {
        setItens(d || [])
        const pre = {}
        ;(d || []).forEach(i => { pre[i.id] = i.quantidade_recebida ?? i.quantidade_solicitada })
        setRecebidos(pre)
        setLoading(false)
      })
  }, [pedido.id])

  async function salvar() {
    setSaving(true)
    try {
      for (const item of itens) {
        const qtd = parseInt(recebidos[item.id]) || 0
        await supabase.from('pedido_itens')
          .update({ quantidade_recebida: qtd, recebido_em: dataRec })
          .eq('id', item.id)

        // Adiciona ao estoque
        const estoqueAtual = item.embalagens?.estoque_atual || 0
        await supabase.from('embalagens')
          .update({ estoque_atual: estoqueAtual + qtd, atualizado_em: new Date().toISOString() })
          .eq('id', item.embalagem_id)
      }
      const todosOk = itens.every(i => parseInt(recebidos[i.id]) === i.quantidade_solicitada)
      await supabase.from('pedidos_grafica').update({ status: todosOk ? 'recebido_total' : 'recebido_parcial' }).eq('id', pedido.id)
      onSaved()
    } catch (e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">📥 Conferir recebimento — {pedido.numero}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.5 }}>
            Preencha a quantidade que a gráfica <strong>realmente entregou</strong>.
            O sistema vai adicionar ao estoque automaticamente.
          </p>
          <div className="form-group">
            <label className="form-label">Data de recebimento</label>
            <input type="date" className="form-input" value={dataRec} onChange={e => setDataRec(e.target.value)} style={{ maxWidth: 200 }} />
          </div>
          {loading ? <div className="loading"><RefreshCw size={16} className="spin" /></div> : (
            <table className="tbl">
              <thead><tr><th>Embalagem</th><th>Pedido</th><th>Recebido</th></tr></thead>
              <tbody>
                {itens.map(item => {
                  const rec = parseInt(recebidos[item.id]) || 0
                  const div = rec !== item.quantidade_solicitada
                  return (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.embalagens?.nome}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{item.embalagens?.codigo}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.quantidade_solicitada.toLocaleString('pt-BR')}</td>
                      <td>
                        <input type="number" min={0} className="qty-input"
                          style={{ borderColor: div ? 'var(--warning)' : undefined, background: div ? 'var(--warning-pale)' : undefined }}
                          value={recebidos[item.id] ?? ''}
                          onChange={e => setRecebidos(prev => ({ ...prev, [item.id]: e.target.value }))} />
                        {div && <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 700, marginTop: 3 }}>
                          {rec > item.quantidade_solicitada ? '+' : ''}{(rec - item.quantidade_solicitada).toLocaleString('pt-BR')} un
                        </div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <><RefreshCw size={14} className="spin" /> Salvando...</> : <><CheckCircle size={14} /> Confirmar e atualizar estoque</>}
          </button>
        </div>
      </div>
    </div>
  )
}

const STATUS_LABEL = {
  enviado: { label: 'Aguardando entrega', cls: 'pill-warning' },
  recebido_total: { label: '✅ Recebido OK', cls: 'pill-ok' },
  recebido_parcial: { label: '⚠️ Recebido c/ diferença', cls: 'pill-danger' },
}

export default function Pedidos({ abrirNovo, onNovoClosed }) {
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNovo, setShowNovo] = useState(false)
  const [conferindo, setConferindo] = useState(null)
  const [expandido, setExpandido] = useState(null)
  const [itensPedido, setItensPedido] = useState({})

  useEffect(() => { if (abrirNovo) setShowNovo(true) }, [abrirNovo])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('pedidos_grafica').select('*').order('criado_em', { ascending: false })
    setPedidos(data || [])
    setLoading(false)
  }

  async function toggleExpand(id) {
    if (expandido === id) { setExpandido(null); return }
    if (!itensPedido[id]) {
      const { data } = await supabase.from('pedido_itens').select('*, embalagens(codigo, nome)').eq('pedido_id', id)
      setItensPedido(prev => ({ ...prev, [id]: data || [] }))
    }
    setExpandido(id)
  }

  useEffect(() => { load() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Pedidos à gráfica</div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNovo(true)}>
            <Plus size={14} /> Novo pedido
          </button>
        </div>

        {loading ? (
          <div className="loading"><RefreshCw size={16} className="spin" /></div>
        ) : pedidos.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <div className="empty-text">Nenhum pedido ainda</div>
          </div>
        ) : pedidos.map(p => (
          <div key={p.id}>
            <div className="hist-item">
              <div>
                <div className="hist-label">{p.numero}</div>
                <div className="hist-sub">
                  Emitido {new Date(p.enviado_em || p.criado_em).toLocaleDateString('pt-BR')}
                  {p.previsao_entrega && ` · Previsão: ${new Date(p.previsao_entrega).toLocaleDateString('pt-BR')}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`pill ${STATUS_LABEL[p.status]?.cls || 'pill-gray'}`}>
                  {STATUS_LABEL[p.status]?.label || p.status}
                </span>
                {(p.status === 'enviado' || p.status === 'recebido_parcial') && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConferindo(p)}>
                    📥 Conferir
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => toggleExpand(p.id)}>
                  {expandido === p.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>
            {expandido === p.id && (
              <div style={{ background: 'var(--gray-50)', padding: '12px 16px', borderRadius: 8, marginBottom: 8 }}>
                <table className="tbl" style={{ fontSize: 13 }}>
                  <thead><tr><th>Código</th><th>Embalagem</th><th>Solicitado</th><th>Recebido</th></tr></thead>
                  <tbody>
                    {(itensPedido[p.id] || []).map(i => (
                      <tr key={i.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{i.embalagens?.codigo}</td>
                        <td>{i.embalagens?.nome}</td>
                        <td>{i.quantidade_solicitada.toLocaleString('pt-BR')}</td>
                        <td style={{ color: i.quantidade_recebida == null ? 'var(--gray-400)' : i.quantidade_recebida !== i.quantidade_solicitada ? 'var(--warning)' : 'var(--ok)', fontWeight: 600 }}>
                          {i.quantidade_recebida != null ? i.quantidade_recebida.toLocaleString('pt-BR') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {showNovo && <ModalNovoPedido onClose={() => { setShowNovo(false); onNovoClosed?.() }} onSaved={() => { setShowNovo(false); onNovoClosed?.(); load() }} />}
      {conferindo && <ModalConferencia pedido={conferindo} onClose={() => setConferindo(null)} onSaved={() => { setConferindo(null); load() }} />}
    </div>
  )
}
