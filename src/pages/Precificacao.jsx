import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, ChevronDown, ChevronUp, Save } from 'lucide-react'

const CANAIS_DEFAULT = [
  { id: 'ecommerce', label: 'E-commerce',   totalPct:0,    totalFixo:18 },
  { id: 'ifood',     label: 'iFood',        totalPct:0.27, totalFixo:0  },
  { id: 'b2b',       label: 'B2B Revenda',  totalPct:0,    totalFixo:0  },
  { id: 'club',      label: 'Laricas Club', totalPct:0,    totalFixo:0  },
  { id: 'pdv',       label: 'PDV Parceiro', totalPct:0,    totalFixo:0  },
]

function fmt(n,d=2) { return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}) }
function fmtR(n) { return `R$ ${fmt(n,2)}` }
function pct(n) { return `${fmt(n*100,1)}%` }

// ── Hook para carregar dados de precificação ───────────────────────────────────
function usePrecificacao() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [
        { data: embs },
        { data: prodComps },
        { data: prepComps },
        { data: preps },
        { data: mps },
        canaisResult,
        { data: precosSalvos },
        overheadResult,
        volumeResult,
      ] = await Promise.all([
        supabase.from('embalagens').select('id,codigo,nome,categoria,tipo,custo_unitario,equivalencia_overhead').eq('tipo','rotulo').eq('ativo',true).order('categoria').order('nome'),
        supabase.from('produto_composicao').select('sku_produto,preparacao_id,quantidade_por_unidade,quantidade_crua,unidade'),
        supabase.from('preparacao_composicao').select('preparacao_id,ingrediente,quantidade,unidade,materia_prima_id,sub_preparacao_id'),
        supabase.from('preparacoes').select('id,nome,tipo,unidade_rendimento,rendimento_estimado,rendimento_real_medio,perda_percentual'),
        supabase.from('materias_primas').select('id,nome,unidade,custo_unitario,atualizado_em'),
        supabase.from('canal_custos').select('*').eq('ativo',true).order('canal_id').then(r => r).catch(() => ({ data: [] })),
        supabase.from('preco_produto_canal').select('*').then(r=>r).catch(()=>({data:[]})),
        supabase.from('overhead_producao').select('valor_mensal').eq('ativo',true).then(r=>r).catch(()=>({data:[]})),
        // Volume: só registros reais de produção (não auto-embalagem)
        supabase.from('embalagens')
          .select('id, equivalencia_overhead')
          .eq('tipo', 'rotulo')
          .eq('ativo', true)
          .then(async ({ data: rotulos }) => {
            if (!rotulos?.length) return { data: [] }
            const ids = rotulos.map(r => r.id)
            const equivMap = {}
            for (const r of rotulos) equivMap[r.id] = parseFloat(r.equivalencia_overhead)||1
            const { data: prod } = await supabase.from('producao_diaria')
              .select('quantidade, embalagem_id')
              .in('embalagem_id', ids)
              .gte('data_producao', new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10))
              .not('registrado_por', 'ilike', '%(auto-embalagem)%')
            const enriched = (prod||[]).map(r => ({
              quantidade: r.quantidade,
              embalagens: { equivalencia_overhead: equivMap[r.embalagem_id] || 1 }
            }))
            return { data: enriched }
          })
          .catch(()=>({data:[]})),
      ])

      // Overhead por unidade
      const totalOverhead = (overheadResult?.data||[]).reduce((s,r)=>s+(parseFloat(r.valor_mensal)||0),0)
      const volumeMensal = (volumeResult?.data||[]).reduce((s,r)=> {
        const equiv = parseFloat(r.embalagens?.equivalencia_overhead)||1
        return s + (parseFloat(r.quantidade)||0) * equiv
      }, 0)
      const overheadPorUnidade = volumeMensal > 0 ? totalOverhead / volumeMensal : 0

      const canaisDB = canaisResult?.data || []

      // Mapa de preços salvos: { sku: { canal_id: preco } }
      const precosMap = {}
      for (const p of (precosSalvos||[])) {
        if (!precosMap[p.sku_produto]) precosMap[p.sku_produto] = {}
        precosMap[p.sku_produto][p.canal_id] = parseFloat(p.preco)||0
      }

    // Canais do banco
    const canais = (canaisDB||[]).map(c => ({
      id: c.canal_id,
      label: c.label,
      taxa: (parseFloat(c.taxa_plataforma)||0)/100,
      imposto: (parseFloat(c.imposto_receita)||0)/100,
      comissao: (parseFloat(c.comissao)||0)/100,
      desconto: (parseFloat(c.desconto_campanhas)||0)/100,
      embalagem: parseFloat(c.custo_embalagem)||0,
      frete: parseFloat(c.custo_frete)||0,
      outros: parseFloat(c.custo_outros)||0,
      // Total deduções % e fixos
      totalPct: ((parseFloat(c.taxa_plataforma)||0)+(parseFloat(c.imposto_receita)||0)+(parseFloat(c.comissao)||0)+(parseFloat(c.desconto_campanhas)||0))/100,
      totalFixo: (parseFloat(c.custo_embalagem)||0)+(parseFloat(c.custo_frete)||0)+(parseFloat(c.custo_outros)||0),
    }))

    // Maps para lookup rápido
    const prepMap = {}
    for (const p of (preps||[])) prepMap[p.id] = p
    const mpMap = {}
    for (const m of (mps||[])) mpMap[m.id] = m

    // Helper: custo total de ingredientes de uma preparação (sem divisão pelo rendimento)
    function custoIngredientes(prepId, visitados = new Set()) {
      if (visitados.has(prepId)) return 0
      const vis = new Set([...visitados, prepId])
      const ings = (prepComps||[]).filter(pc => pc.preparacao_id === prepId)
      return ings.reduce((s, ing) => {
        if (ing.sub_preparacao_id) {
          const subPrep = prepMap[ing.sub_preparacao_id]
          const rendSub = parseFloat(subPrep?.rendimento_real_medio || subPrep?.rendimento_estimado) || 1
          const perdaSub = parseFloat(subPrep?.perda_percentual) || 0
          const rendLiqSub = rendSub * (1 - perdaSub/100)
          const custoSubPorG = rendLiqSub > 0 ? custoIngredientes(ing.sub_preparacao_id, vis) / rendLiqSub : 0
          return s + (parseFloat(ing.quantidade)||0) * custoSubPorG
        }
        const mp = mpMap[ing.materia_prima_id]
        if (!mp) return s
        return s + (parseFloat(ing.quantidade)||0) * (parseFloat(mp.custo_unitario)||0)
      }, 0)
    }

    // Calcula custo/g com rendimento específico (estimado ou real)
    const custoPrepPorG = {}     // usa estimado
    const custoPrepPorGReal = {} // usa real quando disponível

    function calcCusto(prepId, useReal, visitados = new Set(), cache) {
      if (cache[prepId] !== undefined) return cache[prepId]
      if (visitados.has(prepId)) return 0
      const vis = new Set([...visitados, prepId])
      const prep = prepMap[prepId]
      if (!prep) return 0

      const ings = (prepComps||[]).filter(pc => pc.preparacao_id === prepId)
      const custo = ings.reduce((s, ing) => {
        if (ing.sub_preparacao_id) {
          const custoPorG = calcCusto(ing.sub_preparacao_id, useReal, vis, cache)
          return s + (parseFloat(ing.quantidade)||0) * custoPorG
        }
        const mp = mpMap[ing.materia_prima_id]
        if (!mp) return s
        return s + (parseFloat(ing.quantidade)||0) * (parseFloat(mp.custo_unitario)||0)
      }, 0)

      const rendEstimado = parseFloat(prep.rendimento_estimado) || 1
      const rendReal = parseFloat(prep.rendimento_real_medio) || null
      const rend = useReal && rendReal ? rendReal : rendEstimado
      const perda = parseFloat(prep.perda_percentual) || 0
      const rendLiq = rend * (1 - perda/100)
      cache[prepId] = rendLiq > 0 ? custo / rendLiq : 0
      return cache[prepId]
    }

    for (const prep of (preps||[])) {
      calcCusto(prep.id, false, new Set(), custoPrepPorG)
      calcCusto(prep.id, true, new Set(), custoPrepPorGReal)
    }

    // Calcula CMV por produto (duplo: teórico e real)
    const produtos = (embs||[]).map(emb => {
      const comps = (prodComps||[]).filter(c => c.sku_produto === emb.codigo)

      // Custo de preparações
      const detalhesPrep = comps.map(comp => {
        const prep = prepMap[comp.preparacao_id]
        if (!prep) return null
        const qtdCrua = parseFloat(comp.quantidade_crua || comp.quantidade_por_unidade) || 0

        const custoPorGTeorico = custoPrepPorG[comp.preparacao_id] || 0
        const custoPorGReal = custoPrepPorGReal[comp.preparacao_id] || 0
        const custoNaUnidade = custoPorGTeorico * qtdCrua
        const custoNaUnidadeReal = custoPorGReal * qtdCrua

        // Rendimento info
        const rendEstimado = parseFloat(prep.rendimento_estimado) || 0
        const rendReal = parseFloat(prep.rendimento_real_medio) || null
        const usandoReal = !!rendReal

        // Ingredientes desta preparação
        const ings = (prepComps||[]).filter(pc => pc.preparacao_id === comp.preparacao_id).map(ing => {
          const qtdIng = parseFloat(ing.quantidade)||0
          const bruto = parseFloat(prep.rendimento_estimado)||1
          const perda = parseFloat(prep.perda_percentual)||0
          const rendLiq = bruto*(1-perda/100)
          const qtdPorUnidade = (qtdIng/rendLiq)*qtdCrua

          if (ing.sub_preparacao_id) {
            const subPrep = prepMap[ing.sub_preparacao_id]
            const custoPorGSub = custoPrepPorG[ing.sub_preparacao_id] || 0
            const custo = qtdPorUnidade * custoPorGSub
            return { nome: ing.ingrediente, mp: null, mpId: null, subPrep: subPrep?.nome, qtd: qtdPorUnidade, unidade: ing.unidade, custo, isSubPrep: true }
          }
          const mp = mpMap[ing.materia_prima_id]
          const custo = qtdPorUnidade * (parseFloat(mp?.custo_unitario)||0)
          return { nome: ing.ingrediente, mp: mp?.nome, mpId: ing.materia_prima_id, qtd: qtdPorUnidade, unidade: ing.unidade, custo, isSubPrep: false }
        })

        return {
          prepId: comp.preparacao_id,
          nome: prep.nome,
          tipo: prep.tipo,
          qtdCrua,
          unidade: comp.unidade,
          custoPorG: custoPorGTeorico,
          custoNaUnidade,
          custoNaUnidadeReal,
          rendEstimado,
          rendReal,
          usandoReal,
          unidadeRendimento: prep.unidade_rendimento,
          ingredientes: ings,
        }
      }).filter(Boolean)

      const custoRotulo = parseFloat(emb.custo_unitario) || 0
      const custoPreps = detalhesPrep.reduce((s,d) => s + d.custoNaUnidade, 0)
      const custoPrepsReal = detalhesPrep.reduce((s,d) => s + d.custoNaUnidadeReal, 0)
      const cmvTotal = custoPreps + custoRotulo
      const cmvTotalReal = custoPrepsReal + custoRotulo
      const temRendimentoReal = detalhesPrep.some(d => d.usandoReal)

      return { emb, detalhesPrep, custoPreps, custoRotulo, cmvTotal, cmvTotalReal, temRendimentoReal, precosCanal: precosMap[emb.codigo]||{}, semFicha: comps.length === 0 }
    })

      setData({ produtos, custoPrepPorG, custoPrepPorGReal, prepMap, mpMap, canais: canais.length ? canais : CANAIS_DEFAULT, totalOverhead, volumeMensal, overheadPorUnidade })
    } catch(err) {
      console.error('Erro ao carregar precificação:', err)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Salva snapshot automaticamente quando os dados carregam
  useEffect(() => {
    if (!data?.produtos?.length) return
    const mes = new Date().toISOString().slice(0, 7)
    const rows = data.produtos
      .filter(p => p.cmvTotal > 0)
      .map(p => ({
        mes,
        sku_produto: p.emb.codigo,
        nome_produto: p.emb.nome,
        categoria: p.emb.categoria,
        cmv_direto: p.cmvTotal,
        cmv_real: p.temRendimentoReal ? p.cmvTotalReal : null,
        overhead_unit: data.overheadPorUnidade || 0,
        rendimento_usado: p.temRendimentoReal ? 'real' : 'teorico',
      }))
    supabase.from('cmv_historico').upsert(rows, { onConflict: 'mes,sku_produto' })
  }, [data])
  return { data, loading, reload: load }
}

// ── Ficha de Custo ─────────────────────────────────────────────────────────────
function cmvEfetivo(cmvTotal, incluirOverhead, overheadPorUnidade, equivalencia = 1) {
  return incluirOverhead ? cmvTotal + (overheadPorUnidade||0) * equivalencia : cmvTotal
}

function FichaCusto({ data, incluirOverhead }) {
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('Todas')
  const [expandido, setExpandido] = useState(null)
  const [semFicha, setSemFicha] = useState(false)

  const cats = ['Todas', ...new Set(data.produtos.map(p=>p.emb.categoria))]
  const filtrados = data.produtos.filter(p => {
    if (semFicha && !p.semFicha) return false
    if (!semFicha && p.semFicha) return false
    if (cat !== 'Todas' && p.emb.categoria !== cat) return false
    if (busca && !p.emb.nome.toLowerCase().includes(busca.toLowerCase()) && !p.emb.codigo.toLowerCase().includes(busca.toLowerCase())) return false
    return true
  })

  const TIPO_ICON = { massa:'🍞', recheio:'🥄', creme:'🍮', cobertura:'🍫', cha:'🍵', outro:'📦' }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Filtros */}
      <div className="card" style={{padding:'12px 20px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <input className="form-input" placeholder="Buscar produto..." value={busca} onChange={e=>setBusca(e.target.value)} style={{width:220,fontSize:13}}/>
        <select className="form-input" value={cat} onChange={e=>setCat(e.target.value)} style={{width:160,fontSize:13}}>
          {cats.map(c=><option key={c}>{c}</option>)}
        </select>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer'}}>
          <input type="checkbox" checked={semFicha} onChange={e=>setSemFicha(e.target.checked)}/>
          Sem ficha técnica
        </label>
        <div style={{flex:1}}/>
        <div style={{fontSize:12,color:'var(--gray-400)'}}>
          {filtrados.length} produto(s)
        </div>
      </div>

      {/* Tabela */}
      <div className="card">
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)'}}>
              <th style={{padding:'10px 14px',textAlign:'left'}}>Produto</th>
              <th style={{padding:'10px 10px',textAlign:'right'}}>Custo MP</th>
              <th style={{padding:'10px 10px',textAlign:'right'}}>Custo Emb.</th>
              <th style={{padding:'10px 10px',textAlign:'right',color:'var(--purple)'}}>CMV Total</th>
              <th style={{padding:'10px 10px',textAlign:'center'}}>Componentes</th>
              <th style={{padding:'10px 10px'}}/>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p,i) => {
              const exp = expandido === p.emb.codigo
              const cmvEf = cmvEfetivo(p.cmvTotal, incluirOverhead, data.overheadPorUnidade, parseFloat(p.emb.equivalencia_overhead)||1)
              const temCusto = p.cmvTotal > 0
              return (<>
                <tr key={p.emb.codigo}
                  style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa',cursor:'pointer'}}
                  onClick={()=>setExpandido(exp ? null : p.emb.codigo)}>
                  <td style={{padding:'10px 14px'}}>
                    <div style={{fontWeight:700}}>{p.emb.nome}</div>
                    <div style={{fontSize:11,color:'var(--gray-400)',fontFamily:'monospace'}}>{p.emb.codigo}</div>
                  </td>
                  <td style={{padding:'10px 10px',textAlign:'right',color:temCusto?'var(--gray-700)':'var(--gray-300)'}}>
                    {temCusto ? fmtR(p.custoPreps) : '—'}
                  </td>
                  <td style={{padding:'10px 10px',textAlign:'right',color:p.custoRotulo>0?'var(--gray-700)':'var(--gray-300)'}}>
                    {p.custoRotulo>0 ? fmtR(p.custoRotulo) : '—'}
                  </td>
                  <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,color:temCusto?'var(--purple)':'var(--gray-300)'}}>
                    {temCusto ? (
                      <div>
                        <div>{fmtR(p.temRendimentoReal ? cmvEfetivo(p.cmvTotalReal, incluirOverhead, data.overheadPorUnidade, parseFloat(p.emb.equivalencia_overhead)||1) : cmvEf)}</div>
                        {p.temRendimentoReal && (
                          <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:400}}>
                            Teórico: {fmtR(cmvEf)}
                          </div>
                        )}
                      </div>
                    ) : p.semFicha ? '⚠️ sem ficha' : '—'}
                  </td>
                  <td style={{padding:'10px 10px',textAlign:'center'}}>
                    <span style={{fontSize:11,background:'var(--purple-pale)',color:'var(--purple)',padding:'2px 8px',borderRadius:10,fontWeight:700}}>
                      {p.detalhesPrep.length} prep.
                    </span>
                  </td>
                  <td style={{padding:'10px 10px',textAlign:'center',color:'var(--gray-400)'}}>
                    {exp ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </td>
                </tr>
                {exp && (
                  <tr key={`${p.emb.codigo}-detail`} style={{background:'#f8f5ff'}}>
                    <td colSpan={6} style={{padding:'0 14px 14px'}}>
                      <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:12}}>
                        {p.detalhesPrep.map(d => (
                          <div key={d.prepId} style={{border:'1px solid var(--gray-200)',borderRadius:8,overflow:'hidden'}}>
                            <div style={{padding:'8px 14px',background:'var(--purple-pale)'}}>
                              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                                <div style={{fontWeight:700,fontSize:13}}>{TIPO_ICON[d.tipo]} {d.nome}</div>
                                <div style={{fontSize:13}}>
                                  <span style={{color:'var(--gray-500)'}}>{fmt(d.qtdCrua,1)}{d.unidade} × {fmtR(d.custoPorG)}/{d.unidade} = </span>
                                  <span style={{fontWeight:800,color:'var(--purple)'}}>{fmtR(d.custoNaUnidade)}</span>
                                </div>
                              </div>
                              {/* Rendimento info */}
                              <div style={{display:'flex',gap:12,fontSize:11,flexWrap:'wrap'}}>
                                <span style={{color:'var(--gray-500)'}}>
                                  📐 Teórico: <strong>{fmt(d.rendEstimado,1)} {d.unidadeRendimento}</strong>
                                  {' → '}<span style={{color:'var(--gray-600)'}}>{fmtR(d.custoNaUnidade)}</span>
                                </span>
                                {d.rendReal ? (
                                  <span style={{color: d.usandoReal ? 'var(--ok)' : 'var(--gray-500)'}}>
                                    📊 Real: <strong>{fmt(d.rendReal,1)} {d.unidadeRendimento}</strong>
                                    {' → '}<span style={{fontWeight:700}}>{fmtR(d.custoNaUnidadeReal)}</span>
                                    {d.usandoReal && <span style={{marginLeft:4,background:'var(--ok)',color:'#fff',padding:'1px 5px',borderRadius:8,fontSize:10}}>em uso</span>}
                                  </span>
                                ) : (
                                  <span style={{color:'var(--warning)',fontSize:11}}>⚠️ Sem rendimento real registrado</span>
                                )}
                              </div>
                            </div>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                              <thead>
                                <tr style={{background:'var(--gray-50)'}}>
                                  <th style={{padding:'5px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-500)'}}>Ingrediente</th>
                                  <th style={{padding:'5px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>Qtd na unidade</th>
                                  <th style={{padding:'5px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>Custo/un</th>
                                  <th style={{padding:'5px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-500)'}}>Custo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.ingredientes.map((ing,ii) => (
                                  <tr key={ii} style={{borderTop:'1px solid var(--gray-100)'}}>
                                    <td style={{padding:'5px 14px'}}>{ing.nome}</td>
                                    <td style={{padding:'5px 10px',textAlign:'right',color:'var(--gray-500)'}}>{fmt(ing.qtd,3)}{ing.unidade}</td>
                                    <td style={{padding:'5px 10px',textAlign:'right',color:'var(--gray-500)'}}>
                                      {ing.isSubPrep
                                        ? <span style={{color:'var(--purple)',fontStyle:'italic',fontSize:11}}>🧪 {ing.subPrep}</span>
                                        : ing.mp ? (
                                          <div>
                                            <div>{fmtR((data.mpMap?.[ing.mpId]?.custo_unitario)||0)}/{ing.unidade}</div>
                                            {data.mpMap?.[ing.mpId]?.atualizado_em && (
                                              <div style={{fontSize:10,color:'var(--gray-400)'}}>
                                                atualizado {new Date(data.mpMap[ing.mpId].atualizado_em).toLocaleDateString('pt-BR')}
                                              </div>
                                            )}
                                          </div>
                                        ) : '—'}
                                    </td>
                                    <td style={{padding:'5px 10px',textAlign:'right',fontWeight:600,color:ing.custo>0?'var(--gray-700)':'var(--gray-300)'}}>
                                      {ing.custo>0 ? fmtR(ing.custo) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                        {p.custoRotulo > 0 && (
                          <div style={{padding:'8px 14px',border:'1px solid var(--gray-200)',borderRadius:8,display:'flex',justifyContent:'space-between',fontSize:13}}>
                            <span>📦 Embalagem (rótulo + primária)</span>
                            <span style={{fontWeight:700}}>{fmtR(p.custoRotulo)}</span>
                          </div>
                        )}
                        {incluirOverhead && data.overheadPorUnidade > 0 && (
                          <div style={{padding:'8px 14px',border:'1px solid var(--gray-200)',borderRadius:8,display:'flex',justifyContent:'space-between',fontSize:13,background:'#f0faf0'}}>
                            <span>🏭 Overhead de produção{p.emb.equivalencia_overhead > 1 ? ` (×${p.emb.equivalencia_overhead} equiv.)` : ''}</span>
                            <span style={{fontWeight:700,color:'var(--ok)'}}>{fmtR(data.overheadPorUnidade * (parseFloat(p.emb.equivalencia_overhead)||1))}</span>
                          </div>
                        )}
                        {p.temRendimentoReal && (
                          <div style={{padding:'10px 14px',background:'var(--ok)',borderRadius:8,display:'flex',justifyContent:'space-between',color:'#fff',fontWeight:800}}>
                            <span>CMV {incluirOverhead ? 'Total' : 'Direto'} — Rendimento Real ✓</span>
                            <span style={{fontSize:16}}>{fmtR(cmvEfetivo(p.cmvTotalReal, incluirOverhead, data.overheadPorUnidade, parseFloat(p.emb.equivalencia_overhead)||1))}</span>
                          </div>
                        )}
                        <div style={{padding:'10px 14px',background: p.temRendimentoReal ? 'var(--gray-200)' : 'var(--purple)',borderRadius:8,display:'flex',justifyContent:'space-between',color: p.temRendimentoReal ? 'var(--gray-600)' : '#fff',fontWeight:800}}>
                          <span>CMV {incluirOverhead ? 'Total' : 'Direto'} — Rendimento Teórico</span>
                          <span style={{fontSize:16}}>{fmtR(cmvEfetivo(p.cmvTotal, incluirOverhead, data.overheadPorUnidade, parseFloat(p.emb.equivalencia_overhead)||1))}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>)
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Simulador ─────────────────────────────────────────────────────────────────
function Simulador({ data, reload, incluirOverhead }) {
  const [skuSel, setSkuSel] = useState('')
  const [markup, setMarkup] = useState(3)
  const [precoManual, setPrecoManual] = useState('')
  const [desconto, setDesconto] = useState(0)
  const [precosCanal, setPrecosCanal] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const canais = data.canais || CANAIS_DEFAULT

  const prod = data.produtos.find(p => p.emb.codigo === skuSel)
  const cmv = cmvEfetivo(prod?.cmvTotal || 0, incluirOverhead, data.overheadPorUnidade, parseFloat(prod?.emb?.equivalencia_overhead)||1)
  const precoBase = precoManual ? parseFloat(precoManual) : cmv * markup
  const precoComDesconto = precoBase * (1 - desconto/100)
  // Desconto máximo por canal: preço onde MC = 0
  function descontoMaxCanal(canal) {
    // recLiq = precoDesc * (1 - totalPct) - totalFixo = cmv
    // precoDesc = (cmv + totalFixo) / (1 - totalPct)
    // descMax = (precoBase - precoDesc) / precoBase
    if (canal.totalPct >= 1) return 0
    const precoMin = (cmv + canal.totalFixo) / (1 - canal.totalPct)
    const dMax = precoBase > 0 ? Math.max(0, (precoBase - precoMin) / precoBase * 100) : 0
    return dMax
  }

  // Carrega preços salvos ao selecionar produto
  useEffect(() => {
    if (prod) {
      setPrecosCanal({...prod.precosCanal})
      setSaved(false)
    }
  }, [skuSel])

  async function salvarPrecos() {
    if (!skuSel) return
    setSaving(true)
    for (const [canalId, preco] of Object.entries(precosCanal)) {
      if (!preco) continue
      await supabase.from('preco_produto_canal').upsert({
        sku_produto: skuSel,
        canal_id: canalId,
        preco: parseFloat(preco),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'sku_produto,canal_id' })
    }
    setSaving(false)
    setSaved(true)
    reload()
    setTimeout(() => setSaved(false), 3000)
  }

  function calcMC(canal, preco) {
    const recLiq = preco * (1 - canal.totalPct) - canal.totalFixo
    return { recLiq, mc: recLiq - cmv, mgPct: recLiq > 0 ? (recLiq-cmv)/recLiq : 0 }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Seleção de produto */}
      <div className="card card-pad">
        <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'end'}}>
          <div className="form-group" style={{margin:0}}>
            <label className="form-label">Produto</label>
            <select className="form-input" value={skuSel} onChange={e=>setSkuSel(e.target.value)}>
              <option value="">Selecione um produto...</option>
              {[...new Set(data.produtos.map(p=>p.emb.categoria))].sort().map(cat => {
                const grupo = data.produtos.filter(p=>p.emb.categoria===cat)
                if (!grupo.length) return null
                return <optgroup key={cat} label={cat}>{grupo.map(p=><option key={p.emb.codigo} value={p.emb.codigo}>{p.emb.nome}</option>)}</optgroup>
              })}
            </select>
          </div>
          {prod && (
            <div style={{display:'flex',gap:12,alignItems:'flex-end'}}>
              <div style={{textAlign:'center',padding:'0 0 2px'}}>
                <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700,textTransform:'uppercase'}}>CMV</div>
                <div style={{fontSize:20,fontWeight:800,color:'var(--purple)'}}>{fmtR(cmv)}</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={salvarPrecos} disabled={saving}
                style={{marginBottom:2, background: saved?'var(--ok)':undefined}}>
                {saving ? <RefreshCw size={13} className="spin"/> : saved ? '✓ Salvo!' : <Save size={13}/>}
                {!saving && !saved && ' Salvar preços'}
              </button>
            </div>
          )}
        </div>
      </div>

      {prod && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {/* Simulador de markup */}
          <div className="card card-pad">
            <div style={{fontWeight:800,fontSize:14,marginBottom:16}}>💡 Simulador de Preço</div>

            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                <label className="form-label" style={{margin:0}}>Markup</label>
                <span style={{fontWeight:800,fontSize:16,color:'var(--purple)'}}>{fmt(markup,1)}x</span>
              </div>
              <input type="range" min={1} max={6} step={0.1} value={markup}
                onChange={e=>{ setMarkup(parseFloat(e.target.value)); setPrecoManual('') }}
                style={{width:'100%',accentColor:'var(--purple)'}} />
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)'}}>
                <span>1x</span><span>2x</span><span>3x</span><span>4x</span><span>5x</span><span>6x</span>
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <label className="form-label">Ou informe o preço manualmente</label>
              <input type="number" className="form-input" placeholder="R$ 0,00" value={precoManual}
                onChange={e=>{ setPrecoManual(e.target.value); if(e.target.value && cmv>0) setMarkup(parseFloat(e.target.value)/cmv) }} />
            </div>

            {/* Desconto */}
            <div style={{marginBottom:16,padding:'12px 14px',background:'#fff8f0',borderRadius:8,border:'1px solid var(--warning)'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                <label className="form-label" style={{margin:0,color:'var(--warning)'}}>🏷️ Desconto</label>
                <span style={{fontWeight:800,fontSize:15,color:'var(--warning)'}}>{fmt(desconto,1)}%</span>
              </div>
              <input type="range" min={0} max={50} step={0.5} value={desconto}
                onChange={e=>setDesconto(parseFloat(e.target.value))}
                style={{width:'100%',accentColor:'var(--warning)'}}/>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)'}}>
                <span>0%</span><span>10%</span><span>20%</span><span>30%</span><span>40%</span><span>50%</span>
              </div>
              {desconto > 0 && (
                <div style={{marginTop:8,display:'flex',justifyContent:'space-between',fontSize:13}}>
                  <span style={{color:'var(--gray-500)'}}>Preço cheio: {fmtR(precoBase)}</span>
                  <span style={{fontWeight:800,color:'var(--warning)'}}>→ {fmtR(precoComDesconto)}</span>
                </div>
              )}
            </div>

            {/* Resultado */}
            <div style={{background:'var(--purple)',borderRadius:10,padding:16,color:'#fff',textAlign:'center'}}>
              <div style={{fontSize:12,opacity:.8}}>{desconto>0?'Preço com desconto':'Preço sugerido'}</div>
              <div style={{fontSize:32,fontWeight:800}}>{fmtR(precoComDesconto)}</div>
              <div style={{fontSize:13,opacity:.8,marginTop:4}}>
                Markup {fmt(markup,1)}x{desconto>0?` · ${fmt(desconto,1)}% desc.`:''} · Margem s/ desc. {pct(cmv>0?(precoBase-cmv)/precoBase:0)}
              </div>
            </div>

            {/* Faixas de markup */}
            <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:6}}>
              {[2,2.5,3,3.5,4,5].map(m => {
                const p = cmv*m
                const mg = cmv>0?(p-cmv)/p:0
                const atual = Math.abs(m-markup)<0.05
                return (
                  <div key={m} onClick={()=>{setMarkup(m);setPrecoManual('')}}
                    style={{display:'flex',justifyContent:'space-between',padding:'6px 10px',borderRadius:6,cursor:'pointer',
                      background:atual?'var(--purple-pale)':'transparent',
                      border:atual?'1.5px solid var(--purple)':'1px solid var(--gray-100)',
                      fontWeight:atual?700:400}}>
                    <span style={{color:'var(--gray-600)'}}>{m}x → {fmtR(cmv*m)}</span>
                    <span style={{color:mg>=0.5?'var(--ok)':mg>=0.3?'var(--warning)':'var(--danger)'}}>
                      {pct(mg)} margem
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Margem por canal */}
          <div className="card card-pad">
            <div style={{fontWeight:800,fontSize:14,marginBottom:16}}>📊 Margem por Canal</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {canais.map(canal => {
                const precoCanal = parseFloat(precosCanal[canal.id]) || precoBase
                const precoEfetivo = precoCanal * (1 - desconto/100)
                const { recLiq, mc, mgPct } = calcMC(canal, precoEfetivo)
                const dMax = descontoMaxCanal(canal)
                const acimaDMax = desconto > 0 && desconto > dMax
                const cor = mgPct >= 0.4 ? 'var(--ok)' : mgPct >= 0.2 ? 'var(--warning)' : 'var(--danger)'
                const dedPct = (canal.totalPct*100).toFixed(1)
                const fixo = canal.totalFixo
                return (
                  <div key={canal.id} style={{border:`1.5px solid ${acimaDMax?'var(--danger)':'var(--gray-200)'}`,borderRadius:8,padding:'10px 14px',background:acimaDMax?'#fff5f5':undefined}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13}}>{canal.label}</div>
                        <div style={{fontSize:10,color:'var(--gray-400)'}}>
                          Desc. máx: <strong style={{color:dMax>0?'var(--ok)':'var(--danger)'}}>{fmt(dMax,1)}%</strong>
                          {acimaDMax && <span style={{color:'var(--danger)',fontWeight:700,marginLeft:4}}>⚠️ MC negativa</span>}
                        </div>
                      </div>
                      <input type="number" value={precosCanal[canal.id]||''} placeholder={`R$ ${fmt(precoBase,2)}`}
                        onChange={e=>setPrecosCanal(p=>({...p,[canal.id]:e.target.value}))}
                        style={{width:90,padding:'3px 6px',fontSize:12,border:'1px solid var(--gray-200)',borderRadius:5,textAlign:'right'}} />
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                      <div style={{color:'var(--gray-400)'}}>
                        {dedPct}% deduções · R${fixo.toFixed(2)} fixos · Rec. líq. {fmtR(recLiq)}
                      </div>
                      <div style={{fontWeight:800,color:cor}}>MC {fmtR(mc)} ({pct(mgPct)})</div>
                    </div>
                    <div style={{marginTop:6,height:4,background:'var(--gray-100)',borderRadius:2}}>
                      <div style={{height:'100%',width:`${Math.max(0,Math.min(100,mgPct*100))}%`,background:cor,borderRadius:2,transition:'width .3s'}}/>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Ranking de Margem ─────────────────────────────────────────────────────────
function RankingMargem({ data, reload, incluirOverhead }) {
  const [precoRef, setPrecoRef] = useState({})
  const [canalSel, setCanalSel] = useState('ecommerce')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const canais = data.canais || CANAIS_DEFAULT
  const canal = canais.find(c=>c.id===canalSel) || canais[0]

  // Inicializa precoRef com preços salvos
  useEffect(() => {
    const init = {}
    for (const p of data.produtos) {
      if (p.precosCanal?.[canalSel]) init[p.emb.codigo] = p.precosCanal[canalSel]
    }
    setPrecoRef(init)
  }, [canalSel, data])

  async function salvarTodos() {
    setSaving(true)
    for (const [sku, preco] of Object.entries(precoRef)) {
      if (!preco) continue
      await supabase.from('preco_produto_canal').upsert({
        sku_produto: sku, canal_id: canalSel,
        preco: parseFloat(preco),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'sku_produto,canal_id' })
    }
    setSaving(false)
    setSaved(true)
    reload()
    setTimeout(() => setSaved(false), 3000)
  }

  const comCusto = data.produtos.filter(p=>p.cmvTotal>0).map(p => {
    const cmvEf = cmvEfetivo(p.cmvTotal, incluirOverhead, data.overheadPorUnidade, parseFloat(p.emb.equivalencia_overhead)||1)
    const preco = parseFloat(precoRef[p.emb.codigo]) || p.precosCanal?.[canalSel] || cmvEf*3
    const recLiq = preco*(1-canal.totalPct)-canal.totalFixo
    const mc = recLiq - cmvEf
    const mgPct = recLiq>0 ? mc/recLiq : 0
    return { ...p, cmvEf, preco, recLiq, mc, mgPct }
  }).sort((a,b)=>b.mgPct-a.mgPct)

  const semCusto = data.produtos.filter(p=>p.cmvTotal===0)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Filtros */}
      <div className="card card-pad" style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <label className="form-label">Canal de referência</label>
          <select className="form-input" value={canalSel} onChange={e=>setCanalSel(e.target.value)} style={{width:180}}>
            {canais.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={salvarTodos} disabled={saving}
            style={{background: saved?'var(--ok)':undefined}}>
            {saving ? <RefreshCw size={13} className="spin"/> : saved ? '✓ Salvo!' : <><Save size={13}/> Salvar preços</>}
          </button>
        </div>
        <div style={{fontSize:12,color:'var(--gray-400)',alignSelf:'flex-end',paddingBottom:2}}>
          Edite os preços na coluna "Preço" para personalizar o cálculo
        </div>
      </div>

      {/* Tabela ranking */}
      <div className="card">
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--gray-50)',borderBottom:'2px solid var(--gray-200)'}}>
              <th style={{padding:'10px 10px',textAlign:'center',width:36}}>#</th>
              <th style={{padding:'10px 14px',textAlign:'left'}}>Produto</th>
              <th style={{padding:'10px 10px',textAlign:'right'}}>CMV {incluirOverhead?'Total':'Direto'}</th>
              <th style={{padding:'10px 10px',textAlign:'right'}}>Preço</th>
              <th style={{padding:'10px 10px',textAlign:'right'}}>Receita líq.</th>
              <th style={{padding:'10px 10px',textAlign:'right',color:'var(--purple)'}}>MC unitária</th>
              <th style={{padding:'10px 10px',textAlign:'right'}}>Margem %</th>
              <th style={{padding:'10px 10px',minWidth:120}}>Barra</th>
            </tr>
          </thead>
          <tbody>
            {comCusto.map((p,i) => {
              const cor = p.mgPct>=0.5?'var(--ok)':p.mgPct>=0.3?'var(--warning)':'var(--danger)'
              return (
                <tr key={p.emb.codigo} style={{borderTop:'1px solid var(--gray-100)',background:i%2===0?'#fff':'#fafafa'}}>
                  <td style={{padding:'9px 10px',textAlign:'center',fontWeight:800,color:'var(--gray-400)'}}>{i+1}</td>
                  <td style={{padding:'9px 14px'}}>
                    <div style={{fontWeight:700}}>{p.emb.nome}</div>
                    <div style={{fontSize:11,color:'var(--gray-400)'}}>{p.emb.categoria}</div>
                  </td>
                  <td style={{padding:'9px 10px',textAlign:'right',color:'var(--gray-500)'}}>{fmtR(p.cmvEf)}</td>
                  <td style={{padding:'6px 10px',textAlign:'right'}}>
                    <input type="number" value={precoRef[p.emb.codigo]||p.precosCanal[canalSel]||''}
                      placeholder={fmtR(p.cmvEf*3)}
                      onChange={e=>setPrecoRef(pr=>({...pr,[p.emb.codigo]:e.target.value}))}
                      style={{width:80,padding:'3px 6px',fontSize:12,border:'1px solid var(--gray-200)',borderRadius:5,textAlign:'right'}} />
                  </td>
                  <td style={{padding:'9px 10px',textAlign:'right',color:'var(--gray-600)'}}>{fmtR(p.recLiq)}</td>
                  <td style={{padding:'9px 10px',textAlign:'right',fontWeight:800,color:cor}}>{fmtR(p.mc)}</td>
                  <td style={{padding:'9px 10px',textAlign:'right',fontWeight:800,color:cor}}>{pct(p.mgPct)}</td>
                  <td style={{padding:'9px 10px'}}>
                    <div style={{height:8,background:'var(--gray-100)',borderRadius:4}}>
                      <div style={{height:'100%',width:`${Math.max(0,Math.min(100,p.mgPct*100))}%`,background:cor,borderRadius:4}}/>
                    </div>
                  </td>
                </tr>
              )
            })}
            {semCusto.length > 0 && (
              <tr style={{borderTop:'2px dashed var(--gray-200)'}}>
                <td colSpan={8} style={{padding:'10px 14px',fontSize:12,color:'var(--gray-400)',fontStyle:'italic'}}>
                  ⚠️ {semCusto.length} produto(s) sem custo calculado: {semCusto.map(p=>p.emb.nome).join(', ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function Precificacao() {
  const [aba, setAba] = useState('ficha')
  const [incluirOverhead, setIncluirOverhead] = useState(false)
  const { data, loading, reload } = usePrecificacao()

  return (
    <>
      <div className="tabs" style={{marginBottom:0}}>
        <button className={`tab${aba==='ficha'?' active':''}`} onClick={()=>setAba('ficha')}>📊 Ficha de Custo</button>
        <button className={`tab${aba==='simulador'?' active':''}`} onClick={()=>setAba('simulador')}>💡 Simulador</button>
        <button className={`tab${aba==='ranking'?' active':''}`} onClick={()=>setAba('ranking')}>🏆 Ranking de Margem</button>
        <button className={`tab${aba==='evolucao'?' active':''}`} onClick={()=>setAba('evolucao')}>📈 Evolução do CMV</button>
      </div>

      {loading ? (
        <div className="card card-pad" style={{textAlign:'center'}}>
          <RefreshCw size={20} className="spin" style={{color:'var(--purple)'}}/>
          <div style={{marginTop:8,color:'var(--gray-400)'}}>Calculando custos...</div>
        </div>
      ) : !data ? null : (
        <>
          {/* Banner de overhead */}
          <div style={{
            display:'flex', alignItems:'center', gap:12, padding:'10px 16px',
            background: incluirOverhead ? '#f0faf0' : 'var(--gray-50)',
            border: `1.5px solid ${incluirOverhead ? 'var(--ok)' : 'var(--gray-200)'}`,
            borderRadius:8,
          }}>
            <button
              onClick={() => setIncluirOverhead(p=>!p)}
              style={{
                width:48, height:26, borderRadius:13, border:'none', cursor:'pointer',
                background: incluirOverhead ? 'var(--ok)' : 'var(--gray-300)',
                position:'relative', transition:'background .2s', flexShrink:0,
              }}>
              <span style={{
                position:'absolute', top:3,
                left: incluirOverhead ? 24 : 4,
                width:20, height:20, borderRadius:'50%',
                background:'#fff', transition:'left .2s',
                boxShadow:'0 1px 3px rgba(0,0,0,.3)',
              }}/>
            </button>
            <div style={{flex:1}}>
              <div style={{fontWeight:700, fontSize:13, color: incluirOverhead ? 'var(--ok)' : 'var(--gray-600)'}}>
                {incluirOverhead ? '✅ CMV Total (com overhead)' : '📦 CMV Direto (sem overhead)'}
              </div>
              <div style={{fontSize:11, color:'var(--gray-400)', marginTop:1}}>
                {data.overheadPorUnidade > 0
                  ? `Overhead: ${fmtR(data.overheadPorUnidade)}/unidade equiv. · R$${fmt(data.totalOverhead,0)}/mês ÷ ${Math.round(data.volumeMensal)} un equiv. (últimos 30d) · Latas = 8 equiv.`
                  : data.totalOverhead > 0
                    ? `⚠️ Overhead cadastrado (R$${fmt(data.totalOverhead,0)}/mês) mas sem produção registrada nos últimos 30 dias`
                    : 'Cadastre itens de overhead em Admin → 🏭 Overhead para ativar'
                }
              </div>
            </div>
          </div>

          {aba==='ficha'     && <FichaCusto data={data} incluirOverhead={incluirOverhead} />}
          {aba==='simulador' && <Simulador data={data} reload={reload} incluirOverhead={incluirOverhead} />}
          {aba==='ranking'   && <RankingMargem data={data} reload={reload} incluirOverhead={incluirOverhead} />}
          {aba==='evolucao'  && <EvolucaoCMV />}
        </>
      )}
    </>
  )
}

// ── Evolução do CMV ───────────────────────────────────────────────────────────
function EvolucaoCMV() {
  const [historico, setHistorico] = useState([])
  const [loading, setLoading] = useState(true)
  const [skuFiltro, setSkuFiltro] = useState('todos')
  const [catFiltro, setCatFiltro] = useState('todas')

  useEffect(() => {
    supabase.from('cmv_historico')
      .select('*')
      .order('mes', { ascending: true })
      .then(({ data }) => { setHistorico(data||[]); setLoading(false) })
  }, [])

  const meses = [...new Set(historico.map(h => h.mes))].sort()
  const skus = [...new Set(historico.map(h => h.sku_produto))]
  const cats = ['todas', ...new Set(historico.map(h => h.categoria).filter(Boolean))]

  const filtrado = historico.filter(h =>
    (skuFiltro === 'todos' || h.sku_produto === skuFiltro) &&
    (catFiltro === 'todas' || h.categoria === catFiltro)
  )

  // Agrupa por SKU → array de meses
  const porSku = {}
  for (const h of filtrado) {
    if (!porSku[h.sku_produto]) porSku[h.sku_produto] = { nome: h.nome_produto, categoria: h.categoria, meses: {} }
    porSku[h.sku_produto].meses[h.mes] = h
  }
  const produtos = Object.entries(porSku).sort((a,b) => a[1].categoria?.localeCompare(b[1].categoria||'')||0)

  if (loading) return <div className="loading"><RefreshCw size={14} className="spin"/></div>

  if (!historico.length) return (
    <div className="card card-pad" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>
      <div style={{fontSize:32,marginBottom:12}}>📸</div>
      <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>Nenhum snapshot salvo ainda</div>
      <div style={{fontSize:13}}>Use o botão <strong>"📸 Salvar snapshot do mês"</strong> na barra acima para salvar o CMV atual de todos os produtos.</div>
      <div style={{fontSize:12,marginTop:8,color:'var(--gray-300)'}}>Faça isso uma vez por mês para acompanhar a evolução ao longo do tempo.</div>
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Filtros */}
      <div className="card card-pad" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{fontWeight:800,fontSize:14}}>📈 Evolução do CMV por Produto</div>
        <div style={{flex:1}}/>
        <select className="form-input" value={catFiltro} onChange={e=>{setCatFiltro(e.target.value);setSkuFiltro('todos')}} style={{width:180,fontSize:13}}>
          {cats.map(c=><option key={c} value={c}>{c==='todas'?'Todas as categorias':c}</option>)}
        </select>
        <select className="form-input" value={skuFiltro} onChange={e=>setSkuFiltro(e.target.value)} style={{width:220,fontSize:13}}>
          <option value="todos">Todos os produtos</option>
          {skus.filter(s => catFiltro==='todas' || porSku[s]?.categoria===catFiltro).map(s=>(
            <option key={s} value={s}>{porSku[s]?.nome || s}</option>
          ))}
        </select>
      </div>

      {/* Tabela de evolução */}
      <div className="card" style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:600}}>
          <thead>
            <tr style={{background:'var(--purple)',color:'#fff'}}>
              <th style={{padding:'10px 14px',textAlign:'left',fontWeight:700,position:'sticky',left:0,background:'var(--purple)'}}>Produto</th>
              {meses.map(m=>(
                <th key={m} style={{padding:'10px 12px',textAlign:'center',fontWeight:700,whiteSpace:'nowrap'}}>
                  {new Date(m+'-15').toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {produtos.map(([sku, prod], pi) => {
              const valoresMes = meses.map(m => prod.meses[m])
              const primeiro = valoresMes.find(v => v)
              const ultimo = [...valoresMes].reverse().find(v => v)
              const variacao = primeiro && ultimo && primeiro !== ultimo
                ? ((( ultimo.cmv_real ?? ultimo.cmv_direto) - (primeiro.cmv_real ?? primeiro.cmv_direto)) / (primeiro.cmv_real ?? primeiro.cmv_direto)) * 100
                : null

              return (
                <tr key={sku} style={{borderTop:'1px solid var(--gray-100)',background:pi%2===0?'#fff':'#fafafa'}}>
                  <td style={{padding:'9px 14px',fontWeight:600,position:'sticky',left:0,background:pi%2===0?'#fff':'#fafafa',whiteSpace:'nowrap'}}>
                    <div>{prod.nome}</div>
                    <div style={{fontSize:10,color:'var(--gray-400)'}}>{prod.categoria}</div>
                    {variacao !== null && (
                      <div style={{fontSize:10,fontWeight:700,color:variacao>5?'var(--danger)':variacao<-5?'var(--ok)':'var(--gray-400)'}}>
                        {variacao>0?'▲':'▼'} {Math.abs(variacao).toFixed(1)}% vs início
                      </div>
                    )}
                  </td>
                  {meses.map(m => {
                    const h = prod.meses[m]
                    if (!h) return <td key={m} style={{padding:'9px 12px',textAlign:'center',color:'var(--gray-200)'}}>—</td>
                    const cmvPrincipal = h.cmv_real ?? h.cmv_direto
                    const temReal = !!h.cmv_real
                    // Variação vs mês anterior
                    const idx = meses.indexOf(m)
                    const anterior = idx > 0 ? prod.meses[meses[idx-1]] : null
                    const cmvAnterior = anterior ? (anterior.cmv_real ?? anterior.cmv_direto) : null
                    const diff = cmvAnterior ? ((cmvPrincipal - cmvAnterior) / cmvAnterior * 100) : null
                    return (
                      <td key={m} style={{padding:'9px 12px',textAlign:'center'}}>
                        <div style={{fontWeight:800,color:temReal?'var(--ok)':'var(--purple)'}}>
                          {fmtR(cmvPrincipal)}
                        </div>
                        {temReal && (
                          <div style={{fontSize:10,color:'var(--gray-400)'}}>teo: {fmtR(h.cmv_direto)}</div>
                        )}
                        {diff !== null && (
                          <div style={{fontSize:10,fontWeight:700,
                            color:diff>5?'var(--danger)':diff<-5?'var(--ok)':'var(--gray-400)'}}>
                            {diff>0?'▲':'▼'}{Math.abs(diff).toFixed(1)}%
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{fontSize:11,color:'var(--gray-400)',textAlign:'right'}}>
        🟢 Verde = usando rendimento real · 🟣 Roxo = usando rendimento teórico · ▲▼ variação vs mês anterior
      </div>
    </div>
  )
}
