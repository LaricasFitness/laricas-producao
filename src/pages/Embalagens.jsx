import { useState } from 'react'
import Dashboard from './Dashboard'
import Pedidos from './Pedidos'
import Compras from './Compras'
import LogGeral from './LogGeral'

export default function Embalagens() {
  const [sub, setSub] = useState('situacao')
  const [novoPedidoFlag, setNovoPedidoFlag] = useState(false)
  const [tipo, setTipo] = useState('rotulo')

  return (
    <>
      {/* Seletor de tipo */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <button
          className={`btn ${tipo==='rotulo'?'btn-primary':'btn-ghost'}`}
          onClick={()=>setTipo('rotulo')}>
          🏷️ Rótulos
        </button>
        <button
          className={`btn ${tipo==='embalagem'?'btn-primary':'btn-ghost'}`}
          onClick={()=>setTipo('embalagem')}>
          📦 Embalagens
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'situacao' ? ' active' : ''}`} onClick={() => setSub('situacao')}>📊 Situação</button>
        <button className={`tab${sub === 'pedidos' ? ' active' : ''}`} onClick={() => setSub('pedidos')}>🛒 Pedidos</button>
        <button className={`tab${sub === 'compras' ? ' active' : ''}`} onClick={() => setSub('compras')}>💰 Compras</button>
        <button className={`tab${sub === 'acoes' ? ' active' : ''}`} onClick={() => setSub('acoes')}>🕓 Minhas ações</button>
      </div>
      {sub === 'situacao' && <Dashboard tipo={tipo} onNovoPedido={() => { setSub('pedidos'); setNovoPedidoFlag(true) }} />}
      {sub === 'pedidos'  && <Pedidos tipo={tipo} abrirNovo={novoPedidoFlag} onNovoClosed={() => setNovoPedidoFlag(false)} />}
      {sub === 'compras'  && <Compras tipo={tipo} />}
      {sub === 'acoes'    && <div className="card card-pad"><LogGeral /></div>}
    </>
  )
}
