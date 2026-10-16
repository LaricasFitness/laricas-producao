import { useState, useEffect } from 'react'
import { ClipboardList, Truck, Package, CircleDollarSign, Settings, LogOut } from 'lucide-react'
import './App.css'
import { fecharMesesPendentes } from './lib/cmv'
import Login from './pages/Login'
import ProducaoHub from './pages/ProducaoHub'
import Logistica from './pages/Logistica'
import Admin from './pages/Admin'
import EstoqueHub from './pages/EstoqueHub'
import Precificacao from './pages/Precificacao'

const ALL_PAGES = [
  { id: 'producao',      label: 'Produção',  Icon: ClipboardList },
  { id: 'logistica',     label: 'Logística', Icon: Truck },
  { id: 'estoque',       label: 'Estoque',   Icon: Package },
  { id: 'precificacao',  label: 'Custos',    Icon: CircleDollarSign },
  { id: 'admin',         label: 'Admin',     Icon: Settings },
]

const PERM_MAP = {
  dashboard:'estoque', pedidos:'estoque', compras:'estoque',
  embalagens:'estoque', insumos:'estoque',
  analise:'producao', log:'producao', planejamento:'producao', historico:'producao',
  }

const TITLES = {
  producao:    { title:'Produção',           sub:'Registro, planejamento, análise, log e histórico' },
  logistica:   { title:'Logística LALAMOVE', sub:'Roteiros automáticos por zona + CSVs' },
  estoque:       { title:'Estoque',            sub:'Situação, conferência, compras e pedidos — MP e embalagens' },
  precificacao:  { title:'Custos',             sub:'Ficha de custo, CMV do mês, markup e margem por canal' },
  admin:       { title:'Administração',      sub:'Embalagens, usuários e configurações' },
}

function temPermissao(abas, pageId) {
  return abas.includes(pageId) ||
    abas.includes(PERM_MAP[pageId]) ||
    Object.entries(PERM_MAP).some(([old,novo]) => novo===pageId && abas.includes(old))
}

export default function App() {
  const [usuario, setUsuario] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
  })
  const [page, setPage] = useState('estoque')
  const [csvLogistica, setCsvLogistica] = useState(null)

  // Fecha o CMV dos meses vencidos (a partir do dia 5) — sem botão, em segundo plano
  useEffect(() => { if (usuario) fecharMesesPendentes() }, [usuario])

  if (!usuario) return <Login onLogin={u => { setUsuario(u); setPage('estoque') }} />

  const abas = usuario.abas_permitidas || []
  const pages = ALL_PAGES.filter(p => usuario.perfil === 'admin' || temPermissao(abas, p.id))
  const pageAtual = pages.find(p => p.id === page) ? page : (pages[0]?.id || 'producao')
  const { title, sub } = TITLES[pageAtual] || {}

  function irLogistica(csv) { if (!temPermissao(abas,'logistica')) return; setCsvLogistica(csv); setPage('logistica') }
  function sair() { sessionStorage.removeItem('usuario'); setUsuario(null) }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">LARC</div>
          <div className="brand-sub">Produção</div>
        </div>
        <nav className="sidebar-nav">
          {pages.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-btn${pageAtual===id?' active':''}`}
              onClick={() => setPage(id)} title={label}>
              <Icon size={19} strokeWidth={1.8} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-user">
          <div className="avatar">{(usuario.nome || '?').trim().charAt(0).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">{usuario.nome}</div>
            <div className="user-role">{usuario.perfil}</div>
          </div>
          <button className="icon-btn" onClick={sair} title="Sair"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-brand">LARC</div>
          <div className="topbar-text">
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{sub}</div>
          </div>
          <div className="topbar-right">
            <span className="topbar-date">
              {(d => d.charAt(0).toUpperCase() + d.slice(1))(new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}))}
            </span>
            <button className="icon-btn topbar-sair" onClick={sair} title="Sair"><LogOut size={18} /></button>
          </div>
        </header>
        <div className="page">
          {pageAtual==='producao'   && <ProducaoHub onIrLogistica={irLogistica} />}
          {pageAtual==='logistica'  && <Logistica csvInicial={csvLogistica} />}
          {pageAtual==='estoque'       && <EstoqueHub />}
          {pageAtual==='precificacao'  && <Precificacao />}
          {pageAtual==='admin'      && <Admin />}
        </div>
      </div>
    </div>
  )
}
