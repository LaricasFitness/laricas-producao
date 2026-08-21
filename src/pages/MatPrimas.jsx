import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Plus, RefreshCw, Save, Pencil, Upload, FileText } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const CATEGORIAS = ['Lácteos','Chocolates','Proteínas','Farinhas','Adoçantes','Gorduras','Conservantes','Temperos','Frutas e Nuts','Outros']
const UNIDADES = ['g','ml','kg','l','un']

function fmt(n, dec=2) { return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec}) }
function fmtR(n) { return `R$ ${fmt(n,2)}` }

function gerarPDFSituacao(lista, filtrada, totalValor) {
  const doc = new jsPDF()
  const agora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo' })

  // Header
  doc.setFillColor(82,46,100)
  doc.rect(0,0,210,18,'F')
  doc.setTextColor(234,183,130); doc.setFontSize(13); doc.setFont(undefined,'bold')
  doc.text('Laricas Fitness — Situação de Insumos / Matérias-Primas', 14, 11)
  doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(255,255,255)
  doc.text(`Gerado: ${agora}`, 130, 16)

  doc.setTextColor(82,46,100); doc.setFontSize(10); doc.setFont(undefined,'bold')
  doc.text(`Total em estoque: ${fmtR(totalValor)} · ${filtrada.length} insumos`, 14, 26)

  const body = filtrada.map(m => {
    const est = parseFloat(m.estoque_atual)||0
    const custo = parseFloat(m.custo_unitario)||0
    const valor = est*custo
    const min = parseFloat(m.estoque_minimo)||0
    const status = min===0?'—':est<=0?'🚨 Zerado':est<=min?'⚠️ Baixo':'✅ OK'
    return [
      m.nome,
      m.categoria,
      `${fmt(est,1)} ${m.unidade}`,
      custo>0?`${fmtR(custo)}/${m.unidade}`:'—',
      valor>0?fmtR(valor):'—',
      status,
    ]
  })

  autoTable(doc, {
    startY: 32,
    head: [['Insumo','Categoria','Estoque atual','Preço médio','Valor em estoque','Status']],
    body,
    styles: { fontSize:8, cellPadding:3 },
    headStyles: { fillColor:[103,63,124], textColor:255, fontStyle:'bold' },
    alternateRowStyles: { fillColor:[248,245,252] },
    columnStyles: {
      0: { cellWidth:'auto' },
      1: { cellWidth:28 },
      2: { cellWidth:28, halign:'right' },
      3: { cellWidth:32, halign:'right' },
      4: { cellWidth:32, halign:'right' },
      5: { cellWidth:22, halign:'center' },
    },
    margin: { left:14, right:14 },
  })

  const pageCount = doc.getNumberOfPages()
  for (let i=1;i<=pageCount;i++) {
    doc.setPage(i)
    doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(150,150,150)
    doc.text('Laricas Fitness — Insumos', 14, 289)
    doc.text(`Pág ${i}/${pageCount}`, 185, 289)
  }
  doc.save(`Insumos_Situacao_${new Date().toISOString().slice(0,10)}.pdf`)
}

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

    // Insere compra
    await supabase.from('mp_compras').insert({
      materia_prima_id: mp.id,
      quantidade: qtd,
      custo_total: custo,
      data_compra: form.data_compra,
      fornecedor: form.fornecedor || null,
      numero_nf: form.numero_nf || null,
      observacao: form.observacao || null,
    })

    // Recalcula preço médio dos últimos 30 dias (incluindo a compra recém inserida)
    const desde30 = new Date(); desde30.setDate(desde30.getDate() - 30)
    const { data: compras30 } = await supabase
      .from('mp_compras')
      .select('quantidade, custo_total')
      .eq('materia_prima_id', mp.id)
      .gte('data_compra', desde30.toISOString().slice(0,10))
    const totalQtd30 = (compras30||[]).reduce((s,c) => s + parseFloat(c.quantidade||0), 0)
    const totalCusto30 = (compras30||[]).reduce((s,c) => s + parseFloat(c.custo_total||0), 0)
    const novoCusto = totalQtd30 > 0 ? totalCusto30 / totalQtd30 : custo / qtd

    // Atualiza estoque
    const { data: atual } = await supabase.from('materias_primas').select('estoque_atual').eq('id', mp.id).single()
    const estoqueAnt = parseFloat(atual?.estoque_atual)||0
    const novoEstoque = estoqueAnt + qtd

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
          <button className="btn btn-ghost btn-sm" onClick={()=>gerarPDFSituacao(lista, filtrada, totalValor)}>
            <FileText size={13}/> PDF
          </button>
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

// ── Modal compra avulsa (sem XML) ─────────────────────────────────────────────
function ModalCompraAvulsa({ mps, onClose, onSaved }) {
  const [itens, setItens] = useState([{ mp_id:'', quantidade:'', custo_total:'' }])
  const [form, setForm] = useState({
    data_compra: new Date().toISOString().slice(0,10),
    fornecedor: '',
    numero_nf: '',
    observacao: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))
  const setItem = (idx,k,v) => setItens(p=>p.map((it,i)=>i===idx?{...it,[k]:v}:it))
  const addItem = () => setItens(p=>[...p,{mp_id:'',quantidade:'',custo_total:''}])
  const remItem = (idx) => setItens(p=>p.filter((_,i)=>i!==idx))

  const totalGeral = itens.reduce((s,it)=>s+(parseFloat(it.custo_total)||0),0)

  async function salvar() {
    const validos = itens.filter(it=>it.mp_id&&it.quantidade&&it.custo_total)
    if (!validos.length) return
    setSaving(true)
    const desde30 = new Date(); desde30.setDate(desde30.getDate() - 30)
    const desde30str = desde30.toISOString().slice(0,10)
    for (const it of validos) {
      const qtd = parseFloat(it.quantidade)
      const custo = parseFloat(it.custo_total)
      // Insere compra primeiro
      await supabase.from('mp_compras').insert({
        materia_prima_id: it.mp_id,
        quantidade: qtd,
        custo_total: custo,
        data_compra: form.data_compra,
        fornecedor: form.fornecedor||null,
        numero_nf: form.numero_nf||null,
        observacao: form.observacao||null,
      })
      // Recalcula preço médio últimos 30 dias
      const { data: compras30 } = await supabase.from('mp_compras')
        .select('quantidade, custo_total').eq('materia_prima_id', it.mp_id).gte('data_compra', desde30str)
      const tot30Qtd = (compras30||[]).reduce((s,c) => s + parseFloat(c.quantidade||0), 0)
      const tot30Custo = (compras30||[]).reduce((s,c) => s + parseFloat(c.custo_total||0), 0)
      const novoCusto = tot30Qtd > 0 ? tot30Custo / tot30Qtd : custo / qtd
      // Atualiza estoque
      const { data: mp } = await supabase.from('materias_primas').select('estoque_atual').eq('id',it.mp_id).single()
      const novoEstoque = (parseFloat(mp?.estoque_atual)||0) + qtd
      await supabase.from('materias_primas').update({
        estoque_atual: novoEstoque,
        custo_unitario: novoCusto,
        atualizado_em: new Date().toISOString(),
      }).eq('id',it.mp_id)
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:600,maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header">
          <div className="modal-title">💰 Registrar Compra</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Dados gerais */}
          <div className="form-grid-2" style={{marginBottom:12}}>
            <div className="form-group">
              <label className="form-label">Data da compra</label>
              <input type="date" className="form-input" value={form.data_compra} onChange={e=>set('data_compra',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Fornecedor</label>
              <input className="form-input" value={form.fornecedor} onChange={e=>set('fornecedor',e.target.value)} placeholder="Nome do fornecedor" />
            </div>
          </div>
          <div className="form-grid-2" style={{marginBottom:16}}>
            <div className="form-group">
              <label className="form-label">NF / Pedido</label>
              <input className="form-input" value={form.numero_nf} onChange={e=>set('numero_nf',e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Observação</label>
              <input className="form-input" value={form.observacao} onChange={e=>set('observacao',e.target.value)} />
            </div>
          </div>

          {/* Itens */}
          <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Itens da compra</div>
          {itens.map((it,idx)=>{
            const mp = mps.find(m=>m.id===it.mp_id)
            const custoUnit = it.quantidade&&it.custo_total ? parseFloat(it.custo_total)/parseFloat(it.quantidade) : null
            return (
              <div key={idx} style={{border:'1px solid var(--gray-200)',borderRadius:8,padding:'12px 14px',marginBottom:8}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 100px 110px auto',gap:8,alignItems:'start'}}>
                  <div>
                    <select className="form-input" value={it.mp_id} onChange={e=>setItem(idx,'mp_id',e.target.value)} style={{fontSize:13}}>
                      <option value="">Selecione o insumo...</option>
                      {CATEGORIAS.map(cat=>{
                        const grupo = mps.filter(m=>m.categoria===cat)
                        if (!grupo.length) return null
                        return <optgroup key={cat} label={cat}>{grupo.map(m=><option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}</optgroup>
                      })}
                    </select>
                  </div>
                  <div>
                    <input type="number" className="form-input" placeholder={`Qtd${mp?` (${mp.unidade})`:''}`}
                      value={it.quantidade} onChange={e=>setItem(idx,'quantidade',e.target.value)}
                      min={0} step={0.001} style={{fontSize:13}} />
                  </div>
                  <div>
                    <input type="number" className="form-input" placeholder="Custo total R$"
                      value={it.custo_total} onChange={e=>setItem(idx,'custo_total',e.target.value)}
                      min={0} step={0.01} style={{fontSize:13}} />
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>remItem(idx)}
                    style={{color:'var(--danger)',marginTop:2}} disabled={itens.length===1}>✕</button>
                </div>
                {custoUnit!==null && (
                  <div style={{fontSize:11,color:'var(--purple)',fontWeight:700,marginTop:4}}>
                    → {fmtR(custoUnit)}/{mp?.unidade||'un'} por unidade
                  </div>
                )}
              </div>
            )
          })}
          <button className="btn btn-ghost btn-sm" onClick={addItem}><Plus size={12}/> Adicionar item</button>

          {totalGeral > 0 && (
            <div style={{marginTop:12,padding:'10px 14px',background:'var(--purple-pale)',borderRadius:8,display:'flex',justifyContent:'space-between',fontWeight:700}}>
              <span>Total da compra</span>
              <span style={{color:'var(--purple)',fontSize:15}}>{fmtR(totalGeral)}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}
            disabled={saving||!itens.some(it=>it.mp_id&&it.quantidade&&it.custo_total)}>
            {saving?<><RefreshCw size={14} className="spin"/> Salvando...</>:<><Save size={14}/> Registrar compra</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal editar compra ───────────────────────────────────────────────────────
function ModalEditarCompra({ compra, onClose, onSaved }) {
  const [form, setForm] = useState({
    quantidade: String(compra.quantidade),
    custo_total: String(compra.custo_total),
    data_compra: compra.data_compra,
    fornecedor: compra.fornecedor || '',
    numero_nf: compra.numero_nf || '',
    observacao: compra.observacao || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const qtdAnterior = parseFloat(compra.quantidade)||0
  const custoAnterior = parseFloat(compra.custo_total)||0
  const qtdNova = parseFloat(form.quantidade)||0
  const custoNovo = parseFloat(form.custo_total)||0
  const custoUnit = qtdNova > 0 ? custoNovo/qtdNova : 0
  const diffQtd = qtdNova - qtdAnterior

  async function salvar() {
    if (!form.quantidade || !form.custo_total) return
    setSaving(true)

    // Atualiza o registro da compra
    await supabase.from('mp_compras').update({
      quantidade: qtdNova,
      custo_total: custoNovo,
      data_compra: form.data_compra,
      fornecedor: form.fornecedor || null,
      numero_nf: form.numero_nf || null,
      observacao: form.observacao || null,
    }).eq('id', compra.id)

    // Recalcula preço médio ponderado dos últimos 30 dias
    const desde30 = new Date(); desde30.setDate(desde30.getDate() - 30)
    const { data: compras30 } = await supabase
      .from('mp_compras')
      .select('quantidade, custo_total')
      .eq('materia_prima_id', compra.materia_prima_id)
      .gte('data_compra', desde30.toISOString().slice(0,10))

    const totalQtd = (compras30||[]).reduce((s,c) => s + parseFloat(c.quantidade||0), 0)
    const totalCusto = (compras30||[]).reduce((s,c) => s + parseFloat(c.custo_total||0), 0)
    const novoCustoUnit = totalQtd > 0 ? totalCusto / totalQtd : 0

    // Estoque: reverte anterior e aplica novo
    const { data: mp } = await supabase.from('materias_primas')
      .select('estoque_atual').eq('id', compra.materia_prima_id).single()
    const estoqueAtual = parseFloat(mp?.estoque_atual)||0
    const novoEstoque = Math.max(0, estoqueAtual - qtdAnterior + qtdNova)

    await supabase.from('materias_primas').update({
      estoque_atual: novoEstoque,
      custo_unitario: novoCustoUnit,
      atualizado_em: new Date().toISOString(),
    }).eq('id', compra.materia_prima_id)

    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:460}}>
        <div className="modal-header">
          <div>
            <div className="modal-title">✏️ Editar Compra</div>
            <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>{compra.materias_primas?.nome}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Quantidade ({compra.materias_primas?.unidade}) *</label>
              <input type="number" className="form-input" value={form.quantidade}
                onChange={e=>set('quantidade',e.target.value)} min={0} step={0.001} autoFocus/>
            </div>
            <div className="form-group">
              <label className="form-label">Custo total (R$) *</label>
              <input type="number" className="form-input" value={form.custo_total}
                onChange={e=>set('custo_total',e.target.value)} min={0} step={0.01}/>
            </div>
          </div>
          {custoUnit > 0 && (
            <div style={{padding:'8px 12px',background:'var(--purple-pale)',borderRadius:6,fontSize:13,marginBottom:12,color:'var(--purple)',fontWeight:700}}>
              Custo unitário: {fmtR(custoUnit)}/{compra.materias_primas?.unidade}
              {diffQtd !== 0 && (
                <span style={{marginLeft:12,color:diffQtd>0?'var(--ok)':'var(--danger)',fontWeight:700}}>
                  {diffQtd>0?'+':''}{fmt(diffQtd,1)} {compra.materias_primas?.unidade} no estoque
                </span>
              )}
            </div>
          )}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Data da compra</label>
              <input type="date" className="form-input" value={form.data_compra}
                onChange={e=>set('data_compra',e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="form-label">NF / Pedido</label>
              <input className="form-input" value={form.numero_nf}
                onChange={e=>set('numero_nf',e.target.value)}/>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Fornecedor</label>
            <input className="form-input" value={form.fornecedor}
              onChange={e=>set('fornecedor',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Observação</label>
            <input className="form-input" value={form.observacao}
              onChange={e=>set('observacao',e.target.value)}/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}
            disabled={saving||!form.quantidade||!form.custo_total}>
            {saving?<><RefreshCw size={14} className="spin"/> Salvando...</>:<><Save size={14}/> Salvar alterações</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Histórico de compras ──────────────────────────────────────────────────────
function HistoricoCompras() {
  const [compras, setCompras] = useState([])
  const [mps, setMps] = useState([])
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(new Date().toISOString().slice(0,7))
  const [xmlModal, setXmlModal] = useState(false)
  const [compraModal, setCompraModal] = useState(false)
  const [editModal, setEditModal] = useState(null) // compra a editar

  async function load() {
    setLoading(true)
    const ini = mes+'-01'
    const fim = new Date(mes.slice(0,4), mes.slice(5,7), 0).toISOString().slice(0,10)
    const [{ data: comprasData }, { data: mpsData }] = await Promise.all([
      supabase.from('mp_compras')
        .select('*, materias_primas(nome,unidade,categoria)')
        .gte('data_compra',ini).lte('data_compra',fim)
        .order('data_compra',{ascending:false})
        .order('criado_em',{ascending:false}),
      supabase.from('materias_primas').select('id,nome,unidade,categoria,fornecedor').eq('ativo',true).order('categoria').order('nome'),
    ])
    setCompras(comprasData||[])
    setMps(mpsData||[])
    setLoading(false)
  }
  useEffect(()=>{ load() },[mes])

  async function excluirCompra(c) {
    if (!window.confirm(`Excluir compra de ${c.materias_primas?.nome} (${fmt(c.quantidade,1)} ${c.materias_primas?.unidade} — ${fmtR(c.custo_total)})?\n\nO estoque será revertido automaticamente.`)) return

    // Remove compra primeiro
    await supabase.from('mp_compras').delete().eq('id', c.id)

    // Recalcula preço médio dos últimos 30 dias com compras restantes
    const desde30 = new Date(); desde30.setDate(desde30.getDate() - 30)
    const { data: compras30 } = await supabase
      .from('mp_compras')
      .select('quantidade, custo_total')
      .eq('materia_prima_id', c.materia_prima_id)
      .gte('data_compra', desde30.toISOString().slice(0,10))

    const totalQtd = (compras30||[]).reduce((s,r) => s + parseFloat(r.quantidade||0), 0)
    const totalCusto = (compras30||[]).reduce((s,r) => s + parseFloat(r.custo_total||0), 0)
    const novoCusto = totalQtd > 0 ? totalCusto / totalQtd : 0

    // Reverte estoque
    const { data: mp } = await supabase.from('materias_primas').select('estoque_atual').eq('id', c.materia_prima_id).single()
    const estoqueAtual = parseFloat(mp?.estoque_atual)||0
    const novoEstoque = Math.max(0, estoqueAtual - parseFloat(c.quantidade))

    await supabase.from('materias_primas').update({
      estoque_atual: novoEstoque,
      custo_unitario: novoCusto,
      atualizado_em: new Date().toISOString(),
    }).eq('id', c.materia_prima_id)

    load()
  }

  const totalMes = compras.reduce((s,c)=>s+(parseFloat(c.custo_total)||0),0)

  return (
    <div className="card">
      {xmlModal && <ModalImportarXML onClose={()=>setXmlModal(false)} onSaved={()=>{setXmlModal(false);load()}} />}
      {compraModal && <ModalCompraAvulsa mps={mps} onClose={()=>setCompraModal(false)} onSaved={()=>{setCompraModal(false);load()}} />}
      {editModal && <ModalEditarCompra compra={editModal} onClose={()=>setEditModal(null)} onSaved={()=>{setEditModal(null);load()}} />}
      <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center'}}>
        <div style={{fontWeight:800,fontSize:15}}>📦 Histórico de Compras</div>
        <div style={{flex:1}}/>
        <input type="month" className="form-input" value={mes} onChange={e=>setMes(e.target.value)} style={{width:160,fontSize:13}} />
        <button className="btn btn-ghost btn-sm" onClick={()=>setXmlModal(true)}><Upload size={13}/> Importar XML</button>
        <button className="btn btn-primary btn-sm" onClick={()=>setCompraModal(true)}><Plus size={13}/> Registrar compra</button>
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
                  <th style={{padding:'9px 10px',width:70}}></th>
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
                    <td style={{padding:'9px 10px',textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-sm" onClick={()=>setEditModal(c)}
                          title="Editar" style={{fontSize:11}}>
                          <Pencil size={11}/>
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={()=>excluirCompra(c)}
                          style={{color:'var(--danger)',fontSize:11}} title="Excluir e reverter estoque">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--gray-50)'}}>
                  <td colSpan={5} style={{padding:'9px 14px',fontWeight:800}}>Total do mês</td>
                  <td style={{padding:'9px 10px',textAlign:'right',fontWeight:800,color:'var(--purple)'}}>{fmtR(totalMes)}</td>
                  <td colSpan={2}/>
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
        <button className={`tab${sub==='evolucao'?' active':''}`} onClick={()=>setSub('evolucao')}>📈 Evolução de Preços</button>
        <button className={`tab${sub==='custo_prep'?' active':''}`} onClick={()=>setSub('custo_prep')}>🧪 Custo de Preparações</button>
        <button className={`tab${sub==='consumo'?' active':''}`} onClick={()=>setSub('consumo')}>📉 Consumo</button>
        <button className={`tab${sub==='overhead'?' active':''}`} onClick={()=>setSub('overhead')}>🏭 Overhead Mensal</button>
        <button className={`tab${sub==='cmv_mensal'?' active':''}`} onClick={()=>setSub('cmv_mensal')}>💰 CMV Mensal</button>
        <button className={`tab${sub==='conferencia'?' active':''}`} onClick={()=>setSub('conferencia')}>🔍 Conferência</button>
      </div>
      {sub==='situacao'   && <DashMP />}
      {sub==='historico'  && <HistoricoCompras />}
      {sub==='evolucao'   && <EvolucaoPrecos />}
      {sub==='custo_prep'  && <CustoPreparacoes />}
      {sub==='consumo'     && <HistoricoConsumo />}
      {sub==='overhead'    && <OverheadMensal />}
      {sub==='cmv_mensal'  && <CMVMensal />}
      {sub==='conferencia' && <ConferenciaMP />}
    </>
  )
}

// ── Evolução de Preços ────────────────────────────────────────────────────────
function EvolucaoPrecos() {
  const [mps, setMps] = useState([])
  const [compras, setCompras] = useState([])
  const [loading, setLoading] = useState(true)
  const [mpSel, setMpSel] = useState('todas')
  const [catFiltro, setCatFiltro] = useState('Todas')
  const [alertasOnly, setAlertasOnly] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: mpsData }, { data: comprasData }] = await Promise.all([
      supabase.from('materias_primas').select('*').eq('ativo',true).order('categoria').order('nome'),
      supabase.from('mp_compras').select('*, materias_primas(nome,unidade,categoria)')
        .order('data_compra', {ascending:true}),
    ])
    setMps(mpsData||[])
    setCompras(comprasData||[])
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  // PM dos últimos 60 dias por MP
  function pm60(mpId) {
    const corte = new Date(); corte.setDate(corte.getDate()-60)
    const recentes = compras.filter(c => c.materia_prima_id===mpId && new Date(c.data_compra) >= corte)
    if (!recentes.length) return null
    const totalQtd = recentes.reduce((s,c)=>s+parseFloat(c.quantidade||0),0)
    const totalCusto = recentes.reduce((s,c)=>s+parseFloat(c.custo_total||0),0)
    return totalQtd > 0 ? totalCusto/totalQtd : null
  }

  // Última compra de cada MP
  function ultimaCompra(mpId) {
    const hist = compras.filter(c=>c.materia_prima_id===mpId)
    if (!hist.length) return null
    return hist[hist.length-1]
  }

  // Classifica preço em faixa
  function faixa(custo, pm) {
    if (!pm || !custo) return null
    const ratio = custo/pm
    if (ratio <= 0.95) return 'economica'
    if (ratio <= 1.05) return 'ideal'
    return 'caro'
  }

  const FAIXA = {
    ideal:     { label:'✅ Ideal',     cor:'var(--ok)',      bg:'#f0faf0', desc:'Dentro do PM ±5%' },
    economica: { label:'💚 Econômico', cor:'#0a7c4e',        bg:'#e6f9f0', desc:'Abaixo do PM > 5%' },
    caro:      { label:'🚨 Caro',      cor:'var(--danger)',  bg:'#fff0f0', desc:'Acima do PM > 5%' },
  }

  // Agrupa histórico por MP
  const historicosPorMp = {}
  for (const c of compras) {
    const id = c.materia_prima_id
    if (!historicosPorMp[id]) historicosPorMp[id] = []
    historicosPorMp[id].push(c)
  }

  // Filtra MPs
  const cats = ['Todas', ...new Set(mps.map(m=>m.categoria))]
  let mpsFiltradas = mps.filter(m => {
    const matchCat = catFiltro==='Todas' || m.categoria===catFiltro
    const matchSel = mpSel==='todas' || m.id===mpSel
    if (!matchCat || !matchSel) return false
    if (alertasOnly) {
      const ult = ultimaCompra(m.id)
      const pm = pm60(m.id)
      const f = faixa(ult ? parseFloat(ult.custo_unitario) : null, pm)
      return f === 'caro'
    }
    return true
  }).filter(m => (historicosPorMp[m.id]||[]).length > 0)

  // KPIs
  const totalMps = mps.filter(m=>(historicosPorMp[m.id]||[]).length>0).length
  const caros = mps.filter(m => {
    const ult = ultimaCompra(m.id)
    const pm = pm60(m.id)
    return faixa(ult ? parseFloat(ult.custo_unitario) : null, pm) === 'caro'
  }).length
  const economicos = mps.filter(m => {
    const ult = ultimaCompra(m.id)
    const pm = pm60(m.id)
    return faixa(ult ? parseFloat(ult.custo_unitario) : null, pm) === 'economica'
  }).length

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
        {[
          {label:'Com histórico de preço',valor:totalMps,sub:'insumos com compras registradas',cor:'var(--purple)'},
          {label:'🚨 Preço acima do PM',valor:caros,sub:'última compra > 5% acima da média 60d',cor:caros>0?'var(--danger)':'var(--ok)'},
          {label:'💚 Preço econômico',valor:economicos,sub:'última compra > 5% abaixo da média 60d',cor:'#0a7c4e'},
        ].map(k=>(
          <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
            <div style={{fontSize:11,color:'var(--gray-400)'}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Legenda das faixas */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {Object.entries(FAIXA).map(([k,f])=>(
          <div key={k} style={{padding:'6px 12px',background:f.bg,border:`1.5px solid ${f.cor}`,borderRadius:20,fontSize:12,fontWeight:700,color:f.cor}}>
            {f.label} <span style={{fontWeight:400,color:'var(--gray-500)'}}>— {f.desc}</span>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="card" style={{padding:'12px 20px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <select className="form-input" value={catFiltro} onChange={e=>setCatFiltro(e.target.value)} style={{width:160,fontSize:13}}>
          {cats.map(c=><option key={c}>{c}</option>)}
        </select>
        <select className="form-input" value={mpSel} onChange={e=>setMpSel(e.target.value)} style={{width:240,fontSize:13}}>
          <option value="todas">Todos os insumos</option>
          {mps.filter(m=>catFiltro==='Todas'||m.categoria===catFiltro).map(m=>(
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </select>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer',fontWeight:600,color:'var(--danger)'}}>
          <input type="checkbox" checked={alertasOnly} onChange={e=>setAlertasOnly(e.target.checked)} style={{accentColor:'var(--danger)'}}/>
          Apenas alertas 🚨
        </label>
        <div style={{flex:1}}/>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
      </div>

      {/* Cards por MP */}
      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        mpsFiltradas.length === 0 ? (
          <div className="card card-pad" style={{textAlign:'center',color:'var(--gray-300)'}}>
            {alertasOnly ? 'Nenhum insumo com preço acima do PM nos últimos 60 dias' : 'Nenhum insumo com histórico de compras ainda'}
          </div>
        ) : (
          mpsFiltradas.map(mp => {
            const hist = historicosPorMp[mp.id] || []
            const pm = pm60(mp.id)
            const ult = ultimaCompra(mp.id)
            const ultCusto = ult ? parseFloat(ult.custo_unitario) : null
            const f = faixa(ultCusto, pm)
            const fInfo = f ? FAIXA[f] : null
            const varPct = pm && ultCusto ? ((ultCusto-pm)/pm*100) : null

            // Mini gráfico de barras com histórico
            const maxCusto = Math.max(...hist.map(c=>parseFloat(c.custo_unitario)||0))

            return (
              <div key={mp.id} className="card" style={{border: fInfo ? `2px solid ${fInfo.cor}` : undefined}}>
                {/* Header */}
                <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14}}>{mp.nome}</div>
                    <div style={{fontSize:11,color:'var(--gray-400)'}}>{mp.categoria} · {mp.unidade}</div>
                  </div>
                  <div style={{display:'flex',gap:16,alignItems:'center'}}>
                    {pm && (
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>PM 60 dias</div>
                        <div style={{fontSize:16,fontWeight:800,color:'var(--gray-700)'}}>{fmtR(pm)}<span style={{fontSize:11}}>/{ mp.unidade}</span></div>
                      </div>
                    )}
                    {ultCusto && (
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Última compra</div>
                        <div style={{fontSize:16,fontWeight:800,color:fInfo?.cor||'var(--gray-700)'}}>{fmtR(ultCusto)}<span style={{fontSize:11}}>/{mp.unidade}</span></div>
                      </div>
                    )}
                    {fInfo && (
                      <div style={{padding:'6px 12px',background:fInfo.bg,border:`2px solid ${fInfo.cor}`,borderRadius:20,fontSize:12,fontWeight:800,color:fInfo.cor,whiteSpace:'nowrap'}}>
                        {fInfo.label}
                        {varPct !== null && <span style={{marginLeft:6,fontSize:11}}>{varPct>0?'+':''}{varPct.toFixed(1)}%</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Histórico de compras */}
                <div style={{padding:'12px 20px'}}>
                  <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',marginBottom:10}}>
                    Histórico de compras ({hist.length} registros)
                  </div>
                  <div style={{display:'flex',gap:6,alignItems:'flex-end',overflowX:'auto',paddingBottom:4}}>
                    {hist.map((c,i) => {
                      const custo = parseFloat(c.custo_unitario)||0
                      const altPct = maxCusto > 0 ? (custo/maxCusto)*100 : 0
                      const f = faixa(custo, pm)
                      const corBarra = f ? FAIXA[f].cor : 'var(--purple)'
                      const isUlt = i === hist.length-1
                      return (
                        <div key={c.id} style={{display:'flex',flexDirection:'column',alignItems:'center',minWidth:52,flex:'0 0 52px'}}>
                          <div style={{fontSize:9,color:'var(--gray-500)',marginBottom:2,fontWeight:isUlt?700:400}}>
                            {fmtR(custo)}
                          </div>
                          <div style={{
                            width:36, height: Math.max(8, altPct*0.8),
                            background: corBarra,
                            borderRadius:'4px 4px 0 0',
                            opacity: isUlt ? 1 : 0.55,
                            border: isUlt ? `2px solid ${corBarra}` : 'none',
                          }}/>
                          <div style={{fontSize:9,color:'var(--gray-400)',marginTop:3,textAlign:'center',lineHeight:1.2}}>
                            {new Date(c.data_compra+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}
                          </div>
                          {c.fornecedor && (
                            <div style={{fontSize:8,color:'var(--gray-300)',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:52}}>
                              {c.fornecedor}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Faixas de referência */}
                  {pm && (
                    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                      <div style={{fontSize:11,padding:'3px 10px',background:'#e6f9f0',borderRadius:12,color:'#0a7c4e',fontWeight:700}}>
                        💚 Econômico: abaixo de {fmtR(pm*0.95)}/{mp.unidade}
                      </div>
                      <div style={{fontSize:11,padding:'3px 10px',background:'#f0faf0',borderRadius:12,color:'var(--ok)',fontWeight:700}}>
                        ✅ Ideal: {fmtR(pm*0.95)} – {fmtR(pm*1.05)}/{mp.unidade}
                      </div>
                      <div style={{fontSize:11,padding:'3px 10px',background:'#fff0f0',borderRadius:12,color:'var(--danger)',fontWeight:700}}>
                        🚨 Caro: acima de {fmtR(pm*1.05)}/{mp.unidade}
                      </div>
                    </div>
                  )}
                  {!pm && (
                    <div style={{fontSize:11,color:'var(--gray-300)',fontStyle:'italic',marginTop:6}}>
                      Sem compras nos últimos 60 dias para calcular PM de referência
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )
      )}
    </div>
  )
}

// ── Custo de Preparações ──────────────────────────────────────────────────────
function CustoPreparacoes() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(null)
  const [filtro, setFiltro] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: preps }, { data: comps }, { data: mps }] = await Promise.all([
      supabase.from('preparacoes').select('*').eq('ativo', true).order('tipo').order('nome'),
      supabase.from('preparacao_composicao').select('*, materias_primas(id,nome,custo_unitario,unidade)'),
      supabase.from('materias_primas').select('id,nome,custo_unitario,unidade').eq('ativo', true),
    ])

    const mpMap = {}
    for (const m of (mps||[])) mpMap[m.id] = m
    const prepMap = {}
    for (const p of (preps||[])) prepMap[p.id] = p

    // Custo por g recursivo (suporta sub-preparações)
    const cache = {}
    function custoPorG(prepId, vis = new Set()) {
      if (cache[prepId] !== undefined) return cache[prepId]
      if (vis.has(prepId)) return 0
      const v = new Set([...vis, prepId])
      const prep = prepMap[prepId]
      if (!prep) return 0
      const ings = (comps||[]).filter(c => c.preparacao_id === prepId)
      const custo = ings.reduce((s, ing) => {
        if (ing.sub_preparacao_id) return s + (parseFloat(ing.quantidade)||0) * custoPorG(ing.sub_preparacao_id, v)
        const mp = ing.materias_primas || mpMap[ing.materia_prima_id]
        return s + (parseFloat(ing.quantidade)||0) * (parseFloat(mp?.custo_unitario)||0)
      }, 0)
      const rendRealP = parseFloat(prep.rendimento_real_medio)||null
      const rendLiq = rendRealP
        ? rendRealP
        : (parseFloat(prep.rendimento_estimado)||1) * (1 - (parseFloat(prep.perda_percentual)||0)/100)
      cache[prepId] = rendLiq > 0 ? custo/rendLiq : 0
      return cache[prepId]
    }
    for (const p of (preps||[])) custoPorG(p.id)

    const resultado = (preps||[]).map(prep => {
      const ings = (comps||[]).filter(c => c.preparacao_id === prep.id)
      const rendBruto = ings.reduce((s,i) => s + (parseFloat(i.quantidade)||0), 0)
      const perda = parseFloat(prep.perda_percentual)||0
      const rendLiq = rendBruto * (1 - perda/100)

      let custoReceita = 0
      let semPreco = 0
      const detalhes = ings.map(ing => {
        let custo_unitario = 0
        let temMP = false
        let isSubPrep = false
        let subPrepNome = null

        if (ing.sub_preparacao_id) {
          custo_unitario = custoPorG(ing.sub_preparacao_id)
          isSubPrep = true
          subPrepNome = prepMap[ing.sub_preparacao_id]?.nome || '—'
          temMP = true // tem vínculo (sub-prep)
        } else {
          const mp = ing.materias_primas || mpMap[ing.materia_prima_id]
          custo_unitario = parseFloat(mp?.custo_unitario)||0
          temMP = !!ing.materia_prima_id
          if (ing.materia_prima_id && custo_unitario === 0) semPreco++
          if (!ing.materia_prima_id && !ing.sub_preparacao_id) semPreco++
        }

        const qtd = parseFloat(ing.quantidade)||0
        const custo = custo_unitario * qtd
        custoReceita += custo
        return { nome: ing.ingrediente, qtd, unidade: ing.unidade, custo_unitario, custo, temMP, isSubPrep, subPrepNome }
      }).sort((a,b) => b.custo - a.custo)

      const custoG = rendLiq > 0 ? custoReceita / rendLiq : 0
      return { prep, ings: detalhes, rendBruto, rendLiq, custoReceita, custoG, semPreco }
    })

    setData(resultado)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const TIPO_ICON = { massa:'🍞', recheio:'🥄', creme:'🍮', cobertura:'🍫', cha:'🍵', outro:'📦' }
  const filtrados = data.filter(d => !filtro || d.prep.nome.toLowerCase().includes(filtro.toLowerCase()))

  // KPIs
  const comCusto = data.filter(d => d.custoReceita > 0).length
  const semDados = data.filter(d => d.semPreco > 0).length

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
        {[
          {label:'Preparações calculadas',valor:comCusto,sub:`de ${data.length} preparações`,cor:'var(--ok)'},
          {label:'Com dados incompletos',valor:semDados,sub:'MPs sem preço ou não vinculadas',cor:semDados>0?'var(--warning)':'var(--ok)'},
          {label:'Total de preparações',valor:data.length,sub:'massas, recheios, cremes, coberturas',cor:'var(--purple)'},
        ].map(k=>(
          <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
            <div style={{fontSize:11,color:'var(--gray-400)'}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="card">
        <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center'}}>
          <div style={{fontWeight:800,fontSize:15}}>🧪 Custo por Preparação</div>
          <div style={{flex:1}}/>
          <input className="form-input" placeholder="Filtrar..." value={filtro}
            onChange={e=>setFiltro(e.target.value)} style={{width:200,fontSize:13}}/>
          <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
        </div>

        {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
          <div style={{display:'flex',flexDirection:'column'}}>
            {filtrados.map((d,i) => {
              const exp = expandido === d.prep.id
              const temCusto = d.custoReceita > 0
              return (
                <div key={d.prep.id} style={{borderTop:i>0?'1px solid var(--gray-100)':undefined}}>
                  <div
                    onClick={() => setExpandido(exp ? null : d.prep.id)}
                    style={{
                      padding:'11px 20px',
                      display:'grid',
                      gridTemplateColumns:'28px 1fr 130px 130px 130px 80px',
                      gap:10, alignItems:'center',
                      background:i%2===0?'#fff':'#fafafa',
                      cursor:'pointer',
                    }}>
                    <div style={{fontSize:16}}>{TIPO_ICON[d.prep.tipo]||'📦'}</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{d.prep.nome}</div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>{d.prep.tipo} · {d.ings.length} ingredientes</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Custo/receita</div>
                      <div style={{fontWeight:800,color:temCusto?'var(--purple)':'var(--gray-300)',fontSize:14}}>
                        {temCusto ? fmtR(d.custoReceita) : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Rend. líquido</div>
                      <div style={{fontWeight:600}}>
                        {d.rendLiq > 0 ? `${Number(d.rendLiq).toLocaleString('pt-BR',{maximumFractionDigits:1})} ${d.prep.unidade_rendimento}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>
                        Custo/{d.prep.unidade_rendimento}
                      </div>
                      <div style={{fontWeight:800,color:temCusto?'var(--ok)':'var(--gray-300)',fontSize:14}}>
                        {temCusto && d.custoG > 0 ? fmtR(d.custoG) : '—'}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      {d.semPreco > 0 && (
                        <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:'#fffbf0',color:'var(--warning)',fontWeight:700,border:'1px solid var(--warning)'}}>
                          ⚠️ {d.semPreco} sem preço
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Detalhe ingredientes */}
                  {exp && (
                    <div style={{background:'#f8f5ff',borderTop:'1px solid var(--gray-100)',padding:'0 20px 14px'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:10}}>
                        <thead>
                          <tr style={{background:'var(--gray-50)'}}>
                            <th style={{padding:'6px 12px',textAlign:'left',fontWeight:600,color:'var(--gray-500)'}}>Ingrediente</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>Qtd/receita</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>Preço/un</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--purple)'}}>Custo</th>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>% do total</th>
                            <th style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-500)'}}>MP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.ings.map((ing,ii) => {
                            const pct = d.custoReceita > 0 ? (ing.custo/d.custoReceita*100) : 0
                            return (
                              <tr key={ii} style={{borderTop:'1px solid var(--gray-100)',background:ii%2===0?'#fff':'#f8f5ff'}}>
                                <td style={{padding:'6px 12px',fontWeight:600}}>{ing.nome}</td>
                                <td style={{padding:'6px 10px',textAlign:'right',color:'var(--gray-500)'}}>
                                  {Number(ing.qtd).toLocaleString('pt-BR',{maximumFractionDigits:2})} {ing.unidade}
                                </td>
                                <td style={{padding:'6px 10px',textAlign:'right',color:'var(--gray-500)'}}>
                                  {ing.isSubPrep
                                    ? <span style={{color:'var(--purple)',fontStyle:'italic',fontSize:11}}>🧪 {ing.subPrepNome}</span>
                                    : ing.custo_unitario > 0 ? `${fmtR(ing.custo_unitario)}/${ing.unidade}` : <span style={{color:'var(--warning)'}}>sem preço</span>
                                  }
                                </td>
                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:ing.custo>0?'var(--purple)':'var(--gray-300)'}}>
                                  {ing.custo > 0 ? fmtR(ing.custo) : '—'}
                                </td>
                                <td style={{padding:'6px 10px',textAlign:'right'}}>
                                  {pct > 0 && (
                                    <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
                                      <div style={{width:40,height:6,background:'var(--gray-100)',borderRadius:3}}>
                                        <div style={{height:'100%',width:`${Math.min(100,pct)}%`,background:'var(--purple)',borderRadius:3}}/>
                                      </div>
                                      <span style={{fontSize:11,color:'var(--gray-500)',minWidth:32,textAlign:'right'}}>{pct.toFixed(0)}%</span>
                                    </div>
                                  )}
                                </td>
                                <td style={{padding:'6px 10px',textAlign:'center',fontSize:12}}>
                                  {ing.temMP ? <span style={{color:'var(--ok)'}}>✓</span> : <span style={{color:'var(--warning)'}}>—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--purple-pale)'}}>
                            <td colSpan={3} style={{padding:'8px 12px',fontWeight:800}}>Total da receita</td>
                            <td style={{padding:'8px 10px',textAlign:'right',fontWeight:800,color:'var(--purple)',fontSize:14}}>{fmtR(d.custoReceita)}</td>
                            <td style={{padding:'8px 10px',textAlign:'right',fontSize:11,color:'var(--gray-500)'}}>
                              {fmtR(d.custoG)}/{d.prep.unidade_rendimento} líquido
                            </td>
                            <td/>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Overhead Mensal ───────────────────────────────────────────────────────────
function OverheadMensal() {
  const [itens, setItens] = useState([])
  const [rotulos, setRotulos] = useState([])
  const [producao, setProducao] = useState([])
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(new Date().toISOString().slice(0,7))

  async function load() {
    setLoading(true)
    const mesIni = mes + '-01'
    const mesFim = new Date(mes.slice(0,4), mes.slice(5,7), 0).toISOString().slice(0,10)

    const [{ data: overheadData }, { data: rotulosData }, { data: prodData }] = await Promise.all([
      supabase.from('overhead_producao').select('*').eq('ativo',true).order('categoria').order('ordem'),
      supabase.from('embalagens').select('id,equivalencia_overhead').eq('tipo','rotulo').eq('ativo',true),
      supabase.from('producao_diaria')
        .select('quantidade, embalagem_id')
        .gte('data_producao', mesIni)
        .lte('data_producao', mesFim)
        .not('registrado_por', 'ilike', '%(auto-embalagem)%'),
    ])

    // Mapa de equivalência
    const equivMap = {}
    for (const r of (rotulosData||[])) equivMap[r.id] = parseFloat(r.equivalencia_overhead)||1
    const rotuloIds = new Set(Object.keys(equivMap))

    // Volume do mês (só rótulos, com equivalência)
    const volumeMes = (prodData||[]).reduce((s,r) => {
      if (!rotuloIds.has(r.embalagem_id)) return s
      return s + (parseFloat(r.quantidade)||0) * (equivMap[r.embalagem_id]||1)
    }, 0)

    setItens(overheadData||[])
    setRotulos(rotulosData||[])
    setProducao(prodData||[])
    setLoading(false)

    return { volumeMes, overheadData }
  }

  const [volumeMes, setVolumeMes] = useState(0)

  useEffect(() => {
    async function run() {
      setLoading(true)
      const mesIni = mes + '-01'
      const mesFim = new Date(mes.slice(0,4), mes.slice(5,7), 0).toISOString().slice(0,10)

      const [{ data: overheadData }, { data: rotulosData }, { data: prodData }] = await Promise.all([
        supabase.from('overhead_producao').select('*').eq('ativo',true).order('categoria').order('ordem'),
        supabase.from('embalagens').select('id,equivalencia_overhead').eq('tipo','rotulo').eq('ativo',true),
        supabase.from('producao_diaria')
          .select('quantidade, embalagem_id')
          .gte('data_producao', mesIni)
          .lte('data_producao', mesFim)
          .not('registrado_por', 'ilike', '%(auto-embalagem)%'),
      ])

      const equivMap = {}
      for (const r of (rotulosData||[])) equivMap[r.id] = parseFloat(r.equivalencia_overhead)||1
      const rotuloIds = new Set(Object.keys(equivMap))

      const vol = (prodData||[]).reduce((s,r) => {
        if (!rotuloIds.has(r.embalagem_id)) return s
        return s + (parseFloat(r.quantidade)||0) * (equivMap[r.embalagem_id]||1)
      }, 0)

      setItens(overheadData||[])
      setVolumeMes(vol)
      setLoading(false)
    }
    run()
  }, [mes])

  const totalOverhead = itens.reduce((s,it) => s + (parseFloat(it.valor_mensal)||0), 0)
  const overheadPorUn = volumeMes > 0 ? totalOverhead / volumeMes : 0

  // Agrupa por categoria
  const porCat = {}
  for (const it of itens) {
    if (!porCat[it.categoria]) porCat[it.categoria] = []
    porCat[it.categoria].push(it)
  }

  const labelMes = new Date(mes + '-15').toLocaleDateString('pt-BR', { month:'long', year:'numeric' })

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Filtro mês */}
      <div className="card" style={{padding:'12px 20px',display:'flex',gap:12,alignItems:'center'}}>
        <div style={{fontWeight:800,fontSize:15}}>🏭 Análise de Overhead Mensal</div>
        <div style={{flex:1}}/>
        <input type="month" className="form-input" value={mes}
          onChange={e=>setMes(e.target.value)} style={{width:180,fontSize:13}}/>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        {[
          { label:'Total overhead/mês', valor: fmtR(totalOverhead), sub:'cadastrado em Admin → Overhead', cor:'var(--purple)' },
          { label:'Volume produzido', valor: `${Math.round(volumeMes).toLocaleString('pt-BR')} un`, sub:'equivalentes no mês', cor:'var(--gray-700)' },
          { label:'Overhead/unidade', valor: volumeMes>0 ? fmtR(overheadPorUn) : '—', sub:'custo de produção por unidade equiv.', cor:'var(--ok)' },
          { label:'% sobre faturamento', valor: '—', sub:'configure preço médio para calcular', cor:'var(--gray-400)' },
        ].map(k=>(
          <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
            <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
            <div style={{fontSize:10,color:'var(--gray-400)'}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Detalhamento por categoria */}
      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <div className="card">
          <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:800,fontSize:14,color:'var(--purple)',textTransform:'capitalize'}}>
            {labelMes}
          </div>
          {Object.entries(porCat).map(([cat, catItens]) => {
            const totalCat = catItens.reduce((s,it)=>s+(parseFloat(it.valor_mensal)||0),0)
            const pctTotal = totalOverhead > 0 ? totalCat/totalOverhead*100 : 0
            return (
              <div key={cat}>
                {/* Header categoria */}
                <div style={{padding:'8px 20px',background:'var(--gray-50)',borderTop:'1px solid var(--gray-200)',
                  display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontWeight:800,fontSize:12,color:'var(--gray-600)',textTransform:'uppercase',letterSpacing:'.05em'}}>{cat}</div>
                  <div style={{display:'flex',gap:16,alignItems:'center'}}>
                    <div style={{fontSize:11,color:'var(--gray-400)'}}>
                      {pctTotal.toFixed(1)}% do total
                    </div>
                    <div style={{fontWeight:800,fontSize:13,color:'var(--purple)'}}>
                      {fmtR(totalCat)}
                    </div>
                  </div>
                </div>
                {/* Barra proporcional */}
                <div style={{height:3,background:'var(--gray-100)',margin:'0 20px'}}>
                  <div style={{height:'100%',width:`${pctTotal}%`,background:'var(--purple)',borderRadius:2}}/>
                </div>
                {/* Itens */}
                {catItens.map((it,i) => {
                  const pctIt = totalOverhead > 0 ? (parseFloat(it.valor_mensal)||0)/totalOverhead*100 : 0
                  const overheadIt = volumeMes > 0 ? (parseFloat(it.valor_mensal)||0)/volumeMes : 0
                  return (
                    <div key={it.id} style={{
                      padding:'9px 20px 9px 32px',
                      borderTop:'1px solid var(--gray-100)',
                      display:'grid',
                      gridTemplateColumns:'1fr 100px 100px 80px',
                      gap:12, alignItems:'center',
                      background:i%2===0?'#fff':'#fafafa',
                    }}>
                      <div style={{fontWeight:600,fontSize:13}}>{it.descricao}</div>
                      <div style={{textAlign:'right',fontWeight:700,color:'var(--purple)'}}>
                        {fmtR(parseFloat(it.valor_mensal)||0)}
                      </div>
                      <div style={{textAlign:'right',fontSize:12,color:'var(--gray-500)'}}>
                        {volumeMes>0 ? `${fmtR(overheadIt)}/un` : '—'}
                      </div>
                      <div style={{textAlign:'right',fontSize:11,color:'var(--gray-400)'}}>
                        {pctIt.toFixed(1)}%
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* Total geral */}
          <div style={{padding:'12px 20px',borderTop:'2px solid var(--gray-200)',background:'var(--purple)',
            display:'grid',gridTemplateColumns:'1fr 100px 100px 80px',gap:12,alignItems:'center'}}>
            <div style={{fontWeight:800,color:'#fff',fontSize:14}}>Total Overhead</div>
            <div style={{textAlign:'right',fontWeight:800,color:'var(--gold)',fontSize:16}}>{fmtR(totalOverhead)}</div>
            <div style={{textAlign:'right',fontWeight:700,color:'rgba(255,255,255,.8)',fontSize:13}}>
              {volumeMes>0 ? `${fmtR(overheadPorUn)}/un` : '—'}
            </div>
            <div style={{textAlign:'right',color:'rgba(255,255,255,.6)',fontSize:11}}>100%</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Histórico de Consumo ──────────────────────────────────────────────────────
function HistoricoConsumo() {
  const [consumos, setConsumos] = useState([])
  const [mps, setMps] = useState([])
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(new Date().toISOString().slice(0,7))
  const [mpFiltro, setMpFiltro] = useState('todas')

  async function load() {
    setLoading(true)
    const ini = mes + '-01'
    const fim = new Date(mes.slice(0,4), mes.slice(5,7), 0).toISOString().slice(0,10)
    const [{ data: consumosData }, { data: mpsData }] = await Promise.all([
      supabase.from('mp_consumos')
        .select('*, materias_primas(nome, unidade, categoria)')
        .gte('data_consumo', ini)
        .lte('data_consumo', fim)
        .order('data_consumo', { ascending: false })
        .order('criado_em', { ascending: false }),
      supabase.from('materias_primas').select('id,nome,unidade,categoria').eq('ativo',true).order('categoria').order('nome'),
    ])
    setConsumos(consumosData||[])
    setMps(mpsData||[])
    setLoading(false)
  }

  useEffect(() => { load() }, [mes])

  const filtrados = consumos.filter(c =>
    mpFiltro === 'todas' || c.materia_prima_id === mpFiltro
  )

  // Agrupa por MP para resumo
  const porMP = {}
  for (const c of filtrados) {
    const id = c.materia_prima_id
    if (!porMP[id]) porMP[id] = { nome: c.materias_primas?.nome, unidade: c.materias_primas?.unidade, total: 0, registros: 0 }
    porMP[id].total += parseFloat(c.quantidade)||0
    porMP[id].registros++
  }
  const resumo = Object.values(porMP).sort((a,b) => b.total - a.total)
  const totalRegistros = filtrados.length

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Filtros */}
      <div className="card" style={{padding:'12px 20px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{fontWeight:800,fontSize:15}}>📉 Histórico de Consumo</div>
        <div style={{flex:1}}/>
        <select className="form-input" value={mpFiltro} onChange={e=>setMpFiltro(e.target.value)} style={{width:220,fontSize:13}}>
          <option value="todas">Todos os insumos</option>
          {mps.map(m=><option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
        </select>
        <input type="month" className="form-input" value={mes} onChange={e=>setMes(e.target.value)} style={{width:160,fontSize:13}}/>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
        <>
          {/* Resumo por MP */}
          {resumo.length > 0 && (
            <div className="card">
              <div style={{padding:'10px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:700,fontSize:13}}>
                Resumo por insumo — {totalRegistros} lançamentos
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                    <th style={{padding:'8px 14px',textAlign:'left'}}>Insumo</th>
                    <th style={{padding:'8px 10px',textAlign:'right'}}>Total consumido</th>
                    <th style={{padding:'8px 10px',textAlign:'center'}}>Lançamentos</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.map((r,i)=>(
                    <tr key={i} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                      <td style={{padding:'8px 14px',fontWeight:600}}>{r.nome}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>
                        {r.total>=1000?`${(r.total/1000).toFixed(2)} kg`:`${r.total.toFixed(1)} ${r.unidade}`}
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'center',color:'var(--gray-500)'}}>{r.registros}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Lançamentos detalhados */}
          <div className="card">
            <div style={{padding:'10px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:700,fontSize:13}}>
              Lançamentos detalhados
            </div>
            {filtrados.length === 0 ? (
              <div style={{padding:32,textAlign:'center',color:'var(--gray-300)'}}>
                {consumos.length === 0
                  ? 'Nenhum consumo registrado neste mês — ative a baixa automática em Admin → Sistema'
                  : 'Nenhum resultado para o filtro'}
              </div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                    <th style={{padding:'8px 14px',textAlign:'left'}}>Data</th>
                    <th style={{padding:'8px 14px',textAlign:'left'}}>Insumo</th>
                    <th style={{padding:'8px 10px',textAlign:'right'}}>Qtd consumida</th>
                    <th style={{padding:'8px 10px',textAlign:'left'}}>Origem</th>
                    <th style={{padding:'8px 14px',textAlign:'left'}}>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((c,i)=>(
                    <tr key={c.id} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                      <td style={{padding:'8px 14px',color:'var(--gray-500)',fontSize:12}}>
                        {new Date(c.data_consumo+'T12:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td style={{padding:'8px 14px',fontWeight:600}}>
                        {c.materias_primas?.nome}
                        <div style={{fontSize:10,color:'var(--gray-400)'}}>{c.materias_primas?.categoria}</div>
                      </td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'var(--danger)'}}>
                        -{parseFloat(c.quantidade)>=1000
                          ?`${(parseFloat(c.quantidade)/1000).toFixed(2)} kg`
                          :`${parseFloat(c.quantidade).toFixed(1)} ${c.materias_primas?.unidade}`}
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        <span style={{
                          fontSize:11,padding:'2px 8px',borderRadius:10,fontWeight:700,
                          background: c.origem==='producao'?'var(--purple-pale)':'var(--gray-100)',
                          color: c.origem==='producao'?'var(--purple)':'var(--gray-500)',
                        }}>
                          {c.origem==='producao'?'🏭 Produção':c.origem==='manual'?'✏️ Manual':'🔧 Ajuste'}
                        </span>
                      </td>
                      <td style={{padding:'8px 14px',fontSize:12,color:'var(--gray-400)'}}>{c.descricao||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── CMV Mensal ────────────────────────────────────────────────────────────────
function CMVMensal() {
  const [mes, setMes] = useState(new Date().toISOString().slice(0,7))
  const [visao, setVisao] = useState('unitario') // 'unitario' | 'convergencia'
  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [mes])

  async function load() {
    setLoading(true)
    const ini = mes + '-01'
    const fim = new Date(mes.slice(0,4), mes.slice(5,7), 0).toISOString().slice(0,10)
    const mesAnterior = new Date(mes.slice(0,4), mes.slice(5,7)-2, 1).toISOString().slice(0,7)

    // Busca dados em paralelo
    const [
      { data: producao },
      { data: consumoMP },
      { data: embs },
      { data: mps },
      { data: prepComps },
      { data: preps },
      { data: prodComps },
      { data: catEmbsData },
      { data: cfgDesp },
      { data: snapshotAtual },
      { data: snapshotAnterior },
    ] = await Promise.all([
      // Produção do mês por produto
      supabase.from('producao_diaria')
        .select('embalagem_id, quantidade, data_producao')
        .gte('data_producao', ini).lte('data_producao', fim)
        .not('registrado_por', 'ilike', '%(auto-embalagem)%'),
      // Consumo real de MP do mês
      supabase.from('mp_consumos')
        .select('materia_prima_id, quantidade, data_consumo')
        .gte('data_consumo', ini).lte('data_consumo', fim),
      // Embalagens tipo rotulo com custo
      supabase.from('embalagens').select('id,codigo,nome,categoria,tipo,custo_unitario,equivalencia_overhead').eq('ativo',true),
      // MPs com custo
      supabase.from('materias_primas').select('id,nome,unidade,custo_unitario').eq('ativo',true),
      // Composição das preparações
      supabase.from('preparacao_composicao').select('preparacao_id,ingrediente,quantidade,unidade,materia_prima_id,sub_preparacao_id'),
      // Preparações
      supabase.from('preparacoes').select('id,nome,tipo,rendimento_estimado,rendimento_real_medio,perda_percentual').eq('ativo',true),
      // Composição dos produtos + categoria_embalagem
      supabase.from('produto_composicao').select('sku_produto,preparacao_id,quantidade_por_unidade,quantidade_crua,unidade'),
      supabase.from('categoria_embalagem').select('categoria, quantidade, embalagens(id,nome,custo_unitario)').then(r=>r).catch(()=>({data:[]})),
      supabase.from('configuracoes').select('chave, valor').like('chave', 'desperdicio%').then(r=>r).catch(()=>({data:[]})),
      // Snapshot CMV do mês atual
      supabase.from('cmv_historico').select('*').eq('mes', mes),
      // Snapshot CMV do mês anterior
      supabase.from('cmv_historico').select('*').eq('mes', mesAnterior),
    ])

    // Produto acabado = rótulo OU embalagem com ficha técnica (ex: latas)
    const skusComFicha = new Set((prodComps||[]).map(p => p.sku_produto))
    const embMap = {}
    for (const e of (embs||[])) {
      if (e.tipo === 'rotulo' || skusComFicha.has(e.codigo)) embMap[e.id] = e
    }
    const mpMap = {}
    for (const m of (mps||[])) mpMap[m.id] = m
    const prepMap = {}
    for (const p of (preps||[])) prepMap[p.id] = p

    // Produção por SKU no mês
    const prodPorSku = {}
    for (const p of (producao||[])) {
      const emb = embMap[p.embalagem_id]
      if (!emb) continue
      if (!prodPorSku[emb.codigo]) prodPorSku[emb.codigo] = { emb, qtd: 0 }
      prodPorSku[emb.codigo].qtd += p.quantidade
    }

    // Dias que têm consumo registrado (cobertura da baixa automática)
    const diasComConsumo = new Set((consumoMP||[]).map(c => c.data_consumo))
    // Produção restrita aos dias cobertos — para comparação justa com o consumo real
    const prodPorSkuCoberto = {}
    let unidadesCobertas = 0
    let unidadesTotais = 0
    const diasComProducao = new Set()
    const diasSemConsumo = new Set()
    for (const p of (producao||[])) {
      const emb = embMap[p.embalagem_id]
      if (!emb) continue
      unidadesTotais += p.quantidade
      diasComProducao.add(p.data_producao)
      if (diasComConsumo.has(p.data_producao)) {
        if (!prodPorSkuCoberto[emb.codigo]) prodPorSkuCoberto[emb.codigo] = { emb, qtd: 0 }
        prodPorSkuCoberto[emb.codigo].qtd += p.quantidade
        unidadesCobertas += p.quantidade
      } else {
        diasSemConsumo.add(p.data_producao)
      }
    }

    // Custo MP por preparação (recursivo)
    const custoPrepCache = {}
    function custoPrepPorG(prepId, visitados = new Set()) {
      if (custoPrepCache[prepId] !== undefined) return custoPrepCache[prepId]
      if (visitados.has(prepId)) return 0
      const vis = new Set([...visitados, prepId])
      const prep = prepMap[prepId]
      if (!prep) return 0
      const ings = (prepComps||[]).filter(c => c.preparacao_id === prepId)
      const custo = ings.reduce((s, ing) => {
        if (ing.sub_preparacao_id) return s + (parseFloat(ing.quantidade)||0) * custoPrepPorG(ing.sub_preparacao_id, vis)
        const mp = mpMap[ing.materia_prima_id]
        return s + (parseFloat(ing.quantidade)||0) * (parseFloat(mp?.custo_unitario)||0)
      }, 0)
      const rendEst = parseFloat(prep.rendimento_estimado)||1
      const rendReal = parseFloat(prep.rendimento_real_medio)||null
      // Real já é líquido (medido); estimado é bruto e leva a perda de processo
      const rendLiq = rendReal
        ? rendReal
        : rendEst * (1 - (parseFloat(prep.perda_percentual)||0)/100)
      custoPrepCache[prepId] = rendLiq > 0 ? custo/rendLiq : 0
      return custoPrepCache[prepId]
    }
    for (const p of (preps||[])) custoPrepPorG(p.id)

    // Mapa de custo de embalagem por categoria
    const custoEmbPorCat = {}
    for (const ce of (catEmbsData||[])) {
      const cat = ce.categoria
      const custo = (parseFloat(ce.quantidade)||1) * (parseFloat(ce.embalagens?.custo_unitario)||0)
      custoEmbPorCat[cat] = (custoEmbPorCat[cat]||0) + custo
    }

    // VISÃO 1: CMV unitário por produto (snapshot + variação vs mês anterior)
    const snapAtualMap = {}
    for (const s of (snapshotAtual||[])) snapAtualMap[s.sku_produto] = s
    const snapAntMap = {}
    for (const s of (snapshotAnterior||[])) snapAntMap[s.sku_produto] = s

    const produtosUnitario = Object.values(prodPorSku).map(({ emb, qtd }) => {
      const snap = snapAtualMap[emb.codigo]
      const snapAnt = snapAntMap[emb.codigo]
      const cmvUnit = snap ? (snap.cmv_real ?? snap.cmv_direto) : null
      const cmvUnitAnt = snapAnt ? (snapAnt.cmv_real ?? snapAnt.cmv_direto) : null
      const varPct = cmvUnit && cmvUnitAnt ? ((cmvUnit - cmvUnitAnt) / cmvUnitAnt * 100) : null
      const custoTotal = cmvUnit ? cmvUnit * qtd : null
      return { emb, qtd, cmvUnit, cmvUnitAnt, varPct, custoTotal, usandoReal: !!snap?.cmv_real }
    }).sort((a,b) => (b.custoTotal||0) - (a.custoTotal||0))

    const totalCMVUnitario = produtosUnitario.reduce((s,p) => s + (p.custoTotal||0), 0)

    // VISÃO 2a: CMV por consumo real de MP
    const custoConsumoMP = (consumoMP||[]).reduce((s, c) => {
      const mp = mpMap[c.materia_prima_id]
      return s + (parseFloat(c.quantidade)||0) * (parseFloat(mp?.custo_unitario)||0)
    }, 0)

    // Detalhamento por MP consumida
    const consumoPorMP = {}
    for (const c of (consumoMP||[])) {
      const id = c.materia_prima_id
      if (!consumoPorMP[id]) consumoPorMP[id] = { mp: mpMap[id], qtd: 0, custo: 0 }
      const qtd = parseFloat(c.quantidade)||0
      const custo = qtd * (parseFloat(mpMap[id]?.custo_unitario)||0)
      consumoPorMP[id].qtd += qtd
      consumoPorMP[id].custo += custo
    }
    const consumoMPList = Object.values(consumoPorMP)
      .sort((a,b) => b.custo - a.custo)

    // VISÃO 2b: CMV por produção × ficha técnica — separado em preps e embalagem
    let custoPorFichaPreps = 0
    let custoPorFichaEmb = 0
    Object.values(prodPorSku).forEach(({ emb, qtd }) => {
      const comps = (prodComps||[]).filter(c => c.sku_produto === emb.codigo)
      const custoPreps = comps.reduce((sc, comp) => {
        const custoPorG = custoPrepPorG(comp.preparacao_id) || 0
        return sc + custoPorG * (parseFloat(comp.quantidade_crua || comp.quantidade_por_unidade)||0)
      }, 0)
      const custoRotulo = parseFloat(emb.custo_unitario)||0
      const custoFilme = custoEmbPorCat[emb.categoria]||0
      custoPorFichaPreps += custoPreps * qtd
      custoPorFichaEmb += (custoRotulo + custoFilme) * qtd
    })
    const custoPorFicha = custoPorFichaPreps + custoPorFichaEmb

    // MP prevista pela ficha SOMENTE nos dias cobertos pela baixa automática
    let fichaPrepsCoberto = 0
    Object.values(prodPorSkuCoberto).forEach(({ emb, qtd }) => {
      const comps = (prodComps||[]).filter(c => c.sku_produto === emb.codigo)
      const custoPreps = comps.reduce((sc, comp) => {
        const custoPorG = custoPrepPorG(comp.preparacao_id) || 0
        return sc + custoPorG * (parseFloat(comp.quantidade_crua || comp.quantidade_por_unidade)||0)
      }, 0)
      fichaPrepsCoberto += custoPreps * qtd
    })

    // Divergência calculada na MESMA janela de datas
    const divergencia = custoConsumoMP > 0 ? custoConsumoMP - fichaPrepsCoberto : null
    const divergenciaPct = fichaPrepsCoberto > 0 && divergencia !== null ? (divergencia / fichaPrepsCoberto * 100) : null
    const coberturaPct = unidadesTotais > 0 ? (unidadesCobertas / unidadesTotais * 100) : 0

    // Percentuais de desperdício configuráveis
    const cfgMap = {}
    for (const c of (cfgDesp||[])) cfgMap[c.chave] = parseFloat(c.valor)||0
    const despMPPct = cfgMap['desperdicio_mp_pct'] ?? 5
    const despEmbPct = cfgMap['desperdicio_embalagem_pct'] ?? 3

    const despMP = custoPorFichaPreps * (despMPPct/100)
    const despEmb = custoPorFichaEmb * (despEmbPct/100)
    const cmvComDesperdicio = custoPorFicha + despMP + despEmb

    setDados({
      produtosUnitario, totalCMVUnitario,
      custoConsumoMP, custoPorFicha, custoPorFichaPreps, custoPorFichaEmb,
      divergencia, divergenciaPct,
      despMPPct, despEmbPct, despMP, despEmb, cmvComDesperdicio,
      fichaPrepsCoberto, coberturaPct, unidadesCobertas, unidadesTotais,
      diasSemConsumo: [...diasSemConsumo].sort(),
      diasComProducao: diasComProducao.size,
      consumoMPList, mesAnterior,
      totalUnidades: Object.values(prodPorSku).reduce((s,p) => s+p.qtd, 0),
      temConsumoMP: (consumoMP||[]).length > 0,
    })
    setLoading(false)
  }

  const labelMes = (m) => new Date(m+'-15').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Header */}
      <div className="card card-pad" style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{fontWeight:800,fontSize:15}}>💰 CMV Mensal</div>
        <div style={{flex:1}}/>
        <div style={{display:'flex',gap:4}}>
          <button className={`btn btn-sm ${visao==='unitario'?'btn-primary':'btn-ghost'}`} onClick={()=>setVisao('unitario')}>
            📦 CMV por Produto
          </button>
          <button className={`btn btn-sm ${visao==='convergencia'?'btn-primary':'btn-ghost'}`} onClick={()=>setVisao('convergencia')}>
            🔀 Convergência MP
          </button>
        </div>
        <input type="month" className="form-input" value={mes}
          onChange={e=>setMes(e.target.value)} style={{width:180,fontSize:13}}/>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : !dados ? null : (
        <>
          {/* VISÃO 1: CMV unitário por produto */}
          {visao === 'unitario' && (
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                {[
                  {label:'Total produzido',valor:`${dados.totalUnidades.toLocaleString('pt-BR')} un`,cor:'var(--gray-700)'},
                  {label:'CMV total do mês',valor:fmtR(dados.totalCMVUnitario),sub:'produção × CMV unitário',cor:'var(--purple)'},
                  {label:'CMV médio/unidade',valor:dados.totalUnidades>0?fmtR(dados.totalCMVUnitario/dados.totalUnidades):'—',cor:'var(--ok)'},
                ].map(k=>(
                  <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
                    <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>{k.label}</div>
                    <div style={{fontSize:20,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
                    {k.sub && <div style={{fontSize:10,color:'var(--gray-400)'}}>{k.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{padding:'10px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:700,fontSize:13,color:'var(--purple)',textTransform:'capitalize'}}>
                  {labelMes(mes)} — CMV por produto unitário
                  {dados.mesAnterior && <span style={{fontSize:11,color:'var(--gray-400)',fontWeight:400,marginLeft:8}}>vs {labelMes(dados.mesAnterior)}</span>}
                </div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                      <th style={{padding:'8px 14px',textAlign:'left'}}>Produto</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>Qtd produzida</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>CMV unitário</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>vs mês ant.</th>
                      <th style={{padding:'8px 10px',textAlign:'right'}}>CMV total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.produtosUnitario.map((p,i) => (
                      <tr key={p.emb.codigo} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                        <td style={{padding:'8px 14px'}}>
                          <div style={{fontWeight:600}}>{p.emb.nome}</div>
                          <div style={{fontSize:10,color:'var(--gray-400)'}}>{p.emb.categoria} · {p.usandoReal && <span style={{color:'var(--ok)'}}>rendimento real</span>}</div>
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right',color:'var(--gray-600)'}}>{p.qtd.toLocaleString('pt-BR')}</td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:p.cmvUnit?'var(--purple)':'var(--gray-300)'}}>
                          {p.cmvUnit ? fmtR(p.cmvUnit) : '—'}
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontSize:12}}>
                          {p.varPct !== null ? (
                            <span style={{fontWeight:700,color:p.varPct>5?'var(--danger)':p.varPct<-5?'var(--ok)':'var(--gray-500)'}}>
                              {p.varPct>0?'▲':'▼'} {Math.abs(p.varPct).toFixed(1)}%
                            </span>
                          ) : <span style={{color:'var(--gray-300)'}}>—</span>}
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontWeight:800,color:'var(--purple)'}}>
                          {p.custoTotal ? fmtR(p.custoTotal) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--purple)'}}>
                      <td colSpan={4} style={{padding:'10px 14px',fontWeight:800,color:'#fff'}}>Total CMV do mês</td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,color:'var(--gold)',fontSize:16}}>{fmtR(dados.totalCMVUnitario)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {/* VISÃO 2: Convergência MP */}
          {visao === 'convergencia' && (
            <>
              {!dados.temConsumoMP && (
                <div style={{padding:'14px 20px',background:'#fff8f0',borderRadius:8,border:'1px solid var(--warning)',fontSize:13,color:'var(--warning)',fontWeight:600}}>
                  ⚠️ Sem dados de consumo real de MP para {labelMes(mes)} — a baixa automática deve estar ativa para acumular esses dados.
                </div>
              )}

              {/* ── PREVISTO vs REALIZADO lado a lado ── */}
              {(() => {
                const prev = {
                  mp: dados.custoPorFichaPreps,
                  emb: dados.custoPorFichaEmb,
                  despMP: dados.despMP,
                  despEmb: dados.despEmb,
                  total: dados.cmvComDesperdicio,
                }
                // Realizado: MP vem do consumo real (já contém o desperdício de fato).
                // Embalagem não tem medição real — usa a ficha e sinaliza.
                const realMP = dados.custoConsumoMP
                const realEmb = dados.custoPorFichaEmb
                const despImplicito = dados.temConsumoMP ? (realMP - dados.fichaPrepsCoberto) : null
                const real = {
                  mp: realMP,
                  emb: realEmb,
                  despMP: despImplicito,
                  despEmb: null,
                  total: realMP + realEmb,
                }
                // Comparação justa: só os dias cobertos pela baixa automática
                const deltaTotal = dados.temConsumoMP ? realMP - dados.fichaPrepsCoberto : null
                const deltaPct = dados.temConsumoMP && dados.fichaPrepsCoberto > 0
                  ? (deltaTotal / dados.fichaPrepsCoberto * 100) : null
                const coberturaOk = (dados.coberturaPct||0) >= 99.5

                const Linha = ({ label, sub, vPrev, vReal, destaque, aviso }) => (
                  <div style={{
                    display:'grid', gridTemplateColumns:'1fr 130px 130px', gap:12, alignItems:'center',
                    padding: destaque ? '12px 16px' : '9px 16px',
                    borderTop: destaque ? '2px solid var(--gray-200)' : '1px solid var(--gray-100)',
                    background: destaque ? 'var(--purple-pale)' : undefined,
                  }}>
                    <div>
                      <div style={{fontWeight: destaque?800:600, fontSize: destaque?15:13,
                        color: destaque?'var(--purple)':aviso?'var(--warning)':undefined}}>{label}</div>
                      {sub && <div style={{fontSize:10,color:'var(--gray-400)'}}>{sub}</div>}
                    </div>
                    <div style={{textAlign:'right', fontWeight: destaque?800:700, fontSize: destaque?16:13,
                      color: destaque?'var(--purple)':aviso?'var(--warning)':'var(--gray-700)'}}>
                      {vPrev === null ? '—' : fmtR(vPrev)}
                    </div>
                    <div style={{textAlign:'right', fontWeight: destaque?800:700, fontSize: destaque?16:13,
                      color: vReal === null ? 'var(--gray-300)' : destaque?'var(--purple)':aviso?'var(--warning)':'var(--gray-700)'}}>
                      {vReal === null ? 'n/d' : `${vReal<0?'−':''}${fmtR(Math.abs(vReal))}`}
                    </div>
                  </div>
                )

                return (
                  <div className="card">
                    {/* Cabeçalho das colunas */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 130px 130px',gap:12,
                      padding:'12px 16px',background:'var(--purple)',color:'#fff'}}>
                      <div style={{fontWeight:800,fontSize:14}}>CMV do mês — Previsto vs Realizado</div>
                      <div style={{textAlign:'right',fontWeight:800,fontSize:12,textTransform:'uppercase',letterSpacing:'.04em'}}>Previsto</div>
                      <div style={{textAlign:'right',fontWeight:800,fontSize:12,textTransform:'uppercase',letterSpacing:'.04em'}}>Realizado</div>
                    </div>

                    <Linha label="Matéria-prima"
                      sub={coberturaOk
                        ? 'previsto = ficha técnica · realizado = débitos reais de estoque'
                        : `medição cobre só ${(dados.coberturaPct||0).toFixed(0)}% do mês — comparação válida na reconciliação abaixo`}
                      vPrev={prev.mp}
                      vReal={dados.temConsumoMP && coberturaOk ? real.mp : null} />

                    <Linha label="Embalagem (rótulo + filmes)"
                      sub="sem medição real — realizado usa a ficha"
                      vPrev={prev.emb} vReal={real.emb} />

                    <Linha label={`Desperdício MP (${dados.despMPPct}% estimado)`}
                      sub="estimativa — o consumo real já contém o desperdício de fato, não soma duas vezes"
                      vPrev={prev.despMP} vReal={null} aviso />

                    <Linha label={`Desperdício embalagem (${dados.despEmbPct}% previsto)`}
                      sub="sem medição real"
                      vPrev={prev.despEmb} vReal={real.despEmb} aviso />

                    <Linha label="CMV Total do mês"
                      vPrev={prev.total}
                      vReal={dados.temConsumoMP && coberturaOk ? real.total : null} destaque />

                    {dados.totalUnidades > 0 && (
                      <div style={{display:'grid',gridTemplateColumns:'1fr 130px 130px',gap:12,
                        padding:'8px 16px',borderTop:'1px solid var(--gray-100)',fontSize:12,color:'var(--gray-500)'}}>
                        <div>CMV médio por unidade ({dados.totalUnidades.toLocaleString('pt-BR')} un produzidas)</div>
                        <div style={{textAlign:'right',fontWeight:700}}>{fmtR(prev.total/dados.totalUnidades)}</div>
                        <div style={{textAlign:'right',fontWeight:700}}>
                          {dados.temConsumoMP && coberturaOk ? fmtR(real.total/dados.totalUnidades) : 'n/d'}
                        </div>
                      </div>
                    )}

                    {/* Aviso de cobertura parcial */}
                    {dados.temConsumoMP && !coberturaOk && (
                      <div style={{margin:'16px 16px 0',padding:'12px 14px',background:'#fff8f0',borderRadius:8,
                        border:'1px solid var(--warning)',fontSize:12,color:'var(--gray-600)',lineHeight:1.6}}>
                        <div style={{fontWeight:800,color:'var(--warning)',marginBottom:4}}>
                          ⚠️ Cobertura parcial da baixa automática — {(dados.coberturaPct||0).toFixed(1)}%
                        </div>
                        {dados.diasSemConsumo?.length > 0 && (
                          <div>
                            Estes dias tiveram produção mas <strong>não</strong> tiveram consumo de MP debitado:{' '}
                            <strong>{dados.diasSemConsumo.map(d => new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})).join(', ')}</strong>
                            {' '}({(dados.unidadesTotais - dados.unidadesCobertas).toLocaleString('pt-BR')} de {dados.unidadesTotais.toLocaleString('pt-BR')} un).
                          </div>
                        )}
                        <div style={{marginTop:4}}>
                          A comparação abaixo usa <strong>apenas os dias cobertos</strong> nos dois lados
                          (ficha: {fmtR(dados.fichaPrepsCoberto)} para {dados.unidadesCobertas.toLocaleString('pt-BR')} un),
                          senão a diferença refletiria só o recorte de datas. A coluna Realizado do CMV Total continua
                          incompleta enquanto esses dias não forem compensados.
                        </div>
                      </div>
                    )}

                    {/* Diagnóstico */}
                    {!dados.temConsumoMP ? (
                      <div style={{margin:16,padding:'12px 14px',background:'#fff8f0',borderRadius:8,
                        border:'1px solid var(--warning)',fontSize:13,color:'var(--warning)'}}>
                        ⚠️ Sem registros de consumo real de MP neste mês — a coluna Realizado não pode ser calculada.
                        A baixa automática precisa estar ativa (Admin → Sistema).
                      </div>
                    ) : (
                      <div style={{margin:16,padding:'12px 16px',borderRadius:8,textAlign:'center',
                        background: Math.abs(deltaPct||0)>10 ? '#fff0f0' : '#f0faf0',
                        border: `1.5px solid ${Math.abs(deltaPct||0)>10 ? 'var(--danger)' : 'var(--ok)'}`}}>
                        <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>
                          MP realizada vs prevista {coberturaOk ? '(mês completo)' : '(apenas dias cobertos)'}
                        </div>
                        <div style={{fontSize:13,color:'var(--gray-600)',margin:'6px 0 2px'}}>
                          Ficha: <strong>{fmtR(dados.fichaPrepsCoberto)}</strong>
                          {'  →  '}
                          Consumo real: <strong>{fmtR(dados.custoConsumoMP)}</strong>
                          <span style={{color:'var(--gray-400)'}}>
                            {' '}({dados.unidadesCobertas?.toLocaleString('pt-BR')} un)
                          </span>
                        </div>
                        <div style={{fontSize:20,fontWeight:800,margin:'4px 0',
                          color: Math.abs(deltaPct||0)>10 ? 'var(--danger)' : 'var(--ok)'}}>
                          {deltaTotal>=0?'+':'−'}{fmtR(Math.abs(deltaTotal||0))} ({Math.abs(deltaPct||0).toFixed(1)}%)
                        </div>
                        <div style={{fontSize:12,color:'var(--gray-500)',maxWidth:640,margin:'6px auto 0',lineHeight:1.5}}>
                          {Math.abs(deltaPct||0) <= 10
                            ? `✅ Consumo real e ficha técnica convergindo${coberturaOk ? '' : ' nos dias cobertos'}. O CMV pode ser considerado confiável.`
                            : deltaTotal > 0
                              ? `🚨 Consumiu MAIS do que a ficha previa. Se o excedente for parecido com o desperdício configurado (${dados.despMPPct}%), é desperdício normal. Acima disso: rendimento real pior que o cadastrado, quantidades subestimadas nas fichas, ou baixa duplicada.`
                              : '🚨 Consumiu MENOS do que a ficha previa mesmo nos dias cobertos. Causas prováveis: SKUs produzidos sem composição cadastrada (não debitam nada), ou quantidades superestimadas nas fichas técnicas.'}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Detalhamento por MP consumida */}
              {dados.temConsumoMP && (
                <div className="card">
                  <div style={{padding:'10px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:700,fontSize:13,color:'var(--purple)'}}>
                    Consumo real de MP — {labelMes(mes)}
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                    <thead>
                      <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                        <th style={{padding:'8px 14px',textAlign:'left'}}>Matéria-prima</th>
                        <th style={{padding:'8px 10px',textAlign:'right'}}>Qty consumida</th>
                        <th style={{padding:'8px 10px',textAlign:'right'}}>Preço/un</th>
                        <th style={{padding:'8px 10px',textAlign:'right'}}>Custo total</th>
                        <th style={{padding:'8px 10px',textAlign:'right'}}>% do total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.consumoMPList.map((c,i) => (
                        <tr key={c.mp?.id||i} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                          <td style={{padding:'8px 14px',fontWeight:600}}>{c.mp?.nome||'—'}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',color:'var(--gray-600)'}}>
                            {c.qtd>=1000?`${(c.qtd/1000).toFixed(2)} kg`:`${c.qtd.toFixed(1)} ${c.mp?.unidade||''}`}
                          </td>
                          <td style={{padding:'8px 10px',textAlign:'right',color:'var(--gray-500)',fontSize:12}}>
                            {fmtR(parseFloat(c.mp?.custo_unitario)||0)}/{c.mp?.unidade}
                          </td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>
                            {fmtR(c.custo)}
                          </td>
                          <td style={{padding:'8px 10px',textAlign:'right'}}>
                            <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
                              <div style={{width:50,height:5,background:'var(--gray-100)',borderRadius:3}}>
                                <div style={{height:'100%',width:`${Math.min(100,dados.custoConsumoMP>0?c.custo/dados.custoConsumoMP*100:0)}%`,background:'var(--purple)',borderRadius:3}}/>
                              </div>
                              <span style={{fontSize:11,color:'var(--gray-500)',minWidth:32,textAlign:'right'}}>
                                {dados.custoConsumoMP>0?(c.custo/dados.custoConsumoMP*100).toFixed(1):0}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:'2px solid var(--gray-200)',background:'var(--purple)'}}>
                        <td colSpan={3} style={{padding:'10px 14px',fontWeight:800,color:'#fff'}}>Total consumo MP</td>
                        <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,color:'var(--gold)',fontSize:16}}>{fmtR(dados.custoConsumoMP)}</td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Conferência de Matéria-Prima ──────────────────────────────────────────────
function ConferenciaMP() {
  const [mps, setMps] = useState([])
  const [contagens, setContagens] = useState({})
  const [responsavel, setResponsavel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [historico, setHistorico] = useState([])
  const [aba, setAba] = useState('conferir')
  const [catFiltro, setCatFiltro] = useState('todas')
  const [editando, setEditando] = useState(null)
  const [editQtd, setEditQtd] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('materias_primas')
      .select('id,nome,unidade,categoria,estoque_atual,custo_unitario')
      .eq('ativo', true)
      .order('categoria').order('nome')
    setMps(data||[])
    setLoading(false)
  }

  async function loadHistorico() {
    const { data } = await supabase.from('conferencia_mp')
      .select('*, materias_primas(nome,unidade,categoria)')
      .order('criado_em', { ascending: false })
      .limit(200)
    setHistorico(data||[])
  }

  useEffect(() => { load(); loadHistorico() }, [])

  async function confirmar() {
    const lancados = mps.filter(m => contagens[m.id] !== undefined && contagens[m.id] !== '')
    if (!lancados.length) { alert('Nenhuma contagem lançada.'); return }
    setSaving(true)
    const hoje = new Date().toISOString().slice(0,10)

    for (const mp of lancados) {
      const contado = parseFloat(contagens[mp.id])
      const sistema = parseFloat(mp.estoque_atual)||0

      const { error } = await supabase.from('conferencia_mp').insert({
        materia_prima_id: mp.id,
        data_conferencia: hoje,
        estoque_sistema: sistema,
        estoque_contado: contado,
        custo_unitario: parseFloat(mp.custo_unitario)||0,
        responsavel: responsavel || null,
        observacao: `Conferência física — sistema: ${sistema}, contado: ${contado}`,
      })
      if (error) { console.error('Erro conferência MP:', error); continue }

      await supabase.from('materias_primas')
        .update({ estoque_atual: contado, atualizado_em: new Date().toISOString() })
        .eq('id', mp.id)
    }

    setSaving(false)
    setContagens({})
    await load()
    await loadHistorico()
    setAba('historico')
  }

  async function excluir(c) {
    if (!window.confirm(`Excluir conferência de ${c.materias_primas?.nome}?\n\nO estoque voltará para ${fmt(c.estoque_sistema,1)} ${c.materias_primas?.unidade}.`)) return
    await supabase.from('materias_primas')
      .update({ estoque_atual: c.estoque_sistema, atualizado_em: new Date().toISOString() })
      .eq('id', c.materia_prima_id)
    await supabase.from('conferencia_mp').delete().eq('id', c.id)
    await load(); await loadHistorico()
  }

  async function salvarEdicao() {
    if (!editando || editQtd === '') return
    const nova = parseFloat(editQtd)
    await supabase.from('conferencia_mp').update({ estoque_contado: nova }).eq('id', editando.id)
    await supabase.from('materias_primas')
      .update({ estoque_atual: nova, atualizado_em: new Date().toISOString() })
      .eq('id', editando.materia_prima_id)
    setEditando(null); setEditQtd('')
    await load(); await loadHistorico()
  }

  const cats = ['todas', ...new Set(mps.map(m => m.categoria).filter(Boolean))]
  const filtradas = mps.filter(m => catFiltro === 'todas' || m.categoria === catFiltro)
  const lancados = mps.filter(m => contagens[m.id] !== undefined && contagens[m.id] !== '')
  const comDiferenca = lancados.filter(m => parseFloat(contagens[m.id]) !== (parseFloat(m.estoque_atual)||0))
  const impactoFinanceiro = lancados.reduce((s,m) => {
    const diff = parseFloat(contagens[m.id]) - (parseFloat(m.estoque_atual)||0)
    return s + diff * (parseFloat(m.custo_unitario)||0)
  }, 0)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',gap:6}}>
        <button className={`btn btn-sm ${aba==='conferir'?'btn-primary':'btn-ghost'}`} onClick={()=>setAba('conferir')}>
          🔍 Conferir estoque
        </button>
        <button className={`btn btn-sm ${aba==='historico'?'btn-primary':'btn-ghost'}`} onClick={()=>setAba('historico')}>
          📋 Histórico
        </button>
      </div>

      {aba === 'conferir' && (
        <>
          <div className="card card-pad" style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
            <div>
              <div style={{fontWeight:800,fontSize:14}}>🔍 Conferência de Matéria-Prima</div>
              <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>
                Digite a contagem física. Só os itens preenchidos serão ajustados.
              </div>
            </div>
            <div style={{flex:1}}/>
            <select className="form-input" value={catFiltro} onChange={e=>setCatFiltro(e.target.value)} style={{width:180,fontSize:13}}>
              {cats.map(c=><option key={c} value={c}>{c==='todas'?'Todas as categorias':c}</option>)}
            </select>
            <input className="form-input" placeholder="Responsável" value={responsavel}
              onChange={e=>setResponsavel(e.target.value)} style={{width:180,fontSize:13}}/>
            <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13}/></button>
          </div>

          {lancados.length > 0 && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {[
                {label:'Itens conferidos',valor:lancados.length,cor:'var(--purple)'},
                {label:'Com divergência',valor:comDiferenca.length,cor:comDiferenca.length>0?'var(--danger)':'var(--ok)'},
                {label:'Impacto financeiro',valor:`${impactoFinanceiro>=0?'+':'−'}${fmtR(Math.abs(impactoFinanceiro))}`,
                  cor:Math.abs(impactoFinanceiro)<1?'var(--ok)':impactoFinanceiro<0?'var(--danger)':'var(--warning)'},
              ].map(k=>(
                <div key={k.label} className="card card-pad" style={{textAlign:'center'}}>
                  <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>{k.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:k.cor,margin:'4px 0'}}>{k.valor}</div>
                </div>
              ))}
            </div>
          )}

          {loading ? <div className="loading"><RefreshCw size={14} className="spin"/></div> : (
            <div className="card">
              {[...new Set(filtradas.map(m=>m.categoria))].map(cat => (
                <div key={cat}>
                  <div style={{padding:'8px 20px',background:'var(--gray-50)',borderTop:'1px solid var(--gray-200)',
                    fontWeight:800,fontSize:12,color:'var(--gray-600)',textTransform:'uppercase',letterSpacing:'.05em'}}>
                    {cat}
                  </div>
                  {filtradas.filter(m=>m.categoria===cat).map((m,i) => {
                    const contado = contagens[m.id]
                    const tem = contado !== undefined && contado !== ''
                    const sistema = parseFloat(m.estoque_atual)||0
                    const diff = tem ? parseFloat(contado) - sistema : null
                    const diverge = diff !== null && Math.abs(diff) > 0.001
                    const impacto = diff !== null ? diff * (parseFloat(m.custo_unitario)||0) : null
                    return (
                      <div key={m.id} style={{
                        padding:'10px 20px',
                        display:'grid',gridTemplateColumns:'1fr 120px 130px 150px',
                        gap:12,alignItems:'center',
                        borderTop:'1px solid var(--gray-100)',
                        background: diverge?'#fff5f5':tem?'#f0faf0':i%2===0?'#fff':'#fafafa',
                      }}>
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{m.nome}</div>
                          <div style={{fontSize:11,color:'var(--gray-400)'}}>
                            {fmtR(parseFloat(m.custo_unitario)||0)}/{m.unidade}
                          </div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>Sistema</div>
                          <div style={{fontWeight:700,fontSize:14}}>{fmt(sistema,1)} {m.unidade}</div>
                        </div>
                        <div>
                          <input type="number" step={0.001} min={0}
                            value={contagens[m.id]||''}
                            onChange={ev=>setContagens(p=>({...p,[m.id]:ev.target.value}))}
                            placeholder={`Contagem (${m.unidade})`}
                            style={{
                              width:'100%',padding:'6px 10px',fontSize:13,textAlign:'right',
                              border:`1.5px solid ${diverge?'var(--danger)':tem?'var(--ok)':'var(--gray-200)'}`,
                              borderRadius:6,outline:'none',
                              background:diverge?'#fff0f0':tem?'#f0faf0':'#fff',
                            }}/>
                        </div>
                        <div style={{textAlign:'right'}}>
                          {diff !== null && (
                            <>
                              <div style={{fontWeight:800,fontSize:13,
                                color:diff>0?'var(--ok)':diff<0?'var(--danger)':'var(--gray-400)'}}>
                                {diff>0?'+':''}{fmt(diff,1)} {m.unidade}
                                {!diverge && ' ✓'}
                              </div>
                              {diverge && (
                                <div style={{fontSize:11,color:'var(--gray-500)'}}>
                                  {impacto>=0?'+':'−'}{fmtR(Math.abs(impacto))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {lancados.length > 0 && (
            <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>setContagens({})}>Limpar</button>
              <button className="btn btn-primary" onClick={confirmar} disabled={saving}>
                {saving ? <><RefreshCw size={14} className="spin"/> Salvando...</>
                        : <>✓ Confirmar e ajustar estoque ({lancados.length} itens)</>}
              </button>
            </div>
          )}
        </>
      )}

      {aba === 'historico' && (
        <>
          {editando && (
            <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditando(null)}>
              <div className="modal" style={{maxWidth:400}}>
                <div className="modal-header">
                  <div>
                    <div className="modal-title">✏️ Editar Contagem</div>
                    <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>{editando.materias_primas?.nome}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setEditando(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div style={{display:'flex',gap:16,marginBottom:16,padding:'10px 14px',background:'var(--purple-pale)',borderRadius:8,fontSize:13}}>
                    <div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>Sistema na época</div>
                      <div style={{fontWeight:700}}>{fmt(editando.estoque_sistema,1)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:'var(--gray-400)'}}>Contado</div>
                      <div style={{fontWeight:700}}>{fmt(editando.estoque_contado,1)}</div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nova contagem ({editando.materias_primas?.unidade})</label>
                    <input type="number" step={0.001} min={0} className="form-input" value={editQtd}
                      onChange={e=>setEditQtd(e.target.value)} autoFocus/>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-ghost" onClick={()=>setEditando(null)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={salvarEdicao} disabled={editQtd===''}>
                    <Save size={14}/> Salvar
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:800,fontSize:15}}>
              📋 Histórico de Conferências de MP
            </div>
            {historico.length === 0 ? (
              <div style={{padding:40,textAlign:'center',color:'var(--gray-300)'}}>Nenhuma conferência registrada ainda.</div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
                    <th style={{padding:'9px 14px',textAlign:'left'}}>Data</th>
                    <th style={{padding:'9px 14px',textAlign:'left'}}>Matéria-prima</th>
                    <th style={{padding:'9px 10px',textAlign:'right'}}>Sistema</th>
                    <th style={{padding:'9px 10px',textAlign:'right'}}>Contado</th>
                    <th style={{padding:'9px 10px',textAlign:'right'}}>Diferença</th>
                    <th style={{padding:'9px 10px',textAlign:'right'}}>Impacto R$</th>
                    <th style={{padding:'9px 14px',textAlign:'left'}}>Responsável</th>
                    <th style={{padding:'9px 10px',width:70}}></th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((c,i) => {
                    const diff = parseFloat(c.estoque_contado) - parseFloat(c.estoque_sistema)
                    const impacto = diff * (parseFloat(c.custo_unitario)||0)
                    return (
                      <tr key={c.id} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                        <td style={{padding:'8px 14px',color:'var(--gray-500)',fontSize:12}}>
                          {new Date(c.data_conferencia+'T12:00:00').toLocaleDateString('pt-BR')}
                        </td>
                        <td style={{padding:'8px 14px'}}>
                          <div style={{fontWeight:600}}>{c.materias_primas?.nome}</div>
                          <div style={{fontSize:10,color:'var(--gray-400)'}}>{c.materias_primas?.categoria}</div>
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right'}}>{fmt(c.estoque_sistema,1)}</td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700}}>{fmt(c.estoque_contado,1)}</td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontWeight:800,
                          color:diff>0?'var(--ok)':diff<0?'var(--danger)':'var(--gray-400)'}}>
                          {diff>0?'+':''}{fmt(diff,1)}
                        </td>
                        <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,
                          color:Math.abs(impacto)<0.01?'var(--gray-400)':impacto<0?'var(--danger)':'var(--ok)'}}>
                          {Math.abs(impacto)<0.01?'—':`${impacto>=0?'+':'−'}${fmtR(Math.abs(impacto))}`}
                        </td>
                        <td style={{padding:'8px 14px',color:'var(--gray-500)'}}>{c.responsavel||'—'}</td>
                        <td style={{padding:'8px 10px',textAlign:'center'}}>
                          <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                            <button className="btn btn-ghost btn-sm"
                              onClick={()=>{setEditando(c);setEditQtd(String(c.estoque_contado))}} title="Editar">
                              <Pencil size={11}/>
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={()=>excluir(c)}
                              style={{color:'var(--danger)'}} title="Excluir">✕</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
