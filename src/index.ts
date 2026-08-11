import { and, eq, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from './db/client'
import { bookings, courts, whitelistedNumbers } from './db/schema'
import { isExpiredMidtransStatus, isPaidMidtransStatus, isValidMidtransSignature } from './lib/midtrans'
import { getReplyText } from './lib/reply'
import { buildReceiptPdf } from './lib/receipt'
import { registerAdminRoutes } from './admin'

const app = new Hono()




function publicBaseUrl(url: string) {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

async function loadReceiptData(bookingCode: string) {
  const [booking] = await db
    .select({
      bookingCode: bookings.bookingCode,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      courtName: courts.name,
      bookingDate: bookings.bookingDate,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      paidAt: bookings.paidAt,
      paymentAmount: bookings.paymentAmount,
    })
    .from(bookings)
    .innerJoin(courts, eq(bookings.courtId, courts.id))
    .where(eq(bookings.bookingCode, bookingCode))
    .limit(1)

  if (!booking) return null

  return {
    ...booking,
    startTime: booking.startTime.slice(0, 5),
    endTime: booking.endTime.slice(0, 5),
    amount: booking.paymentAmount ? `Rp${new Intl.NumberFormat('id-ID').format(booking.paymentAmount)}` : '-',
    paidAt: booking.paidAt?.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) ?? '-',
  }
}

async function sendWhatsAppDocument(to: string, link: string, filename: string, caption: string) {
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
      type: 'document',
      document: { link, filename, caption },
    }),
  })

  if (!response.ok) {
    console.error('WhatsApp document send failed', response.status, await response.text())
    return
  }

  console.log('WhatsApp document send ok', await response.text())
}

async function isAllowedWhatsAppNumber(phone: string) {
  const rows = await db
    .select({ phone: whitelistedNumbers.phone })
    .from(whitelistedNumbers)
    .where(eq(whitelistedNumbers.isActive, true))

  if (rows.length === 0) return true
  return rows.some((row) => row.phone === phone)
}

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




app.get('/receipts/:bookingCode', async (c) => {
  const receipt = await loadReceiptData(c.req.param('bookingCode'))
  if (!receipt) return c.text('Receipt not found', 404)
  return buildReceiptPdf(receipt)
})

app.post('/webhook/midtrans', async (c) => {
  const body = await c.req.json()
  console.log('Midtrans webhook received', {
    order_id: body?.order_id,
    transaction_status: body?.transaction_status,
    fraud_status: body?.fraud_status,
  })

  if (!body?.order_id && !body?.signature_key) return c.text('OK')

  if (!isValidMidtransSignature(body)) {
    console.error('Invalid Midtrans signature', { order_id: body?.order_id })
    return c.text('Forbidden', 403)
  }

  const bookingCode = body?.custom_field1
  const paymentLinkId = body?.metadata?.extra_info?.payment_link_id
  const bookingPaymentMatch = or(
    eq(bookings.bookingCode, body.order_id),
    eq(bookings.paymentReference, body.order_id),
    ...(bookingCode ? [eq(bookings.bookingCode, bookingCode)] : []),
    ...(paymentLinkId
      ? [
          eq(bookings.paymentUrl, 'https://app.sandbox.midtrans.com/payment-links/' + paymentLinkId),
          eq(bookings.paymentUrl, 'https://app.midtrans.com/payment-links/' + paymentLinkId),
        ]
      : []),
  )

  if (isPaidMidtransStatus(body)) {
    const updated = await db
      .update(bookings)
      .set({
        status: 'confirmed',
        paymentStatus: 'paid',
        paidAt: new Date(),
        paymentReference: body.order_id,
        updatedAt: new Date(),
      })
      .where(and(bookingPaymentMatch, eq(bookings.paymentStatus, 'pending')))
      .returning({ bookingCode: bookings.bookingCode, customerPhone: bookings.customerPhone, status: bookings.status, paymentStatus: bookings.paymentStatus })

    console.log('Midtrans paid update', { order_id: body.order_id, updated })

    if (updated[0]) {
      const receiptUrl = `${publicBaseUrl(c.req.url)}/receipts/${encodeURIComponent(updated[0].bookingCode)}`
      await sendWhatsAppDocument(
        updated[0].customerPhone,
        receiptUrl,
        `receipt-${updated[0].bookingCode}.pdf`,
        `Pembayaran booking ${updated[0].bookingCode} sudah diterima. Berikut bukti pembayaran Anda.`,
      )
    }
  }

  if (isExpiredMidtransStatus(body)) {
    const updated = await db
      .update(bookings)
      .set({
        status: 'expired',
        paymentStatus: 'expired',
        paymentReference: body.order_id,
        updatedAt: new Date(),
      })
      .where(and(bookingPaymentMatch, eq(bookings.paymentStatus, 'pending')))
      .returning({ bookingCode: bookings.bookingCode, status: bookings.status, paymentStatus: bookings.paymentStatus })

    console.log('Midtrans expired update', { order_id: body.order_id, updated })
  }

  return c.text('OK')
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

    if (!(await isAllowedWhatsAppNumber(message.from))) {
      console.log('WhatsApp ignored non-whitelisted number', { phone: message.from })
      return c.text('OK')
    }

    await sendWhatsAppText(message.from, await getReplyText(name, message.text?.body ?? '', message.from))
  }

  return c.text('OK')
})


export default app
