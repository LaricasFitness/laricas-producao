import { useState } from 'react'
import './App.css'
import Dashboard from './pages/Dashboard'
import Analise from './pages/Analise'
import Log from './pages/Log'
import Producao from './pages/Producao'
import Pedidos from './pages/Pedidos'
import Compras from './pages/Compras'
import Admin from './pages/Admin'

const PAGES = [
  { id: 'dashboard', label: 'Estoque',  icon: '📦' },
  { id: 'analise',   label: 'Análise',  icon: '📈' },
  { id: 'log',       label: 'Log',      icon: '📅' },
  { id: 'producao',  label: 'Produção', icon: '📋' },
  { id: 'pedidos',   label: 'Pedidos',  icon: '🛒' },
  { id: 'compras',   label: 'Compras',  icon: '💰' },
  { id: 'admin',     label: 'Admin',    icon: '⚙️' },
]

const TITLES = {
  dashboard: { title: 'Estoque de Embalagens',    sub: 'Alertas, cobertura e sugestões de pedido' },
  analise:   { title: 'Análise de Produção',      sub: 'Volume, tendências, ranking e desperdício' },
  log:       { title: 'Log de Produção',          sub: 'Calendário de registros e dias sem preenchimento' },
  producao:  { title: 'Registro de Produção',     sub: 'Preenchimento diário pela equipe' },
  pedidos:   { title: 'Pedidos à Gráfica',        sub: 'Histórico, geração de PDF e conferência' },
  compras:   { title: 'Compras de Embalagens',    sub: 'Recebimentos, estoque e custo com a gráfica' },
  admin:     { title: 'Administração',            sub: 'Embalagens, estoque e configurações' },
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [novoPedidoFlag, setNovoPedidoFlag] = useState(false)
  const { title, sub } = TITLES[page] || {}

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo"><span>L</span></div>
        {PAGES.map(p => (
          <button key={p.id} className={`nav-btn${page === p.id ? ' active' : ''}`}
            onClick={() => setPage(p.id)} title={p.label}>
            <span style={{ fontSize: 18 }}>{p.icon}</span>
            <span className="nav-label">{p.label}</span>
          </button>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{sub}</div>
          </div>
          <div className="topbar-right">
            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </header>
        <div className="page">
          {page === 'dashboard' && <Dashboard onNovoPedido={() => { setPage('pedidos'); setNovoPedidoFlag(true) }} />}
          {page === 'analise'   && <Analise />}
          {page === 'log'       && <Log />}
          {page === 'producao'  && <Producao />}
          {page === 'pedidos'   && <Pedidos abrirNovo={novoPedidoFlag} onNovoClosed={() => setNovoPedidoFlag(false)} />}
          {page === 'compras'   && <Compras />}
          {page === 'admin'     && <Admin />}
        </div>
      </div>
    </div>
  )
}
