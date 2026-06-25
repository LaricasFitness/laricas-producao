import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData, STATUS_LABEL, atualizarVencidas } from '../lib/financeiro'
import { Plus, RefreshCw, Pencil, Save, ChevronDown, ChevronUp } from 'lucide-react'

function ModalLancamento({ lancamento, tipo, categorias, canais, contas, onClose, onSaved }) {
  const isNew = !lancamento?.id
  const [f, setF] = useState({
    descricao:      lancamento?.descricao || '',
    valor_total:    lancamento?.valor_total || '',
    categoria_id:   lancamento?.categoria_id || '',
    canal_id:       lancamento?.canal_id || '',
    conta_id:       lancamento?.conta_id || (contas[0]?.id || ''),
    total_parcelas: lancamento?.total_parcelas || 1,
    recorrente:     lancamento?.recorrente || false,
    observacao:     lancamento?.observacao || '',
    data_vencimento: lancamento?.fin_parcelas?.[0]?.data_vencimento || new Date().toISOString().slice(0,10),
    data_competencia: lancamento?.fin_parcelas?.[0]?.data_competencia || '',
    status: lancamento?.fin_parcelas?.[0]?.status || 'pendente',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  // Gera parcelas automaticamente
  function gerarParcelas() {
    const n = parseInt(f.total_parcelas) || 1
    const valorParcela = (parseFloat(f.valor_total) || 0) / n
    const base = new Date(f.data_vencimento + 'T12:00:00')
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(base)
      d.setMonth(d.getMonth() + i)
      return {
        numero_parcela: i + 1,
        valor: Math.round(valorParcela * 100) / 100,
        data_vencimento: d.toISOString().slice(0, 10),
        data_competencia: f.data_competencia || null,
        status: f.status,
      }
    })
  }

  async function salvar() {
    if (!f.descricao.trim()) { setErr('Descrição obrigatória.'); return }
    if (!f.valor_total || parseFloat(f.valor_total) <= 0) { setErr('Valor deve ser maior que zero.'); return }
    if (!f.categoria_id) { setErr('Selecione uma categoria.'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        tipo,
        descricao: f.descricao.trim(),
        valor_total: parseFloat(f.valor_total),
        categoria_id: f.categoria_id,
        canal_id: f.canal_id || null,
        conta_id: f.conta_id || null,
        total_parcelas: parseInt(f.total_parcelas) || 1,
        observacao: f.observacao || null,
        criado_por: JSON.parse(sessionStorage.getItem('usuario') || '{}').nome,
      }
      let lancId
      if (isNew) {
        const { data: l, error } = await supabase.from('fin_lancamentos').insert(payload).select().single()
        if (error) throw error
        lancId = l.id
        // Insere parcelas
        const parcelas = gerarParcelas().map(p => ({ ...p, lancamento_id: lancId }))
        await supabase.from('fin_parcelas').insert(parcelas)
      } else {
        await supabase.from('fin_lancamentos').update(payload).eq('id', lancamento.id)
        lancId = lancamento.id
      }
      onSaved()
    } catch(e) { setErr(e.message) }
    setSaving(false)
  }

  const catsFiltradas = categorias.filter(c => c.tipo === tipo)
  const nParcelas = parseInt(f.total_parcelas) || 1
  const valorParcela = nParcelas > 1 ? ((parseFloat(f.valor_total) || 0) / nParcelas) : null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: tipo === 'receita' ? 'var(--ok)' : 'var(--danger)' }}>
            {isNew ? '+ Novo' : '✏️ Editar'} {tipo === 'receita' ? 'Recebimento' : 'Pagamento'}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div style={{ color: 'var(--danger)', fontSize: 13, padding: '8px 12px', background: 'var(--danger-pale)', borderRadius: 6 }}>{err}</div>}

          <div className="form-group">
            <label className="form-label">Descrição *</label>
            <input className="form-input" value={f.descricao} onChange={e => set('descricao', e.target.value)}
              placeholder={tipo === 'receita' ? 'Ex: Pedidos iFood — semana 23/06' : 'Ex: Aluguel Junho/2026'} />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Valor total (R$) *</label>
              <input className="form-input" type="number" min={0} step={0.01} value={f.valor_total}
                onChange={e => set('valor_total', e.target.value)} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label className="form-label">Parcelas</label>
              <input className="form-input" type="number" min={1} max={48} value={f.total_parcelas}
                onChange={e => set('total_parcelas', e.target.value)} disabled={f.recorrente} />
              {valorParcela && <span className="form-hint">{nParcelas}x de {fmtR(valorParcela)}</span>}
            </div>
          </div>

          <div className="form-group">
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>
              <input type="checkbox" checked={f.recorrente}
                onChange={e => { set('recorrente', e.target.checked); if(e.target.checked) set('total_parcelas', 12) }}
                style={{ width:16, height:16, accentColor:'var(--purple)' }} />
              📅 Lançamento recorrente mensal (gera 12 parcelas automaticamente)
            </label>
            {f.recorrente && <div className="form-hint" style={{ marginTop:4 }}>As 12 parcelas serão geradas a partir do 1º vencimento informado, mês a mês.</div>}
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Categoria *</label>
              <select className="form-input" value={f.categoria_id} onChange={e => set('categoria_id', e.target.value)}>
                <option value="">Selecione...</option>
                {catsFiltradas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Canal / origem</label>
              <select className="form-input" value={f.canal_id} onChange={e => set('canal_id', e.target.value)}>
                <option value="">Sem canal</option>
                {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">1º vencimento</label>
              <input type="date" className="form-input" value={f.data_vencimento} onChange={e => set('data_vencimento', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Data competência</label>
              <input type="date" className="form-input" value={f.data_competencia} onChange={e => set('data_competencia', e.target.value)} />
              <span className="form-hint">Deixe em branco para usar o vencimento</span>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input" value={f.status} onChange={e => set('status', e.target.value)}>
                <option value="pendente">Pendente</option>
                <option value="agendado">Agendado</option>
                <option value="pago">Pago</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Conta</label>
              <select className="form-input" value={f.conta_id} onChange={e => set('conta_id', e.target.value)}>
                {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={f.observacao} onChange={e => set('observacao', e.target.value)} placeholder="Opcional" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className={`btn ${tipo === 'receita' ? 'btn-primary' : 'btn-danger'}`} onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalParcela({ parcela, contas, onClose, onSaved }) {
  const [status, setStatus] = useState(parcela.status)
  const [dataPag, setDataPag] = useState(parcela.data_pagamento || new Date().toISOString().slice(0,10))
  const [contaId, setContaId] = useState(parcela.conta_id || '')
  const [saving, setSaving] = useState(false)

  async function salvar() {
    setSaving(true)
    await supabase.from('fin_parcelas').update({
      status,
      data_pagamento: status === 'pago' ? dataPag : null,
      conta_id: contaId || null,
    }).eq('id', parcela.id)
    onSaved()
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <div className="modal-title">Atualizar parcela {parcela.numero_parcela}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--purple)', marginBottom: 4 }}>{fmtR(parcela.valor)}</div>
          <div style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>Vencimento: {fmtData(parcela.data_vencimento)}</div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="pendente">Pendente</option>
              <option value="agendado">Agendado</option>
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
          {status === 'pago' && (
            <>
              <div className="form-group">
                <label className="form-label">Data do pagamento</label>
                <input type="date" className="form-input" value={dataPag} onChange={e => setDataPag(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Conta</label>
                <select className="form-input" value={contaId} onChange={e => setContaId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <RefreshCw size={14} className="spin" /> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FinLancamentos({ tipo }) {
  const hoje = new Date()
  const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const [ini, setIni] = useState(mesIni)
  const [fim, setFim] = useState(hoje.toISOString().slice(0,10))
  const [statusFiltro, setStatusFiltro] = useState('todos')
  const [canalFiltro, setCanalFiltro] = useState('todos')

  const [lancamentos, setLancamentos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [canais, setCanais] = useState([])
  const [contas, setContas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [modalParcela, setModalParcela] = useState(null)
  const [expandido, setExpandido] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('fin_categorias').select('*').eq('ativo', true).order('ordem'),
      supabase.from('fin_canais').select('*').eq('ativo', true).order('ordem'),
      supabase.from('fin_contas').select('*').eq('ativo', true),
    ]).then(([{ data: cats }, { data: cans }, { data: conts }]) => {
      setCategorias(cats || [])
      setCanais(cans || [])
      setContas(conts || [])
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    await atualizarVencidas()
    const { data } = await supabase
      .from('fin_lancamentos')
      .select(`*, fin_categorias(id,nome,cor), fin_canais(id,nome,cor), fin_contas(id,nome),
               fin_parcelas(id,numero_parcela,valor,data_vencimento,data_pagamento,data_competencia,status,conta_id)`)
      .eq('tipo', tipo)
      .order('criado_em', { ascending: false })

    let result = data || []

    // Filtra por status/período nas parcelas
    result = result.filter(l => {
      const parcelas = l.fin_parcelas || []
      return parcelas.some(p => {
        const dentroData = p.data_vencimento >= ini && p.data_vencimento <= fim
        const matchStatus = statusFiltro === 'todos' || p.status === statusFiltro
        const matchCanal = canalFiltro === 'todos' || l.canal_id === canalFiltro
        return dentroData && matchStatus && matchCanal
      })
    })

    setLancamentos(result)
    setLoading(false)
  }, [tipo, ini, fim, statusFiltro, canalFiltro])

  useEffect(() => { load() }, [load])

  const totalPrevisto = lancamentos.reduce((s, l) => s + l.valor_total, 0)
  const totalPago = lancamentos.reduce((s, l) =>
    s + (l.fin_parcelas || []).filter(p => p.status === 'pago').reduce((ss, p) => ss + p.valor, 0), 0)
  const totalVencido = lancamentos.reduce((s, l) =>
    s + (l.fin_parcelas || []).filter(p => p.status === 'vencido').reduce((ss, p) => ss + p.valor, 0), 0)

  const cor = tipo === 'receita' ? 'var(--ok)' : 'var(--danger)'
  const titulo = tipo === 'receita' ? 'Contas a Receber' : 'Contas a Pagar'

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e => setIni(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e => setFim(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-input" value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}>
              <option value="todos">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="agendado">Agendado</option>
              <option value="pago">Pago</option>
              <option value="vencido">Vencido</option>
            </select>
          </div>
          {tipo === 'receita' && (
            <div className="form-group">
              <label className="form-label">Canal</label>
              <select className="form-input" value={canalFiltro} onChange={e => setCanalFiltro(e.target.value)}>
                <option value="todos">Todos</option>
                {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={14} /></button>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setModal('new')} style={{ background: cor }}>
              <Plus size={14} /> Novo {tipo === 'receita' ? 'recebimento' : 'pagamento'}
            </button>
          </div>
        </div>
      </div>

      {/* KPIs rápidos */}
      <div className="kpi-row">
        <div className="kpi neutral" style={{ borderTop: `3px solid ${cor}` }}>
          <div className="kpi-label">Total previsto</div>
          <div className="kpi-value" style={{ fontSize: 20, color: cor }}>{fmtR(totalPrevisto)}</div>
        </div>
        <div className="kpi ok">
          <div className="kpi-label">✅ {tipo === 'receita' ? 'Recebido' : 'Pago'}</div>
          <div className="kpi-value" style={{ fontSize: 20, color: 'var(--ok)' }}>{fmtR(totalPago)}</div>
        </div>
        <div className="kpi danger">
          <div className="kpi-label">🚨 Vencido</div>
          <div className="kpi-value" style={{ fontSize: 20, color: 'var(--danger)' }}>{fmtR(totalVencido)}</div>
        </div>
        <div className="kpi neutral">
          <div className="kpi-label">📋 Lançamentos</div>
          <div className="kpi-value">{lancamentos.length}</div>
        </div>
      </div>

      {/* Tabela */}
      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 700, fontSize: 14 }}>
          {titulo}
        </div>
        {loading ? (
          <div className="loading"><RefreshCw size={14} className="spin" /></div>
        ) : lancamentos.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">{tipo === 'receita' ? '📈' : '📉'}</div>
            <div className="empty-title">Nenhum lançamento no período</div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  {tipo === 'receita' && <th>Canal</th>}
                  <th>Parcelas</th>
                  <th>Valor total</th>
                  <th>Pago</th>
                  <th>Situação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map(l => {
                  const parcelas = l.fin_parcelas || []
                  const pago = parcelas.filter(p => p.status === 'pago').reduce((s, p) => s + p.valor, 0)
                  const vencidas = parcelas.filter(p => p.status === 'vencido').length
                  const pendentes = parcelas.filter(p => ['pendente','agendado'].includes(p.status)).length
                  const exp = expandido === l.id
                  const situacao = vencidas > 0 ? 'danger' : pendentes > 0 ? 'warning' : 'ok'
                  return [
                    <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setExpandido(exp ? null : l.id)}>
                      <td style={{ color: 'var(--gray-400)', fontSize: 12 }}>{exp ? '▼' : '▶'}</td>
                      <td style={{ fontWeight: 600, maxWidth: 200 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.descricao}</div>
                        {l.observacao && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{l.observacao}</div>}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.fin_categorias?.cor, display: 'inline-block', flexShrink: 0 }} />
                          {l.fin_categorias?.nome}
                        </span>
                      </td>
                      {tipo === 'receita' && (
                        <td style={{ fontSize: 12 }}>
                          {l.fin_canais ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: l.fin_canais.cor, display: 'inline-block' }} />
                            {l.fin_canais.nome}
                          </span> : '—'}
                        </td>
                      )}
                      <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                        {parcelas.length > 1 ? `${parcelas.length}x` : '1x'}
                      </td>
                      <td style={{ fontWeight: 700, color: cor }}>{fmtR(l.valor_total)}</td>
                      <td style={{ fontWeight: 600, color: 'var(--ok)' }}>{fmtR(pago)}</td>
                      <td>
                        <span className={`pill ${situacao}`} style={{ fontSize: 10 }}>
                          {vencidas > 0 ? `${vencidas} vencida${vencidas > 1 ? 's' : ''}` :
                           pendentes > 0 ? `${pendentes} pendente${pendentes > 1 ? 's' : ''}` : '✓ Quitado'}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-xs" onClick={() => setModal(l)}><Pencil size={11} /></button>
                      </td>
                    </tr>,
                    exp && (
                      <tr key={l.id + '-exp'}>
                        <td colSpan={tipo === 'receita' ? 9 : 8} style={{ padding: 0 }}>
                          <div style={{ background: 'var(--gray-50)', padding: '10px 20px 10px 40px' }}>
                            <table style={{ fontSize: 12, width: '100%' }}>
                              <thead>
                                <tr>
                                  <th>Parcela</th>
                                  <th>Vencimento</th>
                                  <th>Competência</th>
                                  <th>Valor</th>
                                  <th>Status</th>
                                  <th>Pago em</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {parcelas.sort((a,b) => a.numero_parcela - b.numero_parcela).map(p => {
                                  const scfg = STATUS_LABEL[p.status] || STATUS_LABEL.pendente
                                  return (
                                    <tr key={p.id}>
                                      <td>{p.numero_parcela}/{parcelas.length}</td>
                                      <td>{fmtData(p.data_vencimento)}</td>
                                      <td>{fmtData(p.data_competencia) || '—'}</td>
                                      <td style={{ fontWeight: 700 }}>{fmtR(p.valor)}</td>
                                      <td><span className={`pill ${scfg.cls}`} style={{ fontSize: 10 }}>{scfg.label}</span></td>
                                      <td>{fmtData(p.data_pagamento) || '—'}</td>
                                      <td>
                                        <button className="btn btn-ghost btn-xs" onClick={() => setModalParcela(p)}>
                                          Atualizar
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <ModalLancamento
          lancamento={modal === 'new' ? null : modal}
          tipo={tipo}
          categorias={categorias}
          canais={canais}
          contas={contas}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {modalParcela && (
        <ModalParcela
          parcela={modalParcela}
          contas={contas}
          onClose={() => setModalParcela(null)}
          onSaved={() => { setModalParcela(null); load() }}
        />
      )}
    </>
  )
}
