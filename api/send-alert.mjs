// Vercel Function — envia e-mail via Resend (alertas do financeiro). Só para quem está logado no sistema.
// Variável de ambiente necessária: RESEND_API_KEY

import { exigirSessao } from './_sessao.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await exigirSessao(req, res))) return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY não configurada' })

  try {
    const { to, subject, html } = req.body || {}
    if (!to || !subject || !html) return res.status(400).json({ error: 'to, subject e html são obrigatórios' })

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Laricas Fitness <onboarding@resend.dev>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    })

    const data = await r.json()
    if (!r.ok) throw new Error(data.message || 'Erro no Resend')
    return res.status(200).json({ ok: true, id: data.id })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
