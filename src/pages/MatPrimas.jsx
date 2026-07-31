import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Plus, RefreshCw, Save, Pencil, Upload } from 'lucide-react'

const CATEGORIAS = ['Lácteos','Chocolates','Proteínas','Farinhas','Adoçantes','Gorduras','Conservantes','Temperos','Frutas e Nuts','Outros']
const UNIDADES = ['g','ml','kg','l','un']

function fmt(n, dec=2) { return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec}) }
function fmtR(n) { return `R$ ${fmt(n,2)}` }

// ── Parsers XML (NF-e e NFS-e) ────────────────────────────────────────────────
function parseNFSe(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const get = (tag) => doc.querySelector(tag)?.textContent?.trim() || ''
  const getAlt = (...tags) => { for (const t of tags) { const v = get(t); if (v) return v } return '' }
  const fornecedor = getAlt('PrestadorServico RazaoSocial','Prestador RazaoSocial','RazaoSocial')
  const valor = parseFloat(getAlt('Servico Valores ValorLiquidoNfse','ValorServicos') || '0')
  const numero = getAlt('InfNfse Numero','Numero','nNFSe')
  const dataEmissao = (getAlt('InfNfse DataEmissao','DataEmissao') || '').slice(0,10)
  const descricao = getAlt('Servico Discriminacao','Discriminacao')
  return {
    numero, data_emissao: dataEmissao, valor_total: valor,
    tipo_nota: 'NFSe', fornecedor,
    itens: [{ descricao: descricao || `NFS-e ${numero}`, quantidade: 1, unidade: 'SV', valor_unitario: valor, valor_total: valor }],
  }
}

function parseNFe(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const get = (tag) => doc.querySelector(tag)?.textContent?.trim() || ''
  const getAll = (tag) => [...doc.querySelectorAll(tag)]
  const fornecedor = get('emit xNome') || get('emit xFant')
  const itens = getAll('det').map(det => ({
    descricao: det.querySelector('xProd')?.textContent?.trim() || '',
    ncm: det.querySelector('NCM')?.textContent?.trim() || '',
    quantidade: parseFloat(det.querySelector('qCom')?.textContent || '0'),
    unidade: det.querySelector('uCom')?.textContent?.trim() || 'UN',
    valor_unitario: parseFloat(det.querySelector('vUnCom')?.textContent || '0'),
    valor_total: parseFloat(det.querySelector('vProd')?.textContent || '0'),
  }))
  return {
    numero: get('nNF'),
    data_emissao: (get('dhEmi') || get('dEmi')).slice(0,10),
    valor_total: parseFloat(get('vNF') || '0'),
    tipo_nota: 'NFe', fornecedor, itens,
  }
}

// ── Modal importar XML ────────────────────────────────────────────────────────
function ModalImportarXML({ onClose, onSaved }) {
  const [nf, setNf] = useState(null)
  const [mps, setMps] = useState([])
  const [vinculos, setVinculos] = useState({}) // idx → { mp_id, quantidade, unidade }
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const fileRef = useRef()

  useEffect(() => {
    supabase.from('materias_primas').select('id,nome,unidade,categoria').eq('ativo',true).order('categoria').order('nome')
      .then(({ data }) => setMps(data||[]))
  }, [])

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target.result
      try {
        const isNFSe = text.includes('NFSe') || text.includes('CompNfse') || text.includes('nfse')
        const parsed = isNFSe ? parseNFSe(text) : parseNFe(text)
        if (!parsed.itens?.length) { setErro('XML não reconhecido ou sem itens.'); return }
        setNf(parsed)
        setErro('')
        // Pré-preenche vinculos com índice
        const v = {}
        parsed.itens.forEach((_,i) => { v[i] = { mp_id:'', quantidade: parsed.itens[i].quantidade, unidade: parsed.itens[i].unidade } })
        setVinculos(v)
      } catch { setErro('Erro ao processar XML. Verifique o arquivo.') }
    }
    reader.readAsText(file)
  }

  async function salvar() {
    setSaving(true)
    try {
      for (const [idx, v] of Object.entries(vinculos)) {
        if (!v.mp_id) continue
        const item = nf.itens[parseInt(idx)]
        const qtd = parseFloat(v.quantidade) || item.quantidade
        const custo = item.valor_total

        // Busca MP atual
        const { data: mp } = await supabase.from('materias_primas').select('estoque_atual,custo_unitario').eq('id',v.mp_id).single()
        const estoqueAnt = parseFloat(mp?.estoque_atual)||0
        const custoAnt = parseFloat(mp?.custo_unitario)||0
        const novoEstoque = estoqueAnt + qtd
        const novoCusto = novoEstoque > 0 ? (estoqueAnt*custoAnt + custo) / novoEstoque : custo/qtd

        await supabase.from('mp_compras').insert({
          materia_prima_id: v.mp_id,
          quantidade: qtd,
          custo_total: custo,
          data_compra: nf.data_emissao || new Date().toISOString().slice(0,10),
          fornecedor: nf.fornecedor || null,
          numero_nf: nf.numero || null,
          observacao: `${item.descricao} — importado via XML`,
        })
        await supabase.from('materias_primas').update({
          estoque_atual: novoEstoque,
          custo_unitario: novoCusto,
          atualizado_em: new Date().toISOString(),
        }).eq('id', v.mp_id)
      }
      onSaved()
    } catch(e) { setErro('Erro ao salvar: ' + e.message) }
    setSaving(false)
  }

  const itensVinculados = Object.values(vinculos).filter(v => v.mp_id).length

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:680, maxHeight:'92vh', overflowY:'auto'}}>
        <div className="modal-header">
          <div className="modal-title">📥 Importar XML de Compra</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Upload */}
          {!nf && (
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border:'2px dashed var(--gray-200)', borderRadius:10, padding:40, textAlign:'center', cursor:'pointer', background:'var(--gray-50)' }}
              onDragOver={e=>{e.preventDefault()}}
              onDrop={e=>{e.preventDefault(); handleFile(e.dataTransfer.files[0])}}
            >
              <div style={{fontSize:32,marginBottom:8}}>📄</div>
              <div style={{fontWeight:700,color:'var(--purple)'}}>Clique ou arraste o XML da NF-e / NFS-e</div>
              <div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>Arquivos .xml de nota fiscal eletrônica</div>
              <input ref={fileRef} type="file" accept=".xml" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])} />
            </div>
          )}

          {erro && <div className="alert-banner danger" style={{marginTop:8}}>{erro}</div>}

          {/* Preview e vínculo */}
          {nf && (
            <>
              {/* Cabeçalho da NF */}
              <div style={{padding:'10px 14px',background:'var(--purple-pale)',borderRadius:8,marginBottom:16,fontSize:13}}>
                <div style={{fontWeight:800,color:'var(--purple)'}}>{nf.tipo_nota} nº {nf.numero} — {nf.fornecedor}</div>
                <div style={{color:'var(--gray-500)',marginTop:2}}>
                  Data: {nf.data_emissao ? new Date(nf.data_emissao+'T12:00:00').toLocaleDateString('pt-BR') : '—'} · 
                  Total: <strong>{fmtR(nf.valor_total)}</strong> · 
                  {nf.itens.length} iten(s)
                </div>
              </div>

              <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>
                Vincule cada item da NF à matéria-prima correspondente:
              </div>

              {nf.itens.map((item, idx) => (
                <div key={idx} style={{
                  border:'1px solid var(--gray-200)', borderRadius:8, padding:'12px 14px', marginBottom:10,
                  background: vinculos[idx]?.mp_id ? '#f0faf0' : '#fff',
                }}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{item.descricao}</div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>
                        {fmt(item.quantidade,3)} {item.unidade} · {fmtR(item.valor_unitario)}/un · Total: {fmtR(item.valor_total)}
                      </div>
                    </div>
                    {vinculos[idx]?.mp_id && <span style={{color:'var(--ok)',fontSize:18}}>✓</span>}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 120px 80px',gap:8,alignItems:'center'}}>
                    <select className="form-input" value={vinculos[idx]?.mp_id||''} style={{fontSize:13}}
                      onChange={e => {
                        const mp = mps.find(m=>m.id===e.target.value)
                        setVinculos(p=>({...p,[idx]:{...p[idx], mp_id:e.target.value, unidade: mp?.unidade||item.unidade}}))
                      }}>
                      <option value="">— Ignorar este item —</option>
                      {['Lácteos','Chocolates','Proteínas','Farinhas','Adoçantes','Gorduras','Conservantes','Temperos','Frutas e Nuts','Outros'].map(cat => {
                        const grupo = mps.filter(m=>m.categoria===cat)
                        if (!grupo.length) return null
                        return <optgroup key={cat} label={cat}>{grupo.map(m=><option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}</optgroup>
                      })}
                    </select>
                    <input type="number" className="form-input" placeholder="Qtd" style={{fontSize:13}}
                      value={vinculos[idx]?.quantidade ?? item.quantidade}
                      onChange={e=>setVinculos(p=>({...p,[idx]:{...p[idx],quantidade:e.target.value}}))}
                    />
                    <div style={{fontSize:12,color:'var(--gray-500)',textAlign:'center'}}>
                      {vinculos[idx]?.unidade || item.unidade}
                    </div>
                  </div>
                </div>
              ))}

              {itensVinculados === 0 && (
                <div style={{fontSize:12,color:'var(--warning)',fontStyle:'italic'}}>
                  ⚠️ Nenhum item vinculado ainda — vincule pelo menos um para salvar.
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          {nf && !saving && (
            <button className="btn btn-ghost" onClick={()=>{setNf(null);setVinculos({})}}>
              ↩ Trocar arquivo
            </button>
          )}
          {nf && (
            <button className="btn btn-primary" onClick={salvar} disabled={saving||itensVinculados===0}>
              {saving ? <><RefreshCw size={14} className="spin"/> Salvando...</> : <><Save size={14}/> Salvar {itensVinculados} item(s)</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal cadastro/edição de MP ───────────────────────────────────────────────
function ModalMP({ mp, onClose, onSaved }) {
  const isNew = !mp?.id
  const [form, setForm] = useState({
    nome: mp?.nome || '',
    categoria: mp?.categoria || 'Outros',
    unidade: mp?.unidade || 'g',
    estoque_minimo: mp?.estoque_minimo || '',
    fornecedor: mp?.fornecedor || '',
    observacao: mp?.observacao || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p => ({...p,[k]:v}))

  async function salvar() {
    if (!form.nome.trim()) return
    setSaving(true)
    const payload = {
      nome: form.nome.trim(),
      categoria: form.categoria,
      unidade: form.unidade,
      estoque_minimo: parseFloat(form.estoque_minimo) || 0,
      fornecedor: form.fornecedor || null,
      observacao: form.observacao || null,
      atualizado_em: new Date().toISOString(),
    }
    if (isNew) {
      await supabase.from('materias_primas').insert(payload)
    } else {
      await supabase.from('materias_primas').update(payload).eq('id', mp.id)
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:480}}>
        <div className="modal-header">
          <div className="modal-title">{isNew ? '+ Nova Matéria-Prima' : `Editar — ${mp.nome}`}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input className="form-input" value={form.nome} onChange={e=>set('nome',e.target.value)} autoFocus />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Categoria</label>
              <select className="form-input" value={form.categoria} onChange={e=>set('categoria',e.target.value)}>
                {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Unidade</label>
              <select className="form-input" value={form.unidade} onChange={e=>set('unidade',e.target.value)}>
                {UNIDADES.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Estoque mínimo ({form.unidade})</label>
              <input type="number" className="form-input" value={form.estoque_minimo} onChange={e=>set('estoque_minimo',e.target.value)} min={0} />
            </div>
            <div className="form-group">
              <label className="form-label">Fornecedor principal</label>
              <input className="form-input" value={form.fornecedor} onChange={e=>set('fornecedor',e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={form.observacao} onChange={e=>set('observacao',e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!form.nome.trim()}>
            {saving ? <RefreshCw size={14} className="spin"/> : <Save size={14}/>} {isNew ? 'Criar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal compra ──────────────────────────────────────────────────────────────
function ModalCompra({ mp, onClose, onSaved }) {
  const [form, setForm] = useState({ quantidade:'', custo_total:'', data_compra: new Date().toISOString().slice(0,10), fornecedor: mp?.fornecedor||'', numero_nf:'', observacao:'' })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))
  const custoUnit = form.quantidade && form.custo_total ? (parseFloat(form.custo_total)/parseFloat(form.quantidade)) : 0

  async function salvar() {
    if (!form.quantidade || !form.custo_total) return
    setSaving(true)
    const qtd = parseFloat(form.quantidade)
    const custo = parseFloat(form.custo_total)
    // Atualiza estoque e custo unitário médio ponderado
    const { data: atual } = await supabase.from('materias_primas').select('estoque_atual,custo_unitario').eq('id',mp.id).single()
    const estoqueAnt = parseFloat(atual?.estoque_atual)||0
    const custoAnt = parseFloat(atual?.custo_unitario)||0
    const novoEstoque = estoqueAnt + qtd
    const novoCusto = novoEstoque > 0 ? (estoqueAnt*custoAnt + custo) / novoEstoque : custo/qtd

    await supabase.from('mp_compras').insert({
      materia_prima_id: mp.id,
      quantidade: qtd,
      custo_total: custo,
      data_compra: form.data_compra,
      fornecedor: form.fornecedor || null,
      numero_nf: form.numero_nf || null,
      observacao: form.observacao || null,
    })
    await supabase.from('materias_primas').update({
      estoque_atual: novoEstoque,
      custo_unitario: novoCusto,
      atualizado_em: new Date().toISOString(),
    }).eq('id', mp.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:460}}>
        <div className="modal-header">
          <div className="modal-title">💰 Registrar Compra — {mp.nome}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Quantidade ({mp.unidade}) *</label>
              <input type="number" className="form-input" value={form.quantidade} onChange={e=>set('quantidade',e.target.value)} min={0} step={0.001} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Custo total (R$) *</label>
              <input type="number" className="form-input" value={form.custo_total} onChange={e=>set('custo_total',e.target.value)} min={0} step={0.01} />
            </div>
          </div>
          {custoUnit > 0 && (
            <div style={{padding:'8px 12px', background:'var(--purple-pale)', borderRadius:6, fontSize:13, marginBottom:12, color:'var(--purple)', fontWeight:700}}>
              Custo unitário: {fmtR(custoUnit)} / {mp.unidade}
            </div>
          )}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Data da compra</label>
              <input type="date" className="form-input" value={form.data_compra} onChange={e=>set('data_compra',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">NF / Pedido</label>
              <input className="form-input" value={form.numero_nf} onChange={e=>set('numero_nf',e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Fornecedor</label>
            <input className="form-input" value={form.fornecedor} onChange={e=>set('fornecedor',e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!form.quantidade||!form.custo_total}>
            {saving ? <RefreshCw size={14} className="spin"/> : <Save size={14}/>} Registrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal inventário ──────────────────────────────────────────────────────────
function ModalInventario({ mp, onClose, onSaved }) {
  const [qtd, setQtd] = useState('')
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)

  async function salvar() {
    if (!qtd) return
    setSaving(true)
    const quantidade = parseFloat(qtd)
    await supabase.from('mp_inventarios').insert({
      materia_prima_id: mp.id,
      quantidade,
      responsavel: 'Usuário',
      observacao: obs || null,
    })
    await supabase.from('materias_primas').update({
      estoque_atual: quantidade,
      atualizado_em: new Date().toISOString(),
    }).eq('id', mp.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:400}}>
        <div className="modal-header">
          <div className="modal-title">📋 Inventário — {mp.nome}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{fontSize:13,color:'var(--gray-500)',marginBottom:12}}>
            Estoque atual no sistema: <strong>{fmt(mp.estoque_atual,3)} {mp.unidade}</strong>
          </div>
          <div className="form-group">
            <label className="form-label">Quantidade contada ({mp.unidade}) *</label>
            <input type="number" className="form-input" value={qtd} onChange={e=>setQtd(e.target.value)} min={0} step={0.001} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ex: contagem semanal" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||!qtd}>
            {saving ? <RefreshCw size={14} className="spin"/> : <Save size={14}/>} Salvar contagem
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard de situação ─────────────────────────────────────────────────────
function DashMP() {
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // {tipo:'compra'|'inventario'|'editar'|'xml', mp}
  const [filtro, setFiltro] = useState('')
  const [catFiltro, setCatFiltro] = useState('Todas')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('materias_primas').select('*').eq('ativo',true).order('categoria').order('nome')
    setLista(data||[])
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  function afterSave() { setModal(null); load() }

  const cats = ['Todas', ...new Set((lista||[]).map(m=>m.categoria))]
  const filtrada = lista.filter(m => {
    const matchCat = catFiltro==='Todas' || m.categoria===catFiltro
    const matchNome = !filtro || m.nome.toLowerCase().includes(filtro.toLowerCase())
    return matchCat && matchNome
  })

  const totalValor = lista.reduce((s,m) => s + (parseFloat(m.estoque_atual)||0)*(parseFloat(m.custo_unitario)||0), 0)
  const semEstoque = lista.filter(m => parseFloat(m.estoque_atual||0) <= parseFloat(m.estoque_minimo||0) && m.estoque_minimo > 0).length

  function statusMP(m) {
    const est = parseFloat(m.estoque_atual)||0
    const min = parseFloat(m.estoque_minimo)||0
    if (min === 0) return { cor:'var(--gray-300)', icon:'—' }
    if (est <= 0) return { cor:'var(--danger)', icon:'🚨' }
    if (est <= min) return { cor:'var(--warning)', icon:'⚠️' }
    return { cor:'var(--ok)', icon:'✅' }
  }

  return (
    <>
      {modal?.tipo==='editar'    && <ModalMP mp={modal.mp} onClose={()=>setModal(null)} onSaved={afterSave} />}
      {modal?.tipo==='compra'    && <ModalCompra mp={modal.mp} onClose={()=>setModal(null)} onSaved={afterSave} />}
      {modal?.tipo==='inventario'&& <ModalInventario mp={modal.mp} onClose={()=>setModal(null)} onSaved={afterSave} />}
      {modal?.tipo==='xml'       && <ModalImportarXML onClose={()=>setModal(null)} onSaved={afterSave} />}

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:12}}>
        {[
          {label:'Total em estoque',valor:fmtR(totalValor),sub:`${lista.length} insumos cadastrados`,cor:'var(--purple)'},
          {label:'Abaixo do mínimo',valor:semEstoque,sub:'insumos com estoque crítico',cor:semEstoque>0?'var(--danger)':'var(--ok)'},
          {label:'Insumos ativos',valor:lista.length,sub:'cadastrados no sistema',cor:'var(--gray-600)'},
        ].map(k=>(
          <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
            <div style={{fontSize:11,color:'var(--gray-400)'}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filtros + ações */}
      <div className="card">
        <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input className="form-input" placeholder="Filtrar por nome..." value={filtro} onChange={e=>setFiltro(e.target.value)} style={{width:200,fontSize:13}} />
          <select className="form-input" value={catFiltro} onChange={e=>setCatFiltro(e.target.value)} style={{width:160,fontSize:13}}>
            {cats.map(c=><option key={c}>{c}</option>)}
          </select>
          <div style={{flex:1}}/>
          <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
          <button className="btn btn-ghost btn-sm" onClick={()=>setModal({tipo:'xml'})}>
            <Upload size={13}/> Importar XML
          </button>
          <button className="btn btn-primary btn-sm" onClick={()=>setModal({tipo:'editar',mp:null})}>
            <Plus size={13}/> Nova MP
          </button>
        </div>

        {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)'}}>
                <th style={{padding:'9px 14px',textAlign:'left'}}>Insumo</th>
                <th style={{padding:'9px 10px',textAlign:'left'}}>Categoria</th>
                <th style={{padding:'9px 10px',textAlign:'right'}}>Estoque atual</th>
                <th style={{padding:'9px 10px',textAlign:'right'}}>Preço médio</th>
                <th style={{padding:'9px 10px',textAlign:'right'}}>Valor em estoque</th>
                <th style={{padding:'9px 10px',textAlign:'center'}}>Status</th>
                <th style={{padding:'9px 10px',textAlign:'center'}}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.length===0 && (
                <tr><td colSpan={7} style={{padding:32,textAlign:'center',color:'var(--gray-300)'}}>
                  {lista.length===0 ? 'Nenhum insumo cadastrado ainda' : 'Nenhum resultado para o filtro'}
                </td></tr>
              )}
              {filtrada.map((m,i)=>{
                const est = parseFloat(m.estoque_atual)||0
                const custo = parseFloat(m.custo_unitario)||0
                const valor = est*custo
                const {cor,icon} = statusMP(m)
                return (
                  <tr key={m.id} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                    <td style={{padding:'9px 14px'}}>
                      <div style={{fontWeight:700}}>{m.nome}</div>
                      {m.fornecedor && <div style={{fontSize:11,color:'var(--gray-400)'}}>{m.fornecedor}</div>}
                    </td>
                    <td style={{padding:'9px 10px',fontSize:12,color:'var(--gray-500)'}}>{m.categoria}</td>
                    <td style={{padding:'9px 10px',textAlign:'right',fontWeight:700,color: est<=0?'var(--danger)':'var(--gray-700)'}}>
                      {fmt(est,1)} <span style={{fontSize:11,color:'var(--gray-400)'}}>{m.unidade}</span>
                    </td>
                    <td style={{padding:'9px 10px',textAlign:'right',color:'var(--gray-600)'}}>
                      {custo>0 ? `${fmtR(custo)}/${m.unidade}` : '—'}
                    </td>
                    <td style={{padding:'9px 10px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>
                      {valor>0 ? fmtR(valor) : '—'}
                    </td>
                    <td style={{padding:'9px 10px',textAlign:'center',fontSize:16}}>{icon}</td>
                    <td style={{padding:'9px 10px',textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-sm" title="Registrar compra" onClick={()=>setModal({tipo:'compra',mp:m})}>💰</button>
                        <button className="btn btn-ghost btn-sm" title="Fazer inventário" onClick={()=>setModal({tipo:'inventario',mp:m})}>📋</button>
                        <button className="btn btn-ghost btn-sm" title="Editar" onClick={()=>setModal({tipo:'editar',mp:m})}><Pencil size={12}/></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filtrada.length>0 && (
              <tfoot>
                <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--gray-50)'}}>
                  <td colSpan={4} style={{padding:'9px 14px',fontWeight:800}}>Total em estoque</td>
                  <td style={{padding:'9px 10px',textAlign:'right',fontWeight:800,color:'var(--purple)'}}>{fmtR(totalValor)}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </>
  )
}

// ── Histórico de compras ──────────────────────────────────────────────────────
function HistoricoCompras() {
  const [compras, setCompras] = useState([])
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(new Date().toISOString().slice(0,7))
  const [xmlModal, setXmlModal] = useState(false)

  async function load() {
    setLoading(true)
    const ini = mes+'-01'
    const fim = new Date(mes.slice(0,4), mes.slice(5,7), 0).toISOString().slice(0,10)
    const { data } = await supabase.from('mp_compras')
      .select('*, materias_primas(nome,unidade,categoria)')
      .gte('data_compra',ini).lte('data_compra',fim)
      .order('data_compra',{ascending:false})
    setCompras(data||[])
    setLoading(false)
  }
  useEffect(()=>{ load() },[mes])

  const totalMes = compras.reduce((s,c)=>s+(parseFloat(c.custo_total)||0),0)

  return (
    <div className="card">
      {xmlModal && <ModalImportarXML onClose={()=>setXmlModal(false)} onSaved={()=>{setXmlModal(false);load()}} />}
      <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center'}}>
        <div style={{fontWeight:800,fontSize:15}}>📦 Histórico de Compras</div>
        <div style={{flex:1}}/>
        <input type="month" className="form-input" value={mes} onChange={e=>setMes(e.target.value)} style={{width:160,fontSize:13}} />
        <button className="btn btn-ghost btn-sm" onClick={()=>setXmlModal(true)}><Upload size={13}/> Importar XML</button>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
      </div>
      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <>
          {compras.length===0 ? (
            <div style={{padding:32,textAlign:'center',color:'var(--gray-300)'}}>Nenhuma compra registrada neste mês</div>
          ) : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)'}}>
                  <th style={{padding:'9px 14px',textAlign:'left'}}>Data</th>
                  <th style={{padding:'9px 10px',textAlign:'left'}}>Insumo</th>
                  <th style={{padding:'9px 10px',textAlign:'left'}}>Fornecedor</th>
                  <th style={{padding:'9px 10px',textAlign:'right'}}>Quantidade</th>
                  <th style={{padding:'9px 10px',textAlign:'right'}}>Custo unit.</th>
                  <th style={{padding:'9px 10px',textAlign:'right'}}>Total</th>
                  <th style={{padding:'9px 10px',textAlign:'left'}}>NF</th>
                </tr>
              </thead>
              <tbody>
                {compras.map((c,i)=>(
                  <tr key={c.id} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                    <td style={{padding:'9px 14px',color:'var(--gray-500)',fontSize:12}}>
                      {new Date(c.data_compra+'T12:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td style={{padding:'9px 10px',fontWeight:600}}>
                      {c.materias_primas?.nome}
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>{c.materias_primas?.categoria}</div>
                    </td>
                    <td style={{padding:'9px 10px',color:'var(--gray-500)',fontSize:12}}>{c.fornecedor||'—'}</td>
                    <td style={{padding:'9px 10px',textAlign:'right'}}>{fmt(c.quantidade,1)} {c.materias_primas?.unidade}</td>
                    <td style={{padding:'9px 10px',textAlign:'right',color:'var(--gray-600)',fontSize:12}}>{fmtR(c.custo_unitario)}/{c.materias_primas?.unidade}</td>
                    <td style={{padding:'9px 10px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>{fmtR(c.custo_total)}</td>
                    <td style={{padding:'9px 10px',fontSize:12,color:'var(--gray-400)'}}>{c.numero_nf||'—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--gray-50)'}}>
                  <td colSpan={5} style={{padding:'9px 14px',fontWeight:800}}>Total do mês</td>
                  <td style={{padding:'9px 10px',textAlign:'right',fontWeight:800,color:'var(--purple)'}}>{fmtR(totalMes)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          )}
        </>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function MatPrimas() {
  const [sub, setSub] = useState('situacao')
  return (
    <>
      <div className="tabs" style={{marginBottom:0}}>
        <button className={`tab${sub==='situacao'?' active':''}`} onClick={()=>setSub('situacao')}>📊 Situação</button>
        <button className={`tab${sub==='historico'?' active':''}`} onClick={()=>setSub('historico')}>📦 Compras</button>
      </div>
      {sub==='situacao'  && <DashMP />}
      {sub==='historico' && <HistoricoCompras />}
    </>
  )
}
