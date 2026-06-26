import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData, STATUS_LABEL, atualizarVencidas } from '../lib/financeiro'
import { Plus, RefreshCw, Pencil, Save, Upload, FileText } from 'lucide-react'

// ── Parser XML NF-e ───────────────────────────────────────────────────────────
function parseNFe(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const get = (tag) => doc.querySelector(tag)?.textContent?.trim() || ''
  const getAll = (tag) => [...doc.querySelectorAll(tag)]

  const emit = doc.querySelector('emit')
  const fornecedor = {
    cnpj: get('emit CNPJ') || get('emit CPF'),
    razao_social: get('emit xNome'),
    nome_fantasia: get('emit xFant'),
    telefone: get('emit fone'),
    endereco: `${get('emit xLgr')}, ${get('emit nro')}`,
    cidade: get('emit xMun'),
    uf: get('emit UF'),
  }

  const itens = getAll('det').map(det => ({
    descricao: det.querySelector('xProd')?.textContent?.trim() || '',
    ncm: det.querySelector('NCM')?.textContent?.trim() || '',
    quantidade: parseFloat(det.querySelector('qCom')?.textContent || '0'),
    unidade: det.querySelector('uCom')?.textContent?.trim() || 'UN',
    valor_unitario: parseFloat(det.querySelector('vUnCom')?.textContent || '0'),
    valor_total: parseFloat(det.querySelector('vProd')?.textContent || '0'),
  }))

  const nf = {
    numero: get('nNF'),
    chave: get('chNFe') || doc.querySelector('infNFe')?.getAttribute('Id')?.replace('NFe','') || '',
    data_emissao: get('dhEmi').slice(0, 10) || get('dEmi').slice(0, 10),
    valor_total: parseFloat(get('vNF') || '0'),
    fornecedor,
    itens,
  }
  return nf
}

// ── Modal criar categoria inline ──────────────────────────────────────────────
function ModalNovaCategoria({ tipo, onClose, onSaved }) {
  const [nome, setNome] = useState('')
  const [saving, setSaving] = useState(false)
  async function salvar() {
    if (!nome.trim()) return
    setSaving(true)
    const { data } = await supabase.from('fin_categorias')
      .insert({ nome: nome.trim(), tipo, cor: '#7f8c8d', ordem: 99, ativo: true, nivel: 1 })
      .select().single()
    onSaved(data)
    setSaving(false)
  }
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:340}}>
        <div className="modal-header">
          <div className="modal-title">Nova categoria</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input className="form-input" value={nome} onChange={e=>setNome(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&salvar()} autoFocus placeholder="Ex: Salários, Taxa iFood..." />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!nome.trim()}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Plus size={14}/> Criar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal confirmação XML ─────────────────────────────────────────────────────
function ModalConfirmarXML({ nf, categorias, contas, formasPag, onClose, onSaved }) {
  const [categoria_id, setCategoria] = useState('')
  const [itensCategoria, setItensCategoria] = useState({}) // { idx: categoria_id }
  const [conta_id, setConta] = useState(contas[0]?.id || '')
  const [forma_id, setForma] = useState('')
  const [vencimento, setVencimento] = useState(nf.data_emissao)
  const [salvarInsumos, setSalvarInsumos] = useState(true)
  const [saving, setSaving] = useState(false)

  const catsDespesa = categorias.filter(c => c.tipo === 'despesa' && c.nivel === 1)

  async function confirmar() {
    setSaving(true)
    try {
      // 1. Upsert fornecedor
      let fornecedorId = null
      if (nf.fornecedor.cnpj) {
        const { data: forn } = await supabase.from('fin_fornecedores')
          .upsert({ ...nf.fornecedor }, { onConflict: 'cnpj' })
          .select().single()
        fornecedorId = forn?.id
      }

      // 2. Cria lançamento
      const { data: lanc } = await supabase.from('fin_lancamentos').insert({
        tipo: 'despesa',
        descricao: `NF ${nf.numero} — ${nf.fornecedor.razao_social || nf.fornecedor.nome_fantasia}`,
        valor_total: nf.valor_total,
        categoria_id: categoria_id || null,
        conta_id: conta_id || null,
        forma_pagamento_id: forma_id || null,
        fornecedor_id: fornecedorId,
        nf_chave: nf.chave,
        nf_numero: nf.numero,
        total_parcelas: 1,
        criado_por: JSON.parse(sessionStorage.getItem('usuario')||'{}').nome,
      }).select().single()

      // 3. Parcela
      await supabase.from('fin_parcelas').insert({
        lancamento_id: lanc.id,
        numero_parcela: 1,
        valor: nf.valor_total,
        data_vencimento: vencimento,
        data_competencia: nf.data_emissao,
        status: 'em_aberto',
        conta_id: conta_id || null,
      })

      // 4. Itens da NF — cada item com sua própria categoria
      if (nf.itens.length) {
        const itensInsert = []
        for (let idx = 0; idx < nf.itens.length; idx++) {
          const item = nf.itens[idx]
          let insumo_id = null
          if (salvarInsumos) {
            const { data: ins } = await supabase.from('fin_insumos')
              .upsert({
                descricao: item.descricao,
                ncm: item.ncm,
                unidade: item.unidade,
                preco_medio: item.valor_unitario,
                fornecedor_id: fornecedorId,
              }, { onConflict: 'descricao' })
              .select().single()
            insumo_id = ins?.id
          }
          // Usa categoria por item se definida, senão usa a categoria global
          const catItem = itensCategoria[idx] || categoria_id || null
          itensInsert.push({ ...item, lancamento_id: lanc.id, insumo_id, categoria_id: catItem })
        }
        await supabase.from('fin_nf_itens').insert(itensInsert)
      }

      onSaved()
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:540}}>
        <div className="modal-header">
          <div className="modal-title">📄 NF-e {nf.numero} — {nf.fornecedor.razao_social}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{background:'var(--gray-50)',borderRadius:8,padding:'12px 14px',marginBottom:14,fontSize:13}}>
            <div style={{fontWeight:700,marginBottom:4}}>Resumo da nota</div>
            <div>Fornecedor: <strong>{nf.fornecedor.razao_social}</strong></div>
            <div>CNPJ: {nf.fornecedor.cnpj} · {nf.fornecedor.cidade}/{nf.fornecedor.uf}</div>
            <div>Emissão: {fmtData(nf.data_emissao)} · {nf.itens.length} itens</div>
            <div style={{fontWeight:800,color:'var(--purple)',fontSize:16,marginTop:6}}>Total: {fmtR(nf.valor_total)}</div>
          </div>

          <div style={{maxHeight:200,overflowY:'auto',marginBottom:14,border:'1px solid var(--gray-200)',borderRadius:8}}>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{textAlign:'left',padding:'6px 10px',background:'var(--gray-50)'}}>Produto</th>
                <th style={{textAlign:'right',padding:'6px 10px',background:'var(--gray-50)'}}>Qtd</th>
                <th style={{textAlign:'right',padding:'6px 10px',background:'var(--gray-50)'}}>Total</th>
                <th style={{padding:'6px 10px',background:'var(--gray-50)',minWidth:140}}>Categoria</th>
              </tr></thead>
              <tbody>{nf.itens.map((it,i)=>(
                <tr key={i} style={{borderTop:'1px solid var(--gray-100)'}}>
                  <td style={{padding:'5px 10px'}}>{it.descricao}</td>
                  <td style={{textAlign:'right',padding:'5px 10px'}}>{it.quantidade} {it.unidade}</td>
                  <td style={{textAlign:'right',padding:'5px 10px',fontWeight:600}}>{fmtR(it.valor_total)}</td>
                  <td style={{padding:'3px 6px'}}>
                    <select className="form-input" style={{padding:'3px 6px',fontSize:11}}
                      value={itensCategoria[i]||categoria_id}
                      onChange={e=>setItensCategoria(prev=>({...prev,[i]:e.target.value}))}>
                      <option value="">— padrão —</option>
                      {catsDespesa.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Categoria</label>
              <select className="form-input" value={categoria_id} onChange={e=>setCategoria(e.target.value)}>
                <option value="">Selecione...</option>
                {catsDespesa.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Vencimento</label>
              <input type="date" className="form-input" value={vencimento} onChange={e=>setVencimento(e.target.value)} />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Conta</label>
              <select className="form-input" value={conta_id} onChange={e=>setConta(e.target.value)}>
                {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Forma de pagamento</label>
              <select className="form-input" value={forma_id} onChange={e=>setForma(e.target.value)}>
                <option value="">Selecione...</option>
                {formasPag.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',fontWeight:600}}>
            <input type="checkbox" checked={salvarInsumos} onChange={e=>setSalvarInsumos(e.target.checked)}
              style={{width:16,height:16,accentColor:'var(--purple)'}}/>
            📦 Salvar itens no cadastro de insumos (para controle de estoque futuro)
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={confirmar} disabled={saving}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Save size={14}/> Lançar no Contas a Pagar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalLancamento({ lancamento, tipo, categorias, canais, contas, formasPag, fornecedores, onClose, onSaved }) {
  const isNew = !lancamento?.id
  const [f, setF] = useState({
    descricao:          lancamento?.descricao || '',
    valor_parcela:      lancamento ? (lancamento.valor_total / (lancamento.total_parcelas||1)).toFixed(2) : '',
    categoria_id:       lancamento?.categoria_id || '',
    canal_id:           lancamento?.canal_id || '',
    conta_id:           lancamento?.conta_id || (contas[0]?.id || ''),
    forma_pagamento_id: lancamento?.forma_pagamento_id || '',
    fornecedor_id:      lancamento?.fornecedor_id || '',
    total_parcelas:     lancamento?.total_parcelas || 1,
    recorrente:         lancamento?.recorrente || false,
    observacao:         lancamento?.observacao || '',
    data_vencimento:    lancamento?.fin_parcelas?.[0]?.data_vencimento || new Date().toISOString().slice(0,10),
    data_competencia:   lancamento?.fin_parcelas?.[0]?.data_competencia || '',
    status:             lancamento?.fin_parcelas?.[0]?.status || 'em_aberto',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [showNovaCategoria, setShowNovaCategoria] = useState(false)
  const [catsLocais, setCatsLocais] = useState(categorias)

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const nParcelas = parseInt(f.total_parcelas) || 1
  const valorParcela = parseFloat(f.valor_parcela) || 0
  const valorTotal = valorParcela * nParcelas

  function gerarParcelas() {
    const base = new Date(f.data_vencimento + 'T12:00:00')
    return Array.from({ length: nParcelas }, (_, i) => {
      const d = new Date(base)
      d.setMonth(d.getMonth() + i)
      return {
        numero_parcela: i + 1,
        valor: valorParcela,
        data_vencimento: d.toISOString().slice(0, 10),
        data_competencia: f.data_competencia || null,
        status: f.status,
      }
    })
  }

  async function salvar() {
    if (!f.descricao.trim()) { setErr('Descrição obrigatória.'); return }
    if (!valorParcela || valorParcela <= 0) { setErr('Valor da parcela deve ser maior que zero.'); return }
    if (!f.categoria_id) { setErr('Selecione uma categoria.'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        tipo, descricao: f.descricao.trim(),
        valor_total: valorTotal,
        categoria_id: f.categoria_id,
        canal_id: f.canal_id || null,
        conta_id: f.conta_id || null,
        forma_pagamento_id: f.forma_pagamento_id || null,
        fornecedor_id: f.fornecedor_id || null,
        total_parcelas: nParcelas,
        recorrente: f.recorrente,
        observacao: f.observacao || null,
        criado_por: JSON.parse(sessionStorage.getItem('usuario')||'{}').nome,
      }
      if (isNew) {
        const { data: l, error } = await supabase.from('fin_lancamentos').insert(payload).select().single()
        if (error) throw error
        await supabase.from('fin_parcelas').insert(gerarParcelas().map(p => ({ ...p, lancamento_id: l.id })))
      } else {
        await supabase.from('fin_lancamentos').update(payload).eq('id', lancamento.id)
      }
      onSaved()
    } catch(e) { setErr(e.message) }
    setSaving(false)
  }

  const catsFiltradas = catsLocais.filter(c => c.tipo === tipo && c.nivel === 1)

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-header">
          <div className="modal-title" style={{color:tipo==='receita'?'var(--ok)':'var(--danger)'}}>
            {isNew?'+ Novo':'✏️ Editar'} {tipo==='receita'?'Recebimento':'Pagamento'}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div style={{color:'var(--danger)',fontSize:13,padding:'8px 12px',background:'var(--danger-pale)',borderRadius:6,marginBottom:10}}>{err}</div>}

          <div className="form-group">
            <label className="form-label">Descrição *</label>
            <input className="form-input" value={f.descricao} onChange={e=>set('descricao',e.target.value)}
              placeholder={tipo==='receita'?'Ex: Pedidos iFood — semana 23/06':'Ex: Aluguel Junho/2026'}/>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Valor por parcela (R$) *</label>
              <input className="form-input" type="number" min={0} step={0.01} value={f.valor_parcela}
                onChange={e=>set('valor_parcela',e.target.value)} placeholder="0,00"/>
              {nParcelas > 1 && valorParcela > 0 && <span className="form-hint">Total: {fmtR(valorTotal)}</span>}
            </div>
            <div className="form-group">
              <label className="form-label">Parcelas</label>
              <input className="form-input" type="number" min={1} max={48} value={f.total_parcelas}
                onChange={e=>set('total_parcelas',e.target.value)} disabled={f.recorrente}/>
              {nParcelas === 1 && valorParcela > 0 && <span className="form-hint">Total: {fmtR(valorTotal)}</span>}
            </div>
          </div>

          <div className="form-group">
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
              <input type="checkbox" checked={f.recorrente}
                onChange={e=>{set('recorrente',e.target.checked);if(e.target.checked)set('total_parcelas',12)}}
                style={{width:16,height:16,accentColor:'var(--purple)'}}/>
              📅 Recorrente mensal (12 meses)
            </label>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <label className="form-label" style={{marginBottom:0}}>Categoria *</label>
                <button className="btn btn-ghost btn-xs" onClick={()=>setShowNovaCategoria(true)}>
                  <Plus size={11}/> Nova
                </button>
              </div>
              <select className="form-input" value={f.categoria_id} onChange={e=>set('categoria_id',e.target.value)}>
                <option value="">Selecione...</option>
                {catsFiltradas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Canal / origem</label>
              <select className="form-input" value={f.canal_id} onChange={e=>set('canal_id',e.target.value)}>
                <option value="">Sem canal</option>
                {canais.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Forma de pagamento</label>
              <select className="form-input" value={f.forma_pagamento_id} onChange={e=>set('forma_pagamento_id',e.target.value)}>
                <option value="">Selecione...</option>
                {formasPag.map(fp=><option key={fp.id} value={fp.id}>{fp.nome}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Conta</label>
              <select className="form-input" value={f.conta_id} onChange={e=>set('conta_id',e.target.value)}>
                {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">1º vencimento</label>
              <input type="date" className="form-input" value={f.data_vencimento} onChange={e=>set('data_vencimento',e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="form-label">Data competência</label>
              <input type="date" className="form-input" value={f.data_competencia} onChange={e=>set('data_competencia',e.target.value)}/>
              <span className="form-hint">Deixe em branco para usar o vencimento</span>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Status inicial</label>
              <select className="form-input" value={f.status} onChange={e=>set('status',e.target.value)}>
                <option value="em_aberto">Em aberto</option>
                <option value="agendado">Agendado</option>
                <option value="pago">Pago</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Fornecedor (opcional)</label>
              <select className="form-input" value={f.fornecedor_id} onChange={e=>set('fornecedor_id',e.target.value)}>
                <option value="">Sem fornecedor</option>
                {fornecedores.map(forn=><option key={forn.id} value={forn.id}>{forn.nome_fantasia||forn.razao_social}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={f.observacao} onChange={e=>set('observacao',e.target.value)} placeholder="Opcional"/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className={`btn ${tipo==='receita'?'btn-primary':'btn-danger'}`} onClick={salvar} disabled={saving}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Save size={14}/> Salvar</>}
          </button>
        </div>
      </div>
      {showNovaCategoria && (
        <ModalNovaCategoria tipo={tipo} onClose={()=>setShowNovaCategoria(false)}
          onSaved={nova=>{setCatsLocais(prev=>[...prev,nova]);set('categoria_id',nova.id);setShowNovaCategoria(false)}}/>
      )}
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
              <option value="em_aberto">Em aberto</option>
              <option value="pendente">Pendente (legado)</option>
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
  const [formasPag, setFormasPag] = useState([])
  const [fornecedores, setFornecedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [modalParcela, setModalParcela] = useState(null)
  const [modalXml, setModalXml] = useState(null)
  const [expandido, setExpandido] = useState(null)
  const xmlRef = useRef()

  useEffect(() => {
    Promise.all([
      supabase.from('fin_categorias').select('*').eq('ativo',true).order('nivel').order('ordem'),
      supabase.from('fin_canais').select('*').eq('ativo',true).order('ordem'),
      supabase.from('fin_contas').select('*').eq('ativo',true),
      supabase.from('fin_formas_pagamento').select('*').eq('ativo',true).order('ordem'),
      supabase.from('fin_fornecedores').select('*').eq('ativo',true).order('razao_social'),
    ]).then(([{data:cats},{data:cans},{data:conts},{data:fps},{data:forns}]) => {
      setCategorias(cats||[])
      setCanais(cans||[])
      setContas(conts||[])
      setFormasPag(fps||[])
      setFornecedores(forns||[])
    })
  }, [])

  function handleXML(file) {
    const reader = new FileReader()
    reader.onload = e => {
      const nf = parseNFe(e.target.result)
      setModalXml(nf)
    }
    reader.readAsText(file, 'UTF-8')
  }

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
              <option value="em_aberto">Em aberto</option>
              <option value="pendente">Pendente (legado)</option>
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
          <div style={{ marginLeft: 'auto', display:'flex', gap:8 }}>
            {tipo === 'despesa' && (
              <>
                <button className="btn btn-ghost" onClick={()=>xmlRef.current?.click()}>
                  <FileText size={14}/> Importar XML NF-e
                </button>
                <input ref={xmlRef} type="file" accept=".xml" style={{display:'none'}}
                  onChange={e=>{if(e.target.files[0])handleXML(e.target.files[0]);e.target.value=''}}/>
              </>
            )}
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
                        <div style={{ display:'flex', gap:4 }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setModal(l)} title="Editar"><Pencil size={11} /></button>
                          <button className="btn btn-ghost btn-xs" title="Excluir"
                            style={{ color:'var(--danger)' }}
                            onClick={async () => {
                              if (!window.confirm(`Excluir "${l.descricao}"? Esta ação não pode ser desfeita.`)) return
                              await supabase.from('fin_lancamentos').delete().eq('id', l.id)
                              load()
                            }}>✕</button>
                        </div>
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
                                        <div style={{display:'flex',gap:4}}>
                                          <button className="btn btn-ghost btn-xs" onClick={() => setModalParcela(p)}>
                                            Editar
                                          </button>
                                          <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}}
                                            onClick={async () => {
                                              if (!window.confirm('Excluir esta parcela?')) return
                                              await supabase.from('fin_parcelas').delete().eq('id', p.id)
                                              load()
                                            }}>✕</button>
                                        </div>
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
          tipo={tipo} categorias={categorias} canais={canais} contas={contas} formasPag={formasPag} fornecedores={fornecedores}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }}
        />
      )}
      {modalParcela && (
        <ModalParcela parcela={modalParcela} contas={contas}
          onClose={() => setModalParcela(null)} onSaved={() => { setModalParcela(null); load() }}
        />
      )}
      {modalXml && (
        <ModalConfirmarXML nf={modalXml} categorias={categorias} contas={contas} formasPag={formasPag}
          onClose={() => setModalXml(null)} onSaved={() => { setModalXml(null); load() }}
        />
      )}
    </>
  )
}
