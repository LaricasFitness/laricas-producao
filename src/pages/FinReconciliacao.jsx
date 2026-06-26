import { useState, useRef } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData } from '../lib/financeiro'
import { Upload, RefreshCw, CheckCircle, X, Info } from 'lucide-react'

// ── Parsers de extrato ────────────────────────────────────────────────────────
function parseOFX(texto) {
  // Remove header SGML (antes do <OFX>)
  const xmlStart = texto.indexOf('<OFX>')
  const xmlPart = xmlStart >= 0 ? texto.slice(xmlStart) : texto

  // Parser tolerante para OFX (não é XML puro)
  const get = (tag) => {
    const re = new RegExp(`<${tag}>([^<]+)`, 'i')
    return (xmlPart.match(re)?.[1] || '').trim()
  }
  const getAll = (tag) => {
    const re = new RegExp(`<${tag}>([^<]+)`, 'gi')
    const results = []
    let m
    while ((m = re.exec(xmlPart)) !== null) results.push(m[1].trim())
    return results
  }

  // Extrai todas as transações
  const stmtBlocks = xmlPart.split(/<STMTTRN>/i).slice(1)
  const transacoes = stmtBlocks.map(block => {
    const getB = (tag) => { const re = new RegExp(`<${tag}>([^<\n\r]+)`, 'i'); return (block.match(re)?.[1]||'').trim() }
    const dtStr = getB('DTPOSTED').slice(0,8) // YYYYMMDD
    const data = dtStr.length===8 ? `${dtStr.slice(0,4)}-${dtStr.slice(4,6)}-${dtStr.slice(6,8)}` : null
    const valor = parseFloat(getB('TRNAMT').replace(',','.')) || 0
    const memo = getB('MEMO') || getB('NAME') || ''
    const fitid = getB('FITID')
    const tipo = getB('TRNTYPE') // CREDIT, DEBIT, etc
    return { data, valor, memo, fitid, tipo }
  }).filter(t => t.data && t.valor !== 0)

  return { transacoes, banco: get('ORG') || 'OFX' }
}

function parseInterCSV(texto) {
  const linhas = texto.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim())
  const transacoes = []
  for (const linha of linhas.slice(1)) {
    const cols = linha.split(';').map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 3) continue
    // Inter formato: Data;Tipo;Título;Descrição;Valor
    const [dataRaw,,titulo,desc,valorRaw] = cols
    const m = dataRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!m) continue
    const data = `${m[3]}-${m[2]}-${m[1]}`
    const valor = parseFloat((valorRaw||'0').replace(/\./g,'').replace(',','.')) || 0
    if (valor === 0) continue
    transacoes.push({ data, valor, memo: desc||titulo||'', fitid: `${data}-${valor}-${titulo}` })
  }
  return { transacoes, banco: 'Inter' }
}

function parseC6CSV(texto) {
  // C6 formato: Data;Histórico;Documento;Crédito;Débito;Saldo
  const linhas = texto.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim())
  const transacoes = []
  for (const linha of linhas.slice(1)) {
    const cols = linha.split(';').map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 5) continue
    const [dataRaw,hist,,credRaw,debRaw] = cols
    const m = dataRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!m) continue
    const data = `${m[3]}-${m[2]}-${m[1]}`
    const cred = parseFloat((credRaw||'0').replace(/\./g,'').replace(',','.')) || 0
    const deb = parseFloat((debRaw||'0').replace(/\./g,'').replace(',','.')) || 0
    const valor = cred > 0 ? cred : -deb
    if (valor === 0) continue
    transacoes.push({ data, valor, memo: hist||'', fitid: `${data}-${valor}-${hist}` })
  }
  return { transacoes, banco: 'C6' }
}

function detectarEParsar(texto, filename) {
  const fn = (filename||'').toLowerCase()
  if (fn.endsWith('.ofx') || fn.endsWith('.ofc') || texto.includes('OFXHEADER') || texto.includes('<OFX>')) {
    return parseOFX(texto)
  }
  // Detecta pelo header CSV
  if (texto.includes('Crédito;Débito;Saldo') || fn.includes('c6')) return parseC6CSV(texto)
  if (texto.includes('Título;Descrição') || fn.includes('inter')) return parseInterCSV(texto)
  // Genérico: tenta achar colunas de data e valor
  const linhas = texto.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim())
  const transacoes = []
  for (const linha of linhas.slice(1)) {
    const cols = linha.split(/[,;]/).map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 2) continue
    let data=null, valor=null, memo=''
    for (const col of cols) {
      if (!data) { const m=col.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/); if(m){const a=m[3].length===2?'20'+m[3]:m[3];data=`${a}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`}}
      if (!valor) { const n=parseFloat(col.replace(/\./g,'').replace(',','.')); if(!isNaN(n)&&Math.abs(n)>0&&Math.abs(n)<10000000) valor=n }
      if (!memo && col.length>3 && isNaN(parseFloat(col.replace(',','.')))) memo=col
    }
    if (data && valor!==null) transacoes.push({ data, valor, memo, fitid:`${data}-${valor}-${memo}` })
  }
  return { transacoes, banco: 'Genérico' }
}

// ── Componente ────────────────────────────────────────────────────────────────
export default function FinReconciliacao() {
  const [transacoes, setTransacoes] = useState([])
  const [banco, setBanco] = useState('')
  const [matches, setMatches] = useState({})
  const [ignorados, setIgnorados] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const fileRef = useRef()

  async function processarArquivo(file) {
    setLoading(true); setResultado(null)
    const texto = await file.text()
    const { transacoes: trans, banco: b } = detectarEParsar(texto, file.name)
    setBanco(b)

    if (!trans.length) { setLoading(false); return }

    // Busca parcelas pendentes no período das transações
    const datas = trans.map(t=>t.data).filter(Boolean).sort()
    const ini = datas[0], fim = datas[datas.length-1]

    const { data: parcelas } = await supabase.from('fin_parcelas')
      .select('*, fin_lancamentos(tipo, descricao)')
      .gte('data_vencimento', ini).lte('data_vencimento', fim)
      .in('status', ['pendente','agendado','vencido'])

    // Auto-match por valor exato ±R$0,02 e data ±5 dias
    const autoMatches = {}
    const usadas = new Set()
    for (let i=0; i<trans.length; i++) {
      const t = trans[i]
      const absVal = Math.abs(t.valor)
      const dataT = new Date(t.data+'T12:00:00')
      const match = (parcelas||[]).find(p => {
        if (usadas.has(p.id)) return false
        const diffVal = Math.abs(p.valor - absVal)
        const diffDias = Math.abs((new Date(p.data_vencimento+'T12:00:00') - dataT) / 86400000)
        return diffVal < 0.02 && diffDias <= 5
      })
      if (match) { autoMatches[i] = match.id; usadas.add(match.id) }
    }

    // Enriquece transações com sugestões
    const enriched = trans.map((t, i) => {
      const absVal = Math.abs(t.valor)
      const dataT = new Date(t.data+'T12:00:00')
      const sugestoes = (parcelas||[]).filter(p => {
        const diffVal = Math.abs(p.valor - absVal) / Math.max(p.valor, 1)
        const diffDias = Math.abs((new Date(p.data_vencimento+'T12:00:00') - dataT) / 86400000)
        return diffVal < 0.15 && diffDias <= 10
      })
      return { ...t, sugestoes }
    })

    setTransacoes(enriched)
    setMatches(autoMatches)
    setIgnorados(new Set())
    setLoading(false)
  }

  async function confirmar() {
    setSalvando(true)
    let ok=0, erros=0
    for (const [idx, parcelaId] of Object.entries(matches)) {
      if (ignorados.has(Number(idx))) continue
      const t = transacoes[Number(idx)]
      const { error } = await supabase.from('fin_parcelas').update({
        status: 'pago', data_pagamento: t.data,
      }).eq('id', parcelaId)
      if (error) erros++; else ok++
    }
    setResultado({ ok, erros })
    setSalvando(false)
    // Recarrega
    if (ok > 0) processarArquivo.__last && processarArquivo.__last()
  }

  const matchados = Object.keys(matches).filter(i=>!ignorados.has(Number(i))).length
  const semMatch = transacoes.filter((_,i)=>!matches[i]&&!ignorados.has(i)).length

  return (
    <>
      {/* Header */}
      <div className="card card-pad">
        <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>🏦 Reconciliação Bancária</div>
        <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:12 }}>
          Importe o extrato do seu banco para casar automaticamente com os lançamentos pendentes.
          Suporte a <strong>OFX</strong> (Inter e C6), <strong>CSV Inter</strong> e <strong>CSV C6</strong>.
        </div>
        <div className="alert-banner info" style={{ marginBottom:12 }}>
          <Info size={13}/>
          <span>
            <strong>Inter:</strong> Internet Banking → Extrato → Exportar → OFX &nbsp;|&nbsp;
            <strong>C6:</strong> App C6 → Extrato → Compartilhar → OFX
          </span>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <button className="btn btn-primary" onClick={()=>fileRef.current?.click()} disabled={loading}>
            {loading?<><RefreshCw size={14} className="spin"/> Processando...</>:<><Upload size={14}/> Importar extrato</>}
          </button>
          <input ref={fileRef} type="file" accept=".ofx,.csv,.txt,.ofc" style={{display:'none'}}
            onChange={e=>{if(e.target.files[0]){processarArquivo(e.target.files[0])};e.target.value=''}}/>
          {banco && <span className="pill purple">{banco}</span>}
          {transacoes.length > 0 && (
            <div style={{fontSize:13, color:'var(--gray-500)'}}>
              {transacoes.length} lançamentos ·{' '}
              <span style={{color:'var(--ok)',fontWeight:700}}>{matchados} casados automaticamente</span>
              {semMatch > 0 && <> · <span style={{color:'var(--warning)',fontWeight:700}}>{semMatch} sem par</span></>}
            </div>
          )}
          {matchados > 0 && (
            <button className="btn btn-primary" style={{marginLeft:'auto'}} onClick={confirmar} disabled={salvando}>
              {salvando?<RefreshCw size={14} className="spin"/>:<CheckCircle size={14}/>}
              {' '}Confirmar {matchados} pagamento{matchados>1?'s':''}
            </button>
          )}
        </div>
      </div>

      {resultado && (
        <div className={`card card-pad alert-banner ${resultado.erros===0?'ok':'warning'}`}>
          ✅ {resultado.ok} lançamento{resultado.ok>1?'s':''} marcado{resultado.ok>1?'s':''} como pago
          {resultado.erros > 0 && ` · ⚠️ ${resultado.erros} erro${resultado.erros>1?'s':''}`}
        </div>
      )}

      {transacoes.length > 0 && (
        <div className="card">
          <div style={{padding:'12px 20px',borderBottom:'1px solid var(--gray-200)',fontWeight:700,fontSize:13}}>
            Transações do extrato
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)',minWidth:100}}>Data</th>
                  <th style={{textAlign:'left',padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)',minWidth:180}}>Descrição</th>
                  <th style={{textAlign:'right',padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)',minWidth:110}}>Valor</th>
                  <th style={{padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)',minWidth:200}}>Lançamento no sistema</th>
                  <th style={{padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)',width:40}}></th>
                </tr>
              </thead>
              <tbody>
                {transacoes.map((t,i) => {
                  const ign = ignorados.has(i)
                  const parcelaId = matches[i]
                  const parcela = t.sugestoes?.find(p=>p.id===parcelaId)
                  const isCredito = t.valor > 0

                  return (
                    <tr key={i} style={{
                      borderBottom:'1px solid var(--gray-100)',
                      opacity: ign ? .45 : 1,
                      background: ign ? 'var(--gray-50)' : parcelaId ? 'var(--ok-pale)' : t.sugestoes?.length ? '#fffbf0' : 'var(--white)',
                    }}>
                      <td style={{padding:'9px 14px',color:'var(--gray-600)',whiteSpace:'nowrap'}}>{fmtData(t.data)}</td>
                      <td style={{padding:'9px 14px',maxWidth:220}}>
                        <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontSize:12,color:'var(--gray-700)'}}>{t.memo||'—'}</div>
                        {t.fitid && <div style={{fontSize:10,color:'var(--gray-300)',fontFamily:'monospace'}}>{t.fitid.slice(0,20)}</div>}
                      </td>
                      <td style={{padding:'9px 14px',textAlign:'right',fontWeight:700,color:isCredito?'var(--ok)':'var(--danger)',whiteSpace:'nowrap'}}>
                        {isCredito?'+':''}{fmtR(Math.abs(t.valor))}
                      </td>
                      <td style={{padding:'9px 14px'}}>
                        {ign ? (
                          <span style={{color:'var(--gray-400)',fontSize:12}}>Ignorado</span>
                        ) : parcelaId ? (
                          <div>
                            <div style={{fontWeight:600,fontSize:12,color:'var(--ok)'}}>
                              ✓ {parcela?.fin_lancamentos?.descricao||'Lançamento encontrado'}
                            </div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>
                              {fmtR(parcela?.valor||0)} · {fmtData(parcela?.data_vencimento)}
                            </div>
                          </div>
                        ) : t.sugestoes?.length ? (
                          <select className="form-input" style={{padding:'4px 8px',fontSize:12,maxWidth:240}}
                            value="" onChange={e=>e.target.value&&setMatches(prev=>({...prev,[i]:e.target.value}))}>
                            <option value="">Selecione um lançamento...</option>
                            {t.sugestoes.map(p=>(
                              <option key={p.id} value={p.id}>
                                {p.fin_lancamentos?.descricao} — {fmtR(p.valor)} · {fmtData(p.data_vencimento)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{fontSize:12,color:'var(--gray-300)'}}>Sem lançamento correspondente</span>
                        )}
                      </td>
                      <td style={{padding:'9px 8px',textAlign:'center'}}>
                        <button className="btn btn-ghost btn-xs"
                          title={ign?'Reincluir':'Ignorar esta transação'}
                          style={{color:ign?'var(--purple)':'var(--gray-400)'}}
                          onClick={()=>setIgnorados(prev=>{const n=new Set(prev);ign?n.delete(i):n.add(i);return n})}>
                          {ign?'↩':'✕'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
