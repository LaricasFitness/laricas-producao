import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { Upload, RefreshCw, Download, FileText, CheckCircle, AlertTriangle, X } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'

// ── Constantes ────────────────────────────────────────────────────────────────
const PICKUP = {
  endereco: 'R. Pedroso 258 - Bela Vista São Paulo/SP 01322-010',
  nome: 'Fabio Gabriel',
  tel: '11 93415 7853',
  obs: 'LARICAS FITNESS',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCEP(v) {
  if (!v) return ''
  const s = String(Math.round(Number(String(v).replace(/\D/g, '')) || 0)).padStart(8, '0')
  return `${s.slice(0,5)}-${s.slice(5)}`
}

function formatTel(v) {
  if (!v) return ''
  return String(v).replace(/\D/g, '').replace(/^55/, '')
}

function getZone(cidade = '', cepNum = '') {
  const c = cidade.toLowerCase()
  if (c.includes('barueri') || c.includes('santana de parnaíba') || c.includes('cajamar')) return 'Alphaville'
  if (c.includes('guarulhos')) return 'Guarulhos'
  if (c.includes('santo andré')) return 'ABC — Santo André'
  if (c.includes('são bernardo') || c.includes('diadema')) return 'ABC — São Bernardo'
  if (c.includes('osasco')) return 'Osasco'
  const p = parseInt((cepNum || '').replace(/\D/g,'').slice(0, 5)) || 0
  if (p <= 1999) return 'Centro'
  if (p <= 2999) return 'Norte'
  if (p <= 3999) return 'Zona Leste'
  if (p <= 4999) return 'Zona Sul'
  if (p <= 5999) return 'Zona Oeste'
  if (p <= 8999) return 'Zona Leste Ext.'
  return 'Outro'
}

function buildRoutes(orders) {
  const byZone = {}
  for (const o of orders) {
    const zone = getZone(o.cidade, o.cepNum)
    if (!byZone[zone]) byZone[zone] = []
    byZone[zone].push(o)
  }
  // Ordena por CEP dentro de cada zona
  for (const z of Object.values(byZone)) z.sort((a, b) => (a.cepNum || '').localeCompare(b.cepNum || ''))

  const routes = []
  const MAX = 5
  for (const [zone, ords] of Object.entries(byZone)) {
    for (let i = 0; i < ords.length; i += MAX) {
      routes.push({ label: zone, stops: ords.slice(i, i + MAX) })
    }
  }
  return routes.map((r, i) => ({ ...r, code: String(i + 1).padStart(2, '0') }))
}

// ── Parser CSV ────────────────────────────────────────────────────────────────
function parseCSVRobusto(texto) {
  const rows = []
  let col = '', row = [], inQuote = false
  const clean = texto.replace(/^\uFEFF/, '')
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i], next = clean[i + 1]
    if (inQuote) {
      if (c === '"' && next === '"') { col += '"'; i++ }
      else if (c === '"') inQuote = false
      else col += c
    } else {
      if (c === '"') inQuote = true
      else if (c === ';') { row.push(col.trim()); col = '' }
      else if (c === '\n') { row.push(col.trim()); if (row.some(Boolean)) rows.push(row); row = []; col = '' }
      else if (c !== '\r') col += c
    }
  }
  if (col || row.length) { row.push(col.trim()); if (row.some(Boolean)) rows.push(row) }
  return rows
}

function parsearLogisticaCSV(texto, dataFiltro) {
  const rows = parseCSVRobusto(texto)
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.replace(/^"|"$/g, '').trim())

  const idx = (name) => header.indexOf(name)
  const iNumeroPedido = idx('Número pedido')
  const iTransportadora = idx('Transportadora')
  const iDataPrevista = idx('Data Prevista')
  const iNomeEntrega = idx('Nome Entrega')
  const iNomeComprador = idx('Nome Comprador')
  const iEndereco = idx('Endereço Entrega')
  const iNumero = idx('Número Entrega')
  const iComplemento = idx('Complemento Entrega')
  const iBairro = idx('Bairro Entrega')
  const iCidade = idx('Cidade Entrega')
  const iUF = idx('UF Entrega')
  const iCEP = idx('CEP Entrega')
  const iTel = idx('Celular Comprador')
  const iSKU = idx('SKU')
  const iQtd = idx('Quantidade')
  const iCPF = idx('CPF/CNPJ Comprador')

  const pedidosMap = {}

  for (const cols of rows.slice(1)) {
    const get = (i) => (i >= 0 && i < cols.length ? cols[i] : '')
    const transportadora = get(iTransportadora).toUpperCase()
    if (!transportadora.includes('LALAMOVE')) continue

    const dataPrev = get(iDataPrevista).trim()
    if (dataFiltro && dataPrev !== dataFiltro) continue

    const numPedido = get(iNumeroPedido).trim()
    if (!numPedido) continue

    const sku = get(iSKU).trim()
    const qtd = parseFloat(get(iQtd).replace(',', '.')) || 0

    if (!pedidosMap[numPedido]) {
      const cepRaw = get(iCEP).trim()
      const cepNum = String(Math.round(Number(cepRaw.replace(/\D/g,'')) || 0)).padStart(8, '0')
      pedidosMap[numPedido] = {
        id: numPedido,
        nome: get(iNomeEntrega).trim() || get(iNomeComprador).trim(),
        rua: get(iEndereco).trim(),
        numero: get(iNumero).trim(),
        complemento: get(iComplemento).trim(),
        bairro: get(iBairro).trim(),
        cidade: get(iCidade).trim(),
        uf: get(iUF).trim(),
        cep: formatCEP(cepRaw),
        cepNum,
        tel: formatTel(get(iTel)),
        cpfCnpj: get(iCPF).trim(),
        itens: [],
        excluir: false,
      }
    }
    if (sku && qtd > 0) pedidosMap[numPedido].itens.push({ sku, qtd })
  }

  return Object.values(pedidosMap)
}

// ── CSV Lalamove ──────────────────────────────────────────────────────────────
function buildLalamoveCSV(route) {
  const escape = (s) => s && s.includes(',') ? `"${s}"` : (s || '')
  const rows = [
    ['1. Endereço', '2. Nome', '3. Telefone', '4. Bloco/piso'],
    ['-', '', '', ''],
    [PICKUP.endereco, PICKUP.nome, PICKUP.tel, PICKUP.obs],
  ]
  for (const stop of route.stops) {
    const addr = `${stop.rua} ${stop.numero}  ${stop.bairro} ${stop.cidade}/${stop.uf} CEP ${stop.cep}`
    rows.push([addr, stop.nome, stop.tel || '', stop.complemento || ''])
  }
  return rows.map(r => r.map(escape).join(',')).join('\r\n')
}

function downloadCSV(content, filename) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

async function downloadAllCSVs(routes, dateStr) {
  const zip = new JSZip()
  for (const r of routes) {
    const content = buildLalamoveCSV(r)
    zip.file(`R${r.code}_${r.label.replace(/[^a-zA-Z0-9]/g, '_')}.csv`, '\uFEFF' + content)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `Roteiros_LALAMOVE_${dateStr}.zip`; a.click()
  URL.revokeObjectURL(url)
}

// ── PDF Roteiro ───────────────────────────────────────────────────────────────
function gerarPDFRoteiro(routes, dateStr) {
  const doc = new jsPDF()
  const totalParadas = routes.reduce((s, r) => s + r.stops.length, 0)

  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 210, 32, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(16); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness — Roteiro LALAMOVE', 14, 14)
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(255, 255, 255)
  doc.text(`Data: ${dateStr} · ${routes.length} rotas · ${totalParadas} paradas`, 14, 22)
  doc.text(`Gerado: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 14, 28)

  let y = 38
  for (const r of routes) {
    // Header da rota
    doc.setFillColor(21, 101, 192); doc.rect(14, y, 182, 7, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont(undefined, 'bold')
    doc.text(`ROTA ${r.code} — ${r.label}  (${r.stops.length} parada${r.stops.length > 1 ? 's' : ''})`, 16, y + 5)
    y += 9

    const body = r.stops.map((stop, idx) => [
      String(idx + 1),
      `#${stop.id}`,
      stop.nome,
      `${stop.rua}, ${stop.numero}${stop.complemento ? ` - ${stop.complemento}` : ''}\n${stop.bairro} · ${stop.cidade}/${stop.uf} · CEP ${stop.cep}${stop.tel ? `\nTel: ${stop.tel}` : ''}`,
    ])

    autoTable(doc, {
      startY: y,
      head: [['#', 'Pedido', 'Destinatário', 'Endereço']],
      body,
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [200, 220, 255], textColor: [21, 101, 192], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [249, 250, 255] },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 20 },
        2: { cellWidth: 50 },
        3: { cellWidth: 104 },
      },
      margin: { left: 14, right: 14 },
    })

    y = doc.lastAutoTable.finalY + 6
    if (y > 260 && routes.indexOf(r) < routes.length - 1) { doc.addPage(); y = 14 }
  }

  doc.setFont(undefined, 'normal'); doc.setFontSize(7); doc.setTextColor(150, 150, 150)
  doc.text(`LALAMOVE · ${routes.length} rotas · ${totalParadas} paradas · Despachar conforme produção for fechando`, 14, doc.internal.pageSize.height - 8)
  doc.save(`Roteiro_LALAMOVE_${dateStr.replace(/\//g, '-')}.pdf`)
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Logistica({ csvInicial }) {
  const hoje = new Date()
  const amanha = new Date(); amanha.setDate(hoje.getDate() + 1)
  const [dataFiltro, setDataFiltro] = useState(amanha.toLocaleDateString('pt-BR'))
  const [step, setStep] = useState('upload') // upload | review | ready
  const [orders, setOrders] = useState([])
  const [routes, setRoutes] = useState([])
  const [manualAddr, setManualAddr] = useState({})
  const [enderecoCache, setEnderecoCache] = useState({}) // cpfCnpj -> endereço
  const [sugestoes, setSugestoes] = useState({}) // pedidoId -> endereço sugerido do cache
  const [importando, setImportando] = useState(false)
  const fileRef = useRef()

  // Carrega cache do Supabase
  useEffect(() => {
    supabase.from('enderecos_cache').select('*').then(({ data }) => {
      const map = {}
      for (const r of (data || [])) map[r.cpf_cnpj] = r
      setEnderecoCache(map)
    })
  }, [])

  // Processa CSV quando vem do Planejamento
  useEffect(() => {
    if (csvInicial) processarTextoCSV(csvInicial)
  }, [csvInicial])

  function processarTextoCSV(texto) {
    setImportando(true)
    try {
      const parsed = parsearLogisticaCSV(texto, dataFiltro)
      aplicarParsed(parsed)
    } catch(e) {
      alert('Erro ao processar CSV: ' + e.message)
    }
    setImportando(false)
  }

  function aplicarParsed(parsed) {
    // Identifica sugestões do cache por CPF/CNPJ
    const sugs = {}
    for (const o of parsed) {
      if (o.cpfCnpj && enderecoCache[o.cpfCnpj] && !o.rua) {
        sugs[o.id] = enderecoCache[o.cpfCnpj]
      }
    }
    setSugestoes(sugs)
    setOrders(parsed)

    const missing = parsed.filter(o => !o.rua && !sugs[o.id])
    setManualAddr(Object.fromEntries(missing.map(o => [o.id, { rua:'', numero:'', complemento:'', bairro:'', cidade:'', uf:'', cep:'', tel: o.tel || '' }])))
    setStep(missing.length > 0 || Object.keys(sugs).length > 0 ? 'review' : 'ready')

    if (missing.length === 0 && Object.keys(sugs).length === 0) {
      const valid = parsed.filter(o => !o.excluir)
      setRoutes(buildRoutes(valid))
    }
  }

  function handleFile(file) {
    setImportando(true)
    const reader = new FileReader()
    reader.onload = e => {
      processarTextoCSV(e.target.result)
      setImportando(false)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function aceitarSugestao(pedidoId) {
    const sug = sugestoes[pedidoId]
    setOrders(prev => prev.map(o => o.id === pedidoId ? { ...o, rua: sug.rua, numero: sug.numero, complemento: sug.complemento || '', bairro: sug.bairro, cidade: sug.cidade, uf: sug.uf, cep: sug.cep, tel: sug.tel || o.tel } : o))
    setSugestoes(prev => { const n = { ...prev }; delete n[pedidoId]; return n })
  }

  function rejeitarSugestao(pedidoId) {
    const order = orders.find(o => o.id === pedidoId)
    setSugestoes(prev => { const n = { ...prev }; delete n[pedidoId]; return n })
    setManualAddr(prev => ({ ...prev, [pedidoId]: { rua:'', numero:'', complemento:'', bairro:'', cidade: order?.cidade||'', uf: order?.uf||'', cep:'', tel: order?.tel||'' } }))
  }

  function toggleExcluir(pedidoId) {
    setOrders(prev => prev.map(o => o.id === pedidoId ? { ...o, excluir: !o.excluir } : o))
  }

  function updManual(id, field, val) {
    setManualAddr(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  // Verifica se todas as lacunas estão preenchidas
  const missingOrders = orders.filter(o => !o.rua && !sugestoes[o.id])
  const allFilled = missingOrders.every(o => manualAddr[o.id]?.rua?.trim() && manualAddr[o.id]?.cep?.trim())
  const pendingSugestoes = Object.keys(sugestoes).length > 0

  async function confirmarEGerar() {
    // Merge endereços manuais
    let merged = orders.map(o => manualAddr[o.id] ? { ...o, ...manualAddr[o.id] } : o)

    // Salva no cache os endereços manuais que têm CPF/CNPJ
    for (const o of merged) {
      if (o.cpfCnpj && (manualAddr[o.id]?.rua)) {
        const payload = {
          cpf_cnpj: o.cpfCnpj, nome: o.nome,
          rua: o.rua, numero: o.numero, complemento: o.complemento,
          bairro: o.bairro, cidade: o.cidade, uf: o.uf, cep: o.cep, tel: o.tel,
          atualizado_em: new Date().toISOString(),
        }
        await supabase.from('enderecos_cache').upsert(payload, { onConflict: 'cpf_cnpj' })
      }
    }

    const valid = merged.filter(o => !o.excluir)
    const builtRoutes = buildRoutes(valid)
    setRoutes(builtRoutes)
    setStep('ready')
  }

  const dateStr = dataFiltro
  const totalParadas = routes.reduce((s, r) => s + r.stops.length, 0)

  return (
    <>
      {/* Upload */}
      <div className="card card-pad">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group">
            <label className="form-label">Data do roteiro (DD/MM/AAAA)</label>
            <input className="form-input" value={dataFiltro} onChange={e => setDataFiltro(e.target.value)}
              placeholder="24/06/2026" style={{ width: 160 }} />
          </div>
          <div>
            <label className="form-label" style={{ marginBottom: 5, display: 'block' }}>CSV do Bling</label>
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importando}>
              {importando ? <><RefreshCw size={14} className="spin" /> Processando...</> : <><Upload size={14} /> Importar CSV</>}
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value='' }} />
          </div>
          {orders.length > 0 && (
            <div className="alert-banner ok" style={{ flex: 1 }}>
              <CheckCircle size={14} />
              <strong>{orders.length} pedidos LALAMOVE</strong> encontrados para {dataFiltro}
            </div>
          )}
        </div>
        {!orders.length && (
          <div className="alert-banner info" style={{ marginTop: 14 }}>
            💡 Filtra automaticamente apenas pedidos com transportadora LALAMOVE e a data informada acima.
          </div>
        )}
      </div>

      {/* Revisão */}
      {step === 'review' && (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 700, fontSize: 14 }}>
            Revisão antes de gerar os roteiros
          </div>

          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Sugestões do cache */}
            {Object.keys(sugestoes).map(pedidoId => {
              const order = orders.find(o => o.id === pedidoId)
              const sug = sugestoes[pedidoId]
              return (
                <div key={pedidoId} style={{ background: 'var(--ok-pale)', border: '1px solid var(--ok)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CheckCircle size={14} color="var(--ok)" />
                    <span>#{pedidoId} · {order?.nome}</span>
                    <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 400 }}>Endereço salvo anteriormente encontrado</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--gray-700)', marginBottom: 10 }}>
                    {sug.rua}, {sug.numero}{sug.complemento ? ` - ${sug.complemento}` : ''} · {sug.bairro} · {sug.cidade}/{sug.uf} · CEP {sug.cep}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => aceitarSugestao(pedidoId)}>
                      ✓ Usar este endereço
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => rejeitarSugestao(pedidoId)}>
                      Preencher outro
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Endereços faltantes */}
            {missingOrders.map(order => (
              <div key={order.id} style={{ border: '1px solid var(--warning)', borderRadius: 8, padding: 14, background: 'var(--warning-pale)' }}>
                <div style={{ fontWeight: 700, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <AlertTriangle size={14} color="var(--warning)" />
                  <span>#{order.id} · {order.nome}</span>
                  {order.tel && <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{order.tel}</span>}
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleExcluir(order.id)}
                    style={{ marginLeft: 'auto', color: order.excluir ? 'var(--danger)' : 'var(--gray-500)' }}>
                    {order.excluir ? '✓ Excluído' : 'Excluir do roteiro'}
                  </button>
                </div>
                {!order.excluir && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, marginBottom: 8 }}>
                    <div className="form-group">
                      <label className="form-label">Rua *</label>
                      <input className="form-input" value={manualAddr[order.id]?.rua || ''} onChange={e => updManual(order.id, 'rua', e.target.value)} placeholder="Rua / Av." />
                    </div>
                    <div className="form-group" style={{ width: 80 }}>
                      <label className="form-label">Número *</label>
                      <input className="form-input" value={manualAddr[order.id]?.numero || ''} onChange={e => updManual(order.id, 'numero', e.target.value)} placeholder="Nº" />
                    </div>
                    <div className="form-group" style={{ width: 120 }}>
                      <label className="form-label">Complemento</label>
                      <input className="form-input" value={manualAddr[order.id]?.complemento || ''} onChange={e => updManual(order.id, 'complemento', e.target.value)} placeholder="Apto/Bloco" />
                    </div>
                  </div>
                )}
                {!order.excluir && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr auto', gap: 8 }}>
                    <div className="form-group">
                      <label className="form-label">Bairro</label>
                      <input className="form-input" value={manualAddr[order.id]?.bairro || ''} onChange={e => updManual(order.id, 'bairro', e.target.value)} placeholder="Bairro" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">CEP *</label>
                      <input className="form-input" value={manualAddr[order.id]?.cep || ''} onChange={e => updManual(order.id, 'cep', e.target.value)} placeholder="00000-000" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cidade</label>
                      <input className="form-input" value={manualAddr[order.id]?.cidade || ''} onChange={e => updManual(order.id, 'cidade', e.target.value)} placeholder="São Paulo" />
                    </div>
                    <div className="form-group" style={{ width: 60 }}>
                      <label className="form-label">UF</label>
                      <input className="form-input" value={manualAddr[order.id]?.uf || ''} onChange={e => updManual(order.id, 'uf', e.target.value.toUpperCase())} placeholder="SP" maxLength={2} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Checklist de exclusão para pedidos com endereço */}
            {orders.filter(o => o.rua && !sugestoes[o.id]).length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  Pedidos com endereço — desmarque os que não devem ir no roteiro
                </div>
                {orders.filter(o => o.rua && !sugestoes[o.id]).map(order => (
                  <div key={order.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <input type="checkbox" checked={!order.excluir} onChange={() => toggleExcluir(order.id)}
                      style={{ width: 16, height: 16, accentColor: 'var(--purple)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>#{order.id}</span>
                    <span style={{ fontSize: 13 }}>{order.nome}</span>
                    <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{order.rua}, {order.numero} · {order.cidade}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{getZone(order.cidade, order.cepNum)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary"
              onClick={confirmarEGerar}
              disabled={pendingSugestoes || !allFilled}>
              {pendingSugestoes ? 'Confirme os endereços acima primeiro' : !allFilled ? 'Preencha os campos obrigatórios (*)' : 'Gerar roteiros →'}
            </button>
          </div>
        </div>
      )}

      {/* Pronto para download */}
      {step === 'ready' && routes.length > 0 && (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Roteiros prontos — {routes.length} rotas · {totalParadas} paradas</div>
              <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                Data: {dateStr} · Arraste as rotas para reordenar · clique no X para excluir
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => gerarPDFRoteiro(routes, dateStr)}>
                <FileText size={14} /> PDF do roteiro
              </button>
              <button className="btn btn-gold" onClick={() => downloadAllCSVs(routes, dateStr.replace(/\//g,'-'))}>
                <Download size={14} /> Baixar todos os CSVs (ZIP)
              </button>
            </div>
          </div>

          {/* Preview das rotas com drag and delete */}
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {routes.map((r, rIdx) => (
              <div
                key={r.code}
                draggable
                onDragStart={e => e.dataTransfer.setData('routeIdx', rIdx)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const from = parseInt(e.dataTransfer.getData('routeIdx'))
                  if (from === rIdx) return
                  const newRoutes = [...routes]
                  const [moved] = newRoutes.splice(from, 1)
                  newRoutes.splice(rIdx, 0, moved)
                  // Renumera
                  setRoutes(newRoutes.map((rt, i) => ({ ...rt, code: String(i + 1).padStart(2, '0') })))
                }}
                style={{ border: '1px solid #1565C020', borderRadius: 8, overflow: 'hidden', cursor: 'grab' }}
              >
                <div style={{ background: '#1565C0', color: '#fff', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Drag handle */}
                  <span style={{ fontSize: 16, opacity: .6, cursor: 'grab', userSelect: 'none' }}>⠿</span>
                  <span style={{ fontWeight: 800, fontSize: 13, flex: 1 }}>
                    ROTA {r.code} — {r.label}  ({r.stops.length} parada{r.stops.length > 1 ? 's' : ''})
                  </span>
                  <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 12 }}
                    onClick={() => downloadCSV(buildLalamoveCSV(r), `R${r.code}_${r.label.replace(/[^a-zA-Z0-9]/g,'_')}.csv`)}>
                    <Download size={12} /> CSV
                  </button>
                  <button
                    title="Excluir esta rota"
                    onClick={() => {
                      if (!window.confirm(`Excluir a ROTA ${r.code} — ${r.label}?`)) return
                      const newRoutes = routes.filter((_, i) => i !== rIdx)
                        .map((rt, i) => ({ ...rt, code: String(i + 1).padStart(2, '0') }))
                      setRoutes(newRoutes)
                    }}
                    style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 4, padding: '4px 8px', fontSize: 14, lineHeight: 1 }}>
                    ✕
                  </button>
                </div>
                <div>
                  {r.stops.map((stop, idx) => (
                    <div key={stop.id} style={{ padding: '9px 14px', borderBottom: '1px solid var(--gray-100)', display: 'grid', gridTemplateColumns: '20px 80px 160px 1fr', gap: 8, alignItems: 'center', background: idx % 2 === 0 ? '#fff' : '#f9f8ff', fontSize: 13 }}>
                      <span style={{ fontWeight: 800, color: '#1565C0', textAlign: 'center' }}>{idx + 1}</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--gray-500)', fontSize: 12 }}>#{stop.id}</span>
                      <span style={{ fontWeight: 600 }}>{stop.nome}</span>
                      <span style={{ color: 'var(--gray-600)', fontSize: 12 }}>
                        {stop.rua}, {stop.numero}{stop.complemento ? ` - ${stop.complemento}` : ''} · {stop.bairro} · {stop.cidade}/{stop.uf}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
