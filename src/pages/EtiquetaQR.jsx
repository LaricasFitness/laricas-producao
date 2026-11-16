import { useState, useEffect, useRef } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../supabase'
import { RefreshCw, Check, Trash2, X, Camera } from 'lucide-react'
import { CONSERVACOES, fmtDataHora, fmtValidade, numeroEtiqueta, numeroDoCodigo } from '../lib/etiquetas'

// Baixa de etiqueta pelo QR Code: leitor de câmera dentro do sistema (sem logar de novo)
// e a ficha da etiqueta com os botões Usada / Descartar.

const usuarioAtual = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }
const MOTIVOS = ['Vencida', 'Sobra sem uso', 'Estragada / contaminada', 'Caiu / acidente', 'Outro']

export async function darBaixa(e, status, motivo = null) {
  return supabase.from('etiquetas')
    .update({ status, motivo, baixa_em: new Date().toISOString(), baixa_por: usuarioAtual() || null })
    .eq('id', e.id).eq('status', 'ativa')
}

// Leitor: câmera traseira, procura um QR a cada quadro; ao achar, devolve o texto
export function LeitorQR({ onLido, onFechar }) {
  const video = useRef(null)
  const [erro, setErro] = useState('')
  const [digitado, setDigitado] = useState('')

  useEffect(() => {
    let stream, parar = false, raf
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    function quadro() {
      if (parar) return
      const v = video.current
      if (v && v.readyState >= 2 && v.videoWidth) {
        const esc = Math.min(1, 640 / v.videoWidth)   // reduz para ler mais rápido
        canvas.width = Math.round(v.videoWidth * esc); canvas.height = Math.round(v.videoHeight * esc)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        if (qr?.data && numeroDoCodigo(qr.data)) { parar = true; navigator.vibrate?.(80); onLido(qr.data); return }
      }
      raf = requestAnimationFrame(quadro)
    }
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => {
        stream = s
        if (parar) { s.getTracks().forEach(t => t.stop()); return }
        video.current.srcObject = s
        video.current.play().catch(() => {})
        raf = requestAnimationFrame(quadro)
      })
      .catch(e => setErro(e?.name === 'NotAllowedError'
        ? 'O navegador não deixou usar a câmera. Libere a câmera para este site nas permissões do navegador.'
        : 'Não consegui abrir a câmera neste aparelho. Digite o número da etiqueta abaixo.'))
    if (!navigator.mediaDevices) setErro('Este navegador não dá acesso à câmera. Digite o número da etiqueta abaixo.')
    return () => { parar = true; cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title"><Camera size={16} /> Ler QR da etiqueta</div>
          <button className="btn btn-ghost btn-sm" onClick={onFechar}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {erro ? <div className="alert-banner warning">{erro}</div> : (
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '1 / 1' }}>
              <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,.85)', borderRadius: 10 }} />
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Aponte para o QR Code da etiqueta. Ou digite o número:</div>
          <form style={{ display: 'flex', gap: 6 }} onSubmit={ev => { ev.preventDefault(); if (numeroDoCodigo(digitado)) onLido(digitado) }}>
            <input className="form-input" inputMode="numeric" placeholder="#000123" value={digitado} onChange={e => setDigitado(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-primary" type="submit" disabled={!numeroDoCodigo(digitado)}>Abrir</button>
          </form>
        </div>
      </div>
    </div>
  )
}

// Ficha da etiqueta lida, com a baixa
export function FichaEtiqueta({ codigo, onFechar, onBaixa, onLerOutra }) {
  const [e, setE] = useState(undefined)
  const [motivo, setMotivo] = useState('')
  const [outro, setOutro] = useState('')
  const [descartando, setDescartando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const numero = numeroDoCodigo(codigo)

  useEffect(() => {
    if (!numero) { setE(null); return }
    supabase.from('etiquetas').select('*').eq('numero', numero).maybeSingle()
      .then(({ data, error }) => { if (error) setErro(error.message); setE(data || null) })
  }, [numero])

  const vencida = e && new Date(e.validade) < new Date()
  useEffect(() => { if (vencida) setMotivo('Vencida') }, [vencida])

  async function baixar(status) {
    const m = status === 'descartada' ? (motivo === 'Outro' ? outro.trim() || 'Outro' : motivo) : null
    if (status === 'descartada' && !m) { setErro('Escolha o motivo do descarte.'); return }
    setSalvando(true); setErro('')
    const { data, error } = await darBaixa(e, status, m).select('*')
    setSalvando(false)
    if (error) { setErro(error.message); return }
    if (!data?.length) { setErro('Essa etiqueta já tinha baixa.'); return }
    setE(data[0]); onBaixa?.(data[0])
  }

  const c = e && CONSERVACOES[e.conservacao]
  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onFechar()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">Etiqueta {numero ? numeroEtiqueta(numero) : ''}</div>
          <button className="btn btn-ghost btn-sm" onClick={onFechar}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {e === undefined ? <RefreshCw size={14} className="spin" /> : !e ? (
            <div className="alert-banner danger">Etiqueta não encontrada{erro ? `: ${erro}` : '.'}</div>
          ) : (
            <>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>{e.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{c?.nome}{c?.faixa ? ` · ${c.faixa}` : ''}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Manipulação</div><b>{fmtDataHora(e.manipulado_em)}</b></div>
                <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Validade</div><b style={{ color: vencida ? 'var(--danger)' : undefined }}>{fmtValidade(e.validade)}</b></div>
                {e.responsavel && <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Responsável</div>{e.responsavel}</div>}
                {e.observacao && <div><div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Observação</div>{e.observacao}</div>}
              </div>
              {e.status !== 'ativa' ? (
                <div className={`alert-banner ${e.status === 'usada' ? 'ok' : 'warning'}`}>
                  {e.status === 'usada' ? 'Usada' : `Descartada${e.motivo ? ` (${e.motivo})` : ''}`} em {fmtDataHora(e.baixa_em)}{e.baixa_por ? ` por ${e.baixa_por}` : ''}.
                </div>
              ) : (
                <>
                  {vencida && <div className="alert-banner danger">Vencida. Não use: descarte.</div>}
                  {!descartando ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!vencida && <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => baixar('usada')} disabled={salvando}><Check size={14} /> Usada (acabou)</button>}
                      <button className="btn btn-ghost" style={{ flex: 1, color: 'var(--danger)' }} onClick={() => setDescartando(true)} disabled={salvando}><Trash2 size={14} /> Descartar</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Motivo do descarte</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {MOTIVOS.map(m => <button key={m} className={`btn btn-sm ${motivo === m ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMotivo(m)}>{m}</button>)}
                      </div>
                      {motivo === 'Outro' && <input className="form-input" placeholder="Qual?" value={outro} onChange={ev => setOutro(ev.target.value)} />}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" onClick={() => setDescartando(false)}>Voltar</button>
                        <button className="btn btn-primary" style={{ flex: 1, background: 'var(--danger)' }} onClick={() => baixar('descartada')} disabled={salvando || !motivo}>Confirmar descarte</button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {erro && <div className="alert-banner danger">{erro}</div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          {onLerOutra && <button className="btn btn-ghost" onClick={onLerOutra}><Camera size={14} /> Ler outra</button>}
          <button className="btn btn-ghost" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
