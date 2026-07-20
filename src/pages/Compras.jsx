import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { registrarAcao } from '../lib/log'
import { Plus, RefreshCw, Save, ChevronDown, ChevronUp, X, Pencil } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function fmt(n) { return (n || 0).toLocaleString('pt-BR') }
function fmtR(n) { return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

// ── Seletor de fornecedor com cadastro inline ─────────────────────────────────
function FornecedorSelect({ value, onChange, fornecedores, onNovoCadastrado }) {
  const [criando, setCriando] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [saving, setSaving] = useState(false)

  async function cadastrar() {
    if (!novoNome.trim()) return
    setSaving(true)
    const { data } = await supabase.from('fin_fornecedores')
      .insert({ razao_social: novoNome.trim(), nome_fantasia: novoNome.trim(), tipo_pessoa: 'pj', ativo: true })
      .select().single()
    if (data) {
      onNovoCadastrado(data)
      onChange(data.id)
    }
    setNovoNome('')
    setCriando(false)
    setSaving(false)
  }

  if (criando) return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input className="form-input" value={novoNome} onChange={e => setNovoNome(e.target.value)}
        placeholder="Nome do fornecedor" autoFocus style={{ flex: 1 }}
        onKeyDown={e => { if (e.key === 'Enter') cadastrar(); if (e.key === 'Escape') setCriando(false) }} />
      <button className="btn btn-primary btn-sm" onClick={cadastrar} disabled={saving || !novoNome.trim()}>
        {saving ? <RefreshCw size={12} className="spin"/> : '✓'}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setCriando(false)}><X size={12}/></button>
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select className="form-input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }}>
        <option value="">Selecione o fornecedor...</option>
        {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome_fantasia || f.razao_social}</option>)}
      </select>
      <button className="btn btn-ghost btn-sm" onClick={() => setCriando(true)} title="Cadastrar novo">+ Novo</button>
    </div>
  )
}

// ── Modal novo recebimento ────────────────────────────────────────────────────
function ModalNovaCompra({ pedidos, embalagens, fornecedores: fornInicial, onClose, onSaved, onNovoFornecedor }) {
  const [fornecedores, setFornecedores] = useState(fornInicial)
  const [fornecedorId, setFornecedorId] = useState('')
  const [pedidoId, setPedidoId] = useState('')
  const [nf, setNf] = useState('')
  const [dataRec, setDataRec] = useState(new Date().toISOString().slice(0, 10))
  const [obs, setObs] = useState('')
  const [itens, setItens] = useState([{ embalagem_id: '', nome_livre: '', quantidade: '', valor_unitario: '' }])
  const [saving, setSaving] = useState(false)
  const [prazo, setPrazo] = useState(30)

  function addItem() { setItens(prev => [...prev, { embalagem_id: '', nome_livre: '', quantidade: '', valor_unitario: '' }]) }
  function updItem(i, k, v) { setItens(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it)) }
  function remItem(i) { setItens(prev => prev.filter((_, idx) => idx !== i)) }

  async function carregarItensPedido(pid) {
    if (!pid) { setItens([{ embalagem_id: '', nome_livre: '', quantidade: '', valor_unitario: '' }]); return }
    const { data } = await supabase.from('pedido_itens').select('embalagem_id, quantidade_solicitada').eq('pedido_id', pid)
    setItens((data || []).map(i => ({ embalagem_id: i.embalagem_id, nome_livre: '', quantidade: i.quantidade_solicitada, valor_unitario: '' })))
    // Auto-preenche PressPlate
    const press = fornecedores.find(f => f.nome_fantasia === 'PressPlate' || f.razao_social?.includes('PressPlate'))
    if (press) setFornecedorId(press.id)
  }

  const totalGeral = itens.reduce((s, it) => s + (parseFloat(it.quantidade) || 0) * (parseFloat(it.valor_unitario) || 0), 0)

  async function salvar() {
    const fil = itens.filter(it => (it.embalagem_id || it.nome_livre?.trim()) && it.quantidade > 0)
    if (!fil.length) { alert('Adicione pelo menos um item.'); return }
    setSaving(true)
    try {
      const { data: rec, error } = await supabase.from('recebimentos').insert({
        pedido_id: pedidoId || null,
        fornecedor_id: fornecedorId || null,
        numero_nf: nf || null,
        data_recebimento: dataRec,
        observacao: obs || null,
        valor_total: totalGeral || null,
      }).select().single()
      if (error) throw error

      await supabase.from('recebimento_itens').insert(fil.map(it => ({
        recebimento_id: rec.id,
        embalagem_id: it.embalagem_id || null,
        nome_livre: it.embalagem_id ? null : it.nome_livre?.trim(),
        quantidade_recebida: parseInt(it.quantidade),
        valor_unitario: parseFloat(it.valor_unitario) || null,
      })))

      // Atualiza custo_unitario
      for (const it of fil.filter(i => i.embalagem_id && i.valor_unitario)) {
        await supabase.from('embalagens').update({ custo_unitario: parseFloat(it.valor_unitario) }).eq('id', it.embalagem_id)
      }

      if (pedidoId) await supabase.from('pedidos_grafica').update({ status: 'recebido_total' }).eq('id', pedidoId)

      // Conta a Pagar
      if (totalGeral > 0) {
        const venc = new Date(dataRec); venc.setDate(venc.getDate() + prazo)
        const fornNome = fornecedores.find(f => f.id === fornecedorId)?.nome_fantasia || 'Fornecedor'
        const { data: lanc } = await supabase.from('fin_lancamentos').insert({
          tipo: 'despesa',
          descricao: `Compra embalagens — ${fornNome}${nf ? ` NF ${nf}` : ''}`,
          valor_total: totalGeral,
          fornecedor_id: fornecedorId || null,
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

      await registrarAcao({ acao: 'recebimento', descricao: `Recebimento de ${fil.length} item(s)${nf ? ` — NF ${nf}` : ''}`, tabela: 'recebimentos', registroId: rec.id, dadosNovos: { valor_total: totalGeral } })
      onSaved()
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div className="modal-title">🚚 Registrar recebimento de embalagens</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Fornecedor */}
          <div className="form-group">
            <label className="form-label">Fornecedor</label>
            <FornecedorSelect value={fornecedorId} onChange={setFornecedorId}
              fornecedores={fornecedores}
              onNovoCadastrado={f => { setFornecedores(p => [...p, f]); onNovoFornecedor(f) }} />
          </div>

          {/* Pedido vinculado + data + NF */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Pedido vinculado (opcional)</label>
              <select className="form-input" value={pedidoId} onChange={e => { setPedidoId(e.target.value); carregarItensPedido(e.target.value) }}>
                <option value="">Sem pedido vinculado</option>
                {pedidos.map(p => <option key={p.id} value={p.id}>#{p.numero}</option>)}
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
              <input className="form-input" value={nf} onChange={e => setNf(e.target.value)} placeholder="NF-001234" />
            </div>
            <div className="form-group">
              <label className="form-label">Prazo de pagamento (dias)</label>
              <input type="number" className="form-input" value={prazo} onChange={e => setPrazo(parseInt(e.target.value)||0)} min={0} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex: Chegou com atraso" />
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
                    <optgroup label="🏷️ Rótulos">
                      {embalagens.filter(e => e.tipo === 'rotulo').map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </optgroup>
                    <optgroup label="📦 Embalagens">
                      {embalagens.filter(e => e.tipo === 'embalagem').map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </optgroup>
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
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--purple-pale)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--purple)' }}>
                Total: <strong>{fmtR(totalGeral)}</strong>
                {prazo > 0 && <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--gray-400)' }}>→ vence em {prazo} dias</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ok)' }}>✓ Conta a Pagar será criada automaticamente</div>
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

// ── Modal editar recebimento ──────────────────────────────────────────────────
function ModalEditarCompra({ recebimento, embalagens, fornecedores: fornInicial, onClose, onSaved, onNovoFornecedor }) {
  const [fornecedores, setFornecedores] = useState(fornInicial)
  const [fornecedorId, setFornecedorId] = useState(recebimento.fornecedor_id || '')
  const [nf, setNf] = useState(recebimento.numero_nf || '')
  const [dataRec, setDataRec] = useState(recebimento.data_recebimento || '')
  const [obs, setObs] = useState(recebimento.observacao || '')
  const [itens, setItens] = useState(
    (recebimento.recebimento_itens || []).map(i => ({
      id: i.id,
      embalagem_id: i.embalagem_id || '',
      nome_livre: i.nome_livre || '',
      quantidade: String(i.quantidade_recebida),
      valor_unitario: i.valor_unitario ? String(i.valor_unitario) : '',
    }))
  )
  const [saving, setSaving] = useState(false)

  function addItem() { setItens(p => [...p, { id: null, embalagem_id: '', nome_livre: '', quantidade: '', valor_unitario: '' }]) }
  function updItem(i, k, v) { setItens(p => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it)) }
  function remItem(i) { setItens(p => p.filter((_, idx) => idx !== i)) }

  const totalGeral = itens.reduce((s, it) => s + (parseFloat(it.quantidade)||0) * (parseFloat(it.valor_unitario)||0), 0)

  async function salvar() {
    const fil = itens.filter(it => (it.embalagem_id || it.nome_livre?.trim()) && it.quantidade > 0)
    if (!fil.length) { alert('Adicione pelo menos um item.'); return }
    setSaving(true)
    try {
      // Atualiza cabeçalho
      await supabase.from('recebimentos').update({
        fornecedor_id: fornecedorId || null,
        numero_nf: nf || null,
        data_recebimento: dataRec,
        observacao: obs || null,
        valor_total: totalGeral || null,
      }).eq('id', recebimento.id)

      // Recria itens (delete + insert)
      await supabase.from('recebimento_itens').delete().eq('recebimento_id', recebimento.id)
      await supabase.from('recebimento_itens').insert(fil.map(it => ({
        recebimento_id: recebimento.id,
        embalagem_id: it.embalagem_id || null,
        nome_livre: it.embalagem_id ? null : it.nome_livre?.trim(),
        quantidade_recebida: parseInt(it.quantidade),
        valor_unitario: parseFloat(it.valor_unitario) || null,
      })))

      // Atualiza custo_unitario
      for (const it of fil.filter(i => i.embalagem_id && i.valor_unitario)) {
        await supabase.from('embalagens').update({ custo_unitario: parseFloat(it.valor_unitario) }).eq('id', it.embalagem_id)
      }

      onSaved()
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div className="modal-title">✏️ Editar recebimento</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Fornecedor</label>
            <FornecedorSelect value={fornecedorId} onChange={setFornecedorId}
              fornecedores={fornecedores}
              onNovoCadastrado={f => { setFornecedores(p => [...p, f]); onNovoFornecedor(f) }} />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Data de recebimento</label>
              <input type="date" className="form-input" value={dataRec} onChange={e => setDataRec(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Número da NF (opcional)</label>
              <input className="form-input" value={nf} onChange={e => setNf(e.target.value)} placeholder="NF-001234" />
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
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px auto', gap: 8, marginBottom: 8, alignItems: 'start' }}>
                <div>
                  <select className="form-input" value={it.embalagem_id} onChange={e => updItem(i, 'embalagem_id', e.target.value)}>
                    <option value="">— Não cadastrado / digitar nome —</option>
                    <optgroup label="🏷️ Rótulos">
                      {embalagens.filter(e => e.tipo === 'rotulo').map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </optgroup>
                    <optgroup label="📦 Embalagens">
                      {embalagens.filter(e => e.tipo === 'embalagem').map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </optgroup>
                  </select>
                  {!it.embalagem_id && (
                    <input className="form-input" placeholder="Nome do item"
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
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--purple-pale)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--purple)' }}>Total: <strong>{fmtR(totalGeral)}</strong></span>
              <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>O lançamento financeiro não é atualizado automaticamente — ajuste em Financeiro → A Pagar se necessário</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? <><RefreshCw size={14} className="spin" /> Salvando...</> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Compras({ tipo = 'rotulo' }) {
  const hoje = new Date()
  const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const [ini, setIni] = useState(mesIni)
  const [fim, setFim] = useState(hoje.toISOString().slice(0,10))
  const [filtroForn, setFiltroForn] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos') // todos | rotulo | embalagem | outros
  const [recebimentos, setRecebimentos] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [embalagens, setEmbalagens] = useState([])
  const [fornecedores, setFornecedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [expandido, setExpandido] = useState(null)
  const [editando, setEditando] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: recs }, { data: peds }, { data: embs }, { data: forns }] = await Promise.all([
      supabase.from('recebimentos')
        .select('*, fornecedor:fornecedor_id(id,razao_social,nome_fantasia), recebimento_itens(*, embalagens(nome, codigo, tipo))')
        .gte('data_recebimento', ini).lte('data_recebimento', fim)
        .order('data_recebimento', { ascending: false }),
      supabase.from('pedidos_grafica').select('id, numero').order('criado_em', { ascending: false }).limit(30),
      supabase.from('embalagens').select('id, nome, codigo, tipo, categoria').eq('ativo', true).order('tipo').order('nome'),
      supabase.from('fin_fornecedores').select('id, razao_social, nome_fantasia').eq('ativo', true).order('razao_social'),
    ])
    setRecebimentos(recs || [])
    setPedidos(peds || [])
    setEmbalagens(embs || [])
    setFornecedores(forns || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [ini, fim])

  // Filtra recebimentos
  const recFiltrados = recebimentos.filter(r => {
    if (filtroForn && r.fornecedor_id !== filtroForn) return false
    if (filtroTipo === 'todos') return true
    return (r.recebimento_itens || []).some(i => {
      if (filtroTipo === 'outros') return !i.embalagens
      return i.embalagens?.tipo === filtroTipo
    })
  })

  const totalPeriodo = recFiltrados.reduce((s, r) => s + (r.valor_total || 0), 0)
  const totalUnidades = recFiltrados.reduce((s, r) =>
    s + (r.recebimento_itens || []).reduce((ss, i) => ss + i.quantidade_recebida, 0), 0)

  // Detecta tipos presentes nos recebimentos para mostrar filtros úteis
  const temRotulos = recebimentos.some(r => r.recebimento_itens?.some(i => i.embalagens?.tipo === 'rotulo'))
  const temEmbalagens = recebimentos.some(r => r.recebimento_itens?.some(i => i.embalagens?.tipo === 'embalagem'))
  const temOutros = recebimentos.some(r => r.recebimento_itens?.some(i => !i.embalagens))

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

          {/* Filtro fornecedor */}
          <div className="form-group">
            <label className="form-label">Fornecedor</label>
            <select className="form-input" value={filtroForn} onChange={e => setFiltroForn(e.target.value)}>
              <option value="">Todos</option>
              {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome_fantasia || f.razao_social}</option>)}
            </select>
          </div>

          {/* Filtro tipo */}
          <div className="form-group">
            <label className="form-label">Tipo</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { v: 'todos', l: 'Todos' },
                ...(temRotulos ? [{ v: 'rotulo', l: '🏷️ Rótulos' }] : []),
                ...(temEmbalagens ? [{ v: 'embalagem', l: '📦 Embalagens' }] : []),
                ...(temOutros ? [{ v: 'outros', l: 'Outros' }] : []),
              ].map(({ v, l }) => (
                <button key={v} className={`btn btn-xs ${filtroTipo === v ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFiltroTipo(v)}>{l}</button>
              ))}
            </div>
          </div>

          <button className="btn btn-ghost" onClick={load}><RefreshCw size={14} /></button>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> Registrar recebimento
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        <div className="card card-pad kpi">
          <div className="kpi-label">Total pago no período</div>
          <div className="kpi-value" style={{ color: 'var(--danger)' }}>{fmtR(totalPeriodo)}</div>
        </div>
        <div className="card card-pad kpi">
          <div className="kpi-label">Unidades recebidas</div>
          <div className="kpi-value">{fmt(totalUnidades)}</div>
        </div>
        <div className="card card-pad kpi">
          <div className="kpi-label">Recebimentos</div>
          <div className="kpi-value">{recFiltrados.length}</div>
        </div>
      </div>

      {/* Lista de recebimentos */}
      <div className="card">
        {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : (
          recFiltrados.length === 0 ? (
            <div className="empty card-pad">
              <div className="empty-icon">📦</div>
              <div className="empty-title">Nenhum recebimento no período</div>
              <div className="empty-sub">Ajuste os filtros ou registre um novo recebimento</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Data</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Fornecedor</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>NF</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>Itens</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Total un.</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Valor pago</th>
                  <th style={{ padding: '10px 14px' }}></th>
                </tr>
              </thead>
              <tbody>
                {recFiltrados.map(r => {
                  const totalUn = (r.recebimento_itens || []).reduce((s, i) => s + i.quantidade_recebida, 0)
                  const exp = expandido === r.id
                  const fornNome = r.fornecedor?.nome_fantasia || r.fornecedor?.razao_social || '—'

                  // Detecta tipos no recebimento
                  const tipos = [...new Set((r.recebimento_itens||[]).map(i => i.embalagens?.tipo || 'outro'))]

                  return (
                    <>
                      <tr key={r.id} style={{ borderTop: '1px solid var(--gray-100)', cursor: 'pointer' }}
                        onClick={() => setExpandido(exp ? null : r.id)}>
                        <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                          {new Date(r.data_recebimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontWeight: 600 }}>{fornNome}</span>
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--gray-500)', fontSize: 12 }}>
                          {r.numero_nf || '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className="pill neutral" style={{ fontSize: 11 }}>
                            {(r.recebimento_itens||[]).length} {(r.recebimento_itens||[]).length === 1 ? 'item' : 'itens'}
                          </span>
                          {tipos.map(t => (
                            <span key={t} className="pill" style={{ fontSize: 10, marginLeft: 4, background: t==='rotulo'?'var(--purple-pale)':t==='embalagem'?'#e0f0ff':'var(--gray-100)', color: t==='rotulo'?'var(--purple)':t==='embalagem'?'#1a6fb5':'var(--gray-500)' }}>
                              {t === 'rotulo' ? '🏷️' : t === 'embalagem' ? '📦' : '•'} {t==='rotulo'?'Rótulo':t==='embalagem'?'Embalagem':'Outro'}
                            </span>
                          ))}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>
                          {fmt(totalUn)} un
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--danger)' }}>
                          {r.valor_total ? fmtR(r.valor_total) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button className="btn btn-ghost btn-xs" title="Editar"
                              onClick={e => { e.stopPropagation(); setEditando(r) }}>
                              <Pencil size={12}/>
                            </button>
                            {exp ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                          </div>
                        </td>
                      </tr>
                      {exp && (
                        <tr key={`${r.id}-det`}>
                          <td colSpan={7} style={{ padding: '0 14px 14px', background: 'var(--gray-50)' }}>
                            {r.observacao && (
                              <div style={{ fontSize: 12, color: 'var(--gray-500)', fontStyle: 'italic', padding: '8px 0 4px' }}>
                                📝 {r.observacao}
                              </div>
                            )}
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                              <thead>
                                <tr style={{ color: 'var(--gray-400)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>
                                  <th style={{ padding: '4px 0', textAlign: 'left' }}>Embalagem</th>
                                  <th style={{ padding: '4px 8px', textAlign: 'center' }}>Qtd recebida</th>
                                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Valor unit.</th>
                                  <th style={{ padding: '4px 0', textAlign: 'right' }}>Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(r.recebimento_itens || []).map(i => (
                                  <tr key={i.id} style={{ borderTop: '1px solid var(--gray-200)' }}>
                                    <td style={{ padding: '6px 0' }}>
                                      <div style={{ fontWeight: 600 }}>
                                        {i.embalagens?.nome || i.nome_livre || <span style={{color:'var(--gray-300)',fontStyle:'italic'}}>sem nome</span>}
                                      </div>
                                      {i.embalagens?.codigo && <div style={{ fontSize: 10, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{i.embalagens.codigo}</div>}
                                      {!i.embalagens && i.nome_livre && <div style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 600 }}>não cadastrado</div>}
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{fmt(i.quantidade_recebida)} un</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--gray-600)' }}>{i.valor_unitario ? fmtR(i.valor_unitario) : '—'}</td>
                                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>
                                      {i.valor_unitario ? fmtR(i.quantidade_recebida * i.valor_unitario) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      {showModal && (
        <ModalNovaCompra
          pedidos={pedidos}
          embalagens={embalagens}
          fornecedores={fornecedores}
          onNovoFornecedor={f => setFornecedores(p => [...p, f])}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}

      {editando && (
        <ModalEditarCompra
          recebimento={editando}
          embalagens={embalagens}
          fornecedores={fornecedores}
          onNovoFornecedor={f => setFornecedores(p => [...p, f])}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); load() }}
        />
      )}
    </>
  )
}
