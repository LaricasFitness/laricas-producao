import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { carregarStatusCompleto, gerarNumeroPedido, statusCfg } from '../lib/data'
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
  if (obs) { doc.setTextColor(100,60,140); doc.text(`Obs: ${obs}`, 14, 64) }

  // Agrupa por categoria
  const porCat = {}
  for (const i of itens) {
    const cat = i.categoria || 'Outros'
    if (!porCat[cat]) porCat[cat] = []
    porCat[cat].push(i)
  }

  const body = []
  for (const [cat, citens] of Object.entries(porCat).sort()) {
    // Linha de categoria
    body.push([{
      content: cat,
      colSpan: 3,
      styles: { fillColor: [103,63,124], textColor: 255, fontStyle: 'bold', fontSize: 9, cellPadding: 3 }
    }])
    for (const i of citens) {
      body.push([
        { content: i.codigo, styles: { fontFamily: 'monospace', fontSize: 9, textColor: [120,80,140] } },
        i.nome,
        { content: `${i.qtd.toLocaleString('pt-BR')} un`, styles: { halign: 'right', fontStyle: 'bold' } },
      ])
    }
  }

  autoTable(doc, {
    startY: obs ? 72 : 65,
    head: [['Código', 'Embalagem', 'Qtd solicitada']],
    body,
    styles: { fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [60, 35, 80], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 240, 248] },
    columnStyles: {
      0: { cellWidth: 36 },
      2: { halign: 'right', fontStyle: 'bold', cellWidth: 34 },
    },
  })

  const fy = doc.lastAutoTable.finalY + 12
  const total = itens.reduce((s, i) => s + i.qtd, 0)
  doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(60, 35, 80)
  doc.text(`Total geral: ${total.toLocaleString('pt-BR')} unidades`, 14, fy)
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 150)
  doc.text('Laricas Fitness — Sistema de Controle de Embalagens', 14, 285)
  doc.text(hoje.toLocaleString('pt-BR'), 155, 285)
  doc.save(`Pedido_${numero}.pdf`)
}

function ModalNovoPedido({ onClose, onSaved }) {
  const [embs, setEmbs] = useState([])
  const [qtds, setQtds] = useState({})
  const [obs, setObs] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tipoFiltro, setTipoFiltro] = useState('todos')

  useEffect(() => {
    async function load() {
      const { data: embsData } = await supabase
        .from('embalagens')
        .select('id, codigo, nome, categoria, tipo, unidade_minima_grafica')
        .eq('ativo', true)
        .order('tipo').order('categoria').order('nome')

      if (!embsData) { setLoading(false); return }

      // Usa as mesmas funções do Dashboard — estoque cronológico + média por dias produtivos
      const { calcularEstoqueCronologico, calcularMedia } = await import('../lib/data.js')

      const resultados = await Promise.all(embsData.map(async emb => {
        const [estoque, media] = await Promise.all([
          calcularEstoqueCronologico(emb.id),
          calcularMedia(emb.id),
        ])

        const DIAS = 15
        const MARGEM = 0.10
        const minimoIdeal = Math.ceil(media * DIAS * (1 + MARGEM))
        const falta = Math.max(0, minimoIdeal - estoque)
        const minG = emb.unidade_minima_grafica || 100
        const qtdPedido = falta > 0 ? Math.ceil(falta / minG) * minG : 0

        return { ...emb, estoque_real: estoque, media: Math.round(media * 10) / 10, minimoIdeal, qtdPedido }
      }))

      setEmbs(resultados)
      const pre = {}
      resultados.filter(e => e.qtdPedido > 0).forEach(e => { pre[e.id] = e.qtdPedido })
      setQtds(pre)
      setLoading(false)
    }
    load()
  }, [])

  const selecionadas = embs.filter(e => parseInt(qtds[e.id]||0) > 0)

  async function salvar() {
    if (selecionadas.length === 0) { alert('Selecione pelo menos uma embalagem.'); return }
    setSaving(true)
    try {
      const numero = gerarNumeroPedido()
      const hoje = new Date().toISOString().slice(0, 10)
      const prev = new Date(); prev.setDate(prev.getDate() + 10)
      const { data: pedido, error: pe } = await supabase
        .from('pedidos_grafica')
        .insert({ numero, status:'enviado', enviado_em:hoje, previsao_entrega:prev.toISOString().slice(0,10), observacoes:obs||null })
        .select().single()
      if (pe) throw pe
      await supabase.from('pedido_itens').insert(
        selecionadas.map(e => ({ pedido_id:pedido.id, embalagem_id:e.id, quantidade_solicitada:parseInt(qtds[e.id]) }))
      )
      gerarPDF(numero, selecionadas.map(e => ({ codigo:e.codigo, nome:e.nome, qtd:parseInt(qtds[e.id]), categoria:e.categoria })), obs)
      onSaved()
    } catch(e) { alert('Erro: ' + e.message) }
    setSaving(false)
  }

  const TIPOS = ['todos','rotulo','embalagem']
  const filtradas = embs.filter(e => tipoFiltro==='todos' || e.tipo===tipoFiltro)
  const cats = [...new Set(filtradas.map(e=>e.categoria))]

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:700,maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📦 Novo Pedido à Gráfica</div>
            <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>
              {selecionadas.length} item(s) selecionado(s) · {selecionadas.reduce((s,e)=>s+parseInt(qtds[e.id]||0),0).toLocaleString('pt-BR')} unidades
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Filtro tipo */}
          <div style={{display:'flex',gap:6,marginBottom:14}}>
            {TIPOS.map(t=>(
              <button key={t} onClick={()=>setTipoFiltro(t)}
                className={`btn btn-sm ${tipoFiltro===t?'btn-primary':'btn-ghost'}`}>
                {t==='todos'?'Todos':t==='rotulo'?'Rótulos':'Embalagens'}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}>
              <RefreshCw size={20} className="spin" style={{color:'var(--purple)'}}/> 
              <div style={{marginTop:8}}>Carregando...</div>
            </div>
          ) : (
            cats.map(cat => {
              const grupo = filtradas.filter(e=>e.categoria===cat)
              if (!grupo.length) return null
              return (
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontWeight:800,fontSize:12,color:'var(--purple)',textTransform:'uppercase',
                    letterSpacing:'.05em',padding:'6px 0',borderBottom:'2px solid var(--purple-pale)',marginBottom:8}}>
                    {cat}
                  </div>
                  {grupo.map(e => {
                    const qtd = parseInt(qtds[e.id]||0)
                    const selecionado = qtd > 0
                    return (
                      <div key={e.id} style={{
                        display:'grid',gridTemplateColumns:'1fr 80px 90px',gap:10,alignItems:'center',
                        padding:'7px 10px',borderRadius:6,marginBottom:4,
                        background:selecionado?'var(--purple-pale)':'var(--gray-50)',
                        border:`1px solid ${selecionado?'var(--purple)':'var(--gray-200)'}`,
                      }}>
                        <div>
                          <div style={{fontWeight:selecionado?700:400,fontSize:13}}>{e.nome}</div>
                          <div style={{fontSize:11,color:'var(--gray-400)'}}>
                            Estoque: {e.estoque_real.toLocaleString('pt-BR')} · Média: {e.media}/dia · Ideal 15d: {(e.minimoIdeal||0).toLocaleString('pt-BR')}
                          </div>
                        </div>
                        <div style={{fontSize:11,color:e.qtdPedido>0?'var(--danger)':'var(--ok)',textAlign:'right',fontWeight:700}}>
                          {e.qtdPedido>0?`Pedir ${e.qtdPedido.toLocaleString('pt-BR')}`:'OK'}
                        </div>
                        <input type="number" min={0} step={e.unidade_minima_grafica||100}
                          value={qtds[e.id]||''}
                          onChange={ev=>setQtds(p=>({...p,[e.id]:ev.target.value}))}
                          placeholder="0"
                          style={{padding:'5px 8px',fontSize:13,border:`1.5px solid ${selecionado?'var(--purple)':'var(--gray-200)'}`,
                            borderRadius:6,outline:'none',textAlign:'right',
                            background:selecionado?'#fff':'transparent'}}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}

          <div className="form-group" style={{marginTop:8}}>
            <label className="form-label">Observações</label>
            <textarea className="form-input" rows={2} value={obs} onChange={e=>setObs(e.target.value)}
              placeholder="Instruções especiais, prazo, etc." style={{resize:'vertical'}}/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving||selecionadas.length===0}>
            {saving?<><RefreshCw size={14} className="spin"/> Salvando...</>:<>Criar pedido ({selecionadas.length} itens)</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalCadastrarEmbalagem({ extra, onClose, onSalvar }) {
  const CATS = ['Pão de Mel 100g','Pão de Mel 30g','Barra 180g','Potão 280g','Potinho 60g','Outros']
  const [form, setForm] = useState({ nome: extra.nome, codigo: '', categoria: CATS[0], tipo: 'rotulo' })
  const set = (k,v) => setForm(p=>({...p,[k]:v}))
  const [saving, setSaving] = useState(false)
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">Cadastrar embalagem no sistema</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ padding:'8px 12px', background:'var(--purple-pale)', borderRadius:6, fontSize:12, marginBottom:12 }}>
            Estoque inicial será definido como <strong>{extra.qtd} un</strong> (quantidade recebida hoje)
          </div>
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input className="form-input" value={form.nome} onChange={e=>set('nome',e.target.value)} autoFocus />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Código / SKU *</label>
              <input className="form-input" value={form.codigo} onChange={e=>set('codigo',e.target.value.toUpperCase())} placeholder="Ex: ROT_PAO100" />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select className="form-input" value={form.tipo} onChange={e=>set('tipo',e.target.value)}>
                <option value="rotulo">🏷️ Rótulo</option>
                <option value="embalagem">📦 Embalagem primária</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Categoria</label>
            <select className="form-input" value={form.categoria} onChange={e=>set('categoria',e.target.value)}>
              {CATS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving||!form.nome||!form.codigo}
            onClick={async()=>{ setSaving(true); await onSalvar(extra, form); setSaving(false) }}>
            {saving ? <RefreshCw size={14} className="spin"/> : '✓ Cadastrar e registrar estoque'}
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
  const [itensExtras, setItensExtras] = useState([])
  const [novoItem, setNovoItem] = useState({ nome: '', qtd: '' })
  const [cadastrando, setCadastrando] = useState(null)
  const [valorTotal, setValorTotal] = useState('')

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

  function adicionarItemExtra() {
    if (!novoItem.nome.trim() || !novoItem.qtd) return
    setItensExtras(prev => [...prev, { id: `extra-${Date.now()}`, nome: novoItem.nome.trim(), qtd: parseInt(novoItem.qtd) || 0, cadastrado: false }])
    setNovoItem({ nome: '', qtd: '' })
  }

  async function cadastrarNoSistema(extra, form) {
    try {
      const { data: emb } = await supabase.from('embalagens').insert({
        nome: form.nome, codigo: form.codigo, categoria: form.categoria,
        tipo: form.tipo, estoque_atual: extra.qtd, estoque_minimo: 0,
        visivel_estoque: true, visivel_producao: form.tipo === 'rotulo', ativo: true,
      }).select().single()
      if (emb) {
        await supabase.from('inventarios').insert({
          embalagem_id: emb.id, quantidade: extra.qtd,
          data_inventario: dataRec, criado_em: new Date().toISOString(),
        })
        setItensExtras(prev => prev.map(x => x.id === extra.id ? { ...x, cadastrado: true } : x))
      }
      setCadastrando(null)
    } catch(e) { alert('Erro ao cadastrar: ' + e.message) }
  }

  async function salvar() {
    setSaving(true)
    try {
      // Itens cadastrados
      for (const item of itens) {
        const qtd = parseInt(recebidos[item.id]) || 0
        await supabase.from('pedido_itens')
          .update({ quantidade_recebida: qtd, recebido_em: dataRec })
          .eq('id', item.id)
        const estoqueAtual = item.embalagens?.estoque_atual || 0
        await supabase.from('embalagens')
          .update({ estoque_atual: estoqueAtual + qtd, atualizado_em: new Date().toISOString() })
          .eq('id', item.embalagem_id)
      }

      // Itens extras — registra no log
      for (const extra of itensExtras) {
        if (extra.qtd <= 0) continue
        await supabase.from('log_acoes').insert({
          acao: 'recebimento_extra_grafica',
          descricao: `Recebimento não cadastrado: "${extra.nome}" — ${extra.qtd} un (pedido #${pedido.numero})`,
          tabela: 'pedidos_grafica',
          dados_novos: { nome: extra.nome, qtd: extra.qtd, data: dataRec, pedido: pedido.numero },
        })
      }

      const todosOk = itens.every(i => parseInt(recebidos[i.id]) === i.quantidade_solicitada)
      const temExtras = itensExtras.some(e => e.qtd > 0)
      const novoStatus = todosOk && !temExtras ? 'recebido_total' : 'recebido_parcial'

      // Integração financeira — cria ou atualiza Conta a Pagar
      const valor = parseFloat(String(valorTotal).replace(',', '.')) || 0
      if (valor > 0) {
        // Busca fornecedor PressPlate
        const { data: fornecedor } = await supabase
          .from('fin_fornecedores').select('id').eq('nome_fantasia', 'PressPlate').maybeSingle()

        // Vencimento = data recebimento + 30 dias
        const venc = new Date(dataRec); venc.setDate(venc.getDate() + 30)
        const vencStr = venc.toISOString().slice(0, 10)

        if (pedido.fin_lancamento_id) {
          // Atualiza lançamento existente
          await supabase.from('fin_lancamentos').update({
            valor_total: valor,
            fornecedor_id: fornecedor?.id || null,
          }).eq('id', pedido.fin_lancamento_id)
          await supabase.from('fin_parcelas').update({
            valor, data_vencimento: vencStr, data_competencia: dataRec,
          }).eq('lancamento_id', pedido.fin_lancamento_id)
        } else {
          // Cria novo lançamento de Conta a Pagar
          const { data: lanc } = await supabase.from('fin_lancamentos').insert({
            tipo: 'despesa',
            descricao: `Embalagens gráfica — Pedido ${pedido.numero}`,
            valor_total: valor,
            fornecedor_id: fornecedor?.id || null,
            total_parcelas: 1,
            criado_por: 'sistema',
          }).select().single()

          if (lanc) {
            await supabase.from('fin_parcelas').insert({
              lancamento_id: lanc.id,
              numero_parcela: 1,
              valor,
              data_vencimento: vencStr,
              data_competencia: dataRec,
              status: 'em_aberto',
            })
            // Vincula pedido ao lançamento
            await supabase.from('pedidos_grafica')
              .update({ fin_lancamento_id: lanc.id }).eq('id', pedido.id)
          }
        }
      }

      await supabase.from('pedidos_grafica').update({ status: novoStatus }).eq('id', pedido.id)
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
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
              <label className="form-label">Data de recebimento</label>
              <input type="date" className="form-input" value={dataRec} onChange={e => setDataRec(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
              <label className="form-label">
                💰 Valor total da nota (R$)
                <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 6 }}>→ vence em 30 dias</span>
              </label>
              <input type="number" className="form-input" step="0.01" min="0"
                value={valorTotal} onChange={e => setValorTotal(e.target.value)}
                placeholder="0,00" />
              {pedido.fin_lancamento_id
                ? <div style={{ fontSize: 11, color: 'var(--ok)', marginTop: 3 }}>✓ Vinculado ao financeiro — atualiza valor existente</div>
                : <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 3 }}>Preencha para criar Conta a Pagar no financeiro</div>
              }
            </div>
          </div>
          {loading ? <div className="loading"><RefreshCw size={16} className="spin" /></div> : (
            <>
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

            {/* Itens extras não cadastrados */}
            <div style={{ marginTop: 16, borderTop: '1px solid var(--gray-200)', paddingTop: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gray-600)', marginBottom: 8 }}>
                📦 Itens recebidos não cadastrados no sistema
              </div>
              {itensExtras.length > 0 && (
                <table className="tbl" style={{ marginBottom: 10 }}>
                  <thead><tr><th>Descrição</th><th>Qtd</th><th></th></tr></thead>
                  <tbody>
                    {itensExtras.map(e => (
                      <tr key={e.id} style={{ background: e.cadastrado ? '#f0fdf4' : undefined }}>
                        <td>
                          <input className="form-input" value={e.nome} disabled={e.cadastrado}
                            onChange={ev => setItensExtras(prev => prev.map(x => x.id===e.id ? {...x, nome:ev.target.value} : x))}
                            style={{ fontSize: 13, padding: '5px 8px' }} />
                        </td>
                        <td>
                          <input type="number" min={1} className="qty-input" value={e.qtd} disabled={e.cadastrado}
                            onChange={ev => setItensExtras(prev => prev.map(x => x.id===e.id ? {...x, qtd:parseInt(ev.target.value)||0} : x))} />
                        </td>
                        <td>
                          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                            {e.cadastrado
                              ? <span style={{ fontSize:11, color:'var(--ok)', fontWeight:700 }}>✓ Cadastrado</span>
                              : <button className="btn btn-ghost btn-xs" style={{ color:'var(--purple)', whiteSpace:'nowrap' }}
                                  onClick={() => setCadastrando(cadastrando===e.id ? null : e.id)}>
                                  + Cadastrar
                                </button>
                            }
                            {!e.cadastrado && <button className="btn btn-ghost btn-xs" style={{ color:'var(--danger)' }}
                              onClick={() => setItensExtras(prev => prev.filter(x => x.id !== e.id))}>✕</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* Mini-form de cadastro inline */}
                    {cadastrando && (() => {
                      const extra = itensExtras.find(x => x.id === cadastrando)
                      if (!extra) return null
                      return <ModalCadastrarEmbalagem extra={extra} onClose={() => setCadastrando(null)} onSalvar={cadastrarNoSistema} />
                    })()}
                  </tbody>
                </table>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="form-input" placeholder="Nome / descrição do item"
                  value={novoItem.nome} onChange={e => setNovoItem(p => ({...p, nome: e.target.value}))}
                  onKeyDown={e => e.key === 'Enter' && adicionarItemExtra()}
                  style={{ flex: 1, fontSize: 13 }} />
                <input type="number" min={1} className="form-input" placeholder="Qtd"
                  value={novoItem.qtd} onChange={e => setNovoItem(p => ({...p, qtd: e.target.value}))}
                  onKeyDown={e => e.key === 'Enter' && adicionarItemExtra()}
                  style={{ width: 80, fontSize: 13 }} />
                <button className="btn btn-ghost btn-sm" onClick={adicionarItemExtra}
                  disabled={!novoItem.nome.trim() || !novoItem.qtd}>
                  + Adicionar
                </button>
              </div>
              {itensExtras.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 6 }}>
                  ℹ️ Itens não cadastrados são registrados no log para referência. Cadastre no Admin para controlar o estoque.
                </div>
              )}
            </div>
            </>
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

export default function Pedidos({ abrirNovo, onNovoClosed, tipo = 'rotulo' }) {
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
                {/* Gerar PDF novamente */}
                <button className="btn btn-ghost btn-sm" title="Gerar PDF"
                  onClick={async () => {
                    // Carrega itens se ainda não carregados
                    let itens = itensPedido[p.id]
                    if (!itens) {
                      const { data } = await supabase.from('pedido_itens')
                        .select('*, embalagens(codigo, nome, categoria)').eq('pedido_id', p.id)
                      itens = data || []
                      setItensPedido(prev => ({ ...prev, [p.id]: itens }))
                    }
                    gerarPDF(p.numero, itens.map(i => ({
                      codigo: i.embalagens?.codigo,
                      nome: i.embalagens?.nome,
                      categoria: i.embalagens?.categoria,
                      qtd: i.quantidade_solicitada,
                    })), p.observacao || '')
                  }}>
                  📄 PDF
                </button>
                {(p.status === 'enviado' || p.status === 'recebido_parcial') && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConferindo(p)}>
                    📥 Conferir
                  </button>
                )}
                {/* Excluir pedido */}
                <button className="btn btn-ghost btn-sm" title="Excluir pedido"
                  style={{ color: 'var(--danger)' }}
                  onClick={async () => {
                    if (!window.confirm(`Excluir pedido ${p.numero}? Esta ação não pode ser desfeita.`)) return
                    await supabase.from('pedido_itens').delete().eq('pedido_id', p.id)
                    await supabase.from('pedidos_grafica').delete().eq('id', p.id)
                    load()
                  }}>
                  🗑️
                </button>
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
