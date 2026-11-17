import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Camera, X, Check, AlertTriangle, Link2, Plus, Search } from 'lucide-react'
import { chamarExpedicao, acharPedido, envioDoPedido, bipe } from '../lib/expedicao'
import Pickings from './ExpedicaoPickings'
import NotasDoDia from './ExpedicaoNotas'
import EtiquetasDoDia from './ExpedicaoEtiquetas'

// Logística › Expedição: o operador lê o código de barras da etiqueta de cada pacote que saiu
// (câmera do celular ou leitor de código de barras) e dá baixa de todos de uma vez:
// Shopify → enviado (com rastreio) e arquivado; Bling → Atendido.

const usuarioAtual = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }
const ehAdmin = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.perfil === 'admin' } catch { return false } }
// Etapas do dia, na ordem do processo. Notas fiscais: só administradores; o resto, a expedição toda.
const ETAPAS = [
  { id: 'picking', label: '1. Picking' },
  { id: 'notas', label: '2. Notas fiscais', admin: true },
  { id: 'etiquetas', label: '3. Etiquetas e DANFE' },
  { id: 'baixa', label: '4. Baixa (envio)' },
]
const CHAVE_ETAPA = 'larc_expedicao_etapa'
const CHAVE_LIDOS = 'expedicao_lidos'
const POR_VEZ = 8          // pedidos por chamada de baixa
const DETALHES_POR_VEZ = 30

const carregarLidos = () => { try { return JSON.parse(localStorage.getItem(CHAVE_LIDOS)) || [] } catch { return [] } }
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtData = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : ''
const temTeclado = () => window.matchMedia?.('(pointer: fine)').matches

// ───────────── Leitor de código de barras pela câmera (contínuo) ─────────────
function LeitorCodigos({ onCodigo, onFechar }) {
  const video = useRef(null)
  const [erro, setErro] = useState('')
  const ultimo = useRef({ texto: '', em: 0 })
  const cb = useRef(onCodigo); cb.current = onCodigo

  useEffect(() => {
    let parar = false, stream, controles, timer
    const lido = texto => {
      const agora = Date.now()
      if (texto === ultimo.current.texto && agora - ultimo.current.em < 3000) return   // mesmo pacote ainda na frente
      ultimo.current = { texto, em: agora }
      cb.current(texto)
    }
    const restricoes = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) { setErro('Este navegador não dá acesso à câmera. Digite ou use o leitor de código de barras.'); return }
      // 1) leitor nativo do navegador (Chrome no Android): mais rápido para código de barras
      const formatos = window.BarcodeDetector ? await window.BarcodeDetector.getSupportedFormats().catch(() => []) : []
      if (formatos.includes('code_128')) {
        const det = new window.BarcodeDetector({ formats: ['code_128', 'data_matrix', 'qr_code', 'itf', 'code_39', 'ean_13'].filter(f => formatos.includes(f)) })
        stream = await navigator.mediaDevices.getUserMedia(restricoes)
        if (parar) { stream.getTracks().forEach(t => t.stop()); return }
        video.current.srcObject = stream
        await video.current.play().catch(() => {})
        const ciclo = async () => {
          if (parar) return
          try {
            if (video.current?.readyState >= 2) {
              const r = await det.detect(video.current)
              if (r[0]?.rawValue) lido(r[0].rawValue)
            }
          } catch { /* quadro ruim */ }
          timer = setTimeout(ciclo, 150)
        }
        ciclo()
        return
      }
      // 2) demais navegadores (iPhone etc.): ZXing
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
      if (parar) return
      const dicas = new Map([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE, BarcodeFormat.ITF, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13]],
        [DecodeHintType.TRY_HARDER, true],
      ])
      const leitor = new BrowserMultiFormatReader(dicas, { delayBetweenScanAttempts: 150 })
      controles = await leitor.decodeFromConstraints(restricoes, video.current, r => { if (r) lido(r.getText()) })
      if (parar) controles.stop()
    }
    iniciar().catch(e => setErro(e?.name === 'NotAllowedError'
      ? 'O navegador não deixou usar a câmera. Libere a câmera para este site nas permissões do navegador.'
      : 'Não consegui abrir a câmera. Digite o código ou use o leitor de código de barras.'))
    return () => { parar = true; clearTimeout(timer); controles?.stop(); stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3', maxHeight: 340 }}>
      {erro ? <div className="alert-banner warning" style={{ margin: 10 }}>{erro}</div> : (
        <>
          <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', left: '8%', right: '8%', top: '35%', bottom: '35%', border: '3px solid rgba(255,255,255,.85)', borderRadius: 8 }} />
        </>
      )}
      <button className="btn btn-sm" onClick={onFechar} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', color: '#fff' }}><X size={14} /> Fechar câmera</button>
    </div>
  )
}

// ───────────── Tela ─────────────
export default function Expedicao() {
  const [status, setStatus] = useState(null)         // { bling, shopify }
  const [pedidos, setPedidos] = useState([])          // Bling "Em aberto"
  const [atendidos, setAtendidos] = useState([])      // Bling "Atendido" dos últimos dias (só para avisar)
  const [carregandoAtendidos, setCarregandoAtendidos] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [detalhando, setDetalhando] = useState(0)     // pedidos ainda sem rastreio/CEP carregados
  const [erro, setErro] = useState('')
  const [lidos, setLidos] = useState(carregarLidos)   // ids lidos (ficam guardados no aparelho)
  const [aviso, setAviso] = useState(null)            // { tipo, texto }
  const [escolher, setEscolher] = useState(null)      // vários pedidos com o mesmo CEP
  const [camera, setCamera] = useState(false)
  const [digitado, setDigitado] = useState('')
  const [notificar, setNotificar] = useState(true)
  const [baixando, setBaixando] = useState(null)      // { feitos, total }
  const [falhas, setFalhas] = useState([])
  const [busca, setBusca] = useState('')
  const [hoje, setHoje] = useState([])                // baixas de hoje (expedicao_envios)
  const campo = useRef(null)
  const admin = ehAdmin()
  const [etapa, setEtapa] = useState(() => {
    const salva = localStorage.getItem(CHAVE_ETAPA)
    if (ETAPAS.some(e => e.id === salva && (admin || !e.admin))) return salva
    return admin ? 'picking' : 'baixa'
  })
  const irPara = id => { setEtapa(id); localStorage.setItem(CHAVE_ETAPA, id) }

  useEffect(() => { localStorage.setItem(CHAVE_LIDOS, JSON.stringify(lidos)) }, [lidos])

  useEffect(() => {
    // Volta da autorização do Bling
    const p = new URLSearchParams(window.location.search)
    if (p.has('expedicao')) {
      if (p.get('expedicao') === 'conectado') setAviso({ tipo: 'ok', texto: 'Bling conectado.' })
      else setAviso({ tipo: 'danger', texto: 'A conexão com o Bling não foi concluída. Tente de novo.' })
      p.delete('expedicao')
      window.history.replaceState(null, '', window.location.pathname + (p.toString() ? '?' + p : ''))
    }
    chamarExpedicao('status').then(s => { setStatus(s); if (s.bling) carregar() }).catch(e => setErro(e.message))
    carregarHoje()
  }, [])

  async function carregarHoje() {
    const { data } = await supabase.from('expedicao_envios').select('*')
      .gte('criado_em', new Date(hojeISO() + 'T00:00:00').toISOString()).order('criado_em', { ascending: false })
    setHoje(data || [])
  }

  async function carregar() {
    setCarregando(true); setErro('')
    try {
      const { pedidos: lista, recolocados = [] } = await chamarExpedicao('pedidos')
      setPedidos(lista)
      if (recolocados.length) setAviso({ tipo: 'ok', texto: `O Bling tinha reaberto ${recolocados.length} pedido(s) que já tiveram baixa (${recolocados.join(', ')}). Voltaram para Atendido.` })
      setLidos(ls => ls.filter(id => lista.some(p => p.id === id)))   // o que já saiu de "Em aberto" sai da leitura
      // rastreio, CEP e transportadora vêm do pedido completo: carrega aos poucos
      const ids = lista.map(p => p.id)
      setDetalhando(ids.length)
      for (let i = 0; i < ids.length; i += DETALHES_POR_VEZ) {
        const { pedidos: det } = await chamarExpedicao('detalhes', { ids: ids.slice(i, i + DETALHES_POR_VEZ) })
        const porId = Object.fromEntries(det.filter(d => !d.erro).map(d => [d.id, d]))
        setPedidos(ps => ps.map(p => porId[p.id] ? { ...p, ...porId[p.id] } : p))
        setDetalhando(n => Math.max(0, n - DETALHES_POR_VEZ))
      }
    } catch (e) {
      setErro(e.message)
      if (e.reconectar) setStatus(s => ({ ...s, bling: false }))
      return
    } finally {
      setCarregando(false); setDetalhando(0)
    }
    carregarAtendidos()
  }

  // Pedidos que a nota já deixou Atendido (B2B, venda direta...): carregados em segundo plano,
  // só para a leitura avisar que não precisam de baixa em vez de dar erro
  async function carregarAtendidos() {
    setCarregandoAtendidos(true)
    try {
      const { pedidos: lista } = await chamarExpedicao('pedidos&lista=atendidos')
      setAtendidos(lista)
      const ids = lista.map(p => p.id)
      for (let i = 0; i < ids.length; i += DETALHES_POR_VEZ) {
        const { pedidos: det } = await chamarExpedicao('detalhes', { ids: ids.slice(i, i + DETALHES_POR_VEZ) })
        const porId = Object.fromEntries(det.filter(d => !d.erro).map(d => [d.id, d]))
        setAtendidos(ps => ps.map(p => porId[p.id] ? { ...p, ...porId[p.id] } : p))
      }
    } catch { /* é só aviso: sem a lista, a leitura dá o erro de sempre */ }
    finally { setCarregandoAtendidos(false) }
  }

  const porId = useMemo(() => Object.fromEntries(pedidos.map(p => [p.id, p])), [pedidos])
  const listaLidos = lidos.map(id => porId[id]).filter(Boolean)

  function marcar(p, por) {
    if (lidos.includes(p.id)) { bipe(false); setAviso({ tipo: 'warning', texto: `Pedido ${p.numero} já estava lido.` }); return }
    bipe(true)
    setLidos(ls => [p.id, ...ls])
    setAviso({ tipo: 'ok', texto: `Lido: pedido ${p.numero} · ${p.cliente}${por ? ` (pelo ${por})` : ''}. Falta dar baixa.` })
  }

  // Tirar da leitura: o aviso verde do pedido some (nada foi baixado ainda)
  function tirar(p) {
    setLidos(ls => ls.filter(id => id !== p.id))
    setAviso({ tipo: 'warning', texto: `Pedido ${p.numero} tirado da lista (não foi baixado).` })
  }

  function ler(codigo) {
    const r = acharPedido(codigo, pedidos)
    if (r.tipo === 'ok') return marcar(r.pedido, r.por)
    if (r.tipo === 'varios') { bipe(true); setEscolher(r.pedidos); return }
    // Já Atendido no Bling (a nota fecha o pedido em B2B, venda direta etc., ou já foi baixado)
    const a = acharPedido(codigo, atendidos)
    if (a.tipo !== 'nada') {
      const ps = a.tipo === 'ok' ? [a.pedido] : a.pedidos
      bipe('aviso')
      setAviso({ tipo: 'warning', texto: `${ps.length > 1 ? 'Pedidos' : 'Pedido'} ${ps.map(p => `${p.numero} · ${p.cliente}`).join(' / ')} já ${ps.length > 1 ? 'estão' : 'está'} Atendido no Bling. Não precisa de baixa.` })
      return
    }
    bipe(false)
    setAviso({ tipo: 'danger', texto: detalhando
      ? `"${codigo}" ainda não apareceu: os rastreios estão carregando. Leia de novo em instantes.`
      : carregandoAtendidos
        ? `"${codigo}" não é de nenhum pedido em aberto. Os pedidos já atendidos ainda estão carregando: leia de novo em instantes.`
        : `"${codigo}" não é de nenhum pedido em aberto no Bling, nem de um atendido nos últimos dias (confira se é o código da etiqueta de envio).` })
  }

  async function darBaixa() {
    const ids = listaLidos.map(p => p.id)
    if (!ids.length) return
    const semNF = listaLidos.filter(p => p.detalhado && !p.nf)
    if (semNF.length && !confirm(`${semNF.length} pedido(s) sem nota fiscal no Bling (${semNF.map(p => p.numero).join(', ')}). Dar baixa mesmo assim?`)) return
    setBaixando({ feitos: 0, total: ids.length }); setFalhas([]); setAviso(null)
    const erros = [], ok = []
    try {
      for (let i = 0; i < ids.length; i += POR_VEZ) {
        const { resultados } = await chamarExpedicao('baixar', { ids: ids.slice(i, i + POR_VEZ), notificar, operador: usuarioAtual() })
        for (const r of resultados) (r.ok_bling ? ok : erros).push(r)
        setBaixando({ feitos: Math.min(ids.length, i + POR_VEZ), total: ids.length })
      }
    } catch (e) {
      erros.push({ erro: e.message })
    }
    const feitos = new Set(ok.map(r => r.bling_id))
    setLidos(ls => ls.filter(id => !feitos.has(id)))
    setAtendidos(as => [...pedidos.filter(p => feitos.has(p.id)), ...as])   // ler de novo → "já está Atendido"
    setPedidos(ps => ps.filter(p => !feitos.has(p.id)))
    setFalhas(erros)
    setBaixando(null)
    setAviso(ok.length ? { tipo: erros.length ? 'warning' : 'ok', texto: `${ok.length} pedido(s) baixados${erros.length ? `; ${erros.length} com erro (veja abaixo)` : '.'}` } : null)
    carregarHoje()
  }

  const naoLidos = pedidos.filter(p => !lidos.includes(p.id))
  const filtrados = busca.trim()
    ? naoLidos.filter(p => `${p.numero} ${p.numeroLoja} ${p.cliente} ${envioDoPedido(p)} ${p.cidade}`.toLowerCase().includes(busca.trim().toLowerCase()))
    : naoLidos
  const hojeOk = hoje.filter(h => h.ok_bling)


  // ── Bling não conectado ──
  if (status && !status.bling) return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Conectar o Bling</div>
      <div style={{ fontSize: 13, color: 'var(--gray-600)' }}>
        A expedição precisa de acesso ao Bling para ler os pedidos em aberto e marcar como atendidos.
        A autorização é feita uma vez, no próprio Bling, por quem tem acesso de administrador.
      </div>
      {erro && <div className="alert-banner danger">{erro}</div>}
      {aviso && <div className={`alert-banner ${aviso.tipo}`}>{aviso.texto}</div>}
      <a className="btn btn-primary" href="/api/expedicao?acao=conectar" style={{ alignSelf: 'flex-start' }}><Link2 size={14} /> Conectar o Bling</a>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Etapas do dia: produção fecha o picking → notas → etiquetas e DANFE → no dia seguinte, a baixa */}
      <div className="tabs" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {ETAPAS.filter(e => admin || !e.admin).map(e => (
          <button key={e.id} className={etapa === e.id ? 'tab active' : 'tab'} onClick={() => irPara(e.id)}>{e.label}</button>
        ))}
      </div>

      {/* 1. Pickings gerados ao fechar o planejamento de produção */}
      {etapa === 'picking' && <Pickings />}

      {/* 2. Notas fiscais dos pedidos do picking (só administradores) */}
      {etapa === 'notas' && admin && <NotasDoDia />}

      {/* 3. Etiquetas de transporte e DANFE simplificada do dia (só leitura) */}
      {etapa === 'etiquetas' && <EtiquetasDoDia />}

      {/* 4. Baixa: leitura dos pacotes que saíram */}
      {etapa === 'baixa' && <>
      {/* Leitura */}
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>Ler pacotes enviados</div>
          <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            {carregando && !pedidos.length ? 'Carregando pedidos…' : `${pedidos.length} em aberto no Bling`}
            {detalhando > 0 && ' · carregando rastreios…'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={carregar} disabled={carregando} title="Recarregar pedidos do Bling">
            <RefreshCw size={13} className={carregando ? 'spin' : ''} />
          </button>
        </div>
        {status && !status.shopify && <div className="alert-banner warning">A Shopify não está configurada no Vercel: a baixa vai só no Bling.</div>}
        {erro && <div className="alert-banner danger">{erro}</div>}

        {camera && <LeitorCodigos onCodigo={ler} onFechar={() => setCamera(false)} />}
        <form style={{ display: 'flex', gap: 6 }} onSubmit={ev => { ev.preventDefault(); if (digitado.trim()) { ler(digitado.trim()); setDigitado('') } }}>
          {!camera && <button type="button" className="btn btn-primary" onClick={() => setCamera(true)} disabled={!pedidos.length}><Camera size={14} /> Câmera</button>}
          <input ref={campo} className="form-input" style={{ flex: 1 }} autoFocus={temTeclado()} value={digitado} onChange={e => setDigitado(e.target.value)}
            placeholder="Leitor de código de barras, rastreio, nº do pedido ou CEP" disabled={!pedidos.length} />
          <button className="btn btn-ghost" type="submit" disabled={!digitado.trim()}>OK</button>
        </form>
        {aviso && <div className={`alert-banner ${aviso.tipo}`} style={{ fontWeight: 600 }}>{aviso.texto}</div>}
      </div>

      {/* Lidos */}
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Lidos para baixa ({listaLidos.length})</div>
          {listaLidos.length > 0 && !baixando && <button className="btn btn-ghost btn-sm" onClick={() => confirm('Limpar todos os pedidos lidos?') && setLidos([])}>Limpar</button>}
        </div>
        {listaLidos.length === 0 && <div style={{ fontSize: 13, color: 'var(--gray-400)', padding: '8px 0' }}>Leia a etiqueta de cada pacote que está saindo.</div>}
        {listaLidos.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>{p.numero}</b> · {p.cliente}</div>
              <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                {envioDoPedido(p) || (p.detalhado ? 'sem transportadora' : '…')}
                {p.detalhado && !p.nf && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · sem NF</span>}
              </div>
            </div>
            {!baixando && <button className="btn btn-ghost btn-sm" onClick={() => tirar(p)} title="Tirar da lista"><X size={13} /></button>}
          </div>
        ))}
        {listaLidos.length > 0 && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gray-600)', marginTop: 4 }}>
              <input type="checkbox" checked={notificar} onChange={e => setNotificar(e.target.checked)} />
              Enviar ao cliente o e-mail de pedido enviado (Shopify, com o rastreio)
            </label>
            <button className="btn btn-primary" onClick={darBaixa} disabled={!!baixando} style={{ padding: '10px 14px' }}>
              {baixando ? <><RefreshCw size={14} className="spin" /> Dando baixa… {baixando.feitos}/{baixando.total}</>
                : <><Check size={14} /> Dar baixa em {listaLidos.length} pedido{listaLidos.length > 1 ? 's' : ''} (Bling + Shopify)</>}
            </button>
          </>
        )}
        {falhas.length > 0 && (
          <div className="alert-banner danger" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontWeight: 700 }}><AlertTriangle size={13} /> Não baixados (continuam na lista para tentar de novo):</div>
            {falhas.map((f, i) => <div key={i} style={{ fontSize: 12 }}>{f.numero ? <b>{f.numero}: </b> : null}{f.erro}</div>)}
          </div>
        )}
      </div>

      {/* Em aberto, não lidos */}
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Em aberto, não lidos ({naoLidos.length})</div>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--gray-400)' }} />
            <input className="form-input" style={{ paddingLeft: 26, width: 200 }} placeholder="Buscar" value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Pacote sem código para ler (ex.: motoboy)? Toque em + para marcar à mão.</div>
        {filtrados.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--gray-100)', fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>{p.numero}</b> · {p.cliente} <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{fmtData(p.data)}</span></div>
              <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                {envioDoPedido(p) || (p.detalhado ? 'sem transportadora' : '…')}
                {p.cidade ? ` · ${p.cidade}` : ''}
                {p.detalhado && !p.nf && <span style={{ color: 'var(--warning, #b45309)' }}> · sem NF</span>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => marcar(p)} title="Marcar como lido"><Plus size={14} /></button>
          </div>
        ))}
        {!filtrados.length && !carregando && <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Nenhum.</div>}
      </div>

      {/* Baixas de hoje */}
      {hoje.length > 0 && (
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Baixas de hoje ({hojeOk.length})</div>
          {hoje.map(h => (
            <div key={h.id} style={{ fontSize: 12, display: 'flex', gap: 8, color: h.ok_bling ? 'var(--gray-700)' : 'var(--danger)' }}>
              <span style={{ width: 42, color: 'var(--gray-400)' }}>{new Date(h.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ flex: 1 }}>
                <b>{h.numero || h.bling_id}</b> {h.cliente}
                {h.ok_bling ? ` · Bling ✓${h.ok_shopify ? ' · Shopify ✓' : ''}` : ` · erro: ${h.erro}`}
              </span>
              <span style={{ color: 'var(--gray-400)' }}>{h.operador}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mesmo CEP em mais de um pedido */}
      {escolher && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEscolher(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">Qual destes pedidos?</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setEscolher(null)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Mais de um pedido vai para o mesmo endereço. Escolha pelo nome na etiqueta:</div>
              {escolher.map(p => (
                <button key={p.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => { marcar(p, 'CEP'); setEscolher(null) }}>
                  <b>{p.numero}</b>&nbsp;· {p.cliente}{lidos.includes(p.id) ? ' (já lido)' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
