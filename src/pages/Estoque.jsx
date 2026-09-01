import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, FileSpreadsheet } from 'lucide-react'
import { baixarXlsx } from '../lib/xlsx'

function fmt(n, d = 2) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) }
function fmtR(n) { return `R$ ${fmt(n, 2)}` }
function fmtQ(n, un) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1000 && (un === 'g' || un === 'ml')) return `${fmt(v / 1000, 2)} ${un === 'g' ? 'kg' : 'l'}`
  return `${fmt(v, 1)} ${un || ''}`
}

// Pega a contagem mais recente de cada item até uma data
function contagensAte(registros, campoData, campoItem, campoQtd, dataLimite) {
  const mapa = {}
  for (const r of registros) {
    const d = r[campoData]
    if (!d || d > dataLimite) continue
    const k = r[campoItem]
    if (!mapa[k] || d > mapa[k].data || (d === mapa[k].data && r.criado_em > mapa[k].criado_em)) {
      mapa[k] = { data: d, criado_em: r.criado_em, qtd: parseFloat(r[campoQtd]) || 0 }
    }
  }
  return mapa
}

// Coage resultado de query para array — tolera tabela/coluna inexistente (404)
function arr(x) {
  if (Array.isArray(x)) return x
  if (x && Array.isArray(x.data)) return x.data
  return []
}

export default function ControleEstoque() {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7))
  const [vista, setVista] = useState('real')
  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [mes])

  async function load() {
    setLoading(true)
    const ini = mes + '-01'
    const fim = new Date(mes.slice(0, 4), mes.slice(5, 7), 0).toISOString().slice(0, 10)

    const q = (p) => p.then(r => r).catch(() => ({ data: [] }))
    const [
      rMps, rConfMP, rComprasMP,
      rEmbs, rConfEmb, rRecItens,
      rProducao, rProdComps, rPreps, rPrepComps,
      rCatEmbs,
    ] = await Promise.all([
      q(supabase.from('materias_primas').select('id,nome,unidade,categoria,custo_unitario').eq('ativo', true)),
      q(supabase.from('conferencia_mp').select('materia_prima_id,data_conferencia,estoque_contado,criado_em')),
      q(supabase.from('mp_compras').select('materia_prima_id,quantidade,custo_total,data_compra')
        .gte('data_compra', ini).lte('data_compra', fim)),
      q(supabase.from('embalagens').select('id,codigo,nome,categoria,tipo,custo_unitario').eq('ativo', true)),
      q(supabase.from('conferencia_estoque').select('embalagem_id,data_conferencia,estoque_contado,criado_em')),
      q(supabase.from('recebimento_itens')
        .select('embalagem_id,quantidade_recebida,valor_unitario,recebimentos(data_recebimento)')),
      q(supabase.from('producao_diaria').select('embalagem_id,quantidade')
        .gte('data_producao', ini).lte('data_producao', fim)
        .not('registrado_por', 'ilike', '%(auto-embalagem)%')),
      q(supabase.from('produto_composicao').select('sku_produto,preparacao_id,quantidade_por_unidade')),
      q(supabase.from('preparacoes').select('id,nome,tipo,rendimento_estimado,rendimento_real_medio,perda_percentual')),
      q(supabase.from('preparacao_composicao').select('preparacao_id,quantidade,materia_prima_id,sub_preparacao_id')),
      q(supabase.from('categoria_embalagem').select('categoria,quantidade,embalagens(custo_unitario)')),
    ])

    const mps = arr(rMps), confMP = arr(rConfMP), comprasMP = arr(rComprasMP)
    const embs = arr(rEmbs), confEmb = arr(rConfEmb), recItens = arr(rRecItens)
    const producao = arr(rProducao), prodComps = arr(rProdComps)
    const preps = arr(rPreps), prepComps = arr(rPrepComps), catEmbs = arr(rCatEmbs)

    const mpMap = {}; for (const m of (mps || [])) mpMap[m.id] = m
    const embMap = {}; for (const e of (embs || [])) embMap[e.id] = e
    const prepMap = {}; for (const p of (preps || [])) prepMap[p.id] = p

    // ═══ CONTROLE 1: consumo por inventário ═══
    const buildInventario = (itens, conferencias, entradas, chaveItem, mapaItens) => {
      const cIni = contagensAte(conferencias, 'data_conferencia', chaveItem, 'estoque_contado', ini)
      const cFim = contagensAte(conferencias, 'data_conferencia', chaveItem, 'estoque_contado', fim)
      const linhas = []
      let temIni = false, temFim = false
      for (const item of itens) {
        const inicial = cIni[item.id]
        const final = cFim[item.id]
        // Só conta como final se for contagem posterior à inicial
        const finalValido = final && (!inicial || final.data > inicial.data || final.criado_em > inicial.criado_em)
        if (inicial) temIni = true
        if (finalValido) temFim = true
        const ent = entradas.filter(e => e[chaveItem] === item.id)
        const entQtd = ent.reduce((s, e) => s + (parseFloat(e.qtd) || 0), 0)
        const entVal = ent.reduce((s, e) => s + (parseFloat(e.valor) || 0), 0)
        const qIni = inicial?.qtd ?? null
        const qFim = finalValido ? final.qtd : null
        const preco = parseFloat(item.custo_unitario) || 0
        const consumoQtd = (qIni !== null && qFim !== null) ? qIni + entQtd - qFim : null
        const consumoVal = consumoQtd !== null ? (qIni * preco) + entVal - (qFim * preco) : null
        if (qIni === null && qFim === null && entQtd === 0) continue
        linhas.push({
          item, qIni, qFim, entQtd, entVal, preco, consumoQtd, consumoVal,
          dataIni: inicial?.data, dataFim: finalValido ? final.data : null,
        })
      }
      return { linhas, temIni, temFim }
    }

    const entradasMP = (comprasMP || []).map(c => ({
      materia_prima_id: c.materia_prima_id, qtd: c.quantidade, valor: c.custo_total,
    }))
    const entradasEmb = (recItens || [])
      .filter(r => {
        const d = r.recebimentos?.data_recebimento
        return d && d >= ini && d <= fim
      })
      .map(r => ({
        embalagem_id: r.embalagem_id,
        qtd: r.quantidade_recebida,
        valor: (parseFloat(r.quantidade_recebida) || 0) * (parseFloat(r.valor_unitario) || 0),
      }))

    const invMP = buildInventario(mps || [], confMP || [], entradasMP, 'materia_prima_id', mpMap)
    const invEmb = buildInventario(embs || [], confEmb || [], entradasEmb, 'embalagem_id', embMap)

    // ═══ CONTROLE 2: CMV pela produção × ficha ═══
    const cache = {}
    function custoPrepPorG(prepId, vis = new Set()) {
      if (cache[prepId] !== undefined) return cache[prepId]
      if (vis.has(prepId)) return 0
      const v = new Set([...vis, prepId])
      const prep = prepMap[prepId]; if (!prep) return 0
      const ings = (prepComps || []).filter(c => c.preparacao_id === prepId)
      const custo = ings.reduce((s, ing) => {
        if (ing.sub_preparacao_id) return s + (parseFloat(ing.quantidade) || 0) * custoPrepPorG(ing.sub_preparacao_id, v)
        const mp = mpMap[ing.materia_prima_id]
        return s + (parseFloat(ing.quantidade) || 0) * (parseFloat(mp?.custo_unitario) || 0)
      }, 0)
      const real = parseFloat(prep.rendimento_real_medio) || null
      const rendLiq = real ? real : (parseFloat(prep.rendimento_estimado) || 1) * (1 - (parseFloat(prep.perda_percentual) || 0) / 100)
      cache[prepId] = rendLiq > 0 ? custo / rendLiq : 0
      return cache[prepId]
    }

    const custoEmbCat = {}
    for (const ce of (catEmbs || [])) {
      custoEmbCat[ce.categoria] = (custoEmbCat[ce.categoria] || 0)
        + (parseFloat(ce.quantidade) || 1) * (parseFloat(ce.embalagens?.custo_unitario) || 0)
    }

    const skusComFicha = new Set((prodComps || []).map(p => p.sku_produto))
    const prodPorSku = {}
    for (const p of (producao || [])) {
      const emb = embMap[p.embalagem_id]
      if (!emb) continue
      if (emb.tipo !== 'rotulo' && !skusComFicha.has(emb.codigo)) continue
      if (!prodPorSku[emb.codigo]) prodPorSku[emb.codigo] = { emb, qtd: 0 }
      prodPorSku[emb.codigo].qtd += p.quantidade
    }

    const produzidos = Object.values(prodPorSku).map(({ emb, qtd }) => {
      const comps = (prodComps || []).filter(c => c.sku_produto === emb.codigo)
      const mpUnit = comps.reduce((s, c) =>
        s + custoPrepPorG(c.preparacao_id) * (parseFloat(c.quantidade_por_unidade) || 0), 0)
      const embUnit = (parseFloat(emb.custo_unitario) || 0) + (custoEmbCat[emb.categoria] || 0)
      return { emb, qtd, mpUnit, embUnit, cmvUnit: mpUnit + embUnit, total: (mpUnit + embUnit) * qtd }
    }).sort((a, b) => b.total - a.total)

    const cmvMP = produzidos.reduce((s, p) => s + p.mpUnit * p.qtd, 0)
    const cmvEmb = produzidos.reduce((s, p) => s + p.embUnit * p.qtd, 0)
    const unidades = produzidos.reduce((s, p) => s + p.qtd, 0)

    setDados({ invMP, invEmb, produzidos, cmvMP, cmvEmb, unidades, ini, fim })
    setLoading(false)
  }

  const labelMes = new Date(mes + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const totalMP = dados?.invMP.linhas.reduce((s, l) => s + (l.consumoVal || 0), 0) || 0
  const totalEmb = dados?.invEmb.linhas.reduce((s, l) => s + (l.consumoVal || 0), 0) || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>📦 Controle de Estoque e CMV</div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
          {[['real', '📊 Consumo Real'], ['produzido', '🏭 CMV Produzido'], ['comparar', '🔀 Comparação']].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${vista === k ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setVista(k)}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input type="month" className="form-input" value={mes} onChange={e => setMes(e.target.value)}
          style={{ width: 170, fontSize: 13 }} />
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /></button>
      </div>

      {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : !dados ? null : (
        <>
          {/* ═══ CONSUMO REAL ═══ */}
          {vista === 'real' && (
            <>
              {[
                { titulo: '🧂 Matéria-prima', inv: dados.invMP, total: totalMP },
                { titulo: '📦 Embalagens e rótulos', inv: dados.invEmb, total: totalEmb },
              ].map(({ titulo, inv, total }) => (
                <div key={titulo} className="card">
                  <div style={{ padding: '12px 20px', background: 'var(--purple)', color: '#fff',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{titulo}</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--gold)' }}>{fmtR(total)}</div>
                  </div>

                  {(!inv.temIni || !inv.temFim) ? (
                    <div style={{ padding: '14px 20px', background: '#fff8f0', fontSize: 13, color: 'var(--gray-600)' }}>
                      ⚠️ Faltam contagens para calcular o consumo.
                      {!inv.temIni && <div>· Sem contagem de abertura (até {dados.ini})</div>}
                      {!inv.temFim && <div>· Sem contagem de fechamento (até {dados.fim})</div>}
                      <div style={{ marginTop: 4, color: 'var(--gray-400)' }}>
                        O consumo por inventário exige duas contagens: uma no início e outra no fim do período.
                      </div>
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                            <th style={{ padding: '8px 14px', textAlign: 'left' }}>Item</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right' }}>Estoque inicial</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right' }}>+ Entradas</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right' }}>− Estoque final</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right' }}>= Consumo</th>
                            <th style={{ padding: '8px 14px', textAlign: 'right' }}>Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inv.linhas.filter(l => l.consumoQtd !== null).map((l, i) => (
                            <tr key={l.item.id} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? '#fafafa' : '#fff' }}>
                              <td style={{ padding: '7px 14px', fontWeight: 600 }}>{l.item.nome}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>{fmtQ(l.qIni, l.item.unidade)}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--ok)' }}>
                                {l.entQtd > 0 ? `+${fmtQ(l.entQtd, l.item.unidade)}` : '—'}
                              </td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>{fmtQ(l.qFim, l.item.unidade)}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                                color: l.consumoQtd < 0 ? 'var(--danger)' : 'var(--purple)' }}>
                                {fmtQ(l.consumoQtd, l.item.unidade)}
                              </td>
                              <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 700 }}>{fmtR(l.consumoVal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {inv.linhas.some(l => l.consumoQtd < 0) && (
                        <div style={{ padding: '10px 20px', background: '#fff8f0', fontSize: 12, color: 'var(--gray-600)' }}>
                          ⚠️ Consumo negativo indica erro de contagem ou entrada não lançada.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {(dados.invMP.temIni && dados.invMP.temFim) && (
                <div className="card card-pad" style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', background: 'var(--purple-pale)' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--purple)' }}>Consumo real total — {labelMes}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>
                      medido por inventário, sem depender de ficha técnica
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple)' }}>{fmtR(totalMP + totalEmb)}</div>
                </div>
              )}
            </>
          )}

          {/* ═══ CMV PRODUZIDO ═══ */}
          {vista === 'produzido' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                {[
                  ['Unidades produzidas', dados.unidades.toLocaleString('pt-BR'), 'var(--gray-700)'],
                  ['Matéria-prima', fmtR(dados.cmvMP), 'var(--purple)'],
                  ['Embalagem', fmtR(dados.cmvEmb), 'var(--purple)'],
                  ['CMV por unidade', dados.unidades > 0 ? fmtR((dados.cmvMP + dados.cmvEmb) / dados.unidades) : '—', 'var(--ok)'],
                ].map(([l, v, c]) => (
                  <div key={l} className="card card-pad" style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: c, margin: '4px 0' }}>{v}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--gray-200)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>CMV por produto — {labelMes}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => baixarXlsx({
                    nomeArquivo: `CMV_por_produto_${mes}`,
                    aba: labelMes,
                    colunas: [
                      { header: 'Nome do produto', key: 'nome',      tipo: 'texto',  largura: 38 },
                      { header: 'SKU',             key: 'sku',       tipo: 'texto',  largura: 24 },
                      { header: 'Produzido',       key: 'produzido', tipo: 'numero', largura: 12 },
                      { header: 'MP/un',           key: 'mp',        tipo: 'moeda4', largura: 12 },
                      { header: 'Emb/un',          key: 'emb',       tipo: 'moeda4', largura: 12 },
                      { header: 'CMV/un',          key: 'cmv',       tipo: 'moeda4', largura: 12 },
                      { header: 'Total',           key: 'total',     tipo: 'moeda',  largura: 14 },
                    ],
                    linhas: dados.produzidos.map(p => ({
                      nome: p.emb.nome, sku: p.emb.codigo, produzido: p.qtd,
                      mp: p.mpUnit, emb: p.embUnit, cmv: p.cmvUnit, total: p.total,
                    })),
                  })} disabled={!dados.produzidos.length}>
                    <FileSpreadsheet size={13} /> Exportar Excel
                  </button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                      <th style={{ padding: '8px 14px', textAlign: 'left' }}>Produto</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Produzido</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>MP/un</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Emb/un</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>CMV/un</th>
                      <th style={{ padding: '8px 14px', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.produzidos.map((p, i) => (
                      <tr key={p.emb.codigo} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? '#fafafa' : '#fff' }}>
                        <td style={{ padding: '7px 14px' }}>
                          <div style={{ fontWeight: 600 }}>{p.emb.nome}</div>
                          <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{p.emb.categoria}</div>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>{p.qtd.toLocaleString('pt-BR')}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmtR(p.mpUnit)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmtR(p.embUnit)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--purple)' }}>{fmtR(p.cmvUnit)}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 800 }}>{fmtR(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--purple)' }}>
                      <td colSpan={5} style={{ padding: '10px 14px', fontWeight: 800, color: '#fff' }}>Total produzido no mês</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--gold)', fontSize: 15 }}>
                        {fmtR(dados.cmvMP + dados.cmvEmb)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {/* ═══ COMPARAÇÃO ═══ */}
          {vista === 'comparar' && (() => {
            const podeComparar = dados.invMP.temIni && dados.invMP.temFim
            const difMP = podeComparar ? totalMP - dados.cmvMP : null
            const difMPpct = podeComparar && dados.cmvMP > 0 ? (difMP / dados.cmvMP * 100) : null
            const podeEmb = dados.invEmb.temIni && dados.invEmb.temFim
            const difEmb = podeEmb ? totalEmb - dados.cmvEmb : null
            const difEmbPct = podeEmb && dados.cmvEmb > 0 ? (difEmb / dados.cmvEmb * 100) : null

            const Linha = ({ label, real, ficha, dif, difPct, ok }) => (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 150px', gap: 12,
                padding: '12px 16px', borderTop: '1px solid var(--gray-100)', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                <div style={{ textAlign: 'right', fontWeight: 700 }}>{ok ? fmtR(real) : 'n/d'}</div>
                <div style={{ textAlign: 'right', fontWeight: 700 }}>{fmtR(ficha)}</div>
                <div style={{ textAlign: 'right', fontWeight: 800,
                  color: !ok ? 'var(--gray-300)' : Math.abs(difPct || 0) > 5 ? 'var(--danger)' : 'var(--ok)' }}>
                  {ok ? `${dif >= 0 ? '+' : '−'}${fmtR(Math.abs(dif))} (${fmt(Math.abs(difPct || 0), 1)}%)` : '—'}
                </div>
              </div>
            )

            return (
              <>
                <div className="card">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 150px', gap: 12,
                    padding: '12px 16px', background: 'var(--purple)', color: '#fff' }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>Consumo real vs CMV produzido</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Inventário</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Ficha</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Diferença</div>
                  </div>
                  <Linha label="Matéria-prima" real={totalMP} ficha={dados.cmvMP} dif={difMP} difPct={difMPpct} ok={podeComparar} />
                  <Linha label="Embalagem" real={totalEmb} ficha={dados.cmvEmb} dif={difEmb} difPct={difEmbPct} ok={podeEmb} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 150px', gap: 12,
                    padding: '14px 16px', borderTop: '2px solid var(--gray-200)', background: 'var(--purple-pale)', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--purple)' }}>Total</div>
                    <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: 'var(--purple)' }}>
                      {(podeComparar && podeEmb) ? fmtR(totalMP + totalEmb) : 'n/d'}
                    </div>
                    <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: 'var(--purple)' }}>
                      {fmtR(dados.cmvMP + dados.cmvEmb)}
                    </div>
                    <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 15,
                      color: (podeComparar && podeEmb) ? 'var(--purple)' : 'var(--gray-300)' }}>
                      {(podeComparar && podeEmb)
                        ? `${(totalMP + totalEmb - dados.cmvMP - dados.cmvEmb) >= 0 ? '+' : '−'}${fmtR(Math.abs(totalMP + totalEmb - dados.cmvMP - dados.cmvEmb))}`
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* Interpretação */}
                <div style={{ padding: '14px 18px', borderRadius: 8, background: 'var(--gray-50)',
                  border: '1px solid var(--gray-200)', fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Como ler a diferença</div>
                  <div style={{ color: 'var(--gray-600)' }}>
                    O <strong>inventário</strong> mede o que realmente saiu do estoque, sem depender de ficha técnica.
                    A <strong>ficha</strong> calcula o que deveria ter sido usado para produzir as unidades registradas.
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--gray-600)' }}>
                    <strong>Inventário maior que a ficha</strong> pode ser desperdício, rendimento pior que o cadastrado,
                    produção não registrada — ou <strong>preparação pronta em estoque</strong>, que já consumiu matéria-prima
                    mas ainda não virou produto acabado. Nem toda diferença positiva é perda.
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--gray-600)' }}>
                    <strong>Inventário menor que a ficha</strong> costuma indicar erro de contagem, compra não lançada
                    ou ficha com quantidades superestimadas.
                  </div>
                </div>
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}
