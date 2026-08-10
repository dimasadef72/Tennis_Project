import { Hono } from 'hono'
import { registerAdminRoutes } from './admin'

const app = new Hono()

function legalPage(title: string, body: string) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - BMTennis</title>
  <style>
    body{font-family:Arial,sans-serif;line-height:1.6;max-width:840px;margin:40px auto;padding:0 20px;color:#17202a}
    h1{line-height:1.2} h2{margin-top:28px} a{color:#075e54}
  </style>
</head>
<body>${body}</body>
</html>`
}



app.get('/', (c) => c.text('BMTennis API'))

registerAdminRoutes(app)

app.get('/privacy-policy', (c) => c.html(legalPage('Privacy Policy', `
  <h1>Privacy Policy</h1>
  <p>Last updated: August 10, 2026</p>
  <p>BMTennis Assistant is a booking assistant for Babatan Mukti tennis court reservations.</p>

  <h2>Information We Collect</h2>
  <p>We may collect your name, WhatsApp identifier, phone number, booking requests, booking schedule, payment status, and conversation messages related to court reservations.</p>

  <h2>How We Use Information</h2>
  <p>We use this information to check court availability, create bookings, send booking confirmations, process payment status, provide receipts, prevent duplicate bookings, and support customer service.</p>

  <h2>Data Sharing</h2>
  <p>We do not sell user data. Data may be processed by service providers required to operate the system, including messaging platforms, hosting providers, databases, and payment gateways.</p>

  <h2>Data Retention</h2>
  <p>We keep booking and payment records as needed for operational, accounting, dispute, and legal purposes. Conversation data may be retained to support booking history and service quality.</p>

  <h2>User Requests</h2>
  <p>You may request access, correction, or deletion of your data by following the instructions on our <a href="/data-deletion">Data Deletion</a> page.</p>

  <h2>Contact</h2>
  <p>For privacy questions, contact the BMTennis administrator through the official booking channel.</p>
`)))

app.get('/terms', (c) => c.html(legalPage('Terms of Service', `
  <h1>Terms of Service</h1>
  <p>Last updated: August 10, 2026</p>
  <p>By using BMTennis Assistant, you agree to these terms.</p>

  <h2>Service</h2>
  <p>BMTennis Assistant helps users check tennis court availability, request bookings, receive payment instructions, and receive booking confirmations.</p>

  <h2>Bookings</h2>
  <p>A booking is confirmed only after payment is verified by the payment provider and the system marks the booking as confirmed. Pending bookings may expire if payment is not completed within the required time.</p>

  <h2>User Responsibility</h2>
  <p>You are responsible for providing accurate booking details and completing payment through the provided official payment channel.</p>

  <h2>Cancellation</h2>
  <p>Customer cancellation through the chatbot is not supported in the MVP. Confirmed bookings are considered final unless handled manually by the administrator.</p>

  <h2>Limitations</h2>
  <p>The service may be unavailable due to maintenance, third-party platform issues, payment gateway issues, or network problems.</p>

  <h2>Contact</h2>
  <p>For questions about these terms, contact the BMTennis administrator through the official booking channel.</p>
`)))

app.get('/data-deletion', (c) => c.html(legalPage('Data Deletion', `
  <h1>Data Deletion Instructions</h1>
  <p>Last updated: August 10, 2026</p>
  <p>You can request deletion of your personal data from BMTennis Assistant.</p>

  <h2>How to Request Deletion</h2>
  <p>Send a message to the official BMTennis booking channel with the text: <strong>Delete my data</strong>.</p>
  <p>Please include the WhatsApp account you used for booking so we can identify the correct records.</p>

  <h2>What May Be Deleted</h2>
  <p>We may delete or anonymize your name, messaging identifier, phone number, and conversation data where deletion is technically and legally possible.</p>

  <h2>What May Be Retained</h2>
  <p>Some booking, payment, receipt, audit, or legal records may be retained where required for accounting, dispute resolution, fraud prevention, or legal obligations.</p>

  <h2>Processing Time</h2>
  <p>Deletion requests are reviewed and processed within a reasonable time after verification.</p>
`)))


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
