import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Download, RefreshCw, Tag } from 'lucide-react'
import { montarPdfEnvio, baixarPdf } from '../lib/documentosEnvio'

// Logística › Expedição › 3. Etiquetas e DANFE. Um PDF por dia de produção, na ordem do picking:
// a etiqueta de cada pedido (gerada pela logística no Bling) e, se o pedido tem nota autorizada, a DANFE
// simplificada logo depois. Só leitura: qualquer pessoa da expedição pode baixar.
// Etiqueta dos Correios e do Bling Envios só existe depois da NF autorizada (etapa 2).

const DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const fmtDia = iso => { const d = new Date(iso + 'T12:00:00'); return `${DIA[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` }

export default function EtiquetasDoDia() {
  const [pickings, setPickings] = useState([])
  const [origem, setOrigem] = useState('')
  const [progresso, setProgresso] = useState(null)   // { feitos, total }
  const [resumo, setResumo] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.from('expedicao_pickings').select('id, data_producao, pedidos').order('data_producao', { ascending: false }).limit(10)
      .then(({ data }) => { setPickings(data || []); setOrigem(o => o || data?.[0]?.id || '') })
  }, [])

  const picking = pickings.find(p => p.id === origem)
  const pedidos = (picking?.pedidos || []).filter(p => p.id)

  async function montar() {
    setErro(''); setResumo(null); setProgresso({ feitos: 0, total: pedidos.length })
    try {
      const { bytes, resumo } = await montarPdfEnvio(pedidos, (feitos, total) => setProgresso({ feitos, total }))
      setResumo(resumo)
      if (bytes) baixarPdf(bytes, `Etiquetas_DANFE_${picking.data_producao}.pdf`)
      else setErro('Nenhuma etiqueta ou DANFE disponível para estes pedidos ainda.')
    } catch (e) { setErro(e.message) }
    finally { setProgresso(null) }
  }

  const semEtiqueta = (resumo || []).filter(r => !r.etiqueta)
  const semDanfe = (resumo || []).filter(r => r.etiqueta && !r.danfe && r.nota)
  const comAviso = (resumo || []).filter(r => r.erro || r.avisos.length)

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag size={16} />
        <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>Etiquetas e DANFE simplificada</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
        Um PDF do dia, na ordem do picking: a etiqueta de cada pedido e, quando há nota autorizada, a DANFE simplificada
        logo depois (10 × 15 cm, para a impressora térmica). As etiquetas dos Correios e do Bling Envios só existem depois
        que a nota é autorizada.
      </div>
      {pickings.length === 0 && <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Nenhum picking ainda.</div>}
      {pickings.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="form-input" style={{ width: 'auto' }} value={origem} onChange={e => { setOrigem(e.target.value); setResumo(null) }} disabled={!!progresso}>
            {pickings.map(p => <option key={p.id} value={p.id}>Picking de {fmtDia(p.data_producao)} ({(p.pedidos || []).length})</option>)}
          </select>
          <button className="btn btn-primary" onClick={montar} disabled={!!progresso || !pedidos.length}>
            {progresso ? <><RefreshCw size={13} className="spin" /> Montando… {progresso.feitos}/{progresso.total}</> : <><Download size={13} /> PDF do dia ({pedidos.length})</>}
          </button>
        </div>
      )}
      {erro && <div className="alert-banner danger">{erro}</div>}
      {resumo && (
        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <b>{resumo.filter(r => r.etiqueta).length}</b> etiqueta(s) · <b>{resumo.filter(r => r.danfe).length}</b> DANFE(s)
            {semEtiqueta.length > 0 && <span style={{ color: 'var(--danger)' }}> · {semEtiqueta.length} sem etiqueta</span>}
            {semDanfe.length > 0 && <span style={{ color: 'var(--warning, #b45309)' }}> · {semDanfe.length} com nota sem DANFE</span>}
          </div>
          {comAviso.map(r => (
            <div key={r.numero} style={{ fontSize: 12, color: r.etiqueta ? 'var(--warning, #b45309)' : 'var(--danger)' }}>
              <b>{r.numero}</b> {r.cliente}{r.transportadora ? ` · ${r.transportadora}` : ''}: {[r.erro, ...r.avisos].filter(Boolean).join(' ')}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
