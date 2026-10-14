import React, { useState, useEffect } from 'react'
import { RefreshCw, FileSpreadsheet } from 'lucide-react'
import { baixarXlsx } from '../lib/xlsx'
import {
  carregarFechamentos, calcularTeorico, calcularCMVMes, reabrirMes,
  dataFechamentoPrevista, ultimoDia,
} from '../lib/cmv'

function fmt(n, d = 2) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) }
function fmtR(n) { return `R$ ${fmt(n, 2)}` }
function fmtQ(n, un) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1000 && (un === 'g' || un === 'ml')) return `${fmt(v / 1000, 2)} ${un === 'g' ? 'kg' : 'l'}`
  return `${fmt(v, un === 'un' ? 0 : 1)} ${un || ''}`
}
const soma = (linhas, k) => linhas.reduce((s, l) => s + (l[k] || 0), 0)
const corDif = pct => Math.abs(pct || 0) > 5 ? 'var(--danger)' : 'var(--ok)'

function usuarioAtual() {
  try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
}

// Selo de origem do estoque: contagem física x saldo calculado
function Origem({ o }) {
  if (o !== 'calculado') return null
  return <span title="Sem contagem no último dia do mês: última contagem + entradas − consumo registrado"
    style={{ fontSize: 9, fontWeight: 800, color: 'var(--warning)', marginLeft: 4, textTransform: 'uppercase' }}>calc.</span>
}

export default function ControleEstoque() {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7))
  const [vista, setVista] = useState('real')
  const [expandido, setExpandido] = useState(null)
  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [reabrindo, setReabrindo] = useState(false)

  useEffect(() => { load() }, [mes])

  async function load() {
    setLoading(true); setErro('')
    try {
      const ini = mes + '-01'
      const fim = ultimoDia(mes)
      // Sem a tabela de fechamento (SQL ainda não aplicado) tudo fica provisório
      const fechamentos = await carregarFechamentos().catch(() => ({}))
      const teorico = await calcularTeorico(ini, fim)
      const cmv = await calcularCMVMes(mes, { fechamentos, teorico })
      setDados({ ...teorico, cmv, ini, fim })
    } catch (e) {
      setErro(e.message || String(e)); setDados(null)
    }
    setLoading(false)
  }

  async function reabrir() {
    if (!window.confirm(`Reabrir ${labelMes}?\n\nOs meses seguintes já fechados também serão reabertos ` +
      `(o estoque final de um é o inicial do outro). Eles fecham de novo sozinhos no próximo acesso a partir do dia 5.`)) return
    setReabrindo(true)
    try { await reabrirMes(mes); await load() } catch (e) { alert('Erro ao reabrir: ' + e.message) }
    setReabrindo(false)
  }

  const labelMes = new Date(mes + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const linhas = dados?.cmv?.linhas || []
  const linhasMP = linhas.filter(l => l.tipo === 'mp')
  const linhasEmb = linhas.filter(l => l.tipo === 'emb')
  const realMP = soma(linhasMP, 'cmv_valor'), realEmb = soma(linhasEmb, 'cmv_valor')
  const teoMP = soma(linhasMP, 'teorico_valor'), teoEmb = soma(linhasEmb, 'teorico_valor')
  const fechado = dados?.cmv?.status === 'fechado'
  const ehAdmin = usuarioAtual()?.perfil === 'admin'

  function exportarReal() {
    baixarXlsx({
      nomeArquivo: `CMV_real_${mes}`,
      aba: labelMes,
      colunas: [
        { header: 'Tipo',              key: 'tipo',    tipo: 'texto',  largura: 12 },
        { header: 'Item',              key: 'nome',    tipo: 'texto',  largura: 36 },
        { header: 'Unidade',           key: 'unidade', tipo: 'texto',  largura: 8 },
        { header: 'Estoque inicial',   key: 'ei_qtd',  tipo: 'numero', largura: 14 },
        { header: 'EI (R$)',           key: 'ei_valor', tipo: 'moeda', largura: 13 },
        { header: 'Compras',           key: 'compras_qtd', tipo: 'numero', largura: 12 },
        { header: 'Compras (R$)',      key: 'compras_valor', tipo: 'moeda', largura: 13 },
        { header: 'Atrasadas (R$)',    key: 'atrasadas_valor', tipo: 'moeda', largura: 13 },
        { header: 'Estoque final',     key: 'ef_qtd',  tipo: 'numero', largura: 14 },
        { header: 'EF (R$)',           key: 'ef_valor', tipo: 'moeda', largura: 13 },
        { header: 'Origem EF',         key: 'ef_origem', tipo: 'texto', largura: 11 },
        { header: 'Consumo',           key: 'cmv_qtd', tipo: 'numero', largura: 12 },
        { header: 'CMV real (R$)',     key: 'cmv_valor', tipo: 'moeda', largura: 14 },
        { header: 'Teórico (R$)',      key: 'teorico_valor', tipo: 'moeda', largura: 14 },
      ],
      linhas: linhas.map(l => ({ ...l, tipo: l.tipo === 'mp' ? 'Matéria-prima' : 'Embalagem' })),
    })
  }

  // Tabela de CMV real de um grupo
  const TabelaReal = ({ titulo, sub, lista, total }) => (
    <div className="card">
      <div style={{ padding: '12px 20px', background: 'var(--purple)', color: '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{titulo}</div>
          <div style={{ fontSize: 11, opacity: .75, marginTop: 2 }}>{sub}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--gold)' }}>{fmtR(total)}</div>
      </div>
      {lista.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--gray-300)', fontSize: 13 }}>Sem movimento no período.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left' }}>Item</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Estoque inicial</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>+ Compras</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>− Estoque final</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>= Consumo</th>
                <th style={{ padding: '8px 14px', textAlign: 'right' }}>CMV real</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l, i) => (
                <tr key={l.item_id} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '7px 14px', fontWeight: 600 }}>
                    {l.nome}
                    {l.categoria && <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 400 }}>{l.categoria}</div>}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>
                    {l.ei_qtd === null ? <span style={{ color: 'var(--gray-300)' }}>sem dado</span> : <>
                      {fmtQ(l.ei_qtd, l.unidade)}<Origem o={l.ei_origem} />
                      <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtR(l.ei_valor)}</div>
                    </>}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--ok)' }}>
                    {l.compras_qtd > 0 ? <>+{fmtQ(l.compras_qtd, l.unidade)}
                      <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtR(l.compras_valor)}</div></> : '—'}
                    {l.atrasadas_qtd > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 700 }}
                        title="Compra de mês já fechado, lançada depois do fechamento">
                        +{fmtR(l.atrasadas_valor)} de mês anterior
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>
                    {l.ef_qtd === null ? <span style={{ color: 'var(--gray-300)' }}>sem dado</span> : <>
                      {fmtQ(l.ef_qtd, l.unidade)}<Origem o={l.ef_origem} />
                      <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtR(l.ef_valor)}</div>
                    </>}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                    color: (l.cmv_qtd || 0) < 0 ? 'var(--danger)' : 'var(--purple)' }}>
                    {l.cmv_qtd === null ? 'n/d' : fmtQ(l.cmv_qtd, l.unidade)}
                  </td>
                  <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 700 }}>
                    {l.cmv_valor === null ? 'n/d' : fmtR(l.cmv_valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.some(l => (l.cmv_qtd || 0) < 0) && (
            <div style={{ padding: '10px 20px', background: '#fff8f0', fontSize: 12, color: 'var(--gray-600)' }}>
              ⚠️ Consumo negativo indica erro de contagem ou compra não lançada.
            </div>
          )}
          {lista.some(l => l.ef_origem === 'calculado') && (
            <div style={{ padding: '10px 20px', background: 'var(--gray-50)', fontSize: 11, color: 'var(--gray-500)', borderTop: '1px solid var(--gray-100)' }}>
              <b style={{ color: 'var(--warning)' }}>CALC.</b> = sem contagem no último dia do mês; o estoque final é a última
              contagem + entradas − consumo registrado. Nesses itens o CMV real repete o consumo registrado e não enxerga perdas —
              conte-os no fechamento para medir o real.
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>📦 Controle de Estoque e CMV</div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
          {[['real', '📊 CMV Real'], ['produzido', '🏭 CMV Produzido'], ['comparar', '🔀 Real × Teórico']].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${vista === k ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setVista(k)}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input type="month" className="form-input" value={mes} onChange={e => setMes(e.target.value)}
          style={{ width: 170, fontSize: 13 }} />
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /></button>
      </div>

      {erro && <div className="card card-pad" style={{ color: 'var(--danger)', fontSize: 13 }}>Erro ao calcular: {erro}</div>}

      {loading ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : !dados ? null : (
        <>
          {/* Situação do mês */}
          {vista !== 'produzido' && (
            <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              background: fechado ? '#f0faf0' : '#fff8f0' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: fechado ? 'var(--ok)' : 'var(--warning)' }}>
                {fechado
                  ? `🔒 Fechado em ${new Date(dados.cmv.fechado_em).toLocaleDateString('pt-BR')} — valores congelados`
                  : `⏳ Provisório — fecha automaticamente em ${dataFechamentoPrevista(mes)}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                Estoques valorizados por PEPS · CMV = estoque inicial + compras − estoque final
              </div>
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={exportarReal} disabled={!linhas.length}>
                <FileSpreadsheet size={13} /> Exportar Excel
              </button>
              {fechado && ehAdmin && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={reabrir} disabled={reabrindo}>
                  {reabrindo ? <RefreshCw size={12} className="spin" /> : '🔓'} Reabrir mês
                </button>
              )}
            </div>
          )}

          {/* ═══ CMV REAL ═══ */}
          {vista === 'real' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
                {[
                  ['Matéria-prima', realMP],
                  ['Embalagem', realEmb],
                  ['CMV real total', realMP + realEmb],
                ].map(([l, v]) => (
                  <div key={l} className="card card-pad" style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--purple)', margin: '4px 0' }}>{fmtR(v)}</div>
                  </div>
                ))}
              </div>
              <TabelaReal titulo="🧂 Matéria-prima" sub="contagem física no último dia do mês" lista={linhasMP} total={realMP} />
              <div className="card">
                <div style={{ padding: '12px 20px', background: 'var(--purple)', color: '#fff',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>📦 Embalagens e rótulos</div>
                    <div style={{ fontSize: 11, opacity: .75, marginTop: 2 }}>
                      unidades produzidas × embalagem de cada produto · perda de {fmt(dados.perdaEmbPct, 0)}%
                    </div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--gold)' }}>{fmtR(realEmb)}</div>
                </div>
                {linhasEmb.length === 0 ? (
                  <div style={{ padding: 28, textAlign: 'center', color: 'var(--gray-300)', fontSize: 13 }}>Nenhuma produção registrada no período.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                          <th style={{ padding: '8px 14px', textAlign: 'left' }}>Item</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Pela produção</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>+ Perda</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Custo un.</th>
                          <th style={{ padding: '8px 14px', textAlign: 'right' }}>CMV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhasEmb.map((l, i) => {
                          const custo = l.cmv_qtd > 0 ? l.cmv_valor / l.cmv_qtd : 0
                          return (
                            <tr key={l.item_id} style={{ borderTop: '1px solid var(--gray-100)', background: i % 2 ? '#fafafa' : '#fff' }}>
                              <td style={{ padding: '7px 14px', fontWeight: 600 }}>
                                {l.nome}
                                {l.categoria && <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 400 }}>{l.categoria}</div>}
                              </td>
                              <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmtQ(l.teorico_qtd, 'un')}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--warning)' }}>+{fmtQ(l.cmv_qtd - l.teorico_qtd, 'un')}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-500)' }}>
                                {custo > 0 ? `R$ ${fmt(custo, 4)}` : <span style={{ color: 'var(--danger)' }}>sem custo</span>}
                              </td>
                              <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 700 }}>{fmtR(l.cmv_valor)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
                      { header: 'Maior custo',     key: 'mp1',       tipo: 'texto',  largura: 30 },
                      { header: '% do CMV',        key: 'mp1pct',    tipo: 'texto',  largura: 11 },
                    ],
                    linhas: dados.produzidos.map(p => {
                      const itens = [
                        ...(p.mps || []),
                        { nome: 'Embalagem', custo: p.embUnit },
                      ].sort((a, b) => b.custo - a.custo)
                      const top = itens[0]
                      const pctTop = top && p.cmvUnit > 0 ? `${fmt(top.custo / p.cmvUnit * 100, 1)}%` : ''
                      return {
                        nome: p.emb.nome, sku: p.emb.codigo, produzido: p.qtd,
                        mp: p.mpUnit, emb: p.embUnit, cmv: p.cmvUnit, total: p.total,
                        mp1: top ? top.nome : '', mp1pct: pctTop,
                      }
                    }),
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
                    {dados.produzidos.map((p, i) => {
                      const aberto = expandido === p.emb.codigo
                      const temMP = (p.mps || []).length > 0
                      return (
                      <React.Fragment key={p.emb.codigo}>
                      <tr onClick={() => temMP && setExpandido(aberto ? null : p.emb.codigo)}
                        style={{ borderTop: '1px solid var(--gray-100)', background: aberto ? 'var(--purple-pale)' : i % 2 ? '#fafafa' : '#fff',
                          cursor: temMP ? 'pointer' : 'default' }}>
                        <td style={{ padding: '7px 14px' }}>
                          <div style={{ fontWeight: 600 }}>
                            {temMP && <span style={{ color: 'var(--gray-400)', marginRight: 4 }}>{aberto ? '▾' : '▸'}</span>}
                            {p.emb.nome}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{p.emb.categoria}</div>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>{p.qtd.toLocaleString('pt-BR')}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmtR(p.mpUnit)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmtR(p.embUnit)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--purple)' }}>{fmtR(p.cmvUnit)}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 800 }}>{fmtR(p.total)}</td>
                      </tr>
                      {aberto && (
                        <tr style={{ background: '#f8f5ff' }}>
                          <td colSpan={6} style={{ padding: '0 14px 12px' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', padding: '8px 0 6px', fontWeight: 700 }}>
                              💰 Composição do CMV por unidade · total {fmtR(p.cmvUnit)}
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <tbody>
                                {[
                                  ...p.mps.map(m => ({ ...m, tipo: 'mp' })),
                                  { nome: 'Embalagem (rótulo + filme/vidro)', qtd: null, unidade: '',
                                    custo: p.embUnit, tipo: 'emb' },
                                ].sort((a, b) => b.custo - a.custo).map((m, mi) => {
                                  const pctCMV = p.cmvUnit > 0 ? m.custo / p.cmvUnit * 100 : 0
                                  const cor = m.tipo === 'emb' ? 'var(--gold)' : 'var(--purple)'
                                  return (
                                    <tr key={m.nome} style={{ borderTop: '1px solid var(--gray-100)',
                                      background: m.tipo === 'emb' ? '#fffbf0' : mi % 2 ? '#fff' : 'transparent' }}>
                                      <td style={{ padding: '5px 10px', fontWeight: 600 }}>
                                        {m.tipo === 'emb' ? '📦 ' : ''}{m.nome}
                                      </td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--gray-500)', width: 110 }}>
                                        {m.qtd !== null ? `${fmt(m.qtd, 2)}${m.unidade}` : '—'}
                                      </td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: cor, width: 90 }}>
                                        {fmtR(m.custo)}
                                      </td>
                                      <td style={{ padding: '5px 10px', width: 150 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                          <div style={{ width: 60, height: 6, background: 'var(--gray-100)', borderRadius: 3 }}>
                                            <div style={{ height: '100%', width: `${Math.min(100, pctCMV)}%`, background: cor, borderRadius: 3 }} />
                                          </div>
                                          <span style={{ fontSize: 11, fontWeight: 700, minWidth: 38, textAlign: 'right' }}>{fmt(pctCMV, 1)}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )})}
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

          {/* ═══ REAL × TEÓRICO ═══ */}
          {vista === 'comparar' && (() => {
            const Grupo = ({ titulo, lista, real, teo }) => {
              const comDado = lista.filter(l => l.cmv_valor !== null || l.teorico_valor > 0)
                .map(l => ({ ...l, dif: (l.cmv_valor || 0) - (l.teorico_valor || 0) }))
                .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))
              const dif = real - teo, difPct = teo > 0 ? dif / teo * 100 : null
              return (
                <div className="card">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 150px', gap: 12,
                    padding: '12px 16px', background: 'var(--purple)', color: '#fff', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{titulo}</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Real</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Teórico (ficha)</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Diferença</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 150px', gap: 12,
                    padding: '12px 16px', background: 'var(--purple-pale)', alignItems: 'center', fontWeight: 800 }}>
                    <div style={{ color: 'var(--purple)' }}>Total</div>
                    <div style={{ textAlign: 'right' }}>{fmtR(real)}</div>
                    <div style={{ textAlign: 'right' }}>{fmtR(teo)}</div>
                    <div style={{ textAlign: 'right', color: corDif(difPct) }}>
                      {dif >= 0 ? '+' : '−'}{fmtR(Math.abs(dif))}{difPct !== null && ` (${fmt(Math.abs(difPct), 1)}%)`}
                    </div>
                  </div>
                  {comDado.map((l, i) => {
                    const pct = l.teorico_valor > 0 ? l.dif / l.teorico_valor * 100 : null
                    const difQ = (l.cmv_qtd || 0) - (l.teorico_qtd || 0)
                    return (
                      <div key={l.item_id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 150px', gap: 12,
                        padding: '7px 16px', borderTop: '1px solid var(--gray-100)', alignItems: 'center', fontSize: 12,
                        background: i % 2 ? '#fafafa' : '#fff' }}>
                        <div style={{ fontWeight: 600 }}>{l.nome}<Origem o={l.ef_origem} /></div>
                        <div style={{ textAlign: 'right' }}>
                          {l.cmv_valor === null ? 'n/d' : fmtR(l.cmv_valor)}
                          <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{l.cmv_qtd === null ? '' : fmtQ(l.cmv_qtd, l.unidade)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {fmtR(l.teorico_valor)}
                          <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{fmtQ(l.teorico_qtd, l.unidade)}</div>
                        </div>
                        <div style={{ textAlign: 'right', fontWeight: 700, color: l.cmv_valor === null ? 'var(--gray-300)' : corDif(pct) }}>
                          {l.cmv_valor === null ? '—' : <>
                            {l.dif >= 0 ? '+' : '−'}{fmtR(Math.abs(l.dif))}{pct !== null && ` (${fmt(Math.abs(pct), 1)}%)`}
                            <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--gray-400)' }}>
                              {difQ >= 0 ? '+' : '−'}{fmtQ(Math.abs(difQ), l.unidade)}
                            </div>
                          </>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            }

            return (
              <>
                <Grupo titulo="🧂 Matéria-prima" lista={linhasMP} real={realMP} teo={teoMP} />
                <div className="card card-pad" style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                  <b style={{ color: 'var(--gray-700)' }}>📦 Embalagens e rótulos: {fmtR(realEmb)}</b> — sem contagem de estoque, o
                  real é a própria produção × ficha ({fmtR(teoEmb)}) + {fmt(dados.perdaEmbPct, 0)}% de perda. Não há o que comparar.
                </div>

                {/* Interpretação */}
                <div style={{ padding: '14px 18px', borderRadius: 8, background: 'var(--gray-50)',
                  border: '1px solid var(--gray-200)', fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Como ler a diferença</div>
                  <div style={{ color: 'var(--gray-600)' }}>
                    O <strong>real</strong> mede o que saiu do estoque (inicial + compras − final), sem depender de ficha técnica.
                    O <strong>teórico</strong> é o que a ficha diz que deveria ter sido usado para produzir as unidades registradas,
                    valorizado ao mesmo custo unitário do real — a diferença em R$ é só de quantidade.
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--gray-600)' }}>
                    <strong>Real maior que o teórico</strong>: desperdício, rendimento pior que o cadastrado, produção não registrada —
                    ou <strong>preparação pronta em estoque</strong>, que já consumiu matéria-prima mas ainda não virou produto acabado.
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--gray-600)' }}>
                    <strong>Real menor que o teórico</strong>: erro de contagem, compra não lançada ou ficha superestimada.
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--gray-500)', fontSize: 12 }}>
                    Itens marcados <b style={{ color: 'var(--warning)' }}>CALC.</b> não tiveram contagem no último dia do mês — neles o real
                    repete o consumo registrado e a diferença não indica perda.
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
