import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, ShoppingCart } from 'lucide-react'
import { recalcularCustoMP } from './MatPrimas'
import { mesFechado, avisoMesFechado } from '../lib/cmv'
import { carregarComponentes, gravarComponentes } from '../lib/revenda'
import { MaterialNaMM, ModalLote } from './RevendaMM'
import { CATEGORIA_REVENDA, CHAVE_REVENDA_SKUS, carregarRevenda } from '../lib/dreLaricas'

// Estoque › Conferência › Revenda: mercadoria comprada pronta para revender (ex.: Wafer).
// Cada produto é um item de materias_primas com a categoria "Mercadoria para revenda", contado em unidades:
// compras por lote (NF da MM + frete + display e filme guardados na MM: src/lib/revenda.js), contagem aqui em displays + unidades
// avulsas (caixa aberta), gravada em conferencia_mp. O fechamento do CMV (fechamento_cmv) faz estoque inicial +
// compras − contagem do último dia do mês, e a DRE põe o resultado em "CMV - Mercadoria para revenda".

const POR_DISPLAY = 12   // padrão; vale o conteúdo da última compra lançada em display
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const brl = v => 'R$ ' + fmt(v, 2)
const dataBR = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—'
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const usuario = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }
const emDisplays = (q, n) => { const d = Math.floor((q || 0) / n), u = Math.round(((q || 0) - d * n) * 100) / 100; return `${fmt(d)} display${d === 1 ? '' : 's'}${u ? ` + ${fmt(u, u % 1 ? 1 : 0)} un` : ''}` }

export default function EstoqueRevenda() {
  const [itens, setItens] = useState(null)
  const [contagem, setContagem] = useState({})     // id → { displays, unidades }
  const [data, setData] = useState(hojeSP())
  const [lote, setLote] = useState(null)          // item do lote sendo lançado
  const [comp, setComp] = useState(null)          // display e filme na MM, e os lotes
  const [compraIds, setCompraIds] = useState(new Set())
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [skus, setSkus] = useState({})            // código no Bling → { item, un } (produtos que saem sem venda)
  const [skuPadrao, setSkuPadrao] = useState(false)
  const [novoSku, setNovoSku] = useState({})

  async function carregar() {
    carregarRevenda().then(r => { setSkus(r.skus); setSkuPadrao(r.padrao) }).catch(() => {})
    carregarComponentes().then(setComp).catch(e => setMsg({ tipo: 'danger', txt: e.message }))
    const { data: mps, error } = await supabase.from('materias_primas').select('*').eq('categoria', CATEGORIA_REVENDA).eq('ativo', true).order('nome')
    if (error) { setMsg({ tipo: 'danger', txt: error.message }); setItens([]); return }
    const ids = (mps || []).map(m => m.id)
    const [{ data: compras }, { data: confs }] = ids.length ? await Promise.all([
      supabase.from('mp_compras').select('id, materia_prima_id, quantidade, custo_total, data_compra, numero_nf, fornecedor, qtd_compra, unidade_compra, conteudo_embalagem').in('materia_prima_id', ids).order('data_compra', { ascending: false }).limit(200),
      supabase.from('conferencia_mp').select('id, materia_prima_id, data_conferencia, estoque_contado, estoque_sistema, responsavel, criado_em').in('materia_prima_id', ids).order('criado_em', { ascending: false }).limit(200),
    ]) : [{ data: [] }, { data: [] }]
    setCompraIds(new Set((compras || []).map(c => c.id)))
    setItens((mps || []).map(m => {
      const cs = (compras || []).filter(c => c.materia_prima_id === m.id)
      const emDisplay = cs.find(c => /display|caixa|cx/i.test(c.unidade_compra || '') && +c.conteudo_embalagem > 0)
      return { ...m, porDisplay: emDisplay ? +emDisplay.conteudo_embalagem : POR_DISPLAY, compras: cs.slice(0, 6),
        contagens: (confs || []).filter(c => c.materia_prima_id === m.id).slice(0, 6) }
    }))
  }
  useEffect(() => { carregar() }, [])

  const total = it => { const c = contagem[it.id] || {}; return (parseFloat(c.displays) || 0) * it.porDisplay + (parseFloat(c.unidades) || 0) }
  const lancados = (itens || []).filter(it => { const c = contagem[it.id]; return c && (c.displays !== '' && c.displays != null || c.unidades !== '' && c.unidades != null) })

  async function gravar() {
    if (!lancados.length) return
    setSalvando(true); setMsg(null)
    try {
      for (const it of lancados) {
        const contado = total(it), sistema = +it.estoque_atual || 0
        const { error } = await supabase.from('conferencia_mp').insert({
          materia_prima_id: it.id, data_conferencia: data, estoque_sistema: sistema, estoque_contado: contado,
          custo_unitario: +it.custo_unitario || 0, responsavel: usuario() || null,
          observacao: `Contagem de revenda: ${emDisplays(contado, it.porDisplay)} (${it.porDisplay} un por display) — sistema: ${sistema}`,
        })
        if (error) throw error
        const { error: e2 } = await supabase.from('materias_primas').update({ estoque_atual: contado, atualizado_em: new Date().toISOString() }).eq('id', it.id)
        if (e2) throw e2
      }
      setMsg({ tipo: 'ok', txt: `Contagem de ${dataBR(data)} gravada (${lancados.length} produto${lancados.length > 1 ? 's' : ''}).` })
      setContagem({}); await carregar()
    } catch (e) { setMsg({ tipo: 'danger', txt: 'Erro ao gravar: ' + (e.message || e) }) }
    setSalvando(false)
  }

  async function salvarSkus(novos) {
    setSkus(novos)
    const { error } = await supabase.from('configuracoes').upsert({ chave: CHAVE_REVENDA_SKUS, valor: JSON.stringify(novos),
      descricao: 'Mercadoria para revenda: código do produto no Bling → item de estoque e unidades (produtos que saem sem venda)', atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })
    if (error) setMsg({ tipo: 'danger', txt: 'Erro ao gravar os códigos: ' + error.message }); else setSkuPadrao(false)
  }

  async function mudarComponentes(novo) {
    try { await gravarComponentes(novo); setComp({ ...novo, padrao: false }) }
    catch (e) { setMsg({ tipo: 'danger', txt: 'Erro ao gravar: ' + e.message }) }
  }

  // Frete que chegou depois do lote: soma no custo da compra do lote
  async function lancarFrete(l, valor) {
    const v = +String(valor).replace(',', '.')
    if (!(v > 0)) return
    if (await mesFechado(l.data)) { alert(avisoMesFechado(l.data)); return }
    const { data: c, error } = await supabase.from('mp_compras').select('custo_total, observacao, materia_prima_id').eq('id', l.compraId).single()
    if (error) { setMsg({ tipo: 'danger', txt: error.message }); return }
    const { error: e2 } = await supabase.from('mp_compras').update({ custo_total: Math.round((+c.custo_total + v) * 100) / 100,
      observacao: `${c.observacao || ''} + frete ${brl(v)}` }).eq('id', l.compraId)
    if (e2) { setMsg({ tipo: 'danger', txt: e2.message }); return }
    await recalcularCustoMP(c.materia_prima_id)
    await mudarComponentes({ ...comp, lotes: comp.lotes.map(x => x.id === l.id ? { ...x, frete: v } : x) })
    carregar()
  }

  async function excluir(it, c) {
    if (!confirm(`Excluir a contagem de ${dataBR(c.data_conferencia)} de ${it.nome}?\nO estoque volta para ${fmt(c.estoque_sistema)} un.`)) return
    await supabase.from('materias_primas').update({ estoque_atual: c.estoque_sistema, atualizado_em: new Date().toISOString() }).eq('id', it.id)
    await supabase.from('conferencia_mp').delete().eq('id', c.id)
    carregar()
  }

  if (itens == null) return <div className="card card-pad"><RefreshCw size={13} className="spin" /> Carregando…</div>
  const fimDoMes = (() => { const [a, m] = data.split('-').map(Number); return new Date(a, m, 0).getDate() === +data.slice(8, 10) })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.5 }}>
        Mercadoria comprada pronta para revender. O CMV dela fecha como o da matéria-prima: <b>estoque inicial + compras − contagem do último dia do mês</b>,
        e vai para a conta "CMV - Mercadoria para revenda" da DRE. Conte no último dia de cada mês, em displays fechados + unidades da caixa aberta.
      </div>
      {msg && <div className={`alert-banner ${msg.tipo}`}>{msg.txt}</div>}
      {!itens.length && <div className="alert-banner warning">Nenhum produto com a categoria "{CATEGORIA_REVENDA}". Aplique o revenda.sql no Supabase (cadastra a Wafer).</div>}

      {itens.map(it => (
        <div key={it.id} className="card">
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}><b>{it.nome}</b> <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>· {it.porDisplay} un por display{it.fornecedor ? ` · ${it.fornecedor}` : ''}</span></div>
            <button className="btn btn-primary btn-sm" onClick={() => setLote(it)} disabled={!comp}><ShoppingCart size={13} /> Registrar lote recebido</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 10, padding: 14 }}>
            <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Estoque no sistema</div><div style={{ fontWeight: 800 }}>{emDisplays(+it.estoque_atual, it.porDisplay)}</div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{fmt(+it.estoque_atual)} un</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Custo por unidade</div><div style={{ fontWeight: 800 }}>{brl(+it.custo_unitario)}</div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{brl(+it.custo_unitario * it.porDisplay)} o display</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Valor em estoque</div><div style={{ fontWeight: 800 }}>{brl((+it.estoque_atual || 0) * (+it.custo_unitario || 0))}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Última contagem</div><div style={{ fontWeight: 800 }}>{it.contagens[0] ? dataBR(it.contagens[0].data_conferencia) : 'nunca'}</div></div>
          </div>
          <div style={{ padding: '0 14px 12px', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>Displays fechados<br /><input className="form-input" type="number" min={0} step={1} style={{ width: 120 }}
              value={contagem[it.id]?.displays ?? ''} onChange={e => setContagem(c => ({ ...c, [it.id]: { ...c[it.id], displays: e.target.value } }))} /></label>
            <label style={{ fontSize: 12 }}>+ Unidades (caixa aberta)<br /><input className="form-input" type="number" min={0} step={1} style={{ width: 150 }}
              value={contagem[it.id]?.unidades ?? ''} onChange={e => setContagem(c => ({ ...c, [it.id]: { ...c[it.id], unidades: e.target.value } }))} /></label>
            {lancados.includes(it) && <div style={{ fontSize: 13, paddingBottom: 8 }}>= <b>{fmt(total(it))} un</b>
              <span style={{ color: 'var(--gray-500)' }}> (sistema {fmt(+it.estoque_atual)} un · diferença {fmt(total(it) - (+it.estoque_atual || 0))})</span></div>}
          </div>
          <div style={{ padding: '0 14px 12px', fontSize: 12 }}>
            <b>Códigos no Bling</b> <span style={{ color: 'var(--gray-500)' }}>(quando sai em bonificação, degustação, premiação, marketing ou voucher, o custo sai do CMV de revenda e vai para o marketing)</span>
            {skuPadrao && <div style={{ color: 'var(--warning, #b45309)' }}>Padrão do sistema: confira as unidades e clique em Gravar códigos.</div>}
            {Object.entries(skus).filter(([, v]) => v.item === it.id).map(([k, v]) => <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <code style={{ flex: '1 1 220px' }}>{k}</code>
              <input className='form-input' type='number' min={1} step={1} style={{ width: 80 }} value={v.un} onChange={e => setSkus(s => ({ ...s, [k]: { ...v, un: e.target.value } }))} /> un
              <span style={{ color: 'var(--gray-500)' }}>= {brl((+v.un || 0) * (+it.custo_unitario || 0))}</span>
              <button className='btn btn-ghost btn-sm' onClick={() => { const n = { ...skus }; delete n[k]; salvarSkus(n) }} title='Tirar este código'>✕</button></div>)}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
              <input className='form-input' placeholder='Novo código (SKU do Bling)' style={{ flex: '1 1 220px' }} value={novoSku[it.id]?.k || ''} onChange={e => setNovoSku(n => ({ ...n, [it.id]: { ...n[it.id], k: e.target.value } }))} />
              <input className='form-input' type='number' min={1} placeholder='un' style={{ width: 80 }} value={novoSku[it.id]?.un || ''} onChange={e => setNovoSku(n => ({ ...n, [it.id]: { ...n[it.id], un: e.target.value } }))} />
              <button className='btn btn-ghost btn-sm' disabled={!novoSku[it.id]?.k?.trim()} onClick={() => { const x = novoSku[it.id]; salvarSkus({ ...skus, [x.k.trim()]: { item: it.id, un: +x.un || 1 } }); setNovoSku(n => ({ ...n, [it.id]: {} })) }}>+ Código</button>
              <button className='btn btn-primary btn-sm' onClick={() => salvarSkus(Object.fromEntries(Object.entries(skus).map(([k, v]) => [k, { ...v, un: +v.un || 1 }])))}><Save size={13} /> Gravar códigos</button>
            </div>
          </div>
          {(it.compras.length > 0 || it.contagens.length > 0) && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 10, padding: '0 14px 12px', fontSize: 12 }}>
            <div><b>Últimas compras</b>{it.compras.length ? it.compras.map((c, i) => <div key={i}>{dataBR(c.data_compra)} · {c.qtd_compra && c.unidade_compra ? `${fmt(+c.qtd_compra)} ${c.unidade_compra} = ` : ''}{fmt(+c.quantidade)} un · {brl(+c.custo_total)}{c.numero_nf ? ` · NF ${c.numero_nf}` : ''}</div>) : <div style={{ color: 'var(--gray-500)' }}>nenhuma</div>}</div>
            <div><b>Últimas contagens</b>{it.contagens.length ? it.contagens.map(c => <div key={c.id}>{dataBR(c.data_conferencia)} · {emDisplays(+c.estoque_contado, it.porDisplay)} ({fmt(+c.estoque_contado)} un){c.responsavel ? ` · ${c.responsavel}` : ''}
              <button className="btn btn-ghost btn-sm" style={{ padding: '0 6px', marginLeft: 4 }} onClick={() => excluir(it, c)} title="Excluir esta contagem">✕</button></div>) : <div style={{ color: 'var(--gray-500)' }}>nenhuma</div>}</div>
          </div>}
        </div>
      ))}

      {itens.length > 0 && <div className="card card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>Data da contagem <input className="form-input" type="date" value={data} max={hojeSP()} onChange={e => e.target.value && setData(e.target.value)} style={{ width: 160 }} /></label>
        {!fimDoMes && <span style={{ fontSize: 12, color: 'var(--warning, #b45309)' }}>Para o CMV, a contagem que vale é a do último dia do mês.</span>}
        <button className="btn btn-primary btn-sm" onClick={gravar} disabled={salvando || !lancados.length}>{salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Gravar contagem</button>
      </div>}

      {comp && itens.length > 0 && <MaterialNaMM cfg={comp} compraIds={compraIds} onMudou={mudarComponentes} onFrete={lancarFrete} />}
      {lote && comp && <ModalLote item={lote} cfg={comp} compraIds={compraIds} onClose={() => setLote(null)}
        onSalvo={async novo => { setLote(null); setComp({ ...novo, padrao: false }); await carregar() }} />}
    </div>
  )
}
