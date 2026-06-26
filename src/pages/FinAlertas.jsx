import { useState, useEffect } from 'react'
import { RefreshCw, Save, Mail, Send, Bell } from 'lucide-react'
import { salvarConfigAlertas, carregarConfigAlertas, enviarAlertaManha, enviarAlertaFimDia } from '../lib/alertas'
import { fmtR } from '../lib/financeiro'

export default function FinAlertas() {
  const [config, setConfig] = useState({
    emails: [],
    hora_manha: '08:00',
    hora_fim_dia: '18:00',
    ativo: false,
    ultimo_manha: null,
    ultimo_fim_dia: null,
  })
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testando, setTestando] = useState(null)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    carregarConfigAlertas().then(c => { setConfig(c); setLoading(false) })
  }, [])

  function addEmail() {
    const e = emailInput.trim().toLowerCase()
    if (!e || !e.includes('@')) return
    if (config.emails.includes(e)) return
    setConfig(prev => ({ ...prev, emails: [...prev.emails, e] }))
    setEmailInput('')
  }

  function removeEmail(e) {
    setConfig(prev => ({ ...prev, emails: prev.emails.filter(x => x !== e) }))
  }

  async function salvar() {
    setSaving(true)
    await salvarConfigAlertas(config)
    setMsg({ tipo:'ok', texto:'Configurações salvas!' })
    setTimeout(() => setMsg(null), 3000)
    setSaving(false)
  }

  async function testar(tipo) {
    if (!config.emails.length) { setMsg({ tipo:'erro', texto:'Adicione pelo menos um e-mail.' }); return }
    setTestando(tipo)
    try {
      if (tipo === 'manha') await enviarAlertaManha(config.emails)
      else await enviarAlertaFimDia(config.emails)
      setMsg({ tipo:'ok', texto:`E-mail de ${tipo==='manha'?'manhã':'fim do dia'} enviado para ${config.emails.join(', ')}` })
    } catch(e) {
      setMsg({ tipo:'erro', texto:`Erro: ${e.message}` })
    }
    setTestando(null)
    setTimeout(() => setMsg(null), 5000)
  }

  if (loading) return <div className="loading"><RefreshCw size={14} className="spin"/></div>

  return (
    <>
      {/* Setup Resend */}
      <div className="card card-pad">
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4, display:'flex', alignItems:'center', gap:8 }}>
          <Bell size={18} color="var(--purple)"/> Alertas por E-mail
        </div>
        <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:16 }}>
          Dois e-mails automáticos por dia: resumo da manhã e fechamento do dia.
        </div>

        {/* Instruções Resend */}
        <div style={{ background:'var(--purple-pale)', borderRadius:8, padding:'14px 16px', marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>📋 Configuração inicial (1x)</div>
          <ol style={{ margin:0, paddingLeft:18, fontSize:13, color:'var(--gray-600)', lineHeight:1.8 }}>
            <li>Acesse <a href="https://resend.com" target="_blank" rel="noreferrer" style={{color:'var(--purple)'}}>resend.com</a> e crie uma conta gratuita</li>
            <li>Vá em <strong>API Keys</strong> e crie uma nova key</li>
            <li>No Vercel, acesse seu projeto → <strong>Settings → Environment Variables</strong></li>
            <li>Adicione a variável: <code style={{background:'rgba(103,63,124,.15)',padding:'1px 6px',borderRadius:4}}>RESEND_API_KEY</code> = sua key</li>
            <li>Opcional: verifique um domínio em <strong>Domains</strong> para enviar do seu e-mail</li>
            <li>Clique em <strong>Redeploy</strong> no Vercel para aplicar</li>
          </ol>
        </div>

        <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginBottom:20 }}>
          <div style={{
            width:44, height:24, borderRadius:12,
            background: config.ativo ? 'var(--purple)' : 'var(--gray-300)',
            position:'relative', cursor:'pointer', transition:'background .2s',
            flexShrink:0,
          }} onClick={() => setConfig(p=>({...p,ativo:!p.ativo}))}>
            <div style={{
              width:20, height:20, borderRadius:'50%', background:'#fff',
              position:'absolute', top:2,
              left: config.ativo ? 22 : 2,
              transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)',
            }}/>
          </div>
          <div>
            <div style={{ fontWeight:700, fontSize:13 }}>Alertas {config.ativo ? 'ativados' : 'desativados'}</div>
            <div style={{ fontSize:12, color:'var(--gray-400)' }}>Os e-mails são disparados automaticamente quando o sistema está aberto nos horários configurados</div>
          </div>
        </label>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
          <div className="card card-pad" style={{ background:'#f0fdf4' }}>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:4, color:'#166534' }}>☀️ E-mail da manhã</div>
            <div style={{ fontSize:12, color:'#4b7a5c', marginBottom:10 }}>
              Posição de caixa + contas vencendo hoje
            </div>
            <div className="form-group">
              <label className="form-label">Horário</label>
              <input type="time" className="form-input" value={config.hora_manha}
                onChange={e=>setConfig(p=>({...p,hora_manha:e.target.value}))} />
            </div>
            {config.ultimo_manha && <div style={{fontSize:11,color:'#9ca3af'}}>Último envio: {config.ultimo_manha}</div>}
          </div>
          <div className="card card-pad" style={{ background:'#eff6ff' }}>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:4, color:'#1e40af' }}>🌙 E-mail do fim do dia</div>
            <div style={{ fontSize:12, color:'#4b6eaf', marginBottom:10 }}>
              Entradas/saídas do dia + caixa + contas de amanhã
            </div>
            <div className="form-group">
              <label className="form-label">Horário</label>
              <input type="time" className="form-input" value={config.hora_fim_dia}
                onChange={e=>setConfig(p=>({...p,hora_fim_dia:e.target.value}))} />
            </div>
            {config.ultimo_fim_dia && <div style={{fontSize:11,color:'#9ca3af'}}>Último envio: {config.ultimo_fim_dia}</div>}
          </div>
        </div>

        {/* E-mails destinatários */}
        <div className="form-group" style={{ marginBottom:16 }}>
          <label className="form-label">E-mails destinatários</label>
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input className="form-input" type="email" placeholder="email@exemplo.com" style={{flex:1}}
              value={emailInput} onChange={e=>setEmailInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addEmail()} />
            <button className="btn btn-primary btn-sm" onClick={addEmail}>+ Adicionar</button>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {config.emails.map(e=>(
              <span key={e} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--purple-pale)', color:'var(--purple)', padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:600 }}>
                <Mail size={11}/> {e}
                <button onClick={()=>removeEmail(e)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--purple)',padding:0,lineHeight:1}}>✕</button>
              </span>
            ))}
            {config.emails.length===0&&<span style={{fontSize:12,color:'var(--gray-300)'}}>Nenhum e-mail cadastrado</span>}
          </div>
        </div>

        {msg && (
          <div className={`alert-banner ${msg.tipo==='ok'?'ok':'danger'}`} style={{marginBottom:12}}>
            {msg.tipo==='ok'?'✅':'❌'} {msg.texto}
          </div>
        )}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving?<RefreshCw size={14} className="spin"/>:<Save size={14}/>} Salvar configurações
          </button>
          <button className="btn btn-ghost" onClick={()=>testar('manha')} disabled={!!testando}>
            {testando==='manha'?<RefreshCw size={14} className="spin"/>:<Send size={14}/>} Testar e-mail manhã
          </button>
          <button className="btn btn-ghost" onClick={()=>testar('fim_dia')} disabled={!!testando}>
            {testando==='fim_dia'?<RefreshCw size={14} className="spin"/>:<Send size={14}/>} Testar e-mail fim do dia
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="card card-pad">
        <div style={{ fontWeight:700, fontSize:13, marginBottom:12 }}>📧 Preview do conteúdo dos e-mails</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {[
            { titulo:'☀️ E-mail da manhã', itens:['💰 Posição total de caixa','📊 Saldo por conta','📋 Lista de contas vencendo hoje','📈 Total a receber hoje','📉 Total a pagar hoje'] },
            { titulo:'🌙 E-mail do fim do dia', itens:['📈 Entradas recebidas hoje','📉 Saídas pagas hoje','💰 Resultado do dia','🏦 Posição de caixa atualizada','📋 Contas a vencer amanhã'] },
          ].map(card=>(
            <div key={card.titulo} style={{ background:'var(--gray-50)', borderRadius:8, padding:'14px 16px' }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>{card.titulo}</div>
              {card.itens.map(item=>(
                <div key={item} style={{ fontSize:12, color:'var(--gray-600)', padding:'4px 0', borderBottom:'1px solid var(--gray-200)' }}>{item}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
