import { getReplyText } from '../lib/reply'

async function sendTelegramText(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    console.error('Missing TELEGRAM_BOT_TOKEN')
    return
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })

  if (!response.ok) {
    console.error('Telegram send failed', response.status, await response.text())
    return
  }

  console.log('Telegram send ok')
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed')
  }

  const message = req.body?.message
  const text = message?.text
  const chatId = message?.chat?.id

  console.log('Telegram webhook received', { hasMessage: Boolean(message), hasText: Boolean(text) })

  if (chatId && text) {
    const name = message.from?.first_name ?? 'Customer'
    await sendTelegramText(chatId, getReplyText(name, text))
  }

  return res.status(200).send('OK')
}
