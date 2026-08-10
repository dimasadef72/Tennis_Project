import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('BMTennis API')
})

app.get('/webhook/whatsapp', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(challenge ?? '')
  }

  return c.text('Forbidden', 403)
})

app.post('/webhook/whatsapp', async (c) => {
  const body = await c.req.json()
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

  return c.text('OK')
})

export default app
