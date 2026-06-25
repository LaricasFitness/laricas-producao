import { useState } from 'react'
import Dashboard from './Dashboard'
import Pedidos from './Pedidos'
import Compras from './Compras'
import LogGeral from './LogGeral'

export default function Embalagens() {
  const [sub, setSub] = useState('situacao')
  const [novoPedidoFlag, setNovoPedidoFlag] = useState(false)

  return (
    <>
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'situacao' ? ' active' : ''}`} onClick={() => setSub('situacao')}>📊 Situação</button>
        <button className={`tab${sub === 'pedidos' ? ' active' : ''}`} onClick={() => setSub('pedidos')}>🛒 Pedidos</button>
        <button className={`tab${sub === 'compras' ? ' active' : ''}`} onClick={() => setSub('compras')}>💰 Compras</button>
        <button className={`tab${sub === 'acoes' ? ' active' : ''}`} onClick={() => setSub('acoes')}>🕓 Minhas ações</button>
      </div>
      {sub === 'situacao' && <Dashboard onNovoPedido={() => { setSub('pedidos'); setNovoPedidoFlag(true) }} />}
      {sub === 'pedidos'  && <Pedidos abrirNovo={novoPedidoFlag} onNovoClosed={() => setNovoPedidoFlag(false)} />}
      {sub === 'compras'  && <Compras />}
      {sub === 'acoes'    && <div className="card card-pad"><LogGeral /></div>}
    </>
  )
}
