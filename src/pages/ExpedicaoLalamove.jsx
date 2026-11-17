import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { Bike, RefreshCw, ExternalLink, Check, CalendarClock, AlertTriangle } from 'lucide-react'

// Expedição › 4. Baixa › Lalamove. Cada pacote lido que está numa rota Lalamove do planejamento
// (Logística › rotas, salvas em logistica_historico) mostra a rota dele e quantos pacotes dela já foram lidos.
// "Chamar Lalamove": 1) confere cada parada (telefone, localização EXATA pelo número, endereço comercial);
// 2) endereço comercial → pergunta se deixa para amanhã (lembrete de manhã no topo da Expedição);
// 3) parada sem localização exata bloqueia a cotação: corrige o endereço ou deixa para amanhã;
// 4) cotação em moto → o preço aparece → quem confirma cria a corrida (api/lalamove.mjs).
// O link de acompanhamento vai para a Shopify como rastreio na baixa. Em produção a corrida é cobrada.

export async function chamarLalamove(corpo) {
  const r = await fetch('/api/lalamove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || (r.status === 404 ? 'Função da Lalamove não encontrada (só funciona no site publicado).' : `Erro ${r.status}`))
  return j
}
const fmtValor = (v, m = 'BRL') => m === 'BRL' ? `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}` : `${m} ${v}`
const fmtKm = (v, u) => u === 'm' ? `${(Number(v) / 1000).toFixed(1).replace('.', ',')} km` : `${v} ${u}`
const fmtDia = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''

// parada da rota (Logística) → parada para a Lalamove (stop.id = nº do pedido no Bling; stop.numero = nº da rua)
const paradaDe = s => ({ numero: String(s.id), nome: s.nome, tel: s.tel, rua: s.rua, numero_end: s.numero, complemento: s.complemento,
  bairro: s.bairro, cidade: s.cidade, uf: s.uf, cep: s.cep, cpfCnpj: s.cpfCnpj })

// Lembrete de manhã: pedidos deixados para hoje (topo da Expedição, para o Gabriel ver ao abrir o sistema)
export function LembretesAdiados() {
  const [lista, setLista] = useState([])
  useEffect(() => { chamarLalamove({ acao: 'lembretes' }).then(j => setLista(j.lembretes || [])).catch(() => {}) }, [])
  if (!lista.length) return null
  async function resolver(l) {
    await chamarLalamove({ acao: 'resolver', numero: l.pedido }).catch(() => {})
    setLista(ls => ls.filter(x => x.id !== l.id))
  }
  return (
    <div className="alert-banner warning" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontWeight: 800 }}><CalendarClock size={14} /> Pedidos deixados para hoje ({lista.length})</div>
      {lista.map(l => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ flex: 1 }}>
            <b>{l.pedido}</b>{l.cliente ? ` · ${l.cliente}` : ''}{l.motivo ? ` — ${l.motivo}` : ''}{l.rota ? ` (rota ${l.rota})` : ''}
            <span style={{ fontSize: 11, opacity: 0.8 }}> · adiado {fmtDia(String(l.criado_em).slice(0, 10))}{l.criado_por ? ` por ${l.criado_por}` : ''}</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => resolver(l)} title="Tirar o lembrete">Resolvido</button>
        </div>
      ))}
    </div>
  )
}

export default function LalamoveRotas({ lidos, tirarDaLeitura }) {
  const [historicos, setHistoricos] = useState([])
  const [status, setStatus] = useState(null)        // { configurada, ambiente }
  const [corridas, setCorridas] = useState([])
  const [cotacoes, setCotacoes] = useState({})      // chave da rota → cotação
  const [bloqueios, setBloqueios] = useState({})    // chave da rota → [{ numero, problema }]
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.from('logistica_historico').select('id, datas, rotas, criado_em').order('criado_em', { ascending: false }).limit(8)
      .then(({ data }) => setHistoricos(data || []))
    chamarLalamove({ acao: 'status' }).then(setStatus).catch(() => setStatus({ configurada: false }))
  }, [])

  // Rota de cada pedido: a do roteiro mais recente em que ele aparece
  const rotaDoPedido = useMemo(() => {
    const mapa = {}
    for (const h of historicos) for (const r of h.rotas || []) for (const s of r.stops || []) {
      const n = String(s.id)
      if (!mapa[n] && !s.excluir) mapa[n] = { chave: `${h.id}:${r.code}`, historicoId: h.id, code: r.code, label: r.label, stops: r.stops.filter(x => !x.excluir) }
    }
    return mapa
  }, [historicos])

  const numerosLidos = new Set(lidos.map(p => String(p.numero)))
  const rotas = useMemo(() => {
    const vistas = {}
    for (const n of numerosLidos) { const r = rotaDoPedido[n]; if (r) vistas[r.chave] = r }
    return Object.values(vistas).sort((a, b) => String(a.code).localeCompare(String(b.code)))
  }, [rotaDoPedido, lidos])

  const todosNumeros = rotas.flatMap(r => r.stops.map(s => String(s.id)))
  useEffect(() => {
    if (!todosNumeros.length || !status?.configurada) return
    chamarLalamove({ acao: 'corridas', pedidos: todosNumeros }).then(j => setCorridas(j.corridas || [])).catch(e => setErro(e.message))
  }, [todosNumeros.join(','), status?.configurada])

  if (!rotas.length) return null

  const corridaDa = r => corridas.find(c => c.pedidos.some(n => r.stops.some(s => String(s.id) === n)) && !/CANCEL|REJECT|EXPIRE/i.test(c.status || ''))

  // Deixar para amanhã: guarda o lembrete e tira o pacote da leitura de hoje
  async function deixarParaAmanha(r, s, motivo) {
    await chamarLalamove({ acao: 'adiar', numero: String(s.id), cliente: s.nome, motivo, rota: `${r.code} · ${r.label}` })
    tirarDaLeitura?.(String(s.id))
    setBloqueios(b => ({ ...b, [r.chave]: (b[r.chave] || []).filter(x => x.numero !== String(s.id)) }))
  }

  async function chamar(r) {
    const faltam = r.stops.filter(s => !numerosLidos.has(String(s.id)))
    if (faltam.length && !confirm(`Faltam ${faltam.length} pacote(s) desta rota: ${faltam.map(s => s.id).join(', ')}.\n\nChamar só com os pacotes lidos?`)) return
    let stops = r.stops.filter(s => numerosLidos.has(String(s.id)))
    setErro(''); setOcupado(r.chave); setBloqueios(b => ({ ...b, [r.chave]: [] }))
    try {
      // 1) confere as paradas
      const { paradas: v } = await chamarLalamove({ acao: 'verificar', paradas: stops.map(paradaDe) })
      // 2) endereço comercial: deixar para amanhã?
      for (const x of v.filter(x => x.comercial)) {
        const s = stops.find(s => String(s.id) === x.numero)
        if (confirm(`Pedido ${x.numero} · ${s?.nome || ''}\n${s?.rua || ''}, ${s?.numero || ''}${s?.complemento ? ' - ' + s.complemento : ''}\n\nParece ${x.comercial}.\n\nDeixar este pedido para amanhã?\n(OK = amanhã, com lembrete de manhã · Cancelar = entregar hoje)`)) {
          await deixarParaAmanha(r, s, x.comercial[0].toUpperCase() + x.comercial.slice(1))
          stops = stops.filter(t => String(t.id) !== x.numero)
        }
      }
      // 3) sem localização exata ou sem telefone: bloqueia a cotação
      const problemas = v.filter(x => x.problema && stops.some(s => String(s.id) === x.numero))
      if (problemas.length) { setBloqueios(b => ({ ...b, [r.chave]: problemas })); return }
      if (!stops.length) return
      // 4) cotação
      const q = await chamarLalamove({ acao: 'cotar', paradas: stops.map(paradaDe) })
      if (q.problemas?.length) { setBloqueios(b => ({ ...b, [r.chave]: q.problemas })); return }
      setCotacoes(c => ({ ...c, [r.chave]: { ...q, paradas: stops.map(paradaDe), em: Date.now() } }))
    } catch (e) { setErro(`Rota ${r.code}: ${e.message}`) }
    finally { setOcupado('') }
  }

  async function confirmar(r) {
    const q = cotacoes[r.chave]
    if (!q) return
    if (Date.now() - q.em > 4.5 * 60e3) { setErro('A cotação venceu (vale 5 minutos). Chame de novo.'); setCotacoes(c => ({ ...c, [r.chave]: null })); return }
    const prod = q.ambiente === 'producao'
    if (!confirm(`${prod ? 'Chamar' : '[TESTE] Chamar'} Lalamove (moto) para a Rota ${r.code} · ${r.label}?\n\n${q.paradas.length} parada(s): ${q.paradas.map(p => p.numero).join(', ')}\n${fmtKm(q.distancia, q.unidade)} · ${fmtValor(q.preco, q.moeda)}${prod ? '\n\nO valor é cobrado na conta da Lalamove.' : '\n\nAmbiente de teste: não cobra.'}`)) return
    setErro(''); setOcupado(r.chave)
    try {
      const c = await chamarLalamove({ acao: 'pedir', cotacao: q.cotacao, stops: q.stops, paradas: q.paradas,
        rota: { code: r.code, label: r.label, historicoId: r.historicoId } })
      if (c.aviso) setErro(c.aviso)
      setCorridas(cs => [{ ...c }, ...cs])
      setCotacoes(cs => ({ ...cs, [r.chave]: null }))
    } catch (e) { setErro(`Rota ${r.code}: ${e.message}`) }
    finally { setOcupado('') }
  }

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Bike size={16} />
        <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Lalamove: rotas dos pacotes lidos</div>
        {status?.ambiente === 'sandbox' && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning, #b45309)' }}>AMBIENTE DE TESTE</span>}
      </div>
      {status && !status.configurada && <div className="alert-banner warning">A Lalamove não está configurada no Vercel (LALAMOVE_API_KEY e LALAMOVE_API_SECRET).</div>}
      {erro && <div className="alert-banner danger">{erro}</div>}
      {rotas.map(r => {
        const lidosRota = r.stops.filter(s => numerosLidos.has(String(s.id)))
        const corrida = corridaDa(r)
        const q = cotacoes[r.chave]
        const bloq = bloqueios[r.chave] || []
        return (
          <div key={r.chave} style={{ padding: '8px 10px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <b>Rota {r.code} · {r.label}</b> — {lidosRota.length}/{r.stops.length} pacote{r.stops.length > 1 ? 's' : ''} lido{lidosRota.length === 1 ? '' : 's'}
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                  {r.stops.map(s => <span key={s.id} style={{ marginRight: 8, color: numerosLidos.has(String(s.id)) ? 'var(--success, #15803d)' : 'var(--gray-400)' }}>{numerosLidos.has(String(s.id)) ? '✓' : '○'} {s.id}</span>)}
                </div>
              </div>
              {corrida ? (
                <span style={{ fontSize: 12, color: 'var(--success, #15803d)', fontWeight: 700 }}>
                  <Check size={12} /> Corrida {corrida.order_id}{corrida.status ? ` · ${corrida.status}` : ''}
                  {corrida.share_link && <> · <a href={corrida.share_link} target="_blank" rel="noreferrer">acompanhar <ExternalLink size={10} /></a></>}
                </span>
              ) : q ? (
                <button className="btn btn-primary btn-sm" onClick={() => confirmar(r)} disabled={!!ocupado}>
                  {ocupado === r.chave ? <RefreshCw size={13} className="spin" /> : <Bike size={13} />} Confirmar {fmtValor(q.preco, q.moeda)}
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => chamar(r)} disabled={!!ocupado || !status?.configurada}>
                  {ocupado === r.chave ? <RefreshCw size={13} className="spin" /> : <Bike size={13} />} Chamar Lalamove
                </button>
              )}
            </div>
            {q && !corrida && (
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                Moto · {q.paradas.length} parada(s) · {fmtKm(q.distancia, q.unidade)} · <b>{fmtValor(q.preco, q.moeda)}</b> (cotação vale 5 min)
              </div>
            )}
            {bloq.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontWeight: 700 }}><AlertTriangle size={12} /> Não dá para chamar a Lalamove com estes pedidos:</div>
                {bloq.map(x => {
                  const s = r.stops.find(s => String(s.id) === x.numero)
                  return (
                    <div key={x.numero} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1 }}><b>{x.numero}</b> {s?.nome || ''}: {x.problema}. Corrija no Bling e gere a rota de novo, ou deixe para amanhã.</span>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => deixarParaAmanha(r, s, x.problema[0].toUpperCase() + x.problema.slice(1)).catch(e => setErro(e.message))}>
                        <CalendarClock size={11} /> Amanhã
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
