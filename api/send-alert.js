// Vercel Edge Function — envia e-mail via Resend
// Variável de ambiente necessária: RESEND_API_KEY

export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const { to, subject, html } = body

    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'to, subject e html são obrigatórios' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const res = await fetch('https://api.resend.com/emails', {
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

    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Erro no Resend')

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
