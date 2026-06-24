import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, FileText } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const ORDEM_CATS = [
  'Pão de Mel 100g','Mini Pão de Mel 30g','Lata Mini 240g','Bolinho 100g',
  'Potinho 60g','Potão 280g','Barra 180g','Bombom','Outros'
]

function fmt(n) { return (n || 0).toLocaleString('pt-BR') }

function fmtDataBr(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function diaSemana(iso) {
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][new Date(iso + 'T12:00:00').getDay()]
}

function headerDia(iso) { return `${diaSemana(iso)} ${fmtDataBr(iso)}` }

function gerarPDF(plan, itens) {
  const doc = new jsPDF()
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  doc.setFillColor(82, 46, 100); doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(234, 183, 130); doc.setFontSize(15); doc.setFont(undefined, 'bold')
  doc.text('Laricas Fitness', 14, 12)
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(255,255,255)
  doc.text(`Produção do dia — ${headerDia(plan.data_producao)}`, 14, 20)
  doc.text(`Reimpresso: ${agora}`, 130, 20)

  // Agrupa por categoria
  const porCat = {}
  for (const item of itens) {
    const cat = item.embalagens?.categoria || 'Outros'
    if (!porCat[cat]) porCat[cat] = []
    porCat[cat].push(item)
  }

  const body = []
  for (const cat of ORDEM_CATS) {
    const grupo = (porCat[cat] || []).filter(i => i.quantidade_total > 0)
    if (!grupo.length) continue
    const totalCat = grupo.reduce((s, i) => s + i.quantidade_total, 0)
    body.push([{
      content: `${cat}  —  ${fmt(totalCat)} un`, colSpan: 2,
      styles: { fillColor: [103,63,124], textColor: [255,255,255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 }
    }])
    for (const i of grupo) {
      body.push([
        i.embalagens?.nome || '?',
        { content: fmt(i.quantidade_total), styles: { halign: 'center', fontStyle: 'bold' } }
      ])
    }
  }

  const totalGeral = itens.reduce((s, i) => s + i.quantidade_total, 0)

  autoTable(doc, {
    startY: 33, body,
    styles: { fontSize: 8, cellPadding: 2.5 },
    alternateRowStyles: { fillColor: [248, 245, 252] },
    columnStyles: { 1: { cellWidth: 22, halign: 'center' } },
    margin: { left: 14, right: 14 },
  })

  const finalY = doc.lastAutoTable.finalY + 6
  doc.setFont(undefined,'bold'); doc.setFontSize(11); doc.setTextColor(82,46,100)
  doc.text(`Total geral: ${fmt(totalGeral)} unidades`, 14, finalY)
  doc.setFont(undefined,'normal'); doc.setFontSize(7); doc.setTextColor(150,150,150)
  doc.text('Laricas Fitness — Planejamento de Produção (reimpressão)', 14, 290)
  doc.save(`Producao_${plan.data_producao}_reimp.pdf`)
}

export default function HistoricoPlanejamento() {
  const hoje = new Date()
  const mesIni = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const [ini, setIni] = useState(mesIni)
  const [fim, setFim] = useState(hoje.toISOString().slice(0,10))
  const [planos, setPlanos] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(null)
  const [itensPorPlano, setItensPorPlano] = useState({})
  const [carregando, setCarregando] = useState({})

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('planejamentos')
      .select('id, data_producao, criado_em')
      .gte('data_producao', ini)
      .lte('data_producao', fim)
      .order('data_producao', { ascending: false })
    setPlanos(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [ini, fim])

  async function verDetalhes(plan) {
    if (expandido === plan.id) { setExpandido(null); return }
    setExpandido(plan.id)
    if (itensPorPlano[plan.id]) return
    setCarregando(prev => ({ ...prev, [plan.id]: true }))
    const { data } = await supabase
      .from('planejamento_itens')
      .select('*, embalagens(nome, codigo, categoria)')
      .eq('planejamento_id', plan.id)
      .order('quantidade_total', { ascending: false })
    setItensPorPlano(prev => ({ ...prev, [plan.id]: data || [] }))
    setCarregando(prev => ({ ...prev, [plan.id]: false }))
  }

  async function baixarPDF(plan) {
    let itens = itensPorPlano[plan.id]
    if (!itens) {
      const { data } = await supabase
        .from('planejamento_itens')
        .select('*, embalagens(nome, codigo, categoria)')
        .eq('planejamento_id', plan.id)
        .order('quantidade_total', { ascending: false })
      itens = data || []
      setItensPorPlano(prev => ({ ...prev, [plan.id]: itens }))
    }
    gerarPDF(plan, itens)
  }

  const totalGeral = planos.length

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
          <button className="btn btn-ghost" onClick={load}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* Lista de planos */}
      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Histórico de planejamentos</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{totalGeral} planejamento(s) no período</div>
        </div>

        {loading ? (
          <div className="loading"><RefreshCw size={14} className="spin" /> Carregando...</div>
        ) : planos.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <div className="empty-title">Nenhum planejamento no período</div>
            <div className="empty-sub">Os planejamentos são salvos ao exportar o PDF de Produção</div>
          </div>
        ) : (
          planos.map(plan => {
            const itens = itensPorPlano[plan.id] || []
            const exp = expandido === plan.id
            const total = itens.reduce((s, i) => s + i.quantidade_total, 0)

            return (
              <div key={plan.id}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '13px 20px', borderBottom: '1px solid var(--gray-100)', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--purple-dark)' }}>
                      {headerDia(plan.data_producao)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                      Salvo em {new Date(plan.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {total > 0 && ` · ${fmt(total)} unidades`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => verDetalhes(plan)}>
                      {exp ? '▲ Ocultar' : '▼ Ver detalhes'}
                    </button>
                    <button className="btn btn-gold btn-sm" onClick={() => baixarPDF(plan)}>
                      <FileText size={13} /> Baixar PDF
                    </button>
                  </div>
                </div>

                {exp && (
                  <div style={{ background: 'var(--gray-50)', padding: '14px 20px 14px 32px', borderBottom: '1px solid var(--gray-100)' }}>
                    {carregando[plan.id] ? (
                      <div className="loading" style={{ padding: 16 }}><RefreshCw size={14} className="spin" /></div>
                    ) : (
                      <table className="tbl" style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th style={{ textAlign: 'center' }}>Bling</th>
                            <th style={{ textAlign: 'center' }}>Delivery</th>
                            <th style={{ textAlign: 'center' }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ORDEM_CATS.map(cat => {
                            const grupo = itens.filter(i => (i.embalagens?.categoria || 'Outros') === cat && i.quantidade_total > 0)
                            if (!grupo.length) return null
                            return [
                              <tr key={`cat-${cat}`}>
                                <td colSpan={4} style={{ background: 'var(--purple-pale)', padding: '5px 12px', fontWeight: 800, fontSize: 11, color: 'var(--purple)', textTransform: 'uppercase' }}>
                                  {cat}
                                </td>
                              </tr>,
                              ...grupo.map(i => (
                                <tr key={i.id}>
                                  <td style={{ fontWeight: 600 }}>{i.embalagens?.nome}</td>
                                  <td style={{ textAlign: 'center', color: 'var(--gray-500)' }}>{i.quantidade_bling > 0 ? fmt(i.quantidade_bling) : '—'}</td>
                                  <td style={{ textAlign: 'center', color: 'var(--gray-500)' }}>{i.quantidade_delivery > 0 ? fmt(i.quantidade_delivery) : '—'}</td>
                                  <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--purple)' }}>{fmt(i.quantidade_total)}</td>
                                </tr>
                              ))
                            ]
                          })}
                          <tr>
                            <td colSpan={3} style={{ fontWeight: 800, textAlign: 'right', borderTop: '2px solid var(--gray-200)', paddingTop: 10 }}>Total geral</td>
                            <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 16, color: 'var(--purple)', borderTop: '2px solid var(--gray-200)', paddingTop: 10 }}>{fmt(total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
