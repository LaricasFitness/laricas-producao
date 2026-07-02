import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData, STATUS_LABEL } from '../lib/financeiro'
import { RefreshCw, Pencil, Trash2 } from 'lucide-react'

export default function FinExtrato() {
  const hoje = new Date()
  const iniMes = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const [ini, setIni] = useState(iniMes)
  const [fim, setFim] = useState(hoje.toISOString().slice(0,10))
  const [linhas, setLinhas] = useState([])
  const [loading, setLoading] = useState(true)
  const [saldoAnterior, setSaldoAnterior] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('fin_parcelas')
      .select(`
        id, numero_parcela, valor, valor_pago, status, data_vencimento, data_pagamento, data_competencia, conta_id,
        fin_lancamentos!inner(
          id, tipo, descricao, total_parcelas, is_transferencia,
          fin_categorias(id,nome,cor),
          fin_canais(id,nome),
          fin_contas(id,nome),
          fin_fornecedores(id,razao_social,nome_fantasia),
          fin_formas_pagamento(id,nome)
        )
      `)
      .gte('data_vencimento', ini)
      .lte('data_vencimento', fim)
      .order('data_vencimento', { ascending: true })

    setLinhas(data || [])
    setLoading(false)
  }, [ini, fim])

  useEffect(() => { load() }, [load])

  const valorLinha = (p) => {
    const v = p.valor_pago > 0 ? p.valor_pago : p.valor
    return p.fin_lancamentos?.tipo === 'receita' ? v : -v
  }

  const totalReceitas = linhas.filter(p=>p.fin_lancamentos?.tipo==='receita'&&p.status==='pago').reduce((s,p)=>s+(p.valor_pago||p.valor),0)
  const totalDespesas = linhas.filter(p=>p.fin_lancamentos?.tipo==='despesa'&&p.status==='pago').reduce((s,p)=>s+(p.valor_pago||p.valor),0)
  const saldo = totalReceitas - totalDespesas

  return (
    <>
      {/* Filtros */}
      <div className="card card-pad" style={{marginBottom:12}}>
        <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div className="form-group">
            <label className="form-label">De</label>
            <input type="date" className="form-input" value={ini} onChange={e=>setIni(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Até</label>
            <input type="date" className="form-input" value={fim} onChange={e=>setFim(e.target.value)}/>
          </div>
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={14}/></button>
        </div>

        {/* KPIs */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginTop:14}}>
          <div style={{padding:'10px 14px',background:'#f0fdf4',borderRadius:8,borderLeft:'3px solid var(--ok)'}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700}}>RECEBIDO</div>
            <div style={{fontWeight:800,fontSize:18,color:'var(--ok)'}}>{fmtR(totalReceitas)}</div>
          </div>
          <div style={{padding:'10px 14px',background:'#fff5f5',borderRadius:8,borderLeft:'3px solid var(--danger)'}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700}}>PAGO</div>
            <div style={{fontWeight:800,fontSize:18,color:'var(--danger)'}}>{fmtR(totalDespesas)}</div>
          </div>
          <div style={{padding:'10px 14px',background:saldo>=0?'#f0fdf4':'#fff5f5',borderRadius:8,borderLeft:`3px solid ${saldo>=0?'var(--ok)':'var(--danger)'}`}}>
            <div style={{fontSize:11,color:'var(--gray-400)',fontWeight:700}}>SALDO DO PERÍODO</div>
            <div style={{fontWeight:800,fontSize:18,color:saldo>=0?'var(--ok)':'var(--danger)'}}>{fmtR(saldo)}</div>
          </div>
        </div>
      </div>

      {/* Tabela extrato */}
      <div className="card" style={{overflow:'hidden'}}>
        {loading ? (
          <div className="loading"><RefreshCw size={14} className="spin"/></div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--gray-50)'}}>
                <th style={{padding:'8px 14px',textAlign:'left',width:100}}>Vencimento</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Descrição</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Categoria</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Canal / Fornecedor</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Conta</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Forma Pgto</th>
                <th style={{padding:'8px 14px',textAlign:'right'}}>Entrada</th>
                <th style={{padding:'8px 14px',textAlign:'right'}}>Saída</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Status</th>
                <th style={{padding:'8px 14px'}}></th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr><td colSpan={10} style={{padding:32,textAlign:'center',color:'var(--gray-400)'}}>Nenhum lançamento no período</td></tr>
              )}
              {linhas.map((p, idx) => {
                const l = p.fin_lancamentos
                const isRec = l?.tipo === 'receita'
                const isTransf = l?.is_transferencia
                const vlr = p.valor_pago > 0 ? p.valor_pago : p.valor
                const scfg = STATUS_LABEL[p.status] || STATUS_LABEL.em_aberto
                const hoje = new Date().toISOString().slice(0,10)
                const vencida = p.status !== 'pago' && p.data_vencimento < hoje
                return (
                  <tr key={p.id} style={{
                    borderTop:'1px solid var(--gray-100)',
                    background: isTransf ? 'var(--gray-50)' : vencida ? '#fff8f8' : idx%2===0?'var(--white)':'#fafafa',
                    opacity: isTransf ? 0.7 : 1,
                  }}>
                    <td style={{padding:'8px 14px',color:vencida?'var(--danger)':'var(--gray-600)',fontWeight:vencida?700:400,whiteSpace:'nowrap'}}>
                      {fmtData(p.data_vencimento)}
                    </td>
                    <td style={{padding:'8px 14px',maxWidth:180}}>
                      <div style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        {isTransf && <span style={{fontSize:10,color:'var(--gray-400)',marginRight:4}}>↔</span>}
                        {l?.descricao}
                      </div>
                      {l?.total_parcelas > 1 && <div style={{fontSize:10,color:'var(--gray-400)'}}>{p.numero_parcela}/{l.total_parcelas}</div>}
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      {l?.fin_categorias ? (
                        <span style={{fontSize:11,color:l.fin_categorias.cor||'var(--gray-500)',fontWeight:600}}>
                          ● {l.fin_categorias.nome}
                        </span>
                      ) : <span style={{color:'var(--gray-300)',fontSize:11}}>—</span>}
                    </td>
                    <td style={{padding:'8px 14px',fontSize:12,color:'var(--gray-500)'}}>
                      {l?.fin_canais?.nome || l?.fin_fornecedores?.nome_fantasia || l?.fin_fornecedores?.razao_social || '—'}
                    </td>
                    <td style={{padding:'8px 14px',fontSize:11,color:'var(--gray-500)'}}>
                      {l?.fin_contas?.nome || '—'}
                    </td>
                    <td style={{padding:'8px 14px',fontSize:11,color:'var(--gray-500)'}}>
                      {l?.fin_formas_pagamento?.nome || '—'}
                    </td>
                    <td style={{padding:'8px 14px',textAlign:'right',fontWeight:700,color:'var(--ok)'}}>
                      {isRec ? fmtR(vlr) : '—'}
                    </td>
                    <td style={{padding:'8px 14px',textAlign:'right',fontWeight:700,color:'var(--danger)'}}>
                      {!isRec ? fmtR(vlr) : '—'}
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      <span className={`pill ${scfg.cls}`} style={{fontSize:10}}>{scfg.label}</span>
                    </td>
                    <td style={{padding:'8px 10px'}}>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-ghost btn-xs" title="Editar parcela"
                          onClick={async()=>{
                            const novo = prompt('Novo status (pago/em_aberto/agendado/cancelado):',p.status)
                            if (novo) { await supabase.from('fin_parcelas').update({status:novo,data_pagamento:novo==='pago'?new Date().toISOString().slice(0,10):null}).eq('id',p.id); load() }
                          }}><Pencil size={11}/></button>
                        <button className="btn btn-ghost btn-xs" style={{color:'var(--danger)'}} title="Excluir lançamento"
                          onClick={async()=>{
                            if(!window.confirm('Excluir este lançamento?'))return
                            await supabase.from('fin_lancamentos').delete().eq('id',l.id)
                            load()
                          }}><Trash2 size={11}/></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {linhas.length > 0 && (
              <tfoot>
                <tr style={{background:'var(--gray-50)',fontWeight:800,fontSize:13}}>
                  <td colSpan={6} style={{padding:'10px 14px',color:'var(--gray-600)'}}>Total do período</td>
                  <td style={{padding:'10px 14px',textAlign:'right',color:'var(--ok)'}}>{fmtR(totalReceitas)}</td>
                  <td style={{padding:'10px 14px',textAlign:'right',color:'var(--danger)'}}>{fmtR(totalDespesas)}</td>
                  <td colSpan={2} style={{padding:'10px 14px',color:saldo>=0?'var(--ok)':'var(--danger)'}}>
                    Saldo: {fmtR(saldo)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </>
  )
}
