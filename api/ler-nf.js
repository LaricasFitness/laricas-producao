// Vercel Function — lê a foto (ou PDF) de uma nota fiscal de compra com o Claude
// e devolve os dados estruturados para conferência na tela de compras.
// Variável de ambiente necessária: ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk'

export const config = { maxDuration: 60 }

// Só o próprio sistema pode chamar (a chave de API é paga por uso)
const ORIGENS = [/^https:\/\/laricas-producao[\w-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/]

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

const numOuNulo = { anyOf: [{ type: 'number' }, { type: 'null' }] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legivel', 'problemas', 'fornecedor', 'cnpj_fornecedor', 'numero_nf', 'data_emissao', 'itens', 'totais'],
  properties: {
    legivel: { type: 'boolean' },
    problemas: { type: 'string' },
    fornecedor: { type: 'string' },
    cnpj_fornecedor: { type: 'string' },
    numero_nf: { type: 'string' },
    data_emissao: { type: 'string' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'descricao', 'unidade', 'quantidade', 'valor_unitario', 'valor_total', 'desconto', 'ipi'],
        properties: {
          codigo: { type: 'string' },
          descricao: { type: 'string' },
          unidade: { type: 'string' },
          quantidade: { type: 'number' },
          valor_unitario: { type: 'number' },
          valor_total: { type: 'number' },
          desconto: numOuNulo,
          ipi: numOuNulo,
        },
      },
    },
    totais: {
      type: 'object',
      additionalProperties: false,
      required: ['valor_produtos', 'frete', 'seguro', 'desconto', 'outras_despesas', 'ipi', 'icms_st', 'valor_total_nota'],
      properties: {
        valor_produtos: { type: 'number' },
        frete: { type: 'number' },
        seguro: { type: 'number' },
        desconto: { type: 'number' },
        outras_despesas: { type: 'number' },
        ipi: { type: 'number' },
        icms_st: { type: 'number' },
        valor_total_nota: { type: 'number' },
      },
    },
  },
}

const SISTEMA = `Você lê notas fiscais brasileiras de compra (DANFE de NF-e ou cupom) a partir de foto ou PDF, para lançamento de matéria-prima numa fábrica de doces.

Transcreva exatamente o que está impresso. A foto pode estar girada, inclinada ou com sombra.
- Números: a nota usa formato brasileiro (1.234,56). Devolva como número decimal com ponto (1234.56).
- data_emissao no formato AAAA-MM-DD. cnpj_fornecedor só com os dígitos do CNPJ do emitente.
- Itens: um por linha da tabela "Dados do produto/serviço", na ordem da nota. valor_total é a coluna VLR TOTAL do item (antes do desconto). desconto e ipi do item só se a nota mostrar a coluna desse valor por item; senão null.
- Totais: copie do quadro "Cálculo do imposto" (valor total dos produtos, frete, seguro, desconto, outras despesas acessórias, IPI, ICMS ST/substituição, valor total da nota). Campo ausente = 0.
- Nunca invente nem complete um valor que não consegue ler. Se algo estiver ilegível, cortado ou ambíguo, registre em "problemas" (em português, curto) e coloque legivel=false quando isso impedir conferir a nota.
- Se a imagem não for uma nota fiscal, legivel=false e explique em "problemas".`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' })

  const origem = req.headers.origin || ''
  if (origem && !ORIGENS.some(r => r.test(origem))) return res.status(403).json({ erro: 'Origem não autorizada' })

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada no Vercel' })

  const { media_type, data } = req.body || {}
  if (!TIPOS.includes(media_type) || typeof data !== 'string' || !data.length) {
    return res.status(400).json({ erro: 'Envie uma imagem (JPG, PNG, WEBP) ou PDF da nota' })
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
      messages: [{ role: 'user', content: [arquivo, { type: 'text', text: 'Extraia os dados desta nota fiscal.' }] }],
    })

    if (resposta.stop_reason === 'refusal') return res.status(422).json({ erro: 'A leitura foi recusada. Lance a nota manualmente.' })
    if (resposta.stop_reason === 'max_tokens') return res.status(422).json({ erro: 'Nota grande demais para ler de uma vez. Lance manualmente ou pelo XML.' })

    const texto = resposta.content.filter(b => b.type === 'text').map(b => b.text).join('')
    const nf = JSON.parse(texto)
    return res.status(200).json({ nf, uso: resposta.usage })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ erro: 'Muitas leituras seguidas. Tente de novo em um minuto.' })
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ erro: 'Chave da API inválida — confira ANTHROPIC_API_KEY no Vercel' })
    if (e instanceof Anthropic.BadRequestError) return res.status(400).json({ erro: 'Arquivo não aceito: ' + e.message })
    if (e instanceof Anthropic.APIError) return res.status(502).json({ erro: `Erro da API (${e.status}): ${e.message}` })
    return res.status(500).json({ erro: e.message || String(e) })
  }
}
