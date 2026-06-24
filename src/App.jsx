import { useState } from 'react'
import './App.css'
import Login from './pages/Login'
import Embalagens from './pages/Embalagens'
import Analise from './pages/Analise'
import Log from './pages/Log'
import Producao from './pages/Producao'
import Planejamento from './pages/Planejamento'
import HistoricoPlanejamento from './pages/HistoricoPlanejamento'
import Logistica from './pages/Logistica'
import Admin from './pages/Admin'

const ALL_PAGES = [
  { id: 'embalagens',   label: 'Embalagens',    icon: '📦' },
  { id: 'analise',      label: 'Análise',        icon: '📈' },
  { id: 'log',          label: 'Log',            icon: '📅' },
  { id: 'producao',     label: 'Produção',       icon: '📋' },
  { id: 'planejamento', label: 'Planejamento',   icon: '🗓️' },
  { id: 'logistica',    label: 'Logística',      icon: '🚚' },
  { id: 'historico',    label: 'Histórico',      icon: '📁' },
  { id: 'admin',        label: 'Admin',          icon: '⚙️' },
]

// Mapeamento para permissões — dashboard/pedidos/compras agora são 'embalagens'
const PERM_MAP = {
  dashboard: 'embalagens', pedidos: 'embalagens', compras: 'embalagens',
}

const TITLES = {
  embalagens:   { title: 'Embalagens',              sub: 'Situação do estoque, pedidos à gráfica e compras' },
  analise:      { title: 'Análise de Produção',     sub: 'Volume, tendências, ranking e planejado x realizado' },
  log:          { title: 'Log de Produção',          sub: 'Calendário de registros e dias sem preenchimento' },
  producao:     { title: 'Registro de Produção',    sub: 'Preenchimento diário pela equipe' },
  planejamento: { title: 'Planejamento do Dia',     sub: 'Importa Bling + delivery → PDF para a equipe' },
  logistica:    { title: 'Logística LALAMOVE',      sub: 'Roteiros automáticos por zona + CSVs de importação' },
  historico:    { title: 'Histórico de Planejamentos', sub: 'Consulte e reimprima planejamentos anteriores' },
  admin:        { title: 'Administração',           sub: 'Embalagens, usuários e configurações' },
}

function temPermissao(abas, pageId) {
  // Aceita a aba direta ou os antigos IDs mapeados
  return abas.includes(pageId) ||
    abas.includes(PERM_MAP[pageId]) ||
    Object.entries(PERM_MAP).some(([old, novo]) => novo === pageId && abas.includes(old))
}

export default function App() {
  const [usuario, setUsuario] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
  })
  const [page, setPage] = useState('embalagens')
  const [csvLogistica, setCsvLogistica] = useState(null)

  if (!usuario) return <Login onLogin={u => { setUsuario(u); setPage('embalagens') }} />

  const abas = usuario.abas_permitidas || []

  // Filtra páginas que o usuário tem acesso
  const pages = ALL_PAGES.filter(p => temPermissao(abas, p.id))
  const pageAtual = pages.find(p => p.id === page) ? page : (pages[0]?.id || 'producao')
  const { title, sub } = TITLES[pageAtual] || {}

  function irLogistica(csvTexto) {
    if (!temPermissao(abas, 'logistica')) return
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
        <button className="nav-btn" onClick={sair} title="Sair">
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
            <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 }}>{usuario.nome}</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 4 }}>· {usuario.perfil}</span>
            <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 12 }}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>
        </header>

        <div className="page">
          {pageAtual === 'embalagens'   && <Embalagens />}
          {pageAtual === 'analise'      && <Analise />}
          {pageAtual === 'log'          && <Log />}
          {pageAtual === 'producao'     && <Producao />}
          {pageAtual === 'planejamento' && <Planejamento onIrLogistica={irLogistica} />}
          {pageAtual === 'logistica'    && <Logistica csvInicial={csvLogistica} />}
          {pageAtual === 'historico'    && <HistoricoPlanejamento />}
          {pageAtual === 'admin'        && <Admin />}
        </div>
      </div>
    </div>
  )
}
