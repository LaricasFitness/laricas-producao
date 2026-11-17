import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { Bike, RefreshCw, ExternalLink, Check } from 'lucide-react'

// Expedição › 4. Baixa › Lalamove. Cada pacote lido que está numa rota Lalamove do planejamento
// (Logística › rotas, salvas em logistica_historico) mostra a rota dele e quantos pacotes dela já foram lidos.
// Com a rota lida: cotação em moto (paradas na ordem da rota) → o preço aparece → quem confirma cria a
// corrida (api/lalamove.mjs). O link de acompanhamento vai para a Shopify como rastreio na baixa.
// A corrida é cobrada na conta da Lalamove (em produção): nada é criado sem o clique de confirmação.

async function chamar(corpo) {
  const r = await fetch('/api/lalamove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || (r.status === 404 ? 'Função da Lalamove não encontrada (só funciona no site publicado).' : `Erro ${r.status}`))
  return j
}
const fmtValor = (v, m = 'BRL') => m === 'BRL' ? `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}` : `${m} ${v}`
const fmtKm = (v, u) => u === 'm' ? `${(Number(v) / 1000).toFixed(1).replace('.', ',')} km` : `${v} ${u}`
const usuarioAtual = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }

// parada da rota (Logística) → parada para a Lalamove (stop.id = nº do pedido no Bling; stop.numero = nº da rua)
const paradaDe = s => ({ numero: String(s.id), nome: s.nome, tel: s.tel, rua: s.rua, numero_end: s.numero, complemento: s.complemento,
  bairro: s.bairro, cidade: s.cidade, uf: s.uf, cep: s.cep })

export default function LalamoveRotas({ lidos }) {
  const [historicos, setHistoricos] = useState([])
  const [status, setStatus] = useState(null)        // { configurada, ambiente }
  const [corridas, setCorridas] = useState([])
  const [cotacoes, setCotacoes] = useState({})      // chave da rota → cotação
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.from('logistica_historico').select('id, datas, rotas, criado_em').order('criado_em', { ascending: false }).limit(8)
      .then(({ data }) => setHistoricos(data || []))
    chamar({ acao: 'status' }).then(setStatus).catch(() => setStatus({ configurada: false }))
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
    chamar({ acao: 'corridas', pedidos: todosNumeros }).then(j => setCorridas(j.corridas || [])).catch(e => setErro(e.message))
  }, [todosNumeros.join(','), status?.configurada])

  if (!rotas.length) return null

  const corridaDa = r => corridas.find(c => c.pedidos.some(n => r.stops.some(s => String(s.id) === n)) && !/CANCEL|REJECT|EXPIRE/i.test(c.status || ''))

  async function cotar(r) {
    const faltam = r.stops.filter(s => !numerosLidos.has(String(s.id)))
    if (faltam.length && !confirm(`Faltam ${faltam.length} pacote(s) desta rota: ${faltam.map(s => s.id).join(', ')}.\n\nCotar só com os pacotes lidos?`)) return
    const paradas = r.stops.filter(s => numerosLidos.has(String(s.id))).map(paradaDe)
    setErro(''); setOcupado(r.chave)
    try {
      const q = await chamar({ acao: 'cotar', paradas })
      setCotacoes(c => ({ ...c, [r.chave]: { ...q, paradas, em: Date.now() } }))
    } catch (e) { setErro(`Rota ${r.code}: ${e.message}`) }
    finally { setOcupado('') }
  }

  async function confirmar(r) {
    const q = cotacoes[r.chave]
    if (!q) return
    if (Date.now() - q.em > 4.5 * 60e3) { setErro('A cotação venceu (vale 5 minutos). Cote de novo.'); setCotacoes(c => ({ ...c, [r.chave]: null })); return }
    const prod = q.ambiente === 'producao'
    if (!confirm(`${prod ? 'Chamar' : '[TESTE] Chamar'} Lalamove (moto) para a Rota ${r.code} · ${r.label}?\n\n${q.paradas.length} parada(s) · ${fmtKm(q.distancia, q.unidade)} · ${fmtValor(q.preco, q.moeda)}${prod ? '\n\nO valor é cobrado na conta da Lalamove.' : '\n\nAmbiente de teste: não cobra.'}`)) return
    setErro(''); setOcupado(r.chave)
    try {
      const c = await chamar({ acao: 'pedir', cotacao: q.cotacao, stops: q.stops, paradas: q.paradas,
        rota: { code: r.code, label: r.label, historicoId: r.historicoId }, usuario: usuarioAtual() })
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
        const vagos = q?.precisao?.filter(p => p.precisao !== 'endereço') || []
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
                <button className="btn btn-ghost btn-sm" onClick={() => cotar(r)} disabled={!!ocupado || !status?.configurada}>
                  {ocupado === r.chave ? <RefreshCw size={13} className="spin" /> : <Bike size={13} />} Chamar Lalamove
                </button>
              )}
            </div>
            {q && !corrida && (
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                Moto · {q.paradas.length} parada(s) · {fmtKm(q.distancia, q.unidade)} · <b>{fmtValor(q.preco, q.moeda)}</b> (cotação vale 5 min)
                {vagos.length > 0 && <div style={{ color: 'var(--warning, #b45309)' }}>Localização aproximada (pelo {vagos.map(v => `${v.numero}: ${v.precisao}`).join(', ')}): confira no mapa da Lalamove.</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
