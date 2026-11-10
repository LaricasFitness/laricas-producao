// Vercel Function — lê o print (ou PDF) do faturamento mensal de uma plataforma de delivery
// (iFood, 99 Food, Keeta…) com o Claude e devolve os totais para o lançamento na DRE por competência.
// Variável de ambiente necessária: ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk'

export const config = { maxDuration: 60 }

// Só o próprio sistema pode chamar (a chave de API é paga por uso)
const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legivel', 'problemas', 'plataforma', 'unidade', 'mes', 'vendas', 'taxas', 'promocoes', 'servicos', 'ajustes', 'total_faturamento', 'linhas'],
  properties: {
    legivel: { type: 'boolean' },
    problemas: { type: 'string' },
    plataforma: { type: 'string' },
    unidade: { type: 'string' },
    mes: { type: 'string' },
    vendas: { type: 'number' },
    taxas: { type: 'number' },
    promocoes: { type: 'number' },
    servicos: { type: 'number' },
    ajustes: { type: 'number' },
    total_faturamento: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    linhas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['grupo', 'descricao', 'valor'],
        properties: {
          grupo: { type: 'string' },
          descricao: { type: 'string' },
          valor: { type: 'number' },
        },
      },
    },
  },
}

const SISTEMA = `Você lê o print (ou PDF) da tela de faturamento mensal de uma plataforma de delivery (iFood, 99 Food, Keeta, Anota.AI) de uma fábrica de doces, para lançar na DRE por competência.

No iFood (Financeiro › Faturamento) a tela tem: o nome da loja no canto superior esquerdo, o mês no seletor do topo ("Outubro de 2026") e grupos com uma linha "Total" cada: Valor das vendas, Taxas e comissões, Promoções, Serviços, Ajustes e Total do faturamento. Outras plataformas têm grupos parecidos; use o grupo equivalente.

Devolva:
- plataforma: "iFood", "99 Food", "Keeta", "Anota.AI" ou o nome que aparecer.
- unidade: o nome da loja exatamente como aparece (mesmo cortado com "...").
- mes: o mês do faturamento como AAAA-MM; "" se não aparecer.
- vendas: total do grupo Valor das vendas.
- taxas: total de Taxas e comissões. promocoes: total de Promoções. servicos: total de Serviços (entregas sob demanda e outros serviços contratados).
  Esses três em módulo (positivos), mesmo que a tela mostre "-R$".
- ajustes: total de Ajustes com sinal: positivo quando é a favor da loja (reembolsos), negativo quando é débito.
- total_faturamento: o Total do faturamento (soma de repasses e valores recebidos direto); null se não aparecer.
- linhas: cada linha detalhada visível, com o grupo a que pertence, a descrição (sem o número de pedidos) e o valor com o sinal da tela (cobranças negativas).
- Grupo que não aparece no print = 0. Grupo recolhido que só mostra o Total: use o Total.
- Números no formato brasileiro (1.234,56) viram decimal com ponto (1234.56).
- Nunca invente nem complete um valor que não consegue ler. Se algo estiver ilegível, cortado ou ambíguo, explique em "problemas" (português, curto) e use legivel=false quando isso impedir o lançamento.
- Se a imagem não for um faturamento de plataforma de delivery, legivel=false e explique em "problemas".`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })

  const origem = req.headers.origin || ''
  if (origem && !ORIGENS.some(r => r.test(origem))) return res.status(403).json({ erro: 'Origem não autorizada' })

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada no Vercel' })

  const { media_type, data } = req.body || {}
  if (!TIPOS.includes(media_type) || typeof data !== 'string' || !data.length) {
    return res.status(400).json({ erro: 'Envie uma imagem (JPG, PNG, WEBP) ou PDF do faturamento' })
  }

  const arquivo = media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type, data } }
    : { type: 'image', source: { type: 'base64', media_type, data } }

  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 })

  try {
    const resposta = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SISTEMA,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [arquivo, { type: 'text', text: 'Extraia o faturamento deste print.' }] }],
    })

    if (resposta.stop_reason === 'refusal') return res.status(422).json({ erro: 'A leitura foi recusada. Digite os valores manualmente.' })
    if (resposta.stop_reason === 'max_tokens') return res.status(422).json({ erro: 'Print grande demais para ler de uma vez. Digite os valores manualmente.' })

    const texto = resposta.content.filter(b => b.type === 'text').map(b => b.text).join('')
    return res.status(200).json({ faturamento: JSON.parse(texto), uso: resposta.usage })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ erro: 'Muitas leituras seguidas. Tente de novo em um minuto.' })
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ erro: 'Chave da API inválida — confira ANTHROPIC_API_KEY no Vercel' })
    if (e instanceof Anthropic.BadRequestError) return res.status(400).json({ erro: 'Arquivo não aceito: ' + e.message })
    if (e instanceof Anthropic.APIError) return res.status(502).json({ erro: `Erro da API (${e.status}): ${e.message}` })
    return res.status(500).json({ erro: e.message || String(e) })
  }
}
