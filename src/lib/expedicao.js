// Expedição: chamadas à função /api/expedicao e a regra que liga um código lido ao pedido.
//
// O que dá para ler em cada pacote (etiquetas geradas pelo Bling):
//   Correios  → código de barras do rastreio (AE157753677BR), o Data Matrix (contém o rastreio) e o do CEP
//   J&T       → código de barras do rastreio (888031058876120)
//   Lalamove  → só o código de barras do CEP do destinatário
// Também vale digitar o número do pedido no Bling (20842) ou o número na loja (7728724541724).

export async function chamarExpedicao(acao, corpo) {
  const r = corpo
    ? await fetch('/api/expedicao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, ...corpo }) })
    : await fetch(`/api/expedicao?acao=${acao}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(j.erro || (r.status === 404 ? 'Função da expedição não encontrada (só funciona no site publicado).' : `Erro ${r.status}`))
    e.reconectar = !!j.reconectar
    throw e
  }
  return j
}

const limpar = v => String(v || '').trim().toUpperCase().replace(/\s/g, '')

// Código lido → { tipo: 'ok', pedido, por } | { tipo: 'varios', pedidos } | { tipo: 'nada' }
export function acharPedido(codigo, pedidos) {
  const c = limpar(codigo)
  if (!c) return { tipo: 'nada' }

  // rastreio (igual, ou dentro do Data Matrix dos Correios)
  const porRastreio = pedidos.filter(p => (p.rastreios || []).some(r => r === c || (r.length >= 10 && c.includes(r))))
  if (porRastreio.length === 1) return { tipo: 'ok', pedido: porRastreio[0], por: 'rastreio' }
  if (porRastreio.length > 1) return { tipo: 'varios', pedidos: porRastreio }

  // número do pedido no Bling (#20842) ou na loja
  const num = c.replace(/^#/, '')
  if (/^\d+$/.test(num)) {
    const semZeros = num.replace(/^0+/, '')
    const p = pedidos.find(p => p.numero === semZeros) || pedidos.find(p => p.numeroLoja && p.numeroLoja === num)
    if (p) return { tipo: 'ok', pedido: p, por: 'número' }
  }

  // CEP do destinatário (código de barras da etiqueta da Lalamove e dos Correios)
  if (/^\d{5}-?\d{3}$/.test(num)) {
    const cep = num.replace('-', '')
    const ps = pedidos.filter(p => p.cep === cep)
    if (ps.length === 1) return { tipo: 'ok', pedido: ps[0], por: 'CEP' }
    if (ps.length > 1) return { tipo: 'varios', pedidos: ps }
  }
  return { tipo: 'nada' }
}

// "CORREIOS - SEDEX · AE157753677BR"
export const envioDoPedido = p => [p.transportadora || p.servico, (p.rastreios || []).join(', ')].filter(Boolean).join(' · ')

// Bipe curto: agudo = leu, médio = aviso (ex.: já atendido), grave = não achou
let audio
export function bipe(ok = true) {
  const aviso = ok === 'aviso'
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)()
    const o = audio.createOscillator(), g = audio.createGain()
    o.frequency.value = aviso ? 700 : ok ? 1250 : 330
    g.gain.value = 0.12
    o.connect(g); g.connect(audio.destination)
    o.start(); o.stop(audio.currentTime + (aviso ? 0.18 : ok ? 0.09 : 0.3))
  } catch { /* sem áudio */ }
  navigator.vibrate?.(aviso ? 150 : ok ? 60 : [80, 60, 80])
}
