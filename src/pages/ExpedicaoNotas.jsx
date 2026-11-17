import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, FileText, Send, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { chamarExpedicao } from '../lib/expedicao'

// Logística › Expedição › Notas do dia. Para os pedidos do picking (ou números digitados):
//   1. Conferir: a natureza que a regra pede (e o motivo) e a nota que já existe no Bling
//   2. Gerar rascunhos: nota PENDENTE no Bling para quem ainda não tem (o Bling escolhe a natureza)
//   3. A natureza da nota é comparada com a regra: só a que confere pode ser transmitida
//   4. Transmitir: envia à Sefaz as notas conferidas, depois do clique e da confirmação
// Natureza de escolha manual (consignação, loja sem regra, Shopify não encontrada) fica para o Bling.
// Regras: README › Emissão de NF e api/expedicao.mjs › regraNatureza.

const POR_CHAMADA = 10
const PENDENTE = [1, 4]          // pendente ou rejeitada: dá para transmitir
const FEITA = [5, 6, 7]          // autorizada, emitida DANFE, registrada
const DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const fmtDia = iso => { const d = new Date(iso + 'T12:00:00'); return `${DIA[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` }
const fmtValor = v => v == null ? '' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`
const cap = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : ''
const linkNota = id => `https://www.bling.com.br/notas.fiscais.php#edit/${id}`
const linkPedido = id => `https://www.bling.com.br/vendas.php#edit/${id}`
const numerosDoTexto = t => [...new Set(String(t || '').split(/[\s,;]+/).map(s => s.replace(/^#/, '')).filter(s => /^\d+$/.test(s)))]

// Em que pé está cada pedido
function estado(l) {
  if (l.erro && !l.pedido) return { cor: 'danger', texto: l.erro }
  if (l.nota && FEITA.includes(l.nota.situacao)) return { cor: 'ok', texto: `Nota ${l.nota.numero} ${l.nota.situacaoNome.toLowerCase()}` }
  if (l.nota && PENDENTE.includes(l.nota.situacao)) {
    if (l.regra.manual) return { cor: 'warning', texto: `Nota ${l.nota.numero} ${l.nota.situacaoNome.toLowerCase()}: natureza manual, transmita pelo Bling` }
    if (l.confere) return { cor: 'ok', texto: `Nota ${l.nota.numero} ${l.nota.situacaoNome.toLowerCase()}: natureza confere, pronta para transmitir` }
    return { cor: 'danger', texto: `Nota ${l.nota.numero} com "${l.nota.natureza}": não confere. Corrija no Bling e confira de novo` }
  }
  if (l.nota) return { cor: 'warning', texto: `Nota ${l.nota.numero} ${l.nota.situacaoNome.toLowerCase()}` }
  if (l.regra.manual) return { cor: 'warning', texto: 'Sem nota. Natureza manual: emita pelo Bling' }
  return { cor: 'neutro', texto: 'Sem nota' }
}

const COR = { ok: 'var(--success, #15803d)', danger: 'var(--danger)', warning: 'var(--warning, #b45309)', neutro: 'var(--gray-500)' }

export default function NotasDoDia() {
  const [aberto, setAberto] = useState(false)
  const [pickings, setPickings] = useState([])
  const [origem, setOrigem] = useState('')          // id do picking ou 'digitar'
  const [digitados, setDigitados] = useState('')
  const [linhas, setLinhas] = useState([])          // { numero, pedido, regra, nota, confere, erro, ocupado, msg }
  const [trabalho, setTrabalho] = useState(null)    // { texto, feitos, total }
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!aberto || pickings.length) return
    supabase.from('expedicao_pickings').select('id, data_producao, pedidos').order('data_producao', { ascending: false }).limit(10)
      .then(({ data }) => { setPickings(data || []); setOrigem(o => o || (data?.[0]?.id ?? 'digitar')) })
  }, [aberto])

  const picking = pickings.find(p => p.id === origem)
  const numeros = origem === 'digitar' ? numerosDoTexto(digitados) : (picking?.pedidos || []).map(p => String(p.numero))

  const atualizar = (numero, dados) => setLinhas(ls => ls.map(l => l.numero === numero ? { ...l, ...dados } : l))

  async function conferir(lista = numeros) {
    if (!lista.length) return
    setErro(''); setLinhas(lista.map(numero => ({ numero, ocupado: true })))
    setTrabalho({ texto: 'Conferindo', feitos: 0, total: lista.length })
    try {
      for (let i = 0; i < lista.length; i += POR_CHAMADA) {
        const { pedidos } = await chamarExpedicao('notas', { numeros: lista.slice(i, i + POR_CHAMADA) })
        for (const r of pedidos) atualizar(r.pedido?.numero || r.numero, { ...r, ocupado: false, msg: '' })
        setTrabalho(t => ({ ...t, feitos: Math.min(lista.length, i + POR_CHAMADA) }))
      }
    } catch (e) { setErro(e.message); setLinhas(ls => ls.map(l => ({ ...l, ocupado: false }))) }
    finally { setTrabalho(null) }
  }

  const paraGerar = linhas.filter(l => l.pedido && !l.nota && !l.regra?.manual)
  const paraTransmitir = linhas.filter(l => l.nota && PENDENTE.includes(l.nota.situacao) && l.confere && !l.regra?.manual)

  async function emSequencia(lista, texto, fazer) {
    setErro(''); setTrabalho({ texto, feitos: 0, total: lista.length })
    for (const [i, l] of lista.entries()) {
      atualizar(l.numero, { ocupado: true, msg: '' })
      try { atualizar(l.numero, { ...(await fazer(l)), ocupado: false }) }
      catch (e) { atualizar(l.numero, { ocupado: false, msg: e.message }); if (e.reconectar) { setErro(e.message); break } }
      setTrabalho(t => ({ ...t, feitos: i + 1 }))
    }
    setTrabalho(null)
  }

  const gerar = () => emSequencia(paraGerar, 'Gerando rascunhos', async l => {
    const r = await chamarExpedicao('rascunhoNF', { numero: l.numero })
    return { pedido: r.pedido, regra: r.regra, nota: r.nota, confere: r.confere, msg: '' }
  })

  function transmitir() {
    const n = paraTransmitir.length
    if (!confirm(`Transmitir ${n} nota${n > 1 ? 's' : ''} à Sefaz?\n\nSó vão as notas com a natureza conferida. Depois de autorizada, a nota só pode ser cancelada (até 24 h) pelo Bling.`)) return
    emSequencia(paraTransmitir, 'Transmitindo', async l => {
      const r = await chamarExpedicao('transmitirNF', { numero: l.numero })
      return { nota: r.nota, msg: FEITA.includes(r.nota.situacao) ? '' : `Situação agora: ${r.nota.situacaoNome}` }
    })
  }

  const ocupado = !!trabalho
  const contagem = linhas.reduce((c, l) => { if (l.pedido || l.erro) { const e = estado(l); c[e.cor] = (c[e.cor] || 0) + 1 } return c }, {})

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setAberto(a => !a)}>
        <FileText size={16} />
        <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>Notas do dia</div>
        {aberto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      {aberto && <>
        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
          Cada pedido vem com a natureza que a regra pede e o motivo. Gere os rascunhos, confira e só então transmita.
          Consignação e casos sem regra ficam para o Bling.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="form-input" style={{ width: 'auto' }} value={origem} onChange={e => { setOrigem(e.target.value); setLinhas([]) }} disabled={ocupado}>
            {pickings.map(p => <option key={p.id} value={p.id}>Picking de {fmtDia(p.data_producao)} ({(p.pedidos || []).length})</option>)}
            <option value="digitar">Digitar números</option>
          </select>
          {origem === 'digitar' && (
            <input className="form-input" style={{ flex: 1, minWidth: 180 }} value={digitados} onChange={e => setDigitados(e.target.value)}
              placeholder="Nº dos pedidos no Bling (ex.: 20859, 20860)" disabled={ocupado} />
          )}
          <button className="btn btn-ghost" onClick={() => conferir()} disabled={ocupado || !numeros.length}>
            <RefreshCw size={13} className={trabalho?.texto === 'Conferindo' ? 'spin' : ''} /> Conferir {numeros.length ? `(${numeros.length})` : ''}
          </button>
        </div>
        {erro && <div className="alert-banner danger">{erro}</div>}

        {linhas.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={gerar} disabled={ocupado || !paraGerar.length}>
              <FileText size={13} /> Gerar rascunhos ({paraGerar.length})
            </button>
            <button className="btn btn-primary btn-sm" onClick={transmitir} disabled={ocupado || !paraTransmitir.length}>
              <Send size={13} /> Transmitir conferidas ({paraTransmitir.length})
            </button>
            <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 'auto' }}>
              {trabalho ? `${trabalho.texto}… ${trabalho.feitos}/${trabalho.total}`
                : [contagem.ok && `${contagem.ok} ok`, contagem.danger && `${contagem.danger} com problema`, contagem.warning && `${contagem.warning} manuais`, contagem.neutro && `${contagem.neutro} sem nota`].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}

        {linhas.map(l => {
          const e = l.pedido || l.erro ? estado(l) : null
          return (
            <div key={l.numero} style={{ display: 'flex', gap: 10, padding: '7px 10px', borderBottom: '1px solid var(--gray-100)', fontSize: 13, opacity: l.ocupado ? 0.55 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <b>{l.numero}</b>
                  {l.pedido && <> · {l.pedido.cliente} <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>{l.pedido.loja} · {fmtValor(l.pedido.total)}</span></>}
                </div>
                {l.regra && (
                  <div style={{ fontSize: 11, color: 'var(--gray-600)' }}>
                    Natureza: <b>{l.regra.manual ? 'manual' : cap(l.regra.esperada) || 'venda (do cadastro do cliente)'}</b> · {l.regra.motivo}
                  </div>
                )}
                {e && <div style={{ fontSize: 12, color: COR[e.cor], fontWeight: 600 }}>{l.ocupado ? '…' : e.texto}</div>}
                {l.msg && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{l.msg}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', fontSize: 11 }}>
                {l.nota && <a href={linkNota(l.nota.id)} target="_blank" rel="noreferrer">Nota <ExternalLink size={10} /></a>}
                {l.pedido && <a href={linkPedido(l.pedido.id)} target="_blank" rel="noreferrer">Pedido <ExternalLink size={10} /></a>}
              </div>
            </div>
          )
        })}
      </>}
    </div>
  )
}
