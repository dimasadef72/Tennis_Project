export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge'] ?? ''

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }

    return res.status(403).send('Forbidden')
  }

  if (req.method === 'POST') {
    const body = req.body
    const value = body?.entry?.[0]?.changes?.[0]?.value
    const contact = value?.contacts?.[0]
    const message = value?.messages?.[0]

    if (message?.type === 'text') {
      console.log({
        phone: message.from,
        name: contact?.profile?.name ?? 'Customer',
        text: message.text?.body,
      })
    }

    return res.status(200).send('OK')
  }

  return res.status(405).send('Method Not Allowed')
}
