export default async function handler(req: Request) {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge') ?? ''

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 })
    }

    return new Response('Forbidden', { status: 403 })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const value = body.entry?.[0]?.changes?.[0]?.value
    const contact = value?.contacts?.[0]
    const message = value?.messages?.[0]

    if (message?.type === 'text') {
      console.log({
        phone: message.from,
        name: contact?.profile?.name ?? 'Customer',
        text: message.text?.body,
      })
    }

    return new Response('OK', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
