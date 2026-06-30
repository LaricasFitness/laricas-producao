import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Upload, RefreshCw, Download, FileText, CheckCircle, AlertTriangle, Search, Plus } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'

const PICKUP = {
  endereco: 'R. Pedroso 258 - Bela Vista São Paulo/SP 01322-010',
  nome: 'Fabio Gabriel', tel: '11 93415 7853', obs: 'LARICAS FITNESS',
}

function formatCEP(v) {
  if (!v) return ''
  const s = String(Math.round(Number(String(v).replace(/\D/g,'')) || 0)).padStart(8,'0')
  return `${s.slice(0,5)}-${s.slice(5)}`
}
function formatTel(v) { return v ? String(v).replace(/\D/g,'').replace(/^55/,'') : '' }

function getZone(cidade='', cepNum='') {
  const c = cidade.toLowerCase()
  if (c.includes('barueri') || c.includes('santana de parnaíba') || c.includes('cajamar')) return 'Alphaville'
  if (c.includes('guarulhos')) return 'Guarulhos'
  if (c.includes('santo andré')) return 'ABC — Santo André'
  if (c.includes('são bernardo') || c.includes('diadema')) return 'ABC — São Bernardo'
  if (c.includes('osasco')) return 'Osasco'
  const p = parseInt((cepNum||'').replace(/\D/g,'').slice(0,5)) || 0
  if (p<=1999) return 'Centro'
  if (p<=2999) return 'Norte'
  if (p<=3999) return 'Zona Leste'
  if (p<=4999) return 'Zona Sul'
  if (p<=5999) return 'Zona Oeste'
  if (p<=8999) return 'Zona Leste Ext.'
  return 'Outro'
}

function buildRoutes(orders) {
  const byZone = {}
  for (const o of orders) {
    const zone = getZone(o.cidade, o.cepNum)
    if (!byZone[zone]) byZone[zone] = []
    byZone[zone].push(o)
  }
  for (const z of Object.values(byZone)) z.sort((a,b)=>(a.cepNum||'').localeCompare(b.cepNum||''))
  const routes = [], MAX = 5
  for (const [zone, ords] of Object.entries(byZone)) {
    for (let i = 0; i < ords.length; i += MAX) routes.push({ label: zone, stops: ords.slice(i,i+MAX) })
  }
  return routes.map((r,i) => ({ ...r, code: String(i+1).padStart(2,'0') }))
}

function parseCSVRobusto(texto) {
  const rows = []; let col='', row=[], inQuote=false
  const clean = texto.replace(/^\uFEFF/,'')
  for (let i=0; i<clean.length; i++) {
    const c=clean[i], next=clean[i+1]
    if (inQuote) {
      if (c==='"'&&next==='"') { col+='"'; i++ }
      else if (c==='"') inQuote=false
      else col+=c
    } else {
      if (c==='"') inQuote=true
      else if (c===';') { row.push(col.trim()); col='' }
      else if (c==='\n') { row.push(col.trim()); if (row.some(Boolean)) rows.push(row); row=[]; col='' }
      else if (c!=='\r') col+=c
    }
  }
  if (col||row.length) { row.push(col.trim()); if (row.some(Boolean)) rows.push(row) }
  return rows
}

function parsearLogisticaCSV(texto, datasFiltro) {
  const rows = parseCSVRobusto(texto)
  if (rows.length<2) return []
  const header = rows[0].map(h=>h.replace(/^"|"$/g,'').trim())
  const idx = n => header.indexOf(n)
  const pedidosMap = {}
  const datas = Array.isArray(datasFiltro) ? datasFiltro : (datasFiltro ? [datasFiltro] : [])
  for (const cols of rows.slice(1)) {
    const get = i => (i>=0&&i<cols.length ? cols[i] : '')
    if (!get(idx('Transportadora')).toUpperCase().includes('LALAMOVE')) continue
    const dataPrev = get(idx('Data Prevista')).trim()
    if (datas.length && !datas.includes(dataPrev)) continue
    const numPedido = get(idx('Número pedido')).trim()
    if (!numPedido) continue
    const sku = get(idx('SKU')).trim()
    const qtd = parseFloat(get(idx('Quantidade')).replace(',','.')) || 0
    if (!pedidosMap[numPedido]) {
      const cepRaw = get(idx('CEP Entrega')).trim()
      const cepNum = String(Math.round(Number(cepRaw.replace(/\D/g,''))||0)).padStart(8,'0')
      pedidosMap[numPedido] = {
        id: numPedido,
        nome: get(idx('Nome Entrega')).trim() || get(idx('Nome Comprador')).trim(),
        rua: get(idx('Endereço Entrega')).trim(),
        numero: get(idx('Número Entrega')).trim(),
        complemento: get(idx('Complemento Entrega')).trim(),
        bairro: get(idx('Bairro Entrega')).trim(),
        cidade: get(idx('Cidade Entrega')).trim(),
        uf: get(idx('UF Entrega')).trim(),
        cep: formatCEP(cepRaw), cepNum,
        tel: formatTel(get(idx('Celular Comprador'))),
        cpfCnpj: get(idx('CPF/CNPJ Comprador')).trim(),
        dataPrevista: dataPrev,
        itens: [], excluir: false,
      }
    }
    if (sku && qtd>0) pedidosMap[numPedido].itens.push({ sku, qtd })
  }
  return Object.values(pedidosMap)
}

function parsearTodosOsPedidos(texto, datasFiltro) {
  const rows = parseCSVRobusto(texto)
  if (rows.length<2) return {}
  const header = rows[0].map(h=>h.replace(/^"|"$/g,'').trim())
  const idx = n => header.indexOf(n)
  const pedidosMap = {}
  const datas = Array.isArray(datasFiltro) ? datasFiltro : (datasFiltro ? [datasFiltro] : [])
  for (const cols of rows.slice(1)) {
    const get = i => (i>=0&&i<cols.length ? cols[i] : '')
    const dataPrev = get(idx('Data Prevista')).trim()
    if (datas.length && !datas.includes(dataPrev)) continue
    const numPedido = get(idx('Número pedido')).trim()
    if (!numPedido) continue
    const transportadora = get(idx('Transportadora')).trim() || 'Sem transportadora'
    const sku = get(idx('SKU')).trim()
    const qtd = parseFloat(get(idx('Quantidade')).replace(',','.')) || 0
    if (!pedidosMap[numPedido]) {
      pedidosMap[numPedido] = {
        id: numPedido,
        nome: get(idx('Nome Entrega')).trim() || get(idx('Nome Comprador')).trim(),
        transportadora,
        itens: [],
      }
    }
    if (sku && qtd>0) pedidosMap[numPedido].itens.push({ sku, qtd: Math.round(qtd) })
  }
  return pedidosMap
}

function gerarPDFConferencia(csvTexto, dataFiltro, dateStr) {
  const pedidosMap = parsearTodosOsPedidos(csvTexto, dataFiltro)
  const todos = Object.values(pedidosMap)
  if (!todos.length) { alert('Nenhum pedido encontrado para esta data.'); return }

  // Agrupa por transportadora
  const porTransp = {}
  for (const p of todos) {
    const t = p.transportadora
    if (!porTransp[t]) porTransp[t] = []
    porTransp[t].push(p)
  }

  const doc = new jsPDF()
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const totalPedidos = todos.length
  const totalItens = todos.reduce((s,p) => s + p.itens.reduce((si,i) => si+i.qtd, 0), 0)

  // Header
  doc.setFillColor(82, 46, 100)
  doc.rect(0, 0, 210, 36, 'F')
  doc.setTextColor(234, 183, 130)
  doc.setFontSize(16); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness — Conferência de Expedição', 14, 14)
  doc.setFontSize(9); doc.setFont(undefined, 'normal')
  doc.setTextColor(255, 255, 255)
  doc.text(`Data: ${dateStr}   |   ${totalPedidos} pedidos   |   ${totalItens} unidades no total`, 14, 22)
  doc.text(`Impresso: ${agora}`, 14, 29)

  let y = 42

  for (const [transp, pedidos] of Object.entries(porTransp).sort()) {
    const totalT = pedidos.reduce((s,p) => s + p.itens.reduce((si,i) => si+i.qtd, 0), 0)

    // Header da transportadora
    doc.setFillColor(50, 50, 50)
    doc.rect(14, y, 182, 8, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9); doc.setFont(undefined, 'bold')
    doc.text(`${transp.toUpperCase()}   —   ${pedidos.length} pedido${pedidos.length>1?'s':''}   |   ${totalT} un.`, 17, y+5.5)
    y += 10

    const body = pedidos.map((p, i) => {
      const totalQtd = p.itens.reduce((s,it) => s+it.qtd, 0)
      const resumoItens = p.itens.length > 0
        ? p.itens.map(it => `${it.sku}: ${it.qtd}`).join(', ')
        : '—'
      return [
        { content: '☐', styles: { halign:'center', fontSize:11 } },
        String(i+1),
        `#${p.id}`,
        p.nome || '—',
        { content: String(totalQtd), styles: { halign:'center', fontStyle:'bold' } },
        { content: resumoItens, styles: { fontSize:7, textColor:[100,100,100] } },
      ]
    })

    autoTable(doc, {
      startY: y,
      head: [[
        { content: '✓', styles:{ halign:'center', cellWidth:10 } },
        { content: '#', styles:{ cellWidth:8 } },
        { content: 'Pedido', styles:{ cellWidth:28 } },
        { content: 'Cliente', styles:{ cellWidth:60 } },
        { content: 'Un.', styles:{ halign:'center', cellWidth:14 } },
        { content: 'Itens (SKU: qtd)', styles:{} },
      ]],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor:[230,225,240], textColor:[60,30,80], fontStyle:'bold', fontSize:8 },
      alternateRowStyles: { fillColor:[250,248,255] },
      columnStyles: {
        0: { cellWidth:10, halign:'center' },
        1: { cellWidth:8 },
        2: { cellWidth:28 },
        3: { cellWidth:60 },
        4: { cellWidth:14, halign:'center' },
      },
      margin: { left:14, right:14 },
    })

    y = doc.lastAutoTable.finalY + 8
    if (y > 260) { doc.addPage(); y = 14 }
  }

  // Rodapé
  const pageCount = doc.getNumberOfPages()
  for (let i=1; i<=pageCount; i++) {
    doc.setPage(i)
    doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(150,150,150)
    doc.text(`Laricas Fitness · Conferência de Expedição · ${dateStr} · Página ${i}/${pageCount}`, 14, 291)
  }

  doc.save(`Conferencia_Expedicao_${dateStr.replace(/\//g,'-')}.pdf`)
}

function buildLalamoveCSV(route) {
  const esc = s => s&&s.includes(',') ? `"${s}"` : (s||'')
  const rows = [
    ['1. Endereço','2. Nome','3. Telefone','4. Bloco/piso'],
    ['-','','',''],
    [PICKUP.endereco, PICKUP.nome, PICKUP.tel, PICKUP.obs],
  ]
  for (const stop of route.stops) {
    const addr = `${stop.rua} ${stop.numero}  ${stop.bairro} ${stop.cidade}/${stop.uf} CEP ${stop.cep}`
    rows.push([addr, stop.nome, stop.tel||'', stop.complemento||''])
  }
  return rows.map(r=>r.map(esc).join(',')).join('\r\n')
}

function downloadCSV(content, filename) {
  const blob = new Blob(['\uFEFF'+content], { type:'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click()
  URL.revokeObjectURL(url)
}

async function downloadAllCSVs(routes, dateStr) {
  const zip = new JSZip()
  for (const r of routes) zip.file(`R${r.code}_${r.label.replace(/[^a-zA-Z0-9]/g,'_')}.csv`, '\uFEFF'+buildLalamoveCSV(r))
  const blob = await zip.generateAsync({ type:'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`Roteiros_LALAMOVE_${dateStr}.zip`; a.click()
  URL.revokeObjectURL(url)
}

function gerarPDFRoteiro(routes, dateStr) {
  const doc = new jsPDF()
  const total = routes.reduce((s,r)=>s+r.stops.length,0)
  doc.setFillColor(82,46,100); doc.rect(0,0,210,32,'F')
  doc.setTextColor(234,183,130); doc.setFontSize(16); doc.setFont(undefined,'bold')
  doc.text('Laricas Fitness — Roteiro LALAMOVE', 14, 14)
  doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(255,255,255)
  doc.text(`Data: ${dateStr} · ${routes.length} rotas · ${total} paradas`, 14, 22)
  doc.text(`Gerado: ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`, 14, 28)
  let y=38
  for (const r of routes) {
    doc.setFillColor(21,101,192); doc.rect(14,y,182,7,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont(undefined,'bold')
    doc.text(`ROTA ${r.code} — ${r.label}  (${r.stops.length} parada${r.stops.length>1?'s':''})`, 16, y+5)
    y+=9
    autoTable(doc, {
      startY: y,
      head: [['#','Pedido','Destinatário','Endereço']],
      body: r.stops.map((stop,idx)=>[
        String(idx+1), `#${stop.id}`, stop.nome,
        `${stop.rua}, ${stop.numero}${stop.complemento?` - ${stop.complemento}`:''}\n${stop.bairro} · ${stop.cidade}/${stop.uf} · CEP ${stop.cep}${stop.tel?`\nTel: ${stop.tel}`:''}`,
      ]),
      styles: { fontSize:8, cellPadding:2.5 },
      headStyles: { fillColor:[200,220,255], textColor:[21,101,192], fontStyle:'bold', fontSize:8 },
      alternateRowStyles: { fillColor:[249,250,255] },
      columnStyles: { 0:{cellWidth:8,halign:'center'}, 1:{cellWidth:20}, 2:{cellWidth:50}, 3:{cellWidth:104} },
      margin: { left:14, right:14 },
    })
    y = doc.lastAutoTable.finalY + 6
    if (y>260 && routes.indexOf(r)<routes.length-1) { doc.addPage(); y=14 }
  }
  doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(150,150,150)
  doc.text(`LALAMOVE · ${routes.length} rotas · ${total} paradas`, 14, doc.internal.pageSize.height-8)
  doc.save(`Roteiro_LALAMOVE_${dateStr.replace(/\//g,'-')}.pdf`)
}

// ── Salvar histórico no Supabase ──────────────────────────────────────────────
async function salvarHistorico(routes, dateStr) {
  try {
    const dataIso = dateStr.split('/').reverse().join('-')
    const { data: rota, error } = await supabase
      .from('rotas_historico').insert({ data_roteiro: dataIso }).select().single()
    if (error) throw error
    const paradas = []
    for (const r of routes) {
      for (const stop of r.stops) {
        paradas.push({
          rota_id: rota.id, rota_code: r.code, rota_label: r.label,
          numero_pedido: stop.id, nome: stop.nome, rua: stop.rua, numero: stop.numero,
          complemento: stop.complemento||null, bairro: stop.bairro,
          cidade: stop.cidade, uf: stop.uf, cep: stop.cep, tel: stop.tel||null,
        })
      }
    }
    if (paradas.length) await supabase.from('rotas_historico_paradas').insert(paradas)
  } catch(e) { console.error('Erro ao salvar histórico:', e) }
}

// ── Componente ────────────────────────────────────────────────────────────────
export default function Logistica({ csvInicial }) {
  const amanha = new Date(); amanha.setDate(amanha.getDate()+1)
  const [datasFiltro, setDatasFiltro] = useState([amanha.toLocaleDateString('pt-BR')])
  const [novaData, setNovaData] = useState('')
  const [step, setStep] = useState('upload')
  const [orders, setOrders] = useState([])
  const [routes, setRoutes] = useState([])
  const [csvRaw, setCsvRaw] = useState(null)
  const [manualAddr, setManualAddr] = useState({})
  const [enderecoCache, setEnderecoCache] = useState({})
  const [sugestoes, setSugestoes] = useState({})
  const [importando, setImportando] = useState(false)
  // Busca por pedido
  const [buscaPedido, setBuscaPedido] = useState('')
  const [resultadoBusca, setResultadoBusca] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const fileRef = useRef()

  function addData() {
    if (!novaData.trim()) return
    if (!datasFiltro.includes(novaData)) setDatasFiltro(prev => [...prev, novaData].sort())
    setNovaData('')
  }
  function removeData(d) {
    setDatasFiltro(prev => prev.filter(x => x !== d))
  }

  useEffect(() => {
    supabase.from('enderecos_cache').select('*').then(({ data }) => {
      const map = {}; for (const r of (data||[])) map[r.cpf_cnpj]=r; setEnderecoCache(map)
    })
  }, [])

  useEffect(() => {
    if (csvInicial) {
      setCsvRaw(csvInicial)
      processarTextoCSV(csvInicial)
    }
  }, [csvInicial])

  function processarTextoCSV(texto) {
    setImportando(true)
    try {
      const parsed = parsearLogisticaCSV(texto, datasFiltro)
      aplicarParsed(parsed)
    } catch(e) { alert('Erro: '+e.message) }
    setImportando(false)
  }

  function aplicarParsed(parsed) {
    const sugs = {}
    for (const o of parsed) {
      if (o.cpfCnpj && enderecoCache[o.cpfCnpj] && !o.rua) sugs[o.id]=enderecoCache[o.cpfCnpj]
    }
    setSugestoes(sugs); setOrders(parsed)
    const missing = parsed.filter(o=>!o.rua&&!sugs[o.id])
    setManualAddr(Object.fromEntries(missing.map(o=>[o.id,{rua:'',numero:'',complemento:'',bairro:'',cidade:'',uf:'',cep:'',tel:o.tel||''}])))
    setStep(missing.length>0||Object.keys(sugs).length>0?'review':'ready')
    if (missing.length===0&&Object.keys(sugs).length===0) {
      setRoutes(buildRoutes(parsed.filter(o=>!o.excluir)))
    }
  }

  function handleFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
      setCsvRaw(e.target.result)
      processarTextoCSV(e.target.result)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function aceitarSugestao(id) {
    const sug = sugestoes[id]
    setOrders(prev=>prev.map(o=>o.id===id?{...o,...sug}:o))
    setSugestoes(prev=>{const n={...prev};delete n[id];return n})
  }
  function rejeitarSugestao(id) {
    const o = orders.find(x=>x.id===id)
    setSugestoes(prev=>{const n={...prev};delete n[id];return n})
    setManualAddr(prev=>({...prev,[id]:{rua:'',numero:'',complemento:'',bairro:'',cidade:o?.cidade||'',uf:o?.uf||'',cep:'',tel:o?.tel||''}}))
  }
  function toggleExcluir(id) { setOrders(prev=>prev.map(o=>o.id===id?{...o,excluir:!o.excluir}:o)) }
  function updManual(id,field,val) { setManualAddr(prev=>({...prev,[id]:{...prev[id],[field]:val}})) }

  async function confirmarEGerar() {
    let merged = orders.map(o=>manualAddr[o.id]?{...o,...manualAddr[o.id]}:o)
    for (const o of merged) {
      if (o.cpfCnpj && manualAddr[o.id]?.rua) {
        await supabase.from('enderecos_cache').upsert({
          cpf_cnpj:o.cpfCnpj, nome:o.nome, rua:o.rua, numero:o.numero,
          complemento:o.complemento, bairro:o.bairro, cidade:o.cidade, uf:o.uf, cep:o.cep, tel:o.tel,
          atualizado_em:new Date().toISOString(),
        },{ onConflict:'cpf_cnpj' })
      }
    }
    const built = buildRoutes(merged.filter(o=>!o.excluir))
    setRoutes(built); setStep('ready')
  }

  async function exportarTudo(rs) {
    await downloadAllCSVs(rs, dateStr.replace(/\//g,'-'))
    await salvarHistorico(rs, dateStr)
  }

  async function exportarPDF(rs) {
    gerarPDFRoteiro(rs, dateStr)
    await salvarHistorico(rs, dateStr)
  }

  async function buscarPedido() {
    if (!buscaPedido.trim()) return
    setBuscando(true)
    const dez = new Date(); dez.setDate(dez.getDate()-10)
    const { data } = await supabase
      .from('rotas_historico_paradas')
      .select('*, rota:rota_id(data_roteiro, criado_em)')
      .eq('numero_pedido', buscaPedido.trim())
      .gte('rota.data_roteiro', dez.toISOString().slice(0,10))
      .order('criado_em', { ascending: false })
    setResultadoBusca(data||[])
    setBuscando(false)
  }

  function reincluirParada(parada) {
    // Adiciona a parada como um novo pedido no roteiro atual
    const novoStop = {
      id: parada.numero_pedido, nome: parada.nome,
      rua: parada.rua, numero: parada.numero, complemento: parada.complemento||'',
      bairro: parada.bairro, cidade: parada.cidade, uf: parada.uf,
      cep: parada.cep, cepNum: (parada.cep||'').replace(/\D/g,''),
      tel: parada.tel||'', cpfCnpj:'', itens:[], excluir:false,
    }
    // Adiciona na rota da zona correta ou cria nova
    const zona = getZone(novoStop.cidade, novoStop.cepNum)
    setRoutes(prev => {
      const rotaExistente = prev.find(r => r.label === zona && r.stops.length < 5)
      let novas
      if (rotaExistente) {
        novas = prev.map(r => r === rotaExistente ? { ...r, stops: [...r.stops, novoStop] } : r)
      } else {
        novas = [...prev, { label: zona, stops: [novoStop] }]
      }
      return novas.map((r,i) => ({ ...r, code: String(i+1).padStart(2,'0') }))
    })
    setResultadoBusca(null); setBuscaPedido('')
    alert(`Pedido #${parada.numero_pedido} incluído na rota ${zona}.`)
  }

  const missingOrders = orders.filter(o=>!o.rua&&!sugestoes[o.id])
  const allFilled = missingOrders.every(o=>manualAddr[o.id]?.rua?.trim()&&manualAddr[o.id]?.cep?.trim())
  const pendingSugestoes = Object.keys(sugestoes).length>0
  const dateStr = datasFiltro.length === 1 ? datasFiltro[0] : datasFiltro.join(' + ')
  const totalParadas = routes.reduce((s,r)=>s+r.stops.length,0)

  return (
    <>
      {/* Upload + busca */}
      <div className="card card-pad">
        <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>
          <div className="form-group">
            <label className="form-label">Datas do roteiro (DD/MM/AAAA)</label>
            <div style={{ display:'flex', gap:6 }}>
              <input className="form-input" value={novaData} onChange={e=>setNovaData(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&addData()}
                placeholder="24/06/2026" style={{ width:140 }} />
              <button className="btn btn-ghost btn-sm" onClick={addData}>+ Adicionar</button>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:8 }}>
              {datasFiltro.map(d => (
                <span key={d} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--purple-pale)', color:'var(--purple)', padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:600 }}>
                  {d}
                  <button onClick={()=>removeData(d)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--purple)', padding:0, lineHeight:1 }}>✕</button>
                </span>
              ))}
              {datasFiltro.length===0 && <span style={{ fontSize:12, color:'var(--gray-300)' }}>Nenhuma data selecionada</span>}
            </div>
          </div>
          <div>
            <label className="form-label" style={{ marginBottom:5, display:'block' }}>CSV do Bling</label>
            <button className="btn btn-primary" onClick={()=>fileRef.current?.click()} disabled={importando || datasFiltro.length===0}>
              {importando?<><RefreshCw size={14} className="spin"/> Processando...</>:<><Upload size={14}/> Importar CSV</>}
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }}
              onChange={e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value='' }} />
          </div>
          {orders.length>0&&(
            <div className="alert-banner ok" style={{ flex:1 }}>
              <CheckCircle size={14}/> <strong>{orders.length} pedidos LALAMOVE</strong> encontrados para {datasFiltro.join(', ')}
            </div>
          )}
        </div>

        {/* Busca por pedido */}
        <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--gray-200)' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>
            🔍 Buscar pedido nos últimos 10 dias
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input className="form-input" style={{ width:180 }} placeholder="Nº do pedido"
              value={buscaPedido} onChange={e=>setBuscaPedido(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&buscarPedido()} />
            <button className="btn btn-ghost" onClick={buscarPedido} disabled={buscando}>
              {buscando?<RefreshCw size={14} className="spin"/>:<Search size={14}/>} Buscar
            </button>
            {resultadoBusca!==null&&(
              <button className="btn btn-ghost btn-sm" onClick={()=>setResultadoBusca(null)}>✕ Fechar</button>
            )}
          </div>

          {resultadoBusca!==null&&(
            <div style={{ marginTop:10 }}>
              {resultadoBusca.length===0?(
                <div style={{ fontSize:13, color:'var(--gray-400)' }}>Nenhum resultado nos últimos 10 dias para "{buscaPedido}".</div>
              ):(
                resultadoBusca.map(p=>(
                  <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid var(--gray-100)', flexWrap:'wrap' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:13 }}>#{p.numero_pedido} · {p.nome}</div>
                      <div style={{ fontSize:12, color:'var(--gray-500)' }}>
                        {p.rua}, {p.numero}{p.complemento?` - ${p.complemento}`:''} · {p.bairro} · {p.cidade}/{p.uf} · CEP {p.cep}
                      </div>
                      <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>
                        Rota {p.rota_code} — {p.rota_label} · {p.rota?.data_roteiro ? new Date(p.rota.data_roteiro+'T12:00:00').toLocaleDateString('pt-BR') : ''}
                      </div>
                    </div>
                    {step==='ready'&&(
                      <button className="btn btn-primary btn-sm" onClick={()=>reincluirParada(p)}>
                        <Plus size={12}/> Reincluir na rota
                      </button>
                    )}
                    {step!=='ready'&&(
                      <span style={{ fontSize:12, color:'var(--gray-400)' }}>Gere os roteiros primeiro para reincluir</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {!orders.length&&!resultadoBusca&&(
          <div className="alert-banner info" style={{ marginTop:14 }}>
            💡 Filtra apenas pedidos LALAMOVE na data informada. Use a busca acima para localizar pedidos dos últimos 10 dias e reincluí-los nas rotas.
          </div>
        )}
      </div>

      {/* Revisão */}
      {step==='review'&&(
        <div className="card">
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-200)', fontWeight:700, fontSize:14 }}>
            Revisão antes de gerar os roteiros
          </div>
          <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:14 }}>

            {Object.keys(sugestoes).map(pedidoId=>{
              const order=orders.find(o=>o.id===pedidoId), sug=sugestoes[pedidoId]
              return(
                <div key={pedidoId} style={{ background:'var(--ok-pale)', border:'1px solid var(--ok)', borderRadius:8, padding:14 }}>
                  <div style={{ fontWeight:700, marginBottom:6, display:'flex', gap:8, alignItems:'center' }}>
                    <CheckCircle size={14} color="var(--ok)"/>
                    <span>#{pedidoId} · {order?.nome}</span>
                    <span style={{ fontSize:12, color:'var(--gray-500)', fontWeight:400 }}>Endereço salvo anteriormente</span>
                  </div>
                  <div style={{ fontSize:13, color:'var(--gray-700)', marginBottom:10 }}>
                    {sug.rua}, {sug.numero}{sug.complemento?` - ${sug.complemento}`:''} · {sug.bairro} · {sug.cidade}/{sug.uf} · CEP {sug.cep}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn btn-primary btn-sm" onClick={()=>aceitarSugestao(pedidoId)}>✓ Usar este endereço</button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>rejeitarSugestao(pedidoId)}>Preencher outro</button>
                  </div>
                </div>
              )
            })}

            {missingOrders.map(order=>(
              <div key={order.id} style={{ border:'1px solid var(--warning)', borderRadius:8, padding:14, background:'var(--warning-pale)' }}>
                <div style={{ fontWeight:700, marginBottom:10, display:'flex', gap:8, alignItems:'center' }}>
                  <AlertTriangle size={14} color="var(--warning)"/>
                  <span>#{order.id} · {order.nome}</span>
                  {order.tel&&<span style={{ fontSize:12, color:'var(--gray-500)' }}>{order.tel}</span>}
                  <button className="btn btn-ghost btn-sm" onClick={()=>toggleExcluir(order.id)}
                    style={{ marginLeft:'auto', color:order.excluir?'var(--danger)':'var(--gray-500)' }}>
                    {order.excluir?'✓ Excluído':'Excluir do roteiro'}
                  </button>
                </div>
                {!order.excluir&&(
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 120px', gap:8, marginBottom:8 }}>
                      <div className="form-group">
                        <label className="form-label">Rua *</label>
                        <input className="form-input" value={manualAddr[order.id]?.rua||''} onChange={e=>updManual(order.id,'rua',e.target.value)} placeholder="Rua / Av." />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Número *</label>
                        <input className="form-input" value={manualAddr[order.id]?.numero||''} onChange={e=>updManual(order.id,'numero',e.target.value)} placeholder="Nº" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Complemento</label>
                        <input className="form-input" value={manualAddr[order.id]?.complemento||''} onChange={e=>updManual(order.id,'complemento',e.target.value)} placeholder="Apto" />
                      </div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 1fr 60px', gap:8 }}>
                      <div className="form-group">
                        <label className="form-label">Bairro</label>
                        <input className="form-input" value={manualAddr[order.id]?.bairro||''} onChange={e=>updManual(order.id,'bairro',e.target.value)} placeholder="Bairro" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">CEP *</label>
                        <input className="form-input" value={manualAddr[order.id]?.cep||''} onChange={e=>updManual(order.id,'cep',e.target.value)} placeholder="00000-000" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Cidade</label>
                        <input className="form-input" value={manualAddr[order.id]?.cidade||''} onChange={e=>updManual(order.id,'cidade',e.target.value)} placeholder="São Paulo" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">UF</label>
                        <input className="form-input" value={manualAddr[order.id]?.uf||''} onChange={e=>updManual(order.id,'uf',e.target.value.toUpperCase())} placeholder="SP" maxLength={2} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}

            {orders.filter(o=>o.rua&&!sugestoes[o.id]).length>0&&(
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>
                  Pedidos com endereço — desmarque os que não devem ir no roteiro
                </div>
                {orders.filter(o=>o.rua&&!sugestoes[o.id]).map(order=>(
                  <div key={order.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid var(--gray-100)' }}>
                    <input type="checkbox" checked={!order.excluir} onChange={()=>toggleExcluir(order.id)}
                      style={{ width:16, height:16, accentColor:'var(--purple)', flexShrink:0 }} />
                    <span style={{ fontWeight:600, fontSize:13 }}>#{order.id}</span>
                    <span style={{ fontSize:13 }}>{order.nome}</span>
                    <span style={{ fontSize:12, color:'var(--gray-400)' }}>{order.rua}, {order.numero} · {order.cidade}</span>
                    <span style={{ marginLeft:'auto', fontSize:11, color:'var(--gray-400)', fontFamily:'monospace' }}>{getZone(order.cidade,order.cepNum)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding:'14px 20px', borderTop:'1px solid var(--gray-200)', display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-primary" onClick={confirmarEGerar} disabled={pendingSugestoes||!allFilled}>
              {pendingSugestoes?'Confirme os endereços acima':!allFilled?'Preencha os campos obrigatórios (*)':'Gerar roteiros →'}
            </button>
          </div>
        </div>
      )}

      {/* Pronto */}
      {step==='ready'&&routes.length>0&&(
        <div className="card">
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-200)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:14 }}>Roteiros prontos — {routes.length} rotas · {totalParadas} paradas</div>
              <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:2 }}>
                Data: {dateStr} · Arraste um pedido para outra rota · ✕ para excluir rota
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-outline" onClick={()=>exportarPDF(routes)}>
                <FileText size={14}/> PDF do roteiro
              </button>
              <button className="btn btn-gold" onClick={()=>exportarTudo(routes)}>
                <Download size={14}/> Baixar todos (ZIP)
              </button>
              {csvRaw && (
                <button className="btn btn-ghost" onClick={()=>gerarPDFConferencia(csvRaw, datasFiltro, dateStr)}>
                  <FileText size={14}/> PDF Conferência
                </button>
              )}
            </div>
          </div>

          <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:10 }}>
            {routes.map((r, rIdx) => (
              <div
                key={r.code}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const data = JSON.parse(e.dataTransfer.getData('stop'))
                  const { fromRoute, stopId } = data
                  if (fromRoute === rIdx) return
                  // Move o stop de fromRoute para rIdx
                  const newRoutes = routes.map((rt, i) => {
                    if (i === fromRoute) return { ...rt, stops: rt.stops.filter(s => s.id !== stopId) }
                    if (i === rIdx) {
                      const stop = routes[fromRoute].stops.find(s => s.id === stopId)
                      return { ...rt, stops: [...rt.stops, stop] }
                    }
                    return rt
                  }).filter(rt => rt.stops.length > 0) // remove rota se ficar vazia
                   .map((rt, i) => ({ ...rt, code: String(i+1).padStart(2,'0') }))
                  setRoutes(newRoutes)
                }}
                style={{ border:'1px solid #1565C020', borderRadius:8, overflow:'hidden' }}>
                <div style={{ background:'#1565C0', color:'#fff', padding:'8px 14px', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontWeight:800, fontSize:13, flex:1 }}>
                    ROTA {r.code} — {r.label}  ({r.stops.length} parada{r.stops.length>1?'s':''})
                  </span>
                  <button className="btn btn-sm" style={{ background:'rgba(255,255,255,0.2)', color:'#fff', fontSize:12 }}
                    onClick={() => downloadCSV(buildLalamoveCSV(r), `R${r.code}_${r.label.replace(/[^a-zA-Z0-9]/g,'_')}.csv`)}>
                    <Download size={12}/> CSV
                  </button>
                  <button onClick={() => {
                    if (!window.confirm(`Excluir ROTA ${r.code} — ${r.label}?`)) return
                    setRoutes(routes.filter((_,i) => i !== rIdx).map((rt,i) => ({ ...rt, code: String(i+1).padStart(2,'0') })))
                  }} style={{ background:'rgba(255,255,255,0.15)', color:'#fff', border:'none', cursor:'pointer', borderRadius:4, padding:'4px 8px', fontSize:14 }}>
                    ✕
                  </button>
                </div>
                <div>
                  {r.stops.map((stop, idx) => (
                    <div
                      key={stop.id}
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('stop', JSON.stringify({ fromRoute: rIdx, stopId: stop.id }))
                        e.currentTarget.style.opacity = '0.4'
                      }}
                      onDragEnd={e => { e.currentTarget.style.opacity = '1' }}
                      style={{
                        padding:'9px 14px', borderBottom:'1px solid var(--gray-100)',
                        display:'grid', gridTemplateColumns:'20px 20px 80px 160px 1fr',
                        gap:8, alignItems:'center',
                        background: idx%2===0 ? '#fff' : '#f9f8ff',
                        fontSize:13, cursor:'grab',
                      }}>
                      {/* Drag handle */}
                      <span style={{ color:'var(--gray-300)', fontSize:14, userSelect:'none' }}>⠿</span>
                      <span style={{ fontWeight:800, color:'#1565C0', textAlign:'center' }}>{idx+1}</span>
                      <span style={{ fontFamily:'monospace', color:'var(--gray-500)', fontSize:12 }}>#{stop.id}</span>
                      <span style={{ fontWeight:600 }}>{stop.nome}</span>
                      <span style={{ color:'var(--gray-600)', fontSize:12 }}>
                        {stop.rua}, {stop.numero}{stop.complemento?` - ${stop.complemento}`:''} · {stop.bairro} · {stop.cidade}/{stop.uf}
                      </span>
                    </div>
                  ))}
                  {/* Drop zone visual quando a rota está vazia de paradas */}
                  {r.stops.length === 0 && (
                    <div style={{ padding:20, textAlign:'center', color:'var(--gray-300)', fontSize:13 }}>
                      Solte aqui para mover um pedido para esta rota
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
