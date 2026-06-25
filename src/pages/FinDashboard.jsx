import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { carregarKPIs, atualizarVencidas, fmtR, fmtData } from '../lib/financeiro'
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Clock } from 'lucide-react'

function KPI({ label, value, sub, cor = 'var(--purple)', icon }) {
  return (
    <div className="kpi neutral" style={{ borderTop: `3px solid ${cor}` }}>
      <div className="kpi-label">{icon} {label}</div>
      <div className="kpi-value" style={{ fontSize: 22, color: cor }}>{fmtR(value)}</div>
      {sub && <div className="kpi-detail">{sub}</div>}
    </div>
  )
}

export default function FinDashboard() {
  const hoje = new Date()
  const ini = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const fim = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).getDate()}`

  const [kpis, setKpis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [alertas, setAlertas] = useState([])

  useEffect(() => {
    async function load() {
      await atualizarVencidas()
      const k = await carregarKPIs(ini, fim)
      setKpis(k)

      // Busca próximos vencimentos (7 dias)
      const em7 = new Date(); em7.setDate(em7.getDate() + 7)
      const { data } = await supabase
        .from('fin_parcelas')
        .select('*, fin_lancamentos(tipo, descricao)')
        .in('status', ['pendente', 'agendado'])
        .lte('data_vencimento', em7.toISOString().slice(0,10))
        .gte('data_vencimento', hoje.toISOString().slice(0,10))
        .order('data_vencimento')
        .limit(8)
      setAlertas(data || [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="loading"><RefreshCw size={16} className="spin" /></div>

  const mesAtual = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--gray-400)', fontWeight: 600, marginBottom: 4 }}>
        Mês atual — {mesAtual}
      </div>

      {/* KPIs receita */}
      <div className="kpi-row">
        <KPI label="Receita total" value={kpis.receitaTotal} sub="previsto no mês" cor="var(--ok)" icon="📈" />
        <KPI label="Receita recebida" value={kpis.receitaPaga} sub="confirmado" cor="var(--ok)" icon="✅" />
        <KPI label="A receber" value={kpis.receitaPendente} sub="pendente/agendado" cor="var(--warning)" icon="⏳" />
        <KPI label="Inadimplência" value={kpis.receitaVencida}
          sub={`${kpis.inadimplencia.toFixed(1)}% da receita total`}
          cor={kpis.receitaVencida > 0 ? 'var(--danger)' : 'var(--ok)'} icon="⚠️" />
      </div>

      {/* KPIs despesa */}
      <div className="kpi-row">
        <KPI label="Despesa total" value={kpis.despesaTotal} sub="previsto no mês" cor="var(--danger)" icon="📉" />
        <KPI label="Despesa paga" value={kpis.despesaPaga} sub="confirmado" cor="var(--danger)" icon="💸" />
        <KPI label="A pagar" value={kpis.despesaPendente} sub="pendente/agendado" cor="var(--warning)" icon="📋" />
        <div className="kpi neutral" style={{ borderTop: `3px solid ${kpis.resultado >= 0 ? 'var(--ok)' : 'var(--danger)'}` }}>
          <div className="kpi-label">💰 Resultado do mês</div>
          <div className="kpi-value" style={{ fontSize: 22, color: kpis.resultado >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
            {fmtR(kpis.resultado)}
          </div>
          <div className="kpi-detail">margem: {kpis.margem.toFixed(1)}%</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Barra de resultado visual */}
        <div className="card card-pad">
          <div className="card-title">📊 Resultado — recebido vs pago</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Receita recebida', val: kpis.receitaPaga, cor: 'var(--ok)' },
              { label: 'Despesa paga', val: kpis.despesaPaga, cor: 'var(--danger)' },
            ].map(item => {
              const max = Math.max(kpis.receitaPaga, kpis.despesaPaga, 1)
              return (
                <div key={item.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    <span>{item.label}</span>
                    <span style={{ color: item.cor }}>{fmtR(item.val)}</span>
                  </div>
                  <div className="prog-bar" style={{ height: 12 }}>
                    <div style={{ height: '100%', width: `${(item.val/max)*100}%`, background: item.cor, borderRadius: 3 }} />
                  </div>
                </div>
              )
            })}
            <div style={{ borderTop: '2px solid var(--gray-200)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}>
              <span>Resultado líquido</span>
              <span style={{ color: kpis.resultado >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{fmtR(kpis.resultado)}</span>
            </div>
          </div>
        </div>

        {/* Próximos vencimentos */}
        <div className="card card-pad">
          <div className="card-title"><Clock size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />Próximos vencimentos (7 dias)</div>
          {alertas.length === 0 ? (
            <div style={{ color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>✅ Nenhum vencimento nos próximos 7 dias</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alertas.map(a => {
                const tipo = a.fin_lancamentos?.tipo
                const diasAte = Math.ceil((new Date(a.data_vencimento + 'T12:00:00') - new Date()) / 86400000)
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <span style={{ fontSize: 16 }}>{tipo === 'receita' ? '📈' : '📉'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.fin_lancamentos?.descricao}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                        {fmtData(a.data_vencimento)} · {diasAte === 0 ? 'Hoje!' : `em ${diasAte}d`}
                      </div>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 13, color: tipo === 'receita' ? 'var(--ok)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                      {fmtR(a.valor)}
                    </span>
                    <span className={`pill ${a.status === 'agendado' ? 'purple' : 'warning'}`} style={{ fontSize: 10 }}>
                      {a.status}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
