import { useState } from 'react'
import { ConferenciaEstoque } from './Embalagens'
import { ConferenciaMP, HistoricoCompras } from './MatPrimas'
import Compras from './Compras'

// Hub de estoque: reúne as operações que valem para matéria-prima e
// embalagem, que antes viviam duplicadas em dois menus diferentes.
export default function EstoqueHub() {
  const [aba, setAba] = useState('conferencia')
  const [tipo, setTipo] = useState('mp')

  const Alternador = () => (
    <div style={{ display: 'flex', gap: 4 }}>
      {[['mp', '🧂 Matéria-prima'], ['emb', '📦 Embalagens']].map(([k, l]) => (
        <button key={k} onClick={() => setTipo(k)}
          className={`btn btn-sm ${tipo === k ? 'btn-primary' : 'btn-ghost'}`}>{l}</button>
      ))}
    </div>
  )

  return (
    <div className="page">
      <div className="tabs">
        <button className={`tab${aba === 'conferencia' ? ' active' : ''}`}
          onClick={() => setAba('conferencia')}>🔍 Conferência</button>
        <button className={`tab${aba === 'compras' ? ' active' : ''}`}
          onClick={() => setAba('compras')}>🛒 Compras</button>
      </div>

      <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {aba === 'conferencia' ? '🔍 Conferência de estoque' : '🛒 Compras e recebimentos'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
            {aba === 'conferencia'
              ? 'Contagem física, divergência e impacto no estoque'
              : 'Lançamento de compras, notas e histórico de preços'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <Alternador />
      </div>

      {aba === 'conferencia' && (tipo === 'mp' ? <ConferenciaMP /> : <ConferenciaEstoque />)}
      {aba === 'compras' && (tipo === 'mp' ? <HistoricoCompras /> : <Compras />)}
    </div>
  )
}
