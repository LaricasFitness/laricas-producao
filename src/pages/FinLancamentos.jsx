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
    data_emissao: (get('dhEmi') || get('dEmi')).slice(0, 10),
    valor_total: parseFloat(get('vNF') || '0'),
    fornecedor,
    itens,
    // Duplicatas (parcelas de pagamento na NF)
    duplicatas: getAll('dup').map(dup => ({
      numero: dup.querySelector('nDup')?.textContent?.trim() || '',
      vencimento: (dup.querySelector('dVenc')?.textContent?.trim() || '').slice(0,10),
      valor: parseFloat(dup.querySelector('vDup')?.textContent || '0'),
    })).filter(d => d.vencimento && d.valor > 0),
  }
  return nf
}

// ── Modal criar fornecedor inline ─────────────────────────────────────────────
function ModalNovoFornecedor({ onClose, onSaved }) {
  const [f, setF] = useState({ razao_social:'', nome_fantasia:'', cnpj:'', cidade:'', uf:'SP' })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  async function salvar() {
    if (!f.razao_social.trim()) return
    setSaving(true)
    const { data } = await supabase.from('fin_fornecedores')
      .insert({ ...f, ativo: true })
      .select().single()
    onSaved(data)
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:400}}>
        <div className="modal-header">
          <div className="modal-title">Novo fornecedor</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Razão Social *</label>
            <input className="form-input" value={f.razao_social} onChange={e=>set('razao_social',e.target.value)}
              autoFocus placeholder="Ex: Distribuidora ABC Ltda" />
          </div>
          <div className="form-group">
            <label className="form-label">Nome Fantasia</label>
            <input className="form-input" value={f.nome_fantasia} onChange={e=>set('nome_fantasia',e.target.value)}
              placeholder="Opcional" />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">CNPJ</label>
              <input className="form-input" value={f.cnpj} onChange={e=>set('cnpj',e.target.value)}
                placeholder="00.000.000/0000-00" />
            </div>
            <div className="form-group">
              <label className="form-label">Cidade/UF</label>
              <div style={{ display:'flex', gap:6 }}>
                <input className="form-input" value={f.cidade} onChange={e=>set('cidade',e.target.value)}
                  placeholder="Cidade" style={{ flex:1 }} />
                <input className="form-input" value={f.uf} onChange={e=>set('uf',e.target.value.toUpperCase())}
                  placeholder="UF" maxLength={2} style={{ width:56 }} />
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!f.razao_social.trim()}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Plus size={14}/> Criar</>}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [lancarContas, setLancarContas] = useState(true)
  const [catUnica, setCatUnica] = useState(true)
  const [categoria_id, setCategoria] = useState('')
  const [itensCategoria, setItensCategoria] = useState({})
  const [conta_id, setConta] = useState(contas[0]?.id || '')
  const [forma_id, setForma] = useState('')
  const [competencia, setCompetencia] = useState(nf.data_emissao)
  const [salvarInsumos, setSalvarInsumos] = useState(true)
  const [saving, setSaving] = useState(false)

  // Duplicatas da NF (parcelas de pagamento)
  // Se a NF tem duplicatas usa-as; senão cria uma parcela única com a data de emissão
  const [duplicatas, setDuplicatas] = useState(() => {
    if (nf.duplicatas?.length > 0) return nf.duplicatas.map(d => ({ ...d }))
    return [{ numero:'1', vencimento: nf.data_emissao, valor: nf.valor_total }]
  })

  const catsDespesa = (() => {
    const todas = categorias.filter(c => c.tipo === 'despesa')
    const result = []
    function addNivel(parentId, indent) {
      todas.filter(c=>(c.parent_id||null)===(parentId||null))
        .sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))
        .forEach(c=>{ result.push({...c,_indent:indent}); addNivel(c.id,indent+1) })
    }
    addNivel(null, 0)
    return result
  })()

  function setDupField(idx, campo, valor) {
    setDuplicatas(prev => prev.map((d,i) => i===idx ? {...d,[campo]:valor} : d))
  }

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

      let lancId = null

      if (lancarContas) {
        // 2. Cria lançamento
        const { data: lanc, error: lancErr } = await supabase.from('fin_lancamentos').insert({
          tipo: 'despesa',
          descricao: `NF ${nf.numero} — ${nf.fornecedor.razao_social || nf.fornecedor.nome_fantasia}`,
          valor_total: nf.valor_total,
          categoria_id: catUnica ? (categoria_id || null) : null,
          conta_id: conta_id || null,
          forma_pagamento_id: forma_id || null,
          fornecedor_id: fornecedorId,
          nf_chave: nf.chave,
          nf_numero: nf.numero,
          total_parcelas: duplicatas.length,
          criado_por: JSON.parse(sessionStorage.getItem('usuario')||'{}').nome,
        }).select().single()
        if (lancErr) throw new Error('Erro ao criar lançamento: ' + lancErr.message)
        lancId = lanc.id

        // 3. Parcelas — uma por duplicata
        const { error: parcErr } = await supabase.from('fin_parcelas').insert(
          duplicatas.map((d, i) => ({
            lancamento_id: lancId,
            numero_parcela: i + 1,
            valor: parseFloat(d.valor) || 0,
            data_vencimento: d.vencimento,
            data_competencia: competencia || nf.data_emissao,
            status: 'em_aberto',
            conta_id: conta_id || null,
          }))
        )
        if (parcErr) throw new Error('Erro ao criar parcelas: ' + parcErr.message)
      }

      // 4. Itens da NF
      if (nf.itens.length && lancId) {
        const itensInsert = nf.itens.map((item, idx) => {
          const catItem = catUnica ? null : (itensCategoria[idx] || null)
          return {
            lancamento_id: lancId,
            descricao: item.descricao,
            ncm: item.ncm || null,
            quantidade: item.quantidade,
            unidade: item.unidade,
            valor_unitario: item.valor_unitario,
            valor_total: item.valor_total,
          }
        })
        if (itensInsert.length > 0) {
          await supabase.from('fin_nf_itens').insert(itensInsert)
        }
      }

      // 5. Salvar insumos (independente de lançar)
      if (salvarInsumos && nf.itens.length) {
        for (const item of nf.itens) {
          await supabase.from('fin_insumos').upsert({
            descricao: item.descricao,
            ncm: item.ncm || null,
            unidade: item.unidade || 'UN',
            preco_medio: item.valor_unitario || 0,
            fornecedor_id: fornecedorId,
          }, { onConflict: 'descricao' })
        }
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

          {/* Toggle modo categoria */}
          <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',marginBottom:12,padding:'10px 12px',background:'var(--gray-50)',borderRadius:8}}>
            <div style={{width:40,height:22,borderRadius:11,background:catUnica?'var(--purple)':'var(--gray-300)',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}
              onClick={()=>setCatUnica(p=>!p)}>
              <div style={{width:18,height:18,borderRadius:'50%',background:'#fff',position:'absolute',top:2,left:catUnica?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/>
            </div>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>{catUnica ? '📂 Categoria única para a NF toda' : '📂 Categoria por produto'}</div>
              <div style={{fontSize:11,color:'var(--gray-400)'}}>
                {catUnica ? 'Uma categoria classifica o lançamento inteiro' : 'Cada produto recebe sua própria categoria'}
              </div>
            </div>
          </label>

          {/* Tabela de itens */}
          <div style={{maxHeight:200,overflowY:'auto',marginBottom:14,border:'1px solid var(--gray-200)',borderRadius:8}}>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{textAlign:'left',padding:'6px 10px',background:'var(--gray-50)'}}>Produto</th>
                <th style={{textAlign:'right',padding:'6px 10px',background:'var(--gray-50)'}}>Qtd</th>
                <th style={{textAlign:'right',padding:'6px 10px',background:'var(--gray-50)'}}>Total</th>
                {!catUnica && <th style={{padding:'6px 10px',background:'var(--gray-50)',minWidth:140}}>Categoria</th>}
              </tr></thead>
              <tbody>{nf.itens.map((it,i)=>(
                <tr key={i} style={{borderTop:'1px solid var(--gray-100)'}}>
                  <td style={{padding:'5px 10px'}}>{it.descricao}</td>
                  <td style={{textAlign:'right',padding:'5px 10px'}}>{it.quantidade} {it.unidade}</td>
                  <td style={{textAlign:'right',padding:'5px 10px',fontWeight:600}}>{fmtR(it.valor_total)}</td>
                  {!catUnica && (
                    <td style={{padding:'3px 6px'}}>
                      <select className="form-input" style={{padding:'3px 6px',fontSize:11}}
                        value={itensCategoria[i]||''}
                        onChange={e=>setItensCategoria(prev=>({...prev,[i]:e.target.value}))}>
                        <option value="">Selecione...</option>
                        {catsDespesa.map(c=>(
                      <option key={c.id} value={c.id}>
                        {'　'.repeat(c._indent||0)}{(c._indent||0)>0?'└ ':''}{c.nome}
                      </option>
                    ))}
                      </select>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>

          {/* Toggle: lançar em contas a pagar? */}
          <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'10px 12px',background:lancarContas?'var(--purple-pale)':'var(--gray-50)',borderRadius:8,marginBottom:4}}>
            <div style={{width:40,height:22,borderRadius:11,background:lancarContas?'var(--purple)':'var(--gray-300)',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}
              onClick={()=>setLancarContas(p=>!p)}>
              <div style={{width:18,height:18,borderRadius:'50%',background:'#fff',position:'absolute',top:2,left:lancarContas?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/>
            </div>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:lancarContas?'var(--purple)':'var(--gray-500)'}}>
                {lancarContas ? '📋 Lançar no Contas a Pagar' : '📋 Não lançar — apenas salvar insumos'}
              </div>
              <div style={{fontSize:11,color:'var(--gray-400)'}}>
                {lancarContas ? 'Cria os lançamentos e parcelas de pagamento' : 'Só atualiza o cadastro de insumos e fornecedor'}
              </div>
            </div>
          </label>

          {lancarContas && (
            <>
              {/* Categoria */}
              {catUnica && (
                <div className="form-group">
                  <label className="form-label">Categoria da NF</label>
                  <select className="form-input" value={categoria_id} onChange={e=>setCategoria(e.target.value)}>
                    <option value="">Selecione...</option>
                    {catsDespesa.map(c=>(
                      <option key={c.id} value={c.id}>
                        {'　'.repeat(c._indent||0)}{(c._indent||0)>0?'└ ':''}{c.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Competência */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Data de competência</label>
                  <input type="date" className="form-input" value={competencia} onChange={e=>setCompetencia(e.target.value)}/>
                  <span className="form-hint">Puxado da data de emissão da NF</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Forma de pagamento</label>
                  <select className="form-input" value={forma_id} onChange={e=>setForma(e.target.value)}>
                    <option value="">Selecione...</option>
                    {formasPag.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </div>
              </div>

              {/* Conta */}
              <div className="form-group">
                <label className="form-label">Conta</label>
                <select className="form-input" value={conta_id} onChange={e=>setConta(e.target.value)}>
                  {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              {/* Duplicatas / Vencimentos */}
              <div className="form-group">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <label className="form-label" style={{marginBottom:0}}>
                    Vencimentos {nf.duplicatas?.length > 0 ? <span className="pill ok" style={{fontSize:10,marginLeft:4}}>Puxado da NF</span> : <span className="pill neutral" style={{fontSize:10,marginLeft:4}}>Manual</span>}
                  </label>
                  <button className="btn btn-ghost btn-xs" onClick={()=>setDuplicatas(prev=>[...prev,{numero:String(prev.length+1),vencimento:nf.data_emissao,valor:0}])}>
                    + Parcela
                  </button>
                </div>
                <div style={{border:'1px solid var(--gray-200)',borderRadius:8,overflow:'hidden'}}>
                  <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                    <thead><tr>
                      <th style={{padding:'6px 10px',background:'var(--gray-50)',textAlign:'center',width:50}}>Parc.</th>
                      <th style={{padding:'6px 10px',background:'var(--gray-50)'}}>Vencimento</th>
                      <th style={{padding:'6px 10px',background:'var(--gray-50)',textAlign:'right'}}>Valor</th>
                      <th style={{width:30,padding:'6px 10px',background:'var(--gray-50)'}}></th>
                    </tr></thead>
                    <tbody>
                      {duplicatas.map((d,i)=>(
                        <tr key={i} style={{borderTop:'1px solid var(--gray-100)'}}>
                          <td style={{padding:'4px 10px',textAlign:'center',color:'var(--gray-500)'}}>{i+1}</td>
                          <td style={{padding:'4px 8px'}}>
                            <input type="date" className="form-input" style={{padding:'3px 6px',fontSize:12}}
                              value={d.vencimento} onChange={e=>setDupField(i,'vencimento',e.target.value)}/>
                          </td>
                          <td style={{padding:'4px 8px'}}>
                            <input type="number" className="form-input" style={{padding:'3px 6px',fontSize:12,textAlign:'right'}}
                              value={d.valor} onChange={e=>setDupField(i,'valor',parseFloat(e.target.value)||0)}/>
                          </td>
                          <td style={{padding:'4px 6px',textAlign:'center'}}>
                            {duplicatas.length > 1 && (
                              <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--danger)',fontSize:13,lineHeight:1}}
                                onClick={()=>setDuplicatas(prev=>prev.filter((_,j)=>j!==i))}>✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {duplicatas.length > 1 && (
                    <div style={{padding:'6px 10px',background:'var(--gray-50)',borderTop:'1px solid var(--gray-200)',fontSize:11,textAlign:'right',fontWeight:700}}>
                      Total: {fmtR(duplicatas.reduce((s,d)=>s+d.valor,0))}
                      {Math.abs(duplicatas.reduce((s,d)=>s+d.valor,0) - nf.valor_total) > 0.02 && (
                        <span style={{color:'var(--danger)',marginLeft:8}}>⚠️ Difere do total da NF ({fmtR(nf.valor_total)})</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',fontWeight:600}}>
            <input type="checkbox" checked={salvarInsumos} onChange={e=>setSalvarInsumos(e.target.checked)}
              style={{width:16,height:16,accentColor:'var(--purple)'}}/>
            📦 Salvar itens no cadastro de insumos (para controle de estoque futuro)
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={confirmar} disabled={saving}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Save size={14}/> {lancarContas?'Lançar no Contas a Pagar':'Salvar insumos'}</>}
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
  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false)
  const [fornecedoresLocais, setFornecedoresLocais] = useState(fornecedores)

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

  // Monta categorias em ordem hierárquica com indentação
  const catsFiltradas = (() => {
    const todas = catsLocais.filter(c => c.tipo === tipo)
    const result = []
    function addNivel(parentId, indent) {
      todas.filter(c => (c.parent_id||null) === (parentId||null))
        .sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))
        .forEach(c => {
          result.push({ ...c, _indent: indent })
          addNivel(c.id, indent + 1)
        })
    }
    addNivel(null, 0)
    return result
  })()

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
                {catsFiltradas.map(c=>(
                  <option key={c.id} value={c.id}>
                    {'　'.repeat(c._indent)}{c._indent>0?'└ ':''}{c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Canal / origem</label>
              <select className="form-input" value={f.canal_id} onChange={e=>set('canal_id',e.target.value)}>
                <option value="">Sem canal</option>
                {(() => {
                  // Monta hierarquia: só mostra canais finais com contexto pai
                  const opts = []
                  const porId = Object.fromEntries(canais.map(c=>[c.id,c]))
                  function getNomePath(c) {
                    const parts = [c.nome]
                    let cur = c
                    while (cur.parent_id && porId[cur.parent_id]) {
                      cur = porId[cur.parent_id]
                      parts.unshift(cur.nome)
                    }
                    return parts
                  }
                  const finais = canais.filter(c=>c.tipo==='canal_final'||c.nivel===3)
                  // Agrupa por pai nível 1
                  const agrupadores = canais.filter(c=>c.nivel===1).sort((a,b)=>a.ordem-b.ordem)
                  for (const ag of agrupadores) {
                    const filhosFinais = finais.filter(c=>{
                      const path = getNomePath(c)
                      return path[0]===ag.nome
                    })
                    if (filhosFinais.length===0) {
                      // canais finais diretos do agrupador
                      const diretos = finais.filter(c=>c.parent_id===ag.id)
                      if (diretos.length>0) {
                        opts.push(<optgroup key={ag.id} label={ag.nome}>
                          {diretos.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                        </optgroup>)
                      }
                    } else {
                      opts.push(<optgroup key={ag.id} label={ag.nome}>
                        {filhosFinais.sort((a,b)=>a.nome.localeCompare(b.nome)).map(c=><option key={c.id} value={c.id}>{getNomePath(c).slice(1).join(' › ')}</option>)}
                      </optgroup>)
                    }
                  }
                  return opts
                })()}
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
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                <label className="form-label" style={{ marginBottom:0 }}>Fornecedor (opcional)</label>
                <button className="btn btn-ghost btn-xs" onClick={()=>setShowNovoFornecedor(true)}>
                  <Plus size={11}/> Novo
                </button>
              </div>
              <select className="form-input" value={f.fornecedor_id} onChange={e=>set('fornecedor_id',e.target.value)}>
                <option value="">Sem fornecedor</option>
                {fornecedoresLocais.map(forn=><option key={forn.id} value={forn.id}>{forn.nome_fantasia||forn.razao_social}</option>)}
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
      {showNovoFornecedor && (
        <ModalNovoFornecedor onClose={()=>setShowNovoFornecedor(false)}
          onSaved={novo=>{setFornecedoresLocais(prev=>[...prev,novo]);set('fornecedor_id',novo.id);setShowNovoFornecedor(false)}}/>
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

// ── Modal de Transferência entre contas ──────────────────────────────────────
function ModalTransferencia({ contas, onClose, onSaved }) {
  const [f, setF] = useState({
    conta_origem: contas[0]?.id || '',
    conta_destino: contas[1]?.id || contas[0]?.id || '',
    valor: '',
    data: new Date().toISOString().slice(0,10),
    descricao: 'Transferência entre contas',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k,v) => setF(p=>({...p,[k]:v}))

  async function salvar() {
    if (!f.valor || parseFloat(f.valor) <= 0) { setErr('Informe o valor.'); return }
    if (f.conta_origem === f.conta_destino) { setErr('Origem e destino devem ser diferentes.'); return }
    setSaving(true); setErr('')
    try {
      const usuario = JSON.parse(sessionStorage.getItem('usuario')||'{}').nome
      const valor = parseFloat(f.valor)

      // Cria saída na conta de origem
      const { data: saida } = await supabase.from('fin_lancamentos').insert({
        tipo: 'despesa',
        descricao: f.descricao,
        valor_total: valor,
        conta_id: f.conta_origem,
        total_parcelas: 1,
        observacao: `Transferência → ${contas.find(c=>c.id===f.conta_destino)?.nome}`,
        criado_por: usuario,
      }).select().single()

      await supabase.from('fin_parcelas').insert({
        lancamento_id: saida.id, numero_parcela: 1, valor,
        data_vencimento: f.data, data_pagamento: f.data,
        conta_id: f.conta_origem, status: 'pago',
      })

      // Cria entrada na conta de destino
      const { data: entrada } = await supabase.from('fin_lancamentos').insert({
        tipo: 'receita',
        descricao: f.descricao,
        valor_total: valor,
        conta_id: f.conta_destino,
        total_parcelas: 1,
        observacao: `Transferência ← ${contas.find(c=>c.id===f.conta_origem)?.nome}`,
        criado_por: usuario,
      }).select().single()

      await supabase.from('fin_parcelas').insert({
        lancamento_id: entrada.id, numero_parcela: 1, valor,
        data_vencimento: f.data, data_pagamento: f.data,
        conta_id: f.conta_destino, status: 'pago',
      })

      onSaved()
    } catch(e) { setErr(e.message) }
    setSaving(false)
  }

  const contasOrdem = contas.filter(c=>c.ativo!==false)

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:400}}>
        <div className="modal-header">
          <div className="modal-title">↔️ Transferência entre contas</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div style={{color:'var(--danger)',fontSize:13,padding:'8px 12px',background:'var(--danger-pale)',borderRadius:6,marginBottom:10}}>{err}</div>}

          <div className="form-group">
            <label className="form-label">Conta de origem (saída)</label>
            <select className="form-input" value={f.conta_origem} onChange={e=>set('conta_origem',e.target.value)}>
              {contasOrdem.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          <div style={{textAlign:'center',fontSize:20,margin:'4px 0',color:'var(--purple)'}}>↓</div>

          <div className="form-group">
            <label className="form-label">Conta de destino (entrada)</label>
            <select className="form-input" value={f.conta_destino} onChange={e=>set('conta_destino',e.target.value)}>
              {contasOrdem.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Valor (R$) *</label>
              <input className="form-input" type="number" min={0} step={0.01}
                value={f.valor} onChange={e=>set('valor',e.target.value)} placeholder="0,00" autoFocus/>
            </div>
            <div className="form-group">
              <label className="form-label">Data</label>
              <input type="date" className="form-input" value={f.data} onChange={e=>set('data',e.target.value)}/>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Descrição</label>
            <input className="form-input" value={f.descricao} onChange={e=>set('descricao',e.target.value)}/>
          </div>

          <div style={{fontSize:11,color:'var(--gray-400)',padding:'8px 12px',background:'var(--gray-50)',borderRadius:6}}>
            Cria automaticamente uma saída na conta de origem e uma entrada na conta de destino, ambas marcadas como pagas.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!f.valor}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Save size={14}/> Transferir</>}
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
  const [modalTransf, setModalTransf] = useState(false)
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
            <button className="btn btn-ghost" onClick={()=>setModalTransf(true)} title="Transferência entre contas">
              ↔️ Transferência
            </button>
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

      {modalTransf && (
        <ModalTransferencia contas={contas}
          onClose={() => setModalTransf(false)}
          onSaved={() => { setModalTransf(false); load() }}
        />
      )}
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
