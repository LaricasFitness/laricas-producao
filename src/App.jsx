import { useState } from 'react'
import './App.css'
import Dashboard from './pages/Dashboard'
import Producao from './pages/Producao'
import Pedidos from './pages/Pedidos'
import Admin from './pages/Admin'

const TABS = [
  { id: 'dashboard', label: '📊 Situação' },
  { id: 'producao',  label: '📋 Produção do dia' },
  { id: 'pedidos',   label: '📦 Pedidos' },
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [showAdmin, setShowAdmin] = useState(false)
  const [abrirNovoPedido, setAbrirNovoPedido] = useState(false)

  function irParaPedido() {
    setShowAdmin(false)
    setTab('pedidos')
    setAbrirNovoPedido(true)
  }

  return (
    <div className="shell">
      <div className="header">
        <div className="logo"><span>L</span></div>
        <div>
          <div className="header-brand">Laricas Fitness</div>
          <div className="header-sub">Controle de Embalagens</div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setShowAdmin(v => !v) }}
          >
            {showAdmin ? '← Voltar' : '⚙️ Admin'}
          </button>
        </div>
      </div>

      {showAdmin ? (
        <Admin />
      ) : (
        <>
          <div className="tabs">
            {TABS.map(t => (
              <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'dashboard' && <Dashboard onNovoPedido={irParaPedido} />}
          {tab === 'producao'  && <Producao />}
          {tab === 'pedidos'   && (
            <Pedidos
              abrirNovo={abrirNovoPedido}
              onNovoClosed={() => setAbrirNovoPedido(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
