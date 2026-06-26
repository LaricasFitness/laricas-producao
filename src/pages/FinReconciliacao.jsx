import { useState, useRef } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData } from '../lib/financeiro'
import { Upload, RefreshCw, CheckCircle, AlertTriangle, X } from 'lucide-react'

function parseExtratoCsv(texto) {
  const linhas = texto.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim())
  const result = []
  for (const linha of linhas) {
    const cols = linha.split(/[,;]/).map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 3) continue
    // Detecta data, descrição, valor em várias posições
    let data = null, desc = '', valor = null
    for (const col of cols) {
      if (!data) {
        const m = col.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
        if (m) {
          const [,d,mo,a] = m
          const ano = a.length===2?'20'+a:a
          data = `${ano}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
        }
      }
      if (!valor) {
        const s = col.replace(/\./g,'').replace(',','.')
        const n = parseFloat(s)
        if (!isNaN(n) && Math.abs(n) > 0 && Math.abs(n) < 10000000) valor = n
      }
    }
    const descCols = cols.filter(c => isNaN(parseFloat(c.replace(',','.').replace(/\./g,''))) && !c.match(/\d{1,2}[\/\-]\d{1,2}/))
    desc = descCols.join(' ').trim()
    if (data && valor !== null && desc) result.push({ data, desc, valor, original: linha })
  }
  return result
}

export default function FinReconciliacao() {
  const [linhasExtrato, setLinhasExtrato] = useState([])
  const [matches, setMatches] = useState({})       // idx -> parcela_id
  const [ignorados, setIgnorados] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const fileRef = useRef()

  async function processarArquivo(file) {
    setLoading(true)
    const texto = await file.text()
    const linhas = parseExtratoCsv(texto)

    // Busca parcelas pendentes do período
    const datas = linhas.map(l=>l.data).sort()
    if (!datas.length) { setLoading(false); return }
    const { data: parcelas } = await supabase
      .from('fin_parcelas')
      .select('*, fin_lancamentos(tipo, descricao)')
      .gte('data_vencimento', datas[0])
      .lte('data_vencimento', datas[datas.length-1])
      .in('status', ['pendente','agendado','vencido'])
      .order('data_vencimento')

    // Auto-match: mesmo valor e data próxima (±3 dias)
    const autoMatches = {}
    for (let i=0; i<linhas.length; i++) {
      const l = linhas[i]
      const absVal = Math.abs(l.valor)
      const dataL = new Date(l.data+'T12:00:00')
      const match = (parcelas||[]).find(p => {
        const diff = Math.abs(p.valor - absVal)
        const diffDias = Math.abs((new Date(p.data_vencimento+'T12:00:00') - dataL) / 86400000)
        return diff < 0.02 && diffDias <= 3
      })
      if (match) autoMatches[i] = match.id
    }

    setLinhasExtrato(linhas.map((l,i) => ({ ...l, parcelas: (parcelas||[]).filter(p => {
      const absVal = Math.abs(l.valor)
      const dataL = new Date(l.data+'T12:00:00')
      const diffDias = Math.abs((new Date(p.data_vencimento+'T12:00:00') - dataL) / 86400000)
      return Math.abs(p.valor - absVal) < p.valor*0.1 && diffDias <= 7
    })
    })))
    setMatches(autoMatches)
    setLoading(false)
  }

  async function confirmar() {
    setSalvando(true)
    let ok=0, erros=0
    for (const [idx, parcelaId] of Object.entries(matches)) {
      if (ignorados.has(Number(idx))) continue
      const linha = linhasExtrato[Number(idx)]
      const { error } = await supabase.from('fin_parcelas').update({
        status: 'pago',
        data_pagamento: linha.data,
      }).eq('id', parcelaId)
      if (error) erros++; else ok++
    }
    setResultado({ ok, erros })
    setSalvando(false)
  }

  const matchados = Object.keys(matches).filter(i => !ignorados.has(Number(i))).length
  const semMatch = linhasExtrato.filter((_,i) => !matches[i] && !ignorados.has(i)).length

  return (
    <>
      <div className="card card-pad">
        <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>🏦 Reconciliação Bancária</div>
        <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:14 }}>
          Importe o extrato do banco (CSV) e o sistema casa automaticamente com seus lançamentos pendentes.
          Formatos aceitos: Bradesco, Itaú, Nubank, Inter, BTG ou qualquer CSV com data, descrição e valor.
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button className="btn btn-primary" onClick={()=>fileRef.current?.click()} disabled={loading}>
            {loading?<><RefreshCw size={14} className="spin"/> Processando...</>:<><Upload size={14}/> Importar extrato CSV</>}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt,.ofx" style={{display:'none'}}
            onChange={e=>{if(e.target.files[0])processarArquivo(e.target.files[0]);e.target.value=''}}/>
          {linhasExtrato.length > 0 && (
            <div style={{fontSize:13, color:'var(--gray-500)'}}>
              {linhasExtrato.length} lançamentos · <span style={{color:'var(--ok)',fontWeight:700}}>{matchados} casados</span>
              {semMatch > 0 && <> · <span style={{color:'var(--warning)',fontWeight:700}}>{semMatch} sem par</span></>}
            </div>
          )}
        </div>
      </div>

      {resultado && (
        <div className={`card card-pad alert-banner ${resultado.erros===0?'ok':'warning'}`}>
          ✅ {resultado.ok} lançamento(s) marcado(s) como pago{resultado.erros>0?` · ⚠️ ${resultado.erros} erro(s)`:''}
        </div>
      )}

      {linhasExtrato.length > 0 && (
        <div className="card">
          <div style={{padding:'12px 20px', borderBottom:'1px solid var(--gray-200)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div style={{fontWeight:700, fontSize:14}}>Lançamentos do extrato</div>
            {matchados > 0 && (
              <button className="btn btn-primary" onClick={confirmar} disabled={salvando}>
                {salvando?<RefreshCw size={14} className="spin"/>:<CheckCircle size={14}/>}
                {' '}Confirmar {matchados} pagamento(s)
              </button>
            )}
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>Data</th>
                  <th style={{textAlign:'left',padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>Descrição extrato</th>
                  <th style={{textAlign:'right',padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>Valor</th>
                  <th style={{padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>Lançamento no sistema</th>
                  <th style={{padding:'8px 14px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}></th>
                </tr>
              </thead>
              <tbody>
                {linhasExtrato.map((l,i) => {
                  const ignorado = ignorados.has(i)
                  const parcelaId = matches[i]
                  const parcela = l.parcelas?.find(p=>p.id===parcelaId)
                  const temSugestoes = l.parcelas?.length > 0
                  return (
                    <tr key={i} style={{borderBottom:'1px solid var(--gray-100)', opacity:ignorado?.5:1, background:ignorado?'var(--gray-50)':parcelaId?'var(--ok-pale)':temSugestoes?'#fffbf0':'var(--white)'}}>
                      <td style={{padding:'8px 14px',whiteSpace:'nowrap',color:'var(--gray-600)'}}>{fmtData(l.data)}</td>
                      <td style={{padding:'8px 14px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.desc}</td>
                      <td style={{padding:'8px 14px',textAlign:'right',fontWeight:700,color:l.valor<0?'var(--danger)':'var(--ok)'}}>{fmtR(Math.abs(l.valor))}</td>
                      <td style={{padding:'8px 14px'}}>
                        {ignorado ? (
                          <span style={{color:'var(--gray-400)',fontSize:12}}>Ignorado</span>
                        ) : parcelaId ? (
                          <div>
                            <div style={{fontWeight:600,fontSize:12,color:'var(--ok)'}}>✓ {parcela?.fin_lancamentos?.descricao||'—'}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>{fmtR(parcela?.valor||0)} · {fmtData(parcela?.data_vencimento)}</div>
                          </div>
                        ) : temSugestoes ? (
                          <select className="form-input" style={{padding:'4px 8px',fontSize:12}}
                            value="" onChange={e=>setMatches(prev=>({...prev,[i]:e.target.value}))}>
                            <option value="">Selecione...</option>
                            {l.parcelas.map(p=>(
                              <option key={p.id} value={p.id}>
                                {p.fin_lancamentos?.descricao} — {fmtR(p.valor)} · {fmtData(p.data_vencimento)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{fontSize:12,color:'var(--gray-300)'}}>Sem par encontrado</span>
                        )}
                      </td>
                      <td style={{padding:'8px 14px'}}>
                        <button className="btn btn-ghost btn-xs" title={ignorado?'Reincluir':'Ignorar'}
                          onClick={()=>setIgnorados(prev=>{const n=new Set(prev);ignorado?n.delete(i):n.add(i);return n})}>
                          {ignorado?'↩':'✕'}
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
