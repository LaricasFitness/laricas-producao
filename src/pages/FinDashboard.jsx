import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { atualizarVencidas, fmtR, fmtData } from '../lib/financeiro'
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, Target } from 'lucide-react'

function Seta({ val, base }) {
  if (!base || base === 0) return null
  const pct = ((val - base) / base) * 100
  const cor = pct >= 0 ? 'var(--ok)' : 'var(--danger)'
  const Icon = pct > 2 ? TrendingUp : pct < -2 ? TrendingDown : Minus
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: cor, display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 6 }}>
      <Icon size={11} /> {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function KPICard({ label, value, anterior, meta, cor = 'var(--purple)', icon, sub, pct }) {
  const metaPct = meta > 0 ? (value / meta) * 100 : null
  return (
    <div style={{
      background: 'var(--white)', borderRadius: 10, padding: '16px 18px',
      borderTop: `3px solid ${cor}`, boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: cor, lineHeight: 1.1 }}>
        {pct != null ? `${pct.toFixed(1)}%` : fmtR(value)}
        {anterior != null && <Seta val={value} base={anterior} />}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{sub}</div>}
      {metaPct != null && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gray-400)', marginBottom: 2 }}>
            <span>Meta: {fmtR(meta)}</span>
            <span>{metaPct.toFixed(0)}%</span>
          </div>
          <div style={{ height: 4, background: 'var(--gray-100)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${Math.min(100, metaPct)}%`, background: metaPct >= 100 ? 'var(--ok)' : cor, borderRadius: 2, transition: 'width .4s' }} />
          </div>
        </div>
      )}
    </div>
  )
}

function Alerta({ tipo, label, valor, vencimento, diasAte }) {
  const cfg = {
    vencido:   { cor: 'var(--danger)',  bg: 'var(--danger-pale)',  icon: '🚨' },
    hoje:      { cor: '#e67e22',        bg: '#fef9f0',             icon: '⚡' },
    proximo:   { cor: 'var(--warning)', bg: 'var(--warning-pale)', icon: '⏰' },
    receber:   { cor: 'var(--ok)',      bg: 'var(--ok-pale)',      icon: '📈' },
  }[tipo] || { cor: 'var(--gray-400)', bg: 'var(--gray-50)', icon: '📋' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: cfg.bg, borderRadius: 7, borderLeft: `3px solid ${cfg.cor}` }}>
      <span style={{ fontSize: 14 }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
          {fmtData(vencimento)} · {diasAte === 0 ? 'Hoje' : diasAte < 0 ? `${Math.abs(diasAte)}d atraso` : `em ${diasAte}d`}
        </div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 13, color: cfg.cor, whiteSpace: 'nowrap' }}>{fmtR(valor)}</div>
    </div>
  )
}

export default function FinDashboard() {
  const hoje = new Date()
  const anoMes = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`
  const mesAnt = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1)
  const anoMesAnt = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth()+1).padStart(2,'0')}`

  const [ini, setIni] = useState(`${anoMes}-01`)
  const [fim, setFim] = useState(`${anoMes}-${new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).getDate()}`)
  const iniA = `${anoMesAnt}-01`
  const fimA = `${anoMesAnt}-${new Date(mesAnt.getFullYear(), mesAnt.getMonth()+1, 0).getDate()}`

  const [kpis, setKpis] = useState(null)
  const [kpisAnt, setKpisAnt] = useState(null)
  const [alertas, setAlertas] = useState([])
  const [projecao, setProjecao] = useState(null)
  const [saldoContas, setSaldoContas] = useState([])
  const [cashPeriodo, setCashPeriodo] = useState('Mês')
  const [cashMetrics, setCashMetrics] = useState({ entradas:0, saidas:0, resultado:0 })
  const [loading, setLoading] = useState(true)

  async function calcKpis(ini, fim) {
    const { data } = await supabase
      .from('fin_parcelas')
      .select('valor, valor_pago, status, fin_lancamentos!inner(tipo, is_transferencia, fin_categorias(nome, tipo))')
      .eq('fin_lancamentos.is_transferencia', false)
      .gte('data_vencimento', ini)
      .lte('data_vencimento', fim)

    const todas = (data || []).filter(p => p.fin_lancamentos?.is_transferencia !== true)
    const rec = todas.filter(p => p.fin_lancamentos?.tipo === 'receita')
    const des = todas.filter(p => p.fin_lancamentos?.tipo === 'despesa')

    // Usa valor_pago quando disponível para refletir pagamentos parciais
    // Parcelas em_aberto com valor_pago > 0 = pagamento parcial registrado
    const valorEfetivo = p => {
      if (p.status === 'pago') return (p.valor_pago != null && p.valor_pago > 0) ? p.valor_pago : p.valor
      if (p.valor_pago != null && p.valor_pago > 0) return p.valor_pago // parcial
      return 0
    }
    const recTotal  = rec.reduce((s,p) => s+p.valor, 0)
    const recPago   = rec.reduce((s,p) => s+valorEfetivo(p), 0)
    const recVencido= rec.filter(p=>p.status==='vencido').reduce((s,p) => s+p.valor, 0)
    const desTotal  = des.reduce((s,p) => s+p.valor, 0)
    const desPago   = des.reduce((s,p) => s+valorEfetivo(p), 0)
    const resultado = recPago - desPago
    const margem    = recPago > 0 ? (resultado/recPago)*100 : 0

    // CMV para margem bruta
    const cmv = des.filter(p=>p.status==='pago' && p.fin_lancamentos?.fin_categorias?.nome?.startsWith('CMV')).reduce((s,p)=>s+valorEfetivo(p),0)
    const marginBruta = recPago > 0 ? ((recPago - cmv)/recPago)*100 : 0

    return { recTotal, recPago, recVencido, desTotal, desPago, resultado, margem, marginBruta }
  }

  // Recalcula métricas de caixa quando muda período
  useEffect(() => {
    if (!saldoContas.length && cashPeriodo) return
    async function calcCash() {
      const periodoIni = {
        '7d':  () => { const d=new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) },
        '30d': () => { const d=new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10) },
        'Mês': () => `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`,
        'Ano': () => `${hoje.getFullYear()}-01-01`,
      }[cashPeriodo]?.() || ini

      const { data } = await supabase.from('fin_parcelas')
        .select('valor, fin_lancamentos(tipo)')
        .eq('status','pago')
        .gte('data_pagamento', periodoIni)
        .lte('data_pagamento', hoje.toISOString().slice(0,10))

      const entradas = (data||[]).filter(p=>p.fin_lancamentos?.tipo==='receita').reduce((s,p)=>s+p.valor,0)
      const saidas   = (data||[]).filter(p=>p.fin_lancamentos?.tipo==='despesa').reduce((s,p)=>s+p.valor,0)
      setCashMetrics({ entradas, saidas, resultado: entradas - saidas })
    }
    calcCash()
  }, [cashPeriodo, saldoContas])

  useEffect(() => {
    async function load() {
      await atualizarVencidas()

      const [k, ka] = await Promise.all([calcKpis(ini, fim), calcKpis(iniA, fimA)])
      setKpis(k); setKpisAnt(ka)

      const diaAtual = hoje.getDate()
      const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).getDate()
      const fatorProj = diasNoMes / diaAtual
      setProjecao({
        receita: k.recPago * fatorProj,
        despesa: k.desPago * fatorProj,
        resultado: (k.recPago - k.desPago) * fatorProj,
        diasPassados: diaAtual, diasNoMes,
      })

      // Posição de caixa: saldo_inicial + movimentações pagas
      // Transferências DEVEM afetar saldo por conta (A perde, B ganha)
      // mas são excluídas do P&L (KPIs de receita/despesa)
      const { data: contas } = await supabase.from('fin_contas').select('*').eq('ativo', true).order('nome')
      const { data: pagas } = await supabase.from('fin_parcelas')
        .select('valor, valor_pago, conta_id, fin_lancamentos!inner(tipo, is_transferencia)')
        .eq('status', 'pago')

      const saldoMap = {}
      for (const c of (contas||[])) {
        saldoMap[c.id] = { ...c, saldo_calculado: c.saldo_inicial || 0 }
      }
      for (const p of (pagas||[])) {
        const cid = p.conta_id
        const l = p.fin_lancamentos
        if (!cid || !saldoMap[cid]) continue
        const vlr = (p.valor_pago != null && p.valor_pago > 0) ? p.valor_pago : p.valor
        // Inclui transferências no saldo por conta — mas usa tipo para saber direção
        if (l?.tipo === 'receita') saldoMap[cid].saldo_calculado += vlr
        else saldoMap[cid].saldo_calculado -= vlr
      }
      setSaldoContas(Object.values(saldoMap))

      const em10 = new Date(); em10.setDate(em10.getDate()+10)
      const ha30 = new Date(); ha30.setDate(ha30.getDate()-30)
      const { data: pends } = await supabase.from('fin_parcelas')
        .select('*, fin_lancamentos(tipo, descricao)')
        .in('status', ['pendente','em_aberto','agendado','vencido'])
        .gte('data_vencimento', ha30.toISOString().slice(0,10))
        .lte('data_vencimento', em10.toISOString().slice(0,10))
        .order('data_vencimento').limit(20)

      const hojeStr = hoje.toISOString().slice(0,10)
      setAlertas((pends||[]).map(p => {
        const diasAte = Math.ceil((new Date(p.data_vencimento+'T12:00:00') - new Date()) / 86400000)
        const tipo = p.status==='vencido' ? 'vencido' : p.data_vencimento===hojeStr ? 'hoje' : p.fin_lancamentos?.tipo==='receita' ? 'receber' : 'proximo'
        return { ...p, diasAte, tipo }
      }).sort((a,b)=>a.diasAte-b.diasAte))

      setLoading(false)
    }
    load()
  }, [ini, fim])

  if (loading) return <div className="loading"><RefreshCw size={16} className="spin" /> Carregando dashboard...</div>

  const mesNome = ini === fim
    ? fmtData(ini)
    : `${fmtData(ini)} → ${fmtData(fim)}`
  const vencidos = alertas.filter(a => a.tipo === 'vencido')
  const proximos = alertas.filter(a => a.tipo !== 'vencido')

  // Atalhos rápidos de período
  function setPeriodoMes(offsetMeses = 0) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + offsetMeses, 1)
    const ultimo = new Date(d.getFullYear(), d.getMonth()+1, 0)
    setIni(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`)
    setFim(`${ultimo.getFullYear()}-${String(ultimo.getMonth()+1).padStart(2,'0')}-${String(ultimo.getDate()).padStart(2,'0')}`)
  }
  function setPeriodoDias(dias) {
    const d = new Date(); d.setDate(d.getDate() - dias)
    setIni(d.toISOString().slice(0,10))
    setFim(hoje.toISOString().slice(0,10))
  }

  return (
    <>
      {/* Header com filtro de data */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:12, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:'var(--purple-dark)' }}>Visão geral — {mesNome}</div>
          <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:2 }}>
            Dia {projecao?.diasPassados} de {projecao?.diasNoMes} · Setas = variação vs mês anterior
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap' }}>
          {/* Atalhos */}
          <div style={{ display:'flex', gap:4 }}>
            {[
              { l:'7d',     fn:()=>setPeriodoDias(7) },
              { l:'30d',    fn:()=>setPeriodoDias(30) },
              { l:'Mês',    fn:()=>setPeriodoMes(0) },
              { l:'Mês ant',fn:()=>setPeriodoMes(-1) },
              { l:'Ano',    fn:()=>{ setIni(`${hoje.getFullYear()}-01-01`); setFim(`${hoje.getFullYear()}-12-31`) } },
            ].map(({l,fn}) => (
              <button key={l} className="btn btn-ghost btn-xs" onClick={fn}>{l}</button>
            ))}
          </div>
          {/* Pickers */}
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input type="date" className="form-input" value={ini} onChange={e=>setIni(e.target.value)}
              style={{ padding:'4px 8px', fontSize:12, height:30 }}/>
            <span style={{ color:'var(--gray-400)', fontSize:12 }}>→</span>
            <input type="date" className="form-input" value={fim} onChange={e=>setFim(e.target.value)}
              style={{ padding:'4px 8px', fontSize:12, height:30 }}/>
          </div>
        </div>
      </div>

      {/* 💰 Posição de Caixa — FOCO PRINCIPAL */}
      <div style={{ background:'var(--purple-dark)', borderRadius:12, padding:'18px 20px', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
          <div style={{ fontWeight:800, fontSize:15 }}>💰 Posição de Caixa</div>
          <div style={{ display:'flex', gap:6 }}>
            {[
              { l:'7d',  fn:() => { const d=new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) } },
              { l:'30d', fn:() => { const d=new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10) } },
              { l:'Mês', fn:() => `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01` },
              { l:'Ano', fn:() => `${hoje.getFullYear()}-01-01` },
            ].map(p => (
              <button key={p.l}
                className="btn btn-sm"
                onClick={() => setCashPeriodo(p.l)}
                style={{
                  background: cashPeriodo===p.l ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.1)',
                  color:'#fff', border:'none', fontSize:12, padding:'4px 10px', borderRadius:6, cursor:'pointer',
                }}>
                {p.l}
              </button>
            ))}
          </div>
        </div>

        {/* Entradas / Saídas / Resultado do período */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
          <div style={{ background:'rgba(255,255,255,.08)', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:11, opacity:.6, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Entradas pagas</div>
            <div style={{ fontSize:20, fontWeight:800, color:'#7ddc9b', marginTop:4 }}>{fmtR(cashMetrics.entradas)}</div>
          </div>
          <div style={{ background:'rgba(255,255,255,.08)', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:11, opacity:.6, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Saídas pagas</div>
            <div style={{ fontSize:20, fontWeight:800, color:'#ff8080', marginTop:4 }}>{fmtR(cashMetrics.saidas)}</div>
          </div>
          <div style={{ background:'rgba(255,255,255,.12)', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:11, opacity:.6, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Resultado período</div>
            <div style={{ fontSize:20, fontWeight:800, color: cashMetrics.resultado>=0?'var(--gold)':'#ff8080', marginTop:4 }}>{fmtR(cashMetrics.resultado)}</div>
          </div>
        </div>

        {/* Saldo por conta */}
        <div style={{ borderTop:'1px solid rgba(255,255,255,.15)', paddingTop:12 }}>
          <div style={{ fontSize:11, opacity:.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Saldo atual por conta</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:8 }}>
            {saldoContas.map(c => (
              <div key={c.id} style={{ background:'rgba(255,255,255,.08)', borderRadius:7, padding:'8px 12px' }}>
                <div style={{ fontSize:11, opacity:.6, fontWeight:600 }}>{c.nome}</div>
                <div style={{ fontSize:16, fontWeight:800, color: (c.saldo_calculado??0)>=0?'var(--gold)':'#ff8080', marginTop:3 }}>{fmtR(c.saldo_calculado??0)}</div>
              </div>
            ))}
            {/* Saldo Total Consolidado */}
            <div style={{ background:'rgba(255,255,255,.18)', borderRadius:7, padding:'8px 12px', border:'1px solid rgba(255,255,255,.3)' }}>
              <div style={{ fontSize:11, opacity:.8, fontWeight:700 }}>TOTAL CONSOLIDADO</div>
              <div style={{ fontSize:18, fontWeight:900, color:'var(--gold)', marginTop:3 }}>{fmtR(saldoContas.reduce((s,c)=>s+(c.saldo_calculado??0),0))}</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12 }}>
        <KPICard label="Receita recebida" value={kpis.recPago} anterior={kpisAnt?.recPago}
          cor="var(--ok)" icon="✅" sub={`de ${fmtR(kpis.recTotal)} previsto`} />
        <KPICard label="Despesa paga" value={kpis.desPago} anterior={kpisAnt?.desPago}
          cor="var(--danger)" icon="📉" sub={`de ${fmtR(kpis.desTotal)} previsto`} />
        <KPICard label="Resultado" value={kpis.resultado} anterior={kpisAnt?.resultado}
          cor={kpis.resultado >= 0 ? 'var(--ok)' : 'var(--danger)'} icon="💰"
          sub={`margem ${kpis.margem.toFixed(1)}%`} />
        <KPICard label="Margem Bruta" pct={kpis.marginBruta} anterior={kpisAnt?.marginBruta}
          cor="var(--purple)" icon="📊" sub="s/ CMV" />
        <KPICard label="Inadimplência" value={kpis.recVencido} anterior={kpisAnt?.recVencido}
          cor={kpis.recVencido > 0 ? 'var(--danger)' : 'var(--ok)'} icon="⚠️"
          sub={kpis.recTotal > 0 ? `${((kpis.recVencido/kpis.recTotal)*100).toFixed(1)}% da receita` : '0%'} />
      </div>

      {/* Projeção */}
      {projecao && (
        <div style={{ background:'var(--purple-pale)', borderRadius:10, padding:'14px 18px', border:'1px solid var(--purple-light)' }}>
          <div style={{ fontWeight:800, fontSize:13, color:'var(--purple)', marginBottom:10 }}>
            🎯 Projeção para o mês completo — baseado nos {projecao.diasPassados} dias passados
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12 }}>
            {[
              { label:'Receita projetada', val:projecao.receita, cor:'var(--ok)' },
              { label:'Despesa projetada', val:projecao.despesa, cor:'var(--danger)' },
              { label:'Resultado projetado', val:projecao.resultado, cor:projecao.resultado>=0?'var(--ok)':'var(--danger)' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize:11, color:'var(--purple)', fontWeight:700, marginBottom:3 }}>{item.label}</div>
                <div style={{ fontSize:20, fontWeight:900, color:item.cor }}>{fmtR(item.val)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--purple)', marginBottom:3 }}>
              <span>Progresso do mês</span>
              <span>{((projecao.diasPassados/projecao.diasNoMes)*100).toFixed(0)}%</span>
            </div>
            <div style={{ height:6, background:'rgba(103,63,124,.15)', borderRadius:3 }}>
              <div style={{ height:'100%', width:`${(projecao.diasPassados/projecao.diasNoMes)*100}%`, background:'var(--purple)', borderRadius:3 }} />
            </div>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Vencidos */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13, color:'var(--danger)', display:'flex', alignItems:'center', gap:6 }}>
            <AlertTriangle size={14} /> Vencidos ({vencidos.length})
            {vencidos.length > 0 && <span style={{ fontWeight:400, color:'var(--danger)', fontSize:12 }}>
              · total {fmtR(vencidos.reduce((s,a)=>s+a.valor,0))}
            </span>}
          </div>
          {vencidos.length === 0 ? (
            <div style={{ padding:'12px 14px', background:'var(--ok-pale)', borderRadius:8, fontSize:13, color:'var(--ok)', fontWeight:600 }}>
              ✅ Nenhum vencimento em atraso
            </div>
          ) : vencidos.map(a => (
            <Alerta key={a.id} tipo="vencido" label={a.fin_lancamentos?.descricao}
              valor={a.valor} vencimento={a.data_vencimento} diasAte={a.diasAte} />
          ))}
        </div>

        {/* Próximos */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13, color:'var(--gray-600)', display:'flex', alignItems:'center', gap:6 }}>
            <Clock size={14} /> Próximos 10 dias ({proximos.length})
          </div>
          {proximos.length === 0 ? (
            <div style={{ padding:'12px 14px', background:'var(--gray-50)', borderRadius:8, fontSize:13, color:'var(--gray-400)' }}>
              Nenhum vencimento nos próximos 10 dias
            </div>
          ) : proximos.slice(0,8).map(a => (
            <Alerta key={a.id} tipo={a.tipo} label={a.fin_lancamentos?.descricao}
              valor={a.valor} vencimento={a.data_vencimento} diasAte={a.diasAte} />
          ))}
        </div>
      </div>
    </>
  )
}
