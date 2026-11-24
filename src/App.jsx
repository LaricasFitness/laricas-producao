import { useState, useEffect } from 'react'
import { LogOut, ChevronDown, Menu } from 'lucide-react'
import './App.css'
import { fecharMesesPendentes } from './lib/cmv'
import { MENU, subPadrao, rotuloSub } from './lib/menu'
import { observarGradesFixas } from './lib/gradesMobile'
import { carregarSazonais } from './lib/sazonal'
import Login from './pages/Login'
import { conferirSessao, vigiarSessao, sair as sairDaSessao } from './lib/sessao'
import ProducaoHub from './pages/ProducaoHub'
import Logistica from './pages/Logistica'
import Admin from './pages/Admin'
import EstoqueHub from './pages/EstoqueHub'
import Precificacao from './pages/Precificacao'
import FinanceiroHub from './pages/FinanceiroHub'
import Hoje from './pages/Hoje'
import Conexoes from './lib/conexoes'

const PERM_MAP = {
  dashboard:'estoque', pedidos:'estoque', compras:'estoque',
  embalagens:'estoque', insumos:'estoque',
  analise:'producao', log:'producao', planejamento:'producao', historico:'producao',
  }

function temPermissao(abas, pageId) {
  return abas.includes(pageId) ||
    abas.includes(PERM_MAP[pageId]) ||
    Object.entries(PERM_MAP).some(([old,novo]) => novo===pageId && abas.includes(old))
}

// Link do QR Code da etiqueta de validade (?etiqueta=123): abre Produção › Etiquetas, também depois do login
const etiquetaNaUrl = () => new URLSearchParams(window.location.search).has('etiqueta')
// Volta da autorização do Bling (?expedicao=conectado): abre Logística › Expedição
const expedicaoNaUrl = () => new URLSearchParams(window.location.search).has('expedicao')
const paginaInicial = () => etiquetaNaUrl() ? 'producao' : expedicaoNaUrl() ? 'logistica' : 'hoje'

export default function App() {
  const [usuario, setUsuario] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
  })
  const [page, setPage] = useState(paginaInicial)
  const [csvLogistica, setCsvLogistica] = useState(null)
  const [subs, setSubs] = useState(() => etiquetaNaUrl() ? { producao: 'etiquetas' } : expedicaoNaUrl() ? { logistica: 'expedicao' } : {})  // subtela escolhida em cada área
  const [aberto, setAberto] = useState(null)    // área expandida no menu lateral
  const [menuAberto, setMenuAberto] = useState(false)  // gaveta do celular (☰)

  // Fecha o CMV dos meses vencidos (a partir do dia 5) — sem botão, em segundo plano
  useEffect(() => { if (usuario) fecharMesesPendentes() }, [usuario])

  // Sazonais fora de temporada: carrega antes de abrir qualquer tela
  const [sazonalPronto, setSazonalPronto] = useState(false)
  useEffect(() => {
    if (!usuario) return
    carregarSazonais().finally(() => setSazonalPronto(true))
  }, [usuario])

  // Sessão do servidor (cookie): confere ao abrir e volta ao login quando qualquer /api disser que expirou
  useEffect(() => vigiarSessao(() => { sessionStorage.removeItem('usuario'); setUsuario(null) }), [])
  useEffect(() => {
    if (!usuario?.id) return
    conferirSessao().then(u => {
      if (u === null) { sessionStorage.removeItem('usuario'); setUsuario(null) }       // sem sessão: entrar de novo
      else if (u) { sessionStorage.setItem('usuario', JSON.stringify(u)); setUsuario(u) }  // perfil/abas atualizados
    })
  }, [usuario?.id])

  // Celular: grades com colunas fixas em px ganham a classe .grade-px (ver App.css)
  useEffect(() => observarGradesFixas(), [])

  // Celular: Esc fecha a gaveta do menu
  useEffect(() => {
    if (!menuAberto) return
    const fechar = e => { if (e.key === 'Escape') setMenuAberto(false) }
    const telaGrande = () => { if (window.innerWidth > 768) setMenuAberto(false) }  // girou/redimensionou
    window.addEventListener('keydown', fechar)
    window.addEventListener('resize', telaGrande)
    return () => { window.removeEventListener('keydown', fechar); window.removeEventListener('resize', telaGrande) }
  }, [menuAberto])

  if (!usuario) return <Login onLogin={u => { setUsuario(u); setPage(paginaInicial()) }} />

  const abas = usuario.abas_permitidas || []
  const pages = MENU.filter(p => p.id === 'hoje' || usuario.perfil === 'admin' || temPermissao(abas, p.id))
  // Hoje mostra as tarefas das áreas que o usuário acessa (admin: todas)
  const areasTarefas = usuario.perfil === 'admin' ? null : pages.map(p => p.id)
  const pageAtual = pages.find(p => p.id === page) ? page : (pages[0]?.id || 'producao')
  const subAtual = subs[pageAtual] || subPadrao(pageAtual)
  const setSub = (pageId, subId) => setSubs(p => ({ ...p, [pageId]: subId }))
  const areaAtual = MENU.find(m => m.id === pageAtual)
  const title = rotuloSub(pageAtual, subAtual) || areaAtual?.label
  const sub = areaAtual?.label
  const expandida = aberto ?? pageAtual

  function abrirArea(id) {
    // Na gaveta do celular, tocar na área só abre/fecha os submenus (como menu de loja)
    if (menuAberto || id === pageAtual) { setAberto(expandida === id ? '' : id); return }
    setPage(id); setAberto(null)
  }

  function abrirSub(id, subId) {
    setPage(id); setSub(id, subId); setAberto(null); setMenuAberto(false)
  }

  function irLogistica(csv) { if (!temPermissao(abas,'logistica')) return; setCsvLogistica(csv); setPage('logistica') }
  function sair() { sairDaSessao(); sessionStorage.removeItem('usuario'); setUsuario(null) }

  return (
    <div className={`app${menuAberto ? ' menu-aberto' : ''}`}>
      <div className="menu-fundo" onClick={() => setMenuAberto(false)} />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">LARC</div>
          <div className="brand-sub">Produção</div>
        </div>
        <nav className="sidebar-nav">
          {pages.map(({ id, label, Icon, subs: itens }) => (
            <div key={id} className="nav-group">
              <button className={`nav-btn${pageAtual===id?' active':''}`}
                onClick={() => abrirArea(id)} title={label} aria-expanded={expandida === id}>
                <Icon size={19} strokeWidth={1.8} />
                <span className="nav-label">{label}</span>
                <ChevronDown size={15} className={`nav-chevron${expandida === id ? ' aberto' : ''}`} />
              </button>
              {expandida === id && (
                <div className="nav-subs">
                  {itens.map(s => (
                    <button key={s.id}
                      className={`nav-sub${pageAtual === id && subAtual === s.id ? ' active' : ''}`}
                      onClick={() => abrirSub(id, s.id)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        {usuario.perfil === 'admin' && <Conexoes />}
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
          <button className="menu-toggle" onClick={() => { setAberto(null); setMenuAberto(true) }} title="Menu" aria-label="Abrir menu">
            <Menu size={22} />
          </button>
          <div className="topbar-brand">LARC</div>
          <div className="topbar-text">
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{sub}</div>
          </div>
          <div className="topbar-right">
            <span className="topbar-date">
              {(d => d.charAt(0).toUpperCase() + d.slice(1))(new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}))}
            </span>
          </div>
        </header>
        <div className="page">
          {!sazonalPronto ? <div className="loading">Carregando...</div> : <>
          {pageAtual==='hoje'      && <Hoje areas={areasTarefas} usuario={usuario} onIr={(id, subId) => abrirSub(id, subId)} />}
          {pageAtual==='producao'  && <ProducaoHub onIrLogistica={irLogistica} sub={subAtual} onSub={id => setSub('producao', id)} />}
          {pageAtual==='logistica'  && <Logistica csvInicial={csvLogistica} sub={subAtual} onSub={id => setSub('logistica', id)} />}
          {pageAtual==='estoque'       && <EstoqueHub sub={subAtual} onSub={id => setSub('estoque', id)} />}
          {pageAtual==='precificacao'  && <Precificacao sub={subAtual} onSub={id => setSub('precificacao', id)} />}
          {pageAtual==='financeiro'    && <FinanceiroHub sub={subAtual} onSub={id => setSub('financeiro', id)} />}
          {pageAtual==='admin'      && <Admin sub={subAtual} onSub={id => setSub('admin', id)} />}
          </>}
        </div>
      </div>
    </div>
  )
}
