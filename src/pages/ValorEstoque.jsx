import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'
import {
  carregarFechamentos, carregarBase, calcularCMVMes, mesInicial, mesSeguinte, ultimoDia,
} from '../lib/cmv'

// ═══════════════════════════════════════════════════════════════
// Valor do estoque de matéria-prima, mês a mês (motor de src/lib/cmv.js):
//   inicial  = estoque no fim do mês anterior (contagem, PEPS)
//   comprado = compras do mês (+ atrasadas de mês fechado)
//   utilizado = produção registrada × ficha técnica
//   final    = contagem do último dia (sem ela, saldo calculado)
// Conferência: final − (inicial + comprado − utilizado). Negativo = saiu mais do
// que a ficha explica (perda, ficha subestimada, produção não registrada);
// positivo = sobrou (compra não lançada, ficha superestimada, erro de contagem).
// ═══════════════════════════════════════════════════════════════

// Paleta categórica validada (dataviz: slots 1–4 da referência, ordem fixa)
const COR = { final: '#2a78d6', comprado: '#eb6834', utilizado: '#1baf7a', inicial: '#eda100' }
const SERIES = [
  ['inicial', 'Estoque inicial'], ['comprado', 'Comprado'], ['utilizado', 'Utilizado (produção)'], ['final', 'Estoque final'],
]

function fmtR(n, d = 2) { return `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}` }
const rotMes = m => `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`
const soma = (linhas, k) => linhas.reduce((s, l) => s + (parseFloat(l[k]) || 0), 0)

export default function ValorEstoque() {
  const [meses, setMeses] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  async function load() {
    setLoading(true); setErro('')
    try {
      const atual = new Date().toISOString().slice(0, 7)
      const fechamentos = await carregarFechamentos().catch(() => ({}))
      const base = await carregarBase(ultimoDia(atual))
      const inicio = mesInicial(base)
      if (!inicio) { setMeses([]); setLoading(false); return }
      const lista = []
      for (let m = inicio; m <= atual; m = mesSeguinte(m)) {
        const r = await calcularCMVMes(m, { base, fechamentos })
        const mp = r.linhas.filter(l => l.tipo === 'mp')
        const inicial = soma(mp, 'ei_valor')
        const comprado = soma(mp, 'compras_valor') + soma(mp, 'atrasadas_valor')
        const utilizado = soma(mp, 'teorico_valor')
        const final = soma(mp, 'ef_valor')
        const esperado = inicial + comprado - utilizado
        lista.push({ mes: m, rotulo: rotMes(m), fechado: r.status === 'fechado', inicial, comprado, utilizado, final,
          diferenca: final - esperado, calculados: mp.filter(l => l.ef_origem === 'calculado').length })
      }
      setMeses(lista)
    } catch (e) { setErro(e.message || String(e)) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const atual = meses[meses.length - 1]
  const anterior = meses[meses.length - 2]
  const variacao = atual && anterior ? atual.final - anterior.final : null

  const Kpi = ({ rotulo, valor, sub, cor }) => (
    <div className="card card-pad" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{rotulo}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor || 'var(--gray-800)', margin: '2px 0', whiteSpace: 'nowrap' }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{sub}</div>
    </div>
  )

  if (loading) return <div className="loading"><RefreshCw size={14} className="spin" /> Calculando o estoque mês a mês...</div>
  if (erro) return <div className="card card-pad" style={{ color: 'var(--danger)' }}>Erro ao calcular: {erro}</div>
  if (!atual) return <div className="card card-pad">Ainda não há contagem de fim de mês para começar a série.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
        Matéria-prima · mês de referência <b>{atual.rotulo}</b>{' '}
        <span className={`pill ${atual.fechado ? 'ok' : 'warning'}`}>{atual.fechado ? 'Fechado' : 'Em aberto'}</span>
        {!atual.fechado && ' — mês em andamento, os números mudam até o fechamento'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 10 }}>
        <Kpi rotulo="Valor em estoque" valor={fmtR(atual.final)} sub={atual.fechado ? `contagem de ${atual.rotulo}` : 'hoje (contagem + movimento)'} />
        <Kpi rotulo="Mês anterior" valor={anterior ? fmtR(anterior.final) : '—'} sub={anterior ? anterior.rotulo : ''} />
        <Kpi rotulo="Variação" valor={variacao === null ? '—' : `${variacao >= 0 ? '+' : '−'}${fmtR(Math.abs(variacao))}`}
          sub={variacao !== null && anterior.final > 0 ? `${(variacao / anterior.final * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior` : ''} />
        <Kpi rotulo="Comprado no mês" valor={fmtR(atual.comprado)} sub="compras lançadas" />
        <Kpi rotulo="Utilizado no mês" valor={fmtR(atual.utilizado)} sub="produção × ficha técnica" />
      </div>

      <div className="card card-pad">
        <div className="card-title">Estoque mês a mês</div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={meses} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--gray-100)" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--gray-500)' }} axisLine={{ stroke: 'var(--gray-200)' }} tickLine={false} />
              <YAxis tickFormatter={v => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`}
                tick={{ fontSize: 11, fill: 'var(--gray-500)' }} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(v, nome) => [fmtR(v), nome]}
                contentStyle={{ borderRadius: 8, border: '1px solid var(--gray-200)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SERIES.map(([k, nome]) => (
                <Line key={k} type="monotone" dataKey={k} name={nome} stroke={COR[k]} strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: COR[k] }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {(() => {
          const d = atual.diferenca
          return (
            <div style={{ fontSize: 12, marginTop: 8, color: Math.abs(d) < 1 ? 'var(--ok)' : 'var(--danger)' }}>
              Conferência de {atual.rotulo}: {fmtR(atual.inicial)} + {fmtR(atual.comprado)} − {fmtR(atual.utilizado)} = {fmtR(atual.inicial + atual.comprado - atual.utilizado)} esperado
              {' '}× {fmtR(atual.final)} em estoque — diferença de {d >= 0 ? '+' : '−'}{fmtR(Math.abs(d))}
            </div>
          )
        })()}
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 0' }} className="card-title">Mês a mês</div>
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Mês</th>
              <th style={{ textAlign: 'right' }}>Inicial</th>
              <th style={{ textAlign: 'right' }}>Comprado</th>
              <th style={{ textAlign: 'right' }}>Utilizado</th>
              <th style={{ textAlign: 'right' }}>Final</th>
              <th style={{ textAlign: 'right' }} title="Final − (inicial + comprado − utilizado)">Conferência</th>
            </tr></thead>
            <tbody>
              {[...meses].reverse().map(m => (
                <tr key={m.mes}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{m.rotulo}</b>{' '}
                    <span className={`pill ${m.fechado ? 'ok' : 'warning'}`}>{m.fechado ? 'Fechado' : 'Em aberto'}</span>
                    {m.fechado && m.calculados > 0 && <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{m.calculados} item(ns) sem contagem no fim do mês</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtR(m.inicial)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtR(m.comprado)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtR(m.utilizado)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtR(m.final)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: Math.abs(m.diferenca) < 1 ? 'var(--ok)' : m.diferenca < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {m.diferenca >= 0 ? '+' : '−'}{fmtR(Math.abs(m.diferenca))}
                    {m.utilizado > 0 && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--gray-400)' }}>
                      {(Math.abs(m.diferenca) / m.utilizado * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do utilizado
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--gray-500)', borderTop: '1px solid var(--gray-100)', lineHeight: 1.6 }}>
          <b>Conferência</b> = estoque final − (inicial + comprado − utilizado pela produção).{' '}
          <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Negativo</span>: saiu mais do que a produção explica — perda, ficha subestimada ou produção não registrada.{' '}
          <span style={{ color: 'var(--warning)', fontWeight: 700 }}>Positivo</span>: sobrou — compra não lançada, ficha superestimada ou erro de contagem.{' '}
          Estoques valorizados por PEPS. Detalhe por insumo em Custos › CMV do mês.
        </div>
      </div>
    </div>
  )
}
