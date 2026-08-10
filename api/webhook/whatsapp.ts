import { getReplyText } from '../lib/reply'

async function sendWhatsAppText(to: string, text: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    console.error('Missing WhatsApp env')
    return
  }

  const response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })

  if (!response.ok) {
    console.error('WhatsApp send failed', response.status, await response.text())
    return
  }

  console.log('WhatsApp send ok', await response.text())
}

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

    console.log('WhatsApp webhook received', {
      hasMessage: Boolean(message),
      messageType: message?.type,
      hasStatus: Boolean(value?.statuses?.[0]),
    })

    if (message?.type === 'text') {
      const name = contact?.profile?.name ?? 'Customer'

      console.log({
        phone: message.from,
        name,
        text: message.text?.body,
      })

      await sendWhatsAppText(message.from, await getReplyText(name, message.text?.body ?? ''))
    }

    return res.status(200).send('OK')
  }

  return res.status(405).send('Method Not Allowed')
}
