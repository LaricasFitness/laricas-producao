import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Save, ChevronLeft, ChevronRight, FileDown } from 'lucide-react'
import { gerarFichaTecnicaPDF, gerarFichaPreparacoesPDF } from '../lib/fichaTecnicaPDF'

// Ficha do produto: tudo de um produto numa tela só — custo da unidade,
// preço e margem em cada canal e o que pesa no custo.
// Não calcula custo novo: usa os mesmos números da Precificação (usePrecificacao).

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtR = n => `R$ ${fmt(n, 2)}`
const fmtPct = n => `${fmt(n * 100, 1)}%`
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }

const LS_SKU = 'fichaProduto.sku'
const LS_ALVO = 'fichaProduto.margemAlvo'
const lerLS = (k, def) => { try { return localStorage.getItem(k) ?? def } catch { return def } }
const gravarLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }

// Mesma conta do Ranking de margem:
//   receita líquida = preço × (1 − % do canal) − R$ fixos do canal
//   margem          = lucro ÷ receita líquida
function contasCanal(canal, preco, cmv) {
  const recLiq = preco * (1 - canal.totalPct) - canal.totalFixo
  const lucro = recLiq - cmv
  return { recLiq, lucro, margem: recLiq > 0 ? lucro / recLiq : null }
}
const precoMinimo = (canal, cmv) =>
  canal.totalPct >= 1 ? Infinity : (cmv + canal.totalFixo) / (1 - canal.totalPct)
const precoParaMargem = (canal, cmv, alvo) =>
  (alvo >= 1 || canal.totalPct >= 1) ? Infinity : (cmv / (1 - alvo) + canal.totalFixo) / (1 - canal.totalPct)

const COR_TIPO = { mp: 'var(--purple)', emb: 'var(--gold-dark)', over: 'var(--gray-400)' }
const NOME_TIPO = { mp: 'Matéria-prima', emb: 'Embalagem', over: 'Overhead' }

export default function FichaProduto({ data, reload, incluirOverhead, cmvDe }) {
  const produtos = useMemo(() => [...data.produtos].sort((a, b) =>
    (a.emb.categoria || '').localeCompare(b.emb.categoria || '') || a.emb.nome.localeCompare(b.emb.nome)
  ), [data])

  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('Todas')
  const [soSemFicha, setSoSemFicha] = useState(false)
  const [sku, setSku] = useState(() => lerLS(LS_SKU, ''))
  const [alvoTxt, setAlvoTxt] = useState(() => lerLS(LS_ALVO, '50'))

  const cats = ['Todas', ...new Set(produtos.map(p => p.emb.categoria).filter(Boolean))]
  const termo = busca.trim().toLowerCase()
  const filtrados = produtos.filter(p =>
    (cat === 'Todas' || p.emb.categoria === cat) &&
    (!soSemFicha || p.semFicha) &&
    (!termo || p.emb.nome.toLowerCase().includes(termo) || (p.emb.codigo || '').toLowerCase().includes(termo))
  )
  const qtdSemFicha = produtos.filter(p => p.semFicha).length

  const prod = filtrados.find(p => p.emb.codigo === sku) || filtrados[0] || null
  const idx = prod ? filtrados.indexOf(prod) : -1
  useEffect(() => { if (prod) gravarLS(LS_SKU, prod.emb.codigo) }, [prod?.emb.codigo])

  const alvo = Math.min(0.95, Math.max(0, num(alvoTxt) / 100))
  function mudarAlvo(v) { setAlvoTxt(v); gravarLS(LS_ALVO, v) }

  const catsFiltradas = [...new Set(filtrados.map(p => p.emb.categoria))]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FichasPreparacao prepMap={data.prepMap || {}} />

      {/* Escolha do produto */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Buscar produto ou código..." value={busca}
          onChange={e => setBusca(e.target.value)} style={{ width: 210, fontSize: 13 }} />
        <select className="form-input" value={cat} onChange={e => setCat(e.target.value)} style={{ width: 160, fontSize: 13 }}>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 320px', minWidth: 0, flexWrap: 'nowrap' }}>
          <button className="btn btn-ghost btn-sm" title="Produto anterior" disabled={idx <= 0}
            onClick={() => setSku(filtrados[idx - 1].emb.codigo)}><ChevronLeft size={15} /></button>
          <select className="form-input" value={prod?.emb.codigo || ''} onChange={e => setSku(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>
            {!filtrados.length && <option value="">Nenhum produto</option>}
            {catsFiltradas.map(c => (
              <optgroup key={c} label={c}>
                {filtrados.filter(p => p.emb.categoria === c).map(p => (
                  <option key={p.emb.codigo} value={p.emb.codigo}>{p.semFicha ? '⚠️ ' : ''}{p.emb.nome}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" title="Próximo produto" disabled={idx < 0 || idx >= filtrados.length - 1}
            onClick={() => setSku(filtrados[idx + 1].emb.codigo)}><ChevronRight size={15} /></button>
        </div>
        {qtdSemFicha > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--gray-500)' }}>
            <input type="checkbox" checked={soSemFicha} onChange={e => setSoSemFicha(e.target.checked)} />
            Só sem ficha técnica ({qtdSemFicha})
          </label>
        )}
        <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
          {filtrados.length ? `${idx + 1} de ${filtrados.length}` : ''}
        </span>
      </div>

      {!prod ? (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--gray-400)' }}>
          Nenhum produto com esse filtro.
        </div>
      ) : (
        <Detalhe key={prod.emb.codigo} p={prod} data={data} reload={reload}
          incluirOverhead={incluirOverhead} cmvDe={cmvDe} alvo={alvo} alvoTxt={alvoTxt} mudarAlvo={mudarAlvo} />
      )}
    </div>
  )
}

function Detalhe({ p, data, reload, incluirOverhead, cmvDe, alvo, alvoTxt, mudarAlvo }) {
  const equiv = num(p.emb.equivalencia_overhead) || 1
  const overhead = incluirOverhead ? (data.overheadPorUnidade || 0) * equiv : 0
  const cmv = cmvDe(p)
  const cmvEstimado = p.cmvTotal + overhead
  const mp = p.custoPrepsReal
  const emb = p.custoRotulo
  const peso = p.detalhesPrep.reduce((s, d) => s + (d.unidade === 'g' ? d.qtdCrua : 0), 0)
  const parte = v => cmv > 0 ? fmtPct(v / cmv) + ' do custo' : ''

  // Ingredientes sem preço (custo zero) — o custo da unidade fica menor do que é
  const semPreco = [...new Set(p.detalhesPrep.flatMap(d =>
    d.ingredientes.filter(i => !i.isSubPrep && !(i.custo > 0)).map(i => i.mp || i.nome)))]

  return (
    <>
      {/* Cabeçalho */}
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--gray-800)' }}>{p.emb.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
            <span style={{ fontFamily: 'monospace' }}>{p.emb.codigo}</span> · {p.emb.categoria}
            {equiv > 1 && <> · conta como {fmt(equiv, 0)} unidades no overhead</>}
          </div>
        </div>
        {!p.semFicha && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 12,
            background: p.temRendimentoReal ? 'var(--ok-pale)' : 'var(--gray-100)',
            color: p.temRendimentoReal ? 'var(--ok)' : 'var(--gray-500)',
          }}>
            {p.temRendimentoReal ? '✓ Custo com rendimento medido na produção' : 'Custo com rendimento estimado da receita'}
          </span>
        )}
        {!p.semFicha && <BotaoFichaPDF emb={p.emb} />}
      </div>

      {p.semFicha && (
        <div className="alert-banner warning">
          ⚠️ Sem ficha técnica: o custo abaixo é só da embalagem. Cadastre a composição em Admin › Composição e embalagem.
        </div>
      )}
      {semPreco.length > 0 && (
        <div className="alert-banner warning">
          ⚠️ Sem preço de compra (custo zero): <b>{semPreco.join(', ')}</b>. O custo da unidade está menor do que o real.
        </div>
      )}

      {/* 1. Custo da unidade */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Kpi destaque label="Custo por unidade" valor={fmtR(cmv)}
          detalhe={p.temRendimentoReal ? `estimado: ${fmtR(cmvEstimado)}` : (incluirOverhead ? 'com overhead' : 'sem overhead')} />
        <Kpi label="Matéria-prima" valor={fmtR(mp)} detalhe={parte(mp)} />
        <Kpi label="Embalagem" valor={fmtR(emb)} detalhe={parte(emb) || 'rótulo + filme/vidro'} />
        <Kpi label="Overhead" valor={incluirOverhead ? fmtR(overhead) : '—'}
          detalhe={incluirOverhead ? parte(overhead) : 'desligado (chave acima)'} />
        <Kpi label="Peso" valor={peso > 0 ? `${fmt(peso, 0)} g` : '—'}
          detalhe={p.detalhesPrep.length ? `${p.detalhesPrep.length} preparaç${p.detalhesPrep.length > 1 ? 'ões' : 'ão'}` : 'sem ficha'} />
        <Kpi label="Custo por kg" valor={peso > 0 ? fmtR(cmv / peso * 1000) : '—'} detalhe="custo ÷ peso" />
      </div>

      {/* 2. Preço e margem por canal */}
      <Canais p={p} data={data} reload={reload} cmv={cmv} peso={peso} alvo={alvo} alvoTxt={alvoTxt} mudarAlvo={mudarAlvo} />

      {/* 3. O que pesa no custo */}
      <Composicao p={p} data={data} cmv={cmv} overhead={overhead} />
    </>
  )
}

// Ficha técnica das preparações (PDF para o time de produção): 0,5 a 6 receitas, sem custos
const LS_PREP = 'fichaProduto.prepPDF'
function FichasPreparacao({ prepMap }) {
  const preps = Object.values(prepMap).filter(p => p.ativo !== false).sort((a, b) =>
    (a.tipo || '').localeCompare(b.tipo || '') || (a.nome || '').localeCompare(b.nome || ''))
  const tipos = [...new Set(preps.map(p => p.tipo || 'outros'))]
  const [prepId, setPrepId] = useState(() => lerLS(LS_PREP, ''))
  const [gerando, setGerando] = useState(null)
  const atual = prepMap[prepId] ? prepId : preps[0]?.id || ''

  async function gerar(qual) {
    setGerando(qual)
    try { await gerarFichaPreparacoesPDF(qual === 'uma' ? [atual] : []) }
    catch (e) { alert('Não consegui gerar o PDF: ' + (e.message || e)) }
    setGerando(null)
  }
  if (!preps.length) return null
  return (
    <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Ficha técnica das preparações</div>
        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>PDF para a produção: ingredientes de 0,5 a 6 receitas e quanto rende, sem custos.</div>
      </div>
      <select className="form-input" value={atual} onChange={e => { setPrepId(e.target.value); gravarLS(LS_PREP, e.target.value) }}
        style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320, fontSize: 13, fontWeight: 600 }}>
        {tipos.map(t => (
          <optgroup key={t} label={t}>
            {preps.filter(p => (p.tipo || 'outros') === t).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </optgroup>
        ))}
      </select>
      <button className="btn btn-primary btn-sm" onClick={() => gerar('uma')} disabled={!!gerando || !atual}>
        {gerando === 'uma' ? <RefreshCw size={13} className="spin" /> : <FileDown size={13} />} PDF desta preparação
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => gerar('todas')} disabled={!!gerando}
        title="Todas as preparações ativas num PDF só, agrupadas por tipo">
        {gerando === 'todas' ? <RefreshCw size={13} className="spin" /> : <FileDown size={13} />} Todas
      </button>
    </div>
  )
}

// PDF das preparações deste produto, com quantas unidades cada receita rende
function BotaoFichaPDF({ emb }) {
  const [gerando, setGerando] = useState(false)
  async function gerar() {
    setGerando(true)
    try { await gerarFichaTecnicaPDF({ codigo: emb.codigo, nome: emb.nome, categoria: emb.categoria }) }
    catch (e) { alert('Não consegui gerar o PDF: ' + (e.message || e)) }
    setGerando(false)
  }
  return (
    <button className="btn btn-ghost btn-sm" onClick={gerar} disabled={gerando}
      title="As preparações deste produto, de 0,5 a 6 receitas, com quantas unidades cada receita rende">
      {gerando ? <RefreshCw size={13} className="spin" /> : <FileDown size={13} />} PDF das preparações deste produto
    </button>
  )
}

function Kpi({ label, valor, detalhe, destaque }) {
  return (
    <div className="kpi" style={destaque ? { borderColor: 'var(--purple)', background: 'var(--purple-ghost)' } : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 22, color: destaque ? 'var(--purple)' : 'var(--gray-800)' }}>{valor}</div>
      {detalhe && <div className="kpi-detail">{detalhe}</div>}
    </div>
  )
}

// ── Preço e margem por canal ──────────────────────────────────────────────────
function Canais({ p, data, reload, cmv, peso, alvo, alvoTxt, mudarAlvo }) {
  const canais = data.canais || []
  const salvos = p.precosCanal || {}
  const [precos, setPrecos] = useState(() =>
    Object.fromEntries(canais.map(c => [c.id, salvos[c.id] ? String(salvos[c.id]).replace('.', ',') : ''])))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const mudou = canais.some(c => num(precos[c.id]) !== (num(salvos[c.id]) || 0))

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      for (const c of canais) {
        const novo = num(precos[c.id]), antigo = num(salvos[c.id]) || 0
        if (novo === antigo) continue
        const { error } = novo > 0
          ? await supabase.from('preco_produto_canal').upsert({
              sku_produto: p.emb.codigo, canal_id: c.id, preco: novo, atualizado_em: new Date().toISOString(),
            }, { onConflict: 'sku_produto,canal_id' })
          : await supabase.from('preco_produto_canal').delete().eq('sku_produto', p.emb.codigo).eq('canal_id', c.id)
        if (error) throw error
      }
      reload()
    } catch (e) {
      setErro('Não consegui salvar: ' + (e.message || e))
      setSalvando(false)
    }
  }

  const th = (txt, align = 'right', extra) => (
    <th style={{ padding: '8px 10px', textAlign: align, fontWeight: 600, color: 'var(--gray-500)', fontSize: 12, ...extra }}>{txt}</th>
  )

  return (
    <div className="card">
      <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ fontWeight: 800, fontSize: 15, flex: '1 1 200px' }}>Preço e margem por canal</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gray-600)' }}>
          Margem alvo
          <input className="form-input" type="number" min={0} max={95} step={1} value={alvoTxt}
            onChange={e => mudarAlvo(e.target.value)} style={{ width: 70, fontSize: 13, textAlign: 'right' }} />
          %
        </label>
        {mudou && (
          <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Salvar preços
          </button>
        )}
      </div>
      {erro && <div className="alert-banner danger" style={{ margin: 12 }}>{erro}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--gray-50)' }}>
            {th('Canal', 'left', { paddingLeft: 16 })}
            {th('Preço')}
            {th('Lucro por venda')}
            {th('Margem')}
            {th('Custo % do preço')}
            {th(`Preço p/ ${fmt(alvo * 100, 0)}%`)}
            {th('Desconto máx.', 'right', { paddingRight: 16 })}
          </tr>
        </thead>
        <tbody>
          {canais.map(c => {
            const preco = num(precos[c.id])
            const tem = preco > 0
            const { lucro, margem } = contasCanal(c, preco, cmv)
            const pMin = precoMinimo(c, cmv)
            const pAlvo = precoParaMargem(c, cmv, alvo)
            const dMax = tem && isFinite(pMin) ? Math.max(0, (preco - pMin) / preco) : null
            const status = !tem ? null : (lucro < 0 ? 'prejuízo' : margem !== null && margem + 1e-9 >= alvo ? 'ok' : 'abaixo do alvo')
            const cor = status === 'ok' ? 'var(--ok)' : status === 'prejuízo' ? 'var(--danger)' : 'var(--warning)'
            return (
              <tr key={c.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                <td style={{ padding: '9px 10px 9px 16px' }}>
                  <div style={{ fontWeight: 700 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                    {fmt(c.totalPct * 100, 1)}%{c.totalFixo > 0 ? ` + ${fmtR(c.totalFixo)}` : ''} de taxas
                  </div>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                  <input type="text" inputMode="decimal" value={precos[c.id] || ''} placeholder="sem preço"
                    onChange={e => setPrecos(v => ({ ...v, [c.id]: e.target.value }))}
                    style={{ width: 86, padding: '4px 6px', fontSize: 13, border: '1px solid var(--gray-200)', borderRadius: 6, textAlign: 'right' }} />
                  {tem && peso > 0 && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>{fmtR(preco / peso * 1000)}/kg</div>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                  {tem ? <>
                    <div style={{ fontWeight: 700, color: lucro < 0 ? 'var(--danger)' : 'var(--gray-800)' }}>{fmtR(lucro)}</div>
                    {cmv > 0 && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>markup {fmt(preco / cmv, 1)}x</div>}
                  </> : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                  {tem ? <>
                    <div style={{ fontWeight: 800, color: cor }}>{margem === null ? '—' : fmtPct(margem)}</div>
                    <div style={{ fontSize: 11, color: cor }}>{status === 'ok' ? '✓ no alvo' : status}</div>
                  </> : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>
                  {tem ? fmtPct(cmv / preco) : <span style={{ color: 'var(--gray-300)' }}>—</span>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                  {isFinite(pAlvo) && cmv > 0 ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <span style={{ fontWeight: 700 }}>{fmtR(pAlvo)}</span>
                      <button className="btn btn-ghost btn-xs" title="Usar este preço"
                        onClick={() => setPrecos(v => ({ ...v, [c.id]: (Math.ceil((pAlvo + 0.01) * 10) / 10 - 0.01).toFixed(2).replace('.', ',') }))}>
                        usar
                      </button>
                    </div>
                  ) : '—'}
                </td>
                <td style={{ padding: '9px 16px 9px 10px', textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: dMax === 0 ? 'var(--danger)' : 'var(--gray-700)' }}>
                    {dMax === null ? '—' : fmtPct(dMax)}
                  </div>
                  {isFinite(pMin) && cmv > 0 && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>mín. {fmtR(pMin)}</div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--gray-400)', lineHeight: 1.5, borderTop: '1px solid var(--gray-100)' }}>
        Margem = lucro ÷ receita líquida (preço menos taxa da plataforma, imposto, comissão, desconto de campanha e custos fixos do canal) — mesma conta do Ranking de margem.
        Desconto máx. = quanto dá para baixar o preço antes de dar prejuízo. "usar" arredonda para o ,x9 de cima. Taxas dos canais em Admin › Canais.
      </div>
    </div>
  )
}

// ── O que pesa no custo ───────────────────────────────────────────────────────
function Composicao({ p, data, cmv, overhead }) {
  const [porPrep, setPorPrep] = useState(false)

  const itensEmb = data.itensEmbPorSku?.[p.emb.codigo]
  const linhas = [
    ...(p.mpsProduto || []).map(m => ({
      tipo: 'mp', nome: m.nome, qtd: m.qtd, unidade: m.unidade, custo: m.custo,
      sub: [
        m.preps?.size > 1 ? `em ${[...m.preps].join(' + ')}` : null,
        data.mpMap?.[m.mpId]?.atualizado_em ? `preço de ${new Date(data.mpMap[m.mpId].atualizado_em).toLocaleDateString('pt-BR')}` : null,
      ].filter(Boolean).join(' · '),
    })),
    ...(num(p.emb.custo_unitario) > 0 ? [{ tipo: 'emb', nome: 'Rótulo', qtd: 1, unidade: ' un', custo: num(p.emb.custo_unitario) }] : []),
    ...(itensEmb || []).map(it => ({ tipo: 'emb', nome: it.nome, qtd: it.qtd, unidade: ' un', custo: it.custo })),
    ...(!itensEmb && (data.custoEmbPorCat?.[p.emb.categoria] || 0) > 0
      ? [{ tipo: 'emb', nome: 'Filme/vidro da categoria', qtd: null, custo: data.custoEmbPorCat[p.emb.categoria], sub: p.emb.categoria }]
      : []),
    ...(overhead > 0 ? [{ tipo: 'over', nome: 'Overhead de produção', qtd: null, custo: overhead }] : []),
  ].filter(l => l.custo > 0).sort((a, b) => b.custo - a.custo)

  const total = linhas.reduce((s, l) => s + l.custo, 0) || cmv
  const maior = linhas[0]?.custo || 0
  const tipos = [...new Set(linhas.map(l => l.tipo))]

  return (
    <div className="card">
      <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ fontWeight: 800, fontSize: 15, flex: '1 1 200px' }}>O que pesa no custo</div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--gray-500)' }}>
          {tipos.map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: COR_TIPO[t] }} />{NOME_TIPO[t]}
            </span>
          ))}
        </div>
        {p.detalhesPrep.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setPorPrep(v => !v)}>
            {porPrep ? 'Ver por ingrediente' : 'Ver por preparação'}
          </button>
        )}
      </div>

      {!porPrep ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {linhas.map((l, i) => {
              const parte = total > 0 ? l.custo / total : 0
              return (
                <tr key={l.tipo + l.nome + i} style={{ borderTop: i ? '1px solid var(--gray-100)' : 'none' }}
                  title={`${l.nome}: ${fmtR(l.custo)} (${fmtPct(parte)})`}>
                  <td style={{ padding: '8px 10px 8px 16px' }}>
                    <div style={{ fontWeight: 600 }}>{l.nome}</div>
                    {l.sub && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{l.sub}</div>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                    {l.qtd !== null && l.qtd !== undefined ? `${fmt(l.qtd, l.unidade === ' un' ? 0 : 1)}${l.unidade || ''}` : ''}
                  </td>
                  <td style={{ padding: '8px 10px', width: '38%', minWidth: 120 }}>
                    <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4 }}>
                      <div style={{ height: '100%', width: `${maior > 0 ? Math.max(2, l.custo / maior * 100) : 0}%`, background: COR_TIPO[l.tipo], borderRadius: 4 }} />
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(l.custo)}</td>
                  <td style={{ padding: '8px 16px 8px 6px', textAlign: 'right', color: 'var(--gray-500)', width: 60 }}>{fmtPct(parte)}</td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
              <td style={{ padding: '9px 10px 9px 16px', fontWeight: 800 }} colSpan={3}>Custo por unidade</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 800, color: 'var(--purple)' }}>{fmtR(total)}</td>
              <td style={{ padding: '9px 16px 9px 6px', textAlign: 'right', color: 'var(--gray-500)' }}>100%</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)' }}>
              {['Preparação', 'Na unidade', 'Custo por kg', 'Custo na unidade', 'Rendimento'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', paddingLeft: i ? 10 : 16, textAlign: i ? 'right' : 'left', fontWeight: 600, color: 'var(--gray-500)', fontSize: 12 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.detalhesPrep.map(d => {
              const diff = d.custoNaUnidade > 0 ? (d.custoNaUnidadeReal - d.custoNaUnidade) / d.custoNaUnidade : 0
              return (
                <tr key={d.prepId} style={{ borderTop: '1px solid var(--gray-100)' }}>
                  <td style={{ padding: '8px 10px 8px 16px', fontWeight: 600 }}>{d.nome}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--gray-500)' }}>{fmt(d.qtdCrua, 1)} {d.unidade}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--gray-500)' }}>{fmtR(d.custoPorG * 1000)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>
                    {fmtR(d.custoNaUnidadeReal)}
                    {d.usandoReal && Math.abs(diff) >= 0.001 && (
                      <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)' }}>
                        estimado {fmtR(d.custoNaUnidade)} ({diff > 0 ? '+' : ''}{fmtPct(diff)})
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 16px 8px 10px', textAlign: 'right', fontSize: 12 }}>
                    {d.usandoReal
                      ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>✓ medido: {fmt(d.rendReal, 0)} {d.unidadeRendimento}</span>
                      : <span style={{ color: 'var(--gray-500)' }}>estimado: {fmt(d.rendEstimado, 0)} {d.unidadeRendimento}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
