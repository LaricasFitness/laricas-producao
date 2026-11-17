import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Download } from 'lucide-react'
import { gerarPicking, ordemPicking } from '../lib/pickingPDF'

// Logística › Expedição › Pickings: os pickings gerados ao fechar o planejamento de produção
// (Produção › Planejamento › "PDF Produção"). O líder de expedição baixa o PDF do dia aqui.

const usuarioAtual = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }
const DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const fmtDia = iso => { const d = new Date(iso + 'T12:00:00'); return `${DIA[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` }
const fmtQuando = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function Pickings() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [baixando, setBaixando] = useState(null)

  async function carregar() {
    const { data, error } = await supabase.from('expedicao_pickings')
      .select('id, data_producao, pedidos, faltando, gerado_por, gerado_em, baixado_por, baixado_em')
      .order('data_producao', { ascending: false }).limit(10)
    if (error) { setErro(/does not exist|schema cache/i.test(error.message) ? 'Aplique o expedicao_pickings.sql no Supabase para guardar os pickings.' : error.message); setLista([]); return }
    setErro(''); setLista(data || [])
  }
  useEffect(() => { carregar() }, [])

  async function baixar(pk) {
    setBaixando(pk.id)
    try {
      await gerarPicking([...(pk.pedidos || [])].sort(ordemPicking), `Picking_${pk.data_producao}.pdf`)
      const agora = new Date().toISOString(), quem = usuarioAtual() || null
      await supabase.from('expedicao_pickings').update({ baixado_em: agora, baixado_por: quem }).eq('id', pk.id)
      setLista(ls => ls.map(x => x.id === pk.id ? { ...x, baixado_em: agora, baixado_por: quem } : x))
    } catch (e) {
      setErro('Não consegui gerar o PDF: ' + e.message)
    } finally { setBaixando(null) }
  }

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>Pickings</div>
        <button className="btn btn-ghost btn-sm" onClick={carregar} title="Recarregar"><RefreshCw size={13} /></button>
      </div>
      {erro && <div className="alert-banner danger">{erro}</div>}
      {lista === null && <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Carregando…</div>}
      {lista?.length === 0 && !erro && (
        <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>
          Nenhum picking ainda. Ele é gerado ao fechar o planejamento de produção (Produção › Planejamento › PDF Produção).
        </div>
      )}
      {(lista || []).map((pk, i) => {
        const n = (pk.pedidos || []).length
        return (
          <div key={pk.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, fontSize: 13,
            background: i === 0 && !pk.baixado_em ? 'var(--purple-pale)' : 'var(--gray-50)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>Pedidos de {fmtDia(pk.data_producao)}</b> · {n} pedido{n === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                Gerado {fmtQuando(pk.gerado_em)}{pk.gerado_por ? ` por ${pk.gerado_por}` : ''}
                {pk.baixado_em ? ` · baixado ${fmtQuando(pk.baixado_em)}${pk.baixado_por ? ` por ${pk.baixado_por}` : ''}` : ' · ainda não baixado'}
              </div>
              {pk.faltando?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--warning, #b45309)' }}>Não achados no Bling: {pk.faltando.join(', ')}</div>
              )}
            </div>
            <button className={`btn btn-sm ${pk.baixado_em ? 'btn-ghost' : 'btn-primary'}`} onClick={() => baixar(pk)} disabled={!n || baixando === pk.id}>
              {baixando === pk.id ? <RefreshCw size={13} className="spin" /> : <Download size={13} />} PDF
            </button>
          </div>
        )
      })}
    </div>
  )
}
