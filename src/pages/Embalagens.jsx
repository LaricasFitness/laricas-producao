import { useState } from 'react'
import Dashboard from './Dashboard'
import Pedidos from './Pedidos'
import Compras from './Compras'

export default function Embalagens({ onNovoPedido }) {
  const [sub, setSub] = useState('situacao')
  const [novoPedidoFlag, setNovoPedidoFlag] = useState(false)

  function irNovoPedido() {
    setSub('pedidos')
    setNovoPedidoFlag(true)
  }

  return (
    <>
      {/* Sub-tabs */}
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'situacao' ? ' active' : ''}`} onClick={() => setSub('situacao')}>
          📊 Situação
        </button>
        <button className={`tab${sub === 'pedidos' ? ' active' : ''}`} onClick={() => setSub('pedidos')}>
          🛒 Pedidos
        </button>
        <button className={`tab${sub === 'compras' ? ' active' : ''}`} onClick={() => setSub('compras')}>
          💰 Compras
        </button>
      </div>

      {sub === 'situacao' && <Dashboard onNovoPedido={irNovoPedido} />}
      {sub === 'pedidos'  && <Pedidos abrirNovo={novoPedidoFlag} onNovoClosed={() => setNovoPedidoFlag(false)} />}
      {sub === 'compras'  && <Compras />}
    </>
  )
}
