import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData, STATUS_LABEL } from '../lib/financeiro'
import { RefreshCw, Pencil, Trash2, Save, Plus } from 'lucide-react'

// ── Modal edição rápida de lançamento no Extrato ─────────────────────────────
function ModalEditarExtrato({ parcela, lancamento, categorias, canais, contas, formasPag, fornecedores, onClose, onSaved }) {
  const [f, setF] = useState({
    descricao:          lancamento.descricao || '',
    categoria_id:       lancamento.categoria_id || '',
    canal_id:           lancamento.canal_id || '',
    conta_id:           parcela.conta_id || lancamento.conta_id || '',
    forma_pagamento_id: lancamento.forma_pagamento_id || '',
    fornecedor_id:      lancamento.fornecedor_id || '',
    observacao:         lancamento.observacao || '',
    valor:              parcela.valor || 0,
    data_vencimento:    parcela.data_vencimento || '',
    data_competencia:   parcela.data_competencia || '',
    status:             parcela.status || 'em_aberto',
    data_pagamento:     parcela.data_pagamento || '',
  })
  const set = (k,v) => setF(p=>({...p,[k]:v}))
  const [saving, setSaving] = useState(false)
  const [busca, setBusca] = useState('')

  const catsFiltradas = categorias.filter(c =>
    !busca || c.nome.toLowerCase().includes(busca.toLowerCase()) ||
    categorias.find(p=>p.id===c.parent_id)?.nome.toLowerCase().includes(busca.toLowerCase())
  )

  async function salvar() {
    setSaving(true)
    await supabase.from('fin_lancamentos').update({
      descricao: f.descricao,
      categoria_id: f.categoria_id || null,
      canal_id: f.canal_id || null,
      conta_id: f.conta_id || null,
      forma_pagamento_id: f.forma_pagamento_id || null,
      fornecedor_id: f.fornecedor_id || null,
      observacao: f.observacao || null,
    }).eq('id', lancamento.id)
    await supabase.from('fin_parcelas').update({
      valor: parseFloat(f.valor) || parcela.valor,
      data_vencimento: f.data_vencimento,
      data_competencia: f.data_competencia || null,
      status: f.status,
      data_pagamento: f.status === 'pago' ? (f.data_pagamento || new Date().toISOString().slice(0,10)) : null,
      conta_id: f.conta_id || null,
    }).eq('id', parcela.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-header">
          <div className="modal-title">Editar lançamento</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="form-group" style={{gridColumn:'1/-1'}}>
            <label className="form-label">Descrição *</label>
            <input className="form-input" value={f.descricao} onChange={e=>set('descricao',e.target.value)} autoFocus/>
          </div>
          <div className="form-group">
            <label className="form-label">Valor (R$)</label>
            <input type="number" className="form-input" step={0.01} value={f.valor} onChange={e=>set('valor',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-input" value={f.status} onChange={e=>set('status',e.target.value)}>
              <option value="em_aberto">Em aberto</option>
              <option value="agendado">Agendado</option>
              <option value="pago">Pago</option>
              <option value="vencido">Vencido</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Vencimento</label>
            <input type="date" className="form-input" value={f.data_vencimento} onChange={e=>set('data_vencimento',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Competência</label>
            <input type="date" className="form-input" value={f.data_competencia} onChange={e=>set('data_competencia',e.target.value)}/>
          </div>
          {f.status === 'pago' && (
            <div className="form-group">
              <label className="form-label">Data pagamento</label>
              <input type="date" className="form-input" value={f.data_pagamento} onChange={e=>set('data_pagamento',e.target.value)}/>
            </div>
          )}
          <div className="form-group" style={{gridColumn:'1/-1'}}>
            <label className="form-label">Categoria</label>
            <input className="form-input" placeholder="Buscar categoria..." value={busca}
              onChange={e=>setBusca(e.target.value)} style={{marginBottom:4}}/>
            <select className="form-input" value={f.categoria_id} onChange={e=>set('categoria_id',e.target.value)} size={5}>
              <option value="">Sem categoria</option>
              {catsFiltradas.map(c=>(
                <option key={c.id} value={c.id}>
                  {'　'.repeat(c._indent||0)}{(c._indent||0)>0?'└ ':''}{c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Conta</label>
            <select className="form-input" value={f.conta_id} onChange={e=>set('conta_id',e.target.value)}>
              <option value="">Selecione...</option>
              {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Forma Pgto</label>
            <select className="form-input" value={f.forma_pagamento_id} onChange={e=>set('forma_pagamento_id',e.target.value)}>
              <option value="">Selecione...</option>
              {formasPag.map(fp=><option key={fp.id} value={fp.id}>{fp.nome}</option>)}
            </select>
          </div>
          {lancamento.tipo === 'receita' && (
            <div className="form-group">
              <label className="form-label">Canal</label>
              <select className="form-input" value={f.canal_id} onChange={e=>set('canal_id',e.target.value)}>
                <option value="">Selecione...</option>
                {canais.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Fornecedor</label>
            <select className="form-input" value={f.fornecedor_id} onChange={e=>set('fornecedor_id',e.target.value)}>
              <option value="">Sem fornecedor</option>
              {fornecedores.map(fn=><option key={fn.id} value={fn.id}>{fn.nome_fantasia||fn.razao_social}</option>)}
            </select>
          </div>
          <div className="form-group" style={{gridColumn:'1/-1'}}>
            <label className="form-label">Observação</label>
            <input className="form-input" value={f.observacao} onChange={e=>set('observacao',e.target.value)}/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving?<RefreshCw size={14} className="spin"/>:<><Save size={14}/> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FinExtrato() {
  const hoje = new Date()
  const iniMes = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`
  const [ini, setIni] = useState(iniMes)
  const [fim, setFim] = useState(hoje.toISOString().slice(0,10))
  const [linhas, setLinhas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalEditar, setModalEditar] = useState(null) // { parcela, lancamento }

  // Dados de apoio
  const [categorias, setCategorias] = useState([])
  const [canais, setCanais] = useState([])
  const [contas, setContas] = useState([])
  const [formasPag, setFormasPag] = useState([])
  const [fornecedores, setFornecedores] = useState([])

  useEffect(() => {
    Promise.all([
      supabase.from('fin_categorias').select('*').eq('ativo',true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_canais').select('*').eq('ativo',true).order('nome'),
      supabase.from('fin_contas').select('*').eq('ativo',true).order('nome'),
      supabase.from('fin_formas_pagamento').select('*').eq('ativo',true).order('nome'),
      supabase.from('fin_fornecedores').select('*').eq('ativo',true).order('razao_social'),
    ]).then(([{data:cats},{data:cns},{data:cnts},{data:fps},{data:forns}]) => {
      // Monta categorias com indentação
      const todas = cats||[]
      const result = []
      function addN(pid, indent) {
        todas.filter(c=>(c.parent_id||null)===(pid||null)).sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))
          .forEach(c=>{ result.push({...c,_indent:indent}); addN(c.id,indent+1) })
      }
      addN(null,0)
      setCategorias(result)
      setCanais(cns||[])
      setContas(cnts||[])
      setFormasPag(fps||[])
      setFornecedores(forns||[])
    })
  }, [])

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
      <div className="card" style={{overflowX:'auto'}}>
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
                        <button className="btn btn-ghost btn-xs" title="Editar lançamento"
                          onClick={()=>setModalEditar({parcela:p, lancamento:l})}>
                          <Pencil size={11}/>
                        </button>
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
      {modalEditar && (
        <ModalEditarExtrato
          parcela={modalEditar.parcela}
          lancamento={modalEditar.lancamento}
          categorias={categorias} canais={canais} contas={contas}
          formasPag={formasPag} fornecedores={fornecedores}
          onClose={()=>setModalEditar(null)}
          onSaved={()=>{ setModalEditar(null); load() }}
        />
      )}
    </>
  )
}
