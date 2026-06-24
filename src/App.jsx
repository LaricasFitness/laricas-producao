import { useState, useEffect } from 'react'
import './App.css'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Analise from './pages/Analise'
import Log from './pages/Log'
import Producao from './pages/Producao'
import Pedidos from './pages/Pedidos'
import Compras from './pages/Compras'
import Admin from './pages/Admin'
import Planejamento from './pages/Planejamento'
import HistoricoPlanejamento from './pages/HistoricoPlanejamento'
import Logistica from './pages/Logistica'

const ALL_PAGES = [
  { id: 'dashboard',    label: 'Estoque',       icon: '📦' },
  { id: 'analise',      label: 'Análise',        icon: '📈' },
  { id: 'log',          label: 'Log',            icon: '📅' },
  { id: 'producao',     label: 'Produção',       icon: '📋' },
  { id: 'planejamento', label: 'Planejamento',   icon: '🗓️' },
  { id: 'logistica',    label: 'Logística',      icon: '🚚' },
  { id: 'historico',    label: 'Histórico',      icon: '📁' },
  { id: 'pedidos',      label: 'Pedidos',        icon: '🛒' },
  { id: 'compras',      label: 'Compras',        icon: '💰' },
  { id: 'admin',        label: 'Admin',          icon: '⚙️' },
]

const TITLES = {
  dashboard:    { title: 'Estoque de Embalagens',       sub: 'Alertas, cobertura e sugestões de pedido' },
  analise:      { title: 'Análise de Produção',         sub: 'Volume, tendências, ranking e planejado x realizado' },
  log:          { title: 'Log de Produção',             sub: 'Calendário de registros e dias sem preenchimento' },
  producao:     { title: 'Registro de Produção',        sub: 'Preenchimento diário pela equipe' },
  planejamento: { title: 'Planejamento do Dia',         sub: 'Importa Bling + delivery → PDF para a equipe' },
  logistica:    { title: 'Logística LALAMOVE',          sub: 'Roteiros automáticos por zona + CSVs de importação' },
  historico:    { title: 'Histórico de Planejamentos',  sub: 'Consulte e reimprima planejamentos anteriores' },
  pedidos:      { title: 'Pedidos à Gráfica',           sub: 'Histórico, geração de PDF e conferência' },
  compras:      { title: 'Compras de Embalagens',       sub: 'Recebimentos, estoque e custo com a gráfica' },
  admin:        { title: 'Administração',               sub: 'Embalagens, usuários e configurações' },
}

export default function App() {
  const [usuario, setUsuario] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
  })
  const [page, setPage] = useState('dashboard')
  const [novoPedidoFlag, setNovoPedidoFlag] = useState(false)
  const [csvLogistica, setCsvLogistica] = useState(null)

  // Se não tem sessão, mostra login
  if (!usuario) return <Login onLogin={u => { setUsuario(u); setPage('dashboard') }} />

  const abas = usuario.abas_permitidas || []
  const pages = ALL_PAGES.filter(p => abas.includes(p.id))

  // Se a página atual não é permitida, vai para a primeira disponível
  const pageAtual = abas.includes(page) ? page : (pages[0]?.id || 'producao')

  const { title, sub } = TITLES[pageAtual] || {}

  function irLogistica(csvTexto) {
    if (!abas.includes('logistica')) return
    setCsvLogistica(csvTexto)
    setPage('logistica')
  }

  function sair() {
    sessionStorage.removeItem('usuario')
    setUsuario(null)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo"><span>L</span></div>
        {pages.map(p => (
          <button key={p.id} className={`nav-btn${pageAtual === p.id ? ' active' : ''}`}
            onClick={() => setPage(p.id)} title={p.label}>
            <span style={{ fontSize: 18 }}>{p.icon}</span>
            <span className="nav-label">{p.label}</span>
          </button>
        ))}
        <div className="sidebar-spacer" />
        {/* Sair */}
        <button className="nav-btn" onClick={sair} title="Sair" style={{ marginTop: 'auto' }}>
          <span style={{ fontSize: 16 }}>↩️</span>
          <span className="nav-label">Sair</span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{sub}</div>
          </div>
          <div className="topbar-right">
            <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 }}>
              {usuario.nome}
            </span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 4 }}>
              · {usuario.perfil}
            </span>
            <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 12 }}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>
        </header>

        <div className="page">
          {pageAtual === 'dashboard'    && <Dashboard onNovoPedido={() => { setPage('pedidos'); setNovoPedidoFlag(true) }} />}
          {pageAtual === 'analise'      && <Analise />}
          {pageAtual === 'log'          && <Log />}
          {pageAtual === 'producao'     && <Producao />}
          {pageAtual === 'planejamento' && <Planejamento onIrLogistica={irLogistica} />}
          {pageAtual === 'logistica'    && <Logistica csvInicial={csvLogistica} />}
          {pageAtual === 'historico'    && <HistoricoPlanejamento />}
          {pageAtual === 'pedidos'      && <Pedidos abrirNovo={novoPedidoFlag} onNovoClosed={() => setNovoPedidoFlag(false)} />}
          {pageAtual === 'compras'      && <Compras />}
          {pageAtual === 'admin'        && <Admin />}
        </div>
      </div>
    </div>
  )
}
