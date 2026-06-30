import { supabase } from '../supabase'
import { fmtR } from './financeiro'

// ── Templates de e-mail ───────────────────────────────────────────────────────
function templateBase(titulo, subtitulo, conteudo) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f0f8; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #4a2d5e 0%, #673f7c 100%); border-radius: 12px 12px 0 0; padding: 28px 32px; }
  .header h1 { color: #eab782; margin: 0; font-size: 20px; font-weight: 900; }
  .header p { color: rgba(255,255,255,.7); margin: 4px 0 0; font-size: 13px; }
  .body { background: #fff; padding: 28px 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
  .kpi-row { display: flex; gap: 12px; margin: 16px 0; }
  .kpi { flex: 1; padding: 14px; border-radius: 8px; text-align: center; }
  .kpi .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .7; margin-bottom: 4px; }
  .kpi .value { font-size: 20px; font-weight: 900; }
  .kpi.verde { background: #f0fdf4; color: #166534; }
  .kpi.vermelho { background: #fef2f2; color: #991b1b; }
  .kpi.roxo { background: #f5f0ff; color: #6b21a8; }
  .kpi.azul { background: #eff6ff; color: #1e40af; }
  .section { margin: 20px 0; }
  .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; color: #9ca3af; margin-bottom: 10px; }
  .item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
  .item:last-child { border-bottom: none; }
  .item .name { font-size: 13px; font-weight: 600; color: #374151; }
  .item .sub { font-size: 11px; color: #9ca3af; margin-top: 1px; }
  .item .val { font-size: 14px; font-weight: 800; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge.hoje { background: #fef3c7; color: #92400e; }
  .badge.vencido { background: #fee2e2; color: #991b1b; }
  .badge.amanha { background: #ede9fe; color: #5b21b6; }
  .footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 20px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🍫 Laricas Fitness</h1>
    <p>${subtitulo}</p>
  </div>
  <div class="body">
    ${conteudo}
  </div>
  <div class="footer">Laricas Fitness · Sistema de Gestão · <a href="https://laricas-producao.vercel.app" style="color:#673f7c">Abrir sistema</a></div>
</div>
</body>
</html>`
}

// ── Busca dados para os e-mails ───────────────────────────────────────────────
async function buscarDadosEmail() {
  const hoje = new Date()
  const hojeStr = hoje.toISOString().slice(0,10)
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1)
  const amanhaStr = amanha.toISOString().slice(0,10)

  // Parcelas de hoje e amanhã
  const { data: parcelasHoje } = await supabase.from('fin_parcelas')
    .select('*, fin_lancamentos(tipo, descricao)')
    .eq('data_vencimento', hojeStr)
    .in('status', ['pendente','em_aberto','agendado','vencido'])

  const { data: parcelasAmanha } = await supabase.from('fin_parcelas')
    .select('*, fin_lancamentos(tipo, descricao)')
    .eq('data_vencimento', amanhaStr)
    .in('status', ['pendente','em_aberto','agendado'])

  // Movimentações do dia (pagas hoje)
  const { data: pagasHoje } = await supabase.from('fin_parcelas')
    .select('valor, fin_lancamentos(tipo, descricao)')
    .eq('data_pagamento', hojeStr)
    .eq('status', 'pago')

  // Saldo de cada conta
  const { data: contas } = await supabase.from('fin_contas').select('*').eq('ativo',true)
  const { data: todasPagas } = await supabase.from('fin_parcelas')
    .select('valor, conta_id, fin_lancamentos(tipo)')
    .eq('status','pago')

  const saldoMap = {}
  for (const c of (contas||[])) saldoMap[c.id] = { nome:c.nome, saldo:c.saldo_inicial||0 }
  for (const p of (todasPagas||[])) {
    if (!p.conta_id || !saldoMap[p.conta_id]) continue
    if (p.fin_lancamentos?.tipo==='receita') saldoMap[p.conta_id].saldo += p.valor
    else saldoMap[p.conta_id].saldo -= p.valor
  }
  const saldoContas = Object.values(saldoMap)
  const saldoTotal = saldoContas.reduce((s,c)=>s+c.saldo,0)

  // Entradas/saídas do dia
  const entradasHoje = (pagasHoje||[]).filter(p=>p.fin_lancamentos?.tipo==='receita').reduce((s,p)=>s+p.valor,0)
  const saidasHoje = (pagasHoje||[]).filter(p=>p.fin_lancamentos?.tipo==='despesa').reduce((s,p)=>s+p.valor,0)

  return {
    hojeStr, amanhaStr,
    parcelasHoje: parcelasHoje||[],
    parcelasAmanha: parcelasAmanha||[],
    entradasHoje, saidasHoje,
    saldoContas, saldoTotal,
  }
}

// ── E-mail da manhã ───────────────────────────────────────────────────────────
function htmlManha(d) {
  const vencendoHoje = d.parcelasHoje
  const recHoje = vencendoHoje.filter(p=>p.fin_lancamentos?.tipo==='receita')
  const pagHoje = vencendoHoje.filter(p=>p.fin_lancamentos?.tipo==='despesa')
  const totalRecHoje = recHoje.reduce((s,p)=>s+p.valor,0)
  const totalPagHoje = pagHoje.reduce((s,p)=>s+p.valor,0)

  const itemsHoje = vencendoHoje.length === 0
    ? '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px">✅ Nenhum vencimento hoje</div>'
    : vencendoHoje.map(p => `
      <div class="item">
        <div>
          <div class="name">${p.fin_lancamentos?.descricao||'—'}</div>
          <div class="sub">${p.fin_lancamentos?.tipo==='receita'?'📈 A receber':'📉 A pagar'}</div>
        </div>
        <div style="text-align:right">
          <div class="val" style="color:${p.fin_lancamentos?.tipo==='receita'?'#166534':'#991b1b'}">${fmtR(p.valor)}</div>
          <span class="badge hoje">Hoje</span>
        </div>
      </div>`).join('')

  const saldoItems = d.saldoContas.map(c => `
    <div class="item">
      <div class="name">${c.nome}</div>
      <div class="val" style="color:${c.saldo>=0?'#166534':'#991b1b'}">${fmtR(c.saldo)}</div>
    </div>`).join('')

  return templateBase(
    'Bom dia, Laricas!',
    `Resumo da manhã · ${new Date(d.hojeStr+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}`,
    `<div class="kpi-row">
      <div class="kpi roxo">
        <div class="label">💰 Caixa Total</div>
        <div class="value">${fmtR(d.saldoTotal)}</div>
      </div>
      <div class="kpi verde">
        <div class="label">📈 A Receber Hoje</div>
        <div class="value">${fmtR(totalRecHoje)}</div>
      </div>
      <div class="kpi vermelho">
        <div class="label">📉 A Pagar Hoje</div>
        <div class="value">${fmtR(totalPagHoje)}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Vencimentos de hoje (${vencendoHoje.length})</div>
      ${itemsHoje}
    </div>

    <hr class="divider"/>

    <div class="section">
      <div class="section-title">Posição de caixa por conta</div>
      ${saldoItems||'<div style="color:#9ca3af;font-size:13px">Nenhuma conta cadastrada</div>'}
    </div>`
  )
}

// ── E-mail do fim do dia ──────────────────────────────────────────────────────
function htmlFimDia(d) {
  const amItems = d.parcelasAmanha.length === 0
    ? '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px">✅ Nenhum vencimento amanhã</div>'
    : d.parcelasAmanha.map(p => `
      <div class="item">
        <div>
          <div class="name">${p.fin_lancamentos?.descricao||'—'}</div>
          <div class="sub">${p.fin_lancamentos?.tipo==='receita'?'📈 A receber':'📉 A pagar'}</div>
        </div>
        <div style="text-align:right">
          <div class="val" style="color:${p.fin_lancamentos?.tipo==='receita'?'#166534':'#991b1b'}">${fmtR(p.valor)}</div>
          <span class="badge amanha">Amanhã</span>
        </div>
      </div>`).join('')

  const saldoItems = d.saldoContas.map(c => `
    <div class="item">
      <div class="name">${c.nome}</div>
      <div class="val" style="color:${c.saldo>=0?'#166534':'#991b1b'}">${fmtR(c.saldo)}</div>
    </div>`).join('')

  const resultadoDia = d.entradasHoje - d.saidasHoje

  return templateBase(
    'Resumo do dia',
    `Fechamento · ${new Date(d.hojeStr+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}`,
    `<div class="kpi-row">
      <div class="kpi verde">
        <div class="label">📈 Entradas Hoje</div>
        <div class="value">${fmtR(d.entradasHoje)}</div>
      </div>
      <div class="kpi vermelho">
        <div class="label">📉 Saídas Hoje</div>
        <div class="value">${fmtR(d.saidasHoje)}</div>
      </div>
      <div class="kpi ${resultadoDia>=0?'verde':'vermelho'}">
        <div class="label">💰 Resultado Dia</div>
        <div class="value">${fmtR(resultadoDia)}</div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi roxo" style="flex:1">
        <div class="label">🏦 Posição de Caixa Atual</div>
        <div class="value">${fmtR(d.saldoTotal)}</div>
      </div>
    </div>

    <hr class="divider"/>

    <div class="section">
      <div class="section-title">Posição de caixa por conta</div>
      ${saldoItems}
    </div>

    <hr class="divider"/>

    <div class="section">
      <div class="section-title">Vencimentos de amanhã (${d.parcelasAmanha.length})</div>
      ${amItems}
    </div>`
  )
}

// ── Envia via API Vercel ──────────────────────────────────────────────────────
async function enviarEmail({ to, subject, html }) {
  const res = await fetch('/api/send-alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Falha ao enviar')
  return data
}

// ── Funções públicas ──────────────────────────────────────────────────────────
export async function enviarAlertaManha(emails) {
  const d = await buscarDadosEmail()
  const dataStr = new Date(d.hojeStr+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
  await enviarEmail({
    to: emails,
    subject: `☀️ Laricas — Bom dia! Caixa: ${fmtR(d.saldoTotal)} · ${d.parcelasHoje.length} venc. hoje (${dataStr})`,
    html: htmlManha(d),
  })
  return d
}

export async function enviarAlertaFimDia(emails) {
  const d = await buscarDadosEmail()
  const dataStr = new Date(d.hojeStr+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
  const resultado = d.entradasHoje - d.saidasHoje
  await enviarEmail({
    to: emails,
    subject: `🌙 Laricas — Fechamento ${dataStr}: ${resultado>=0?'+':''}${fmtR(resultado)} · Caixa: ${fmtR(d.saldoTotal)}`,
    html: htmlFimDia(d),
  })
  return d
}

// ── Salva/lê configurações de alerta no Supabase ─────────────────────────────
export async function salvarConfigAlertas(config) {
  await supabase.from('fin_config_alertas').upsert(
    { id: 'default', ...config }, { onConflict: 'id' }
  )
}

export async function carregarConfigAlertas() {
  const { data } = await supabase.from('fin_config_alertas').select('*').eq('id','default').single()
  return data || {
    emails: [],
    hora_manha: '08:00',
    hora_fim_dia: '18:00',
    ativo: false,
    ultimo_manha: null,
    ultimo_fim_dia: null,
  }
}

// ── Verifica e dispara alertas (chamado a cada vez que o sistema é aberto) ────
export async function verificarEDispararAlertas() {
  const config = await carregarConfigAlertas()
  if (!config.ativo || !config.emails?.length) return

  const agora = new Date()
  const horaAtual = `${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`
  const hojeStr = agora.toISOString().slice(0,10)

  // Alerta manhã
  if (horaAtual >= config.hora_manha &&
      (!config.ultimo_manha || config.ultimo_manha < hojeStr)) {
    try {
      await enviarAlertaManha(config.emails)
      await supabase.from('fin_config_alertas').update({ ultimo_manha: hojeStr }).eq('id','default')
    } catch(e) { console.error('Erro alerta manhã:', e) }
  }

  // Alerta fim do dia
  if (horaAtual >= config.hora_fim_dia &&
      (!config.ultimo_fim_dia || config.ultimo_fim_dia < hojeStr)) {
    try {
      await enviarAlertaFimDia(config.emails)
      await supabase.from('fin_config_alertas').update({ ultimo_fim_dia: hojeStr }).eq('id','default')
    } catch(e) { console.error('Erro alerta fim dia:', e) }
  }
}
