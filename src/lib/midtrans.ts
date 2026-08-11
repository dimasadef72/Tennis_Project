import { createHash } from 'crypto'

const paymentLinkBaseUrl = process.env.MIDTRANS_IS_PRODUCTION === 'true'
  ? 'https://api.midtrans.com/v1'
  : 'https://api.sandbox.midtrans.com/v1'

function serverKey() {
  const key = process.env.MIDTRANS_SERVER_KEY
  if (!key) throw new Error('Missing MIDTRANS_SERVER_KEY')
  return key
}

function authHeader() {
  return `Basic ${Buffer.from(`${serverKey()}:`).toString('base64')}`
}

export async function createMidtransPayment(params: {
  orderId: string
  amount: number
  customerName: string
  customerPhone: string
}) {
  const response = await fetch(`${paymentLinkBaseUrl}/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: params.orderId,
        gross_amount: params.amount,
      },
      customer_required: false,
      usage_limit: 1,
      expiry: {
        duration: Number(process.env.MIDTRANS_PAYMENT_EXPIRY_MINUTES ?? 15),
        unit: 'minute',
      },
      enabled_payments: ['other_qris'],
      item_details: [
        {
          id: 'court-booking',
          price: params.amount,
          quantity: 1,
          name: 'Booking Lapangan Tenis Babatan Mukti',
        },
      ],
      customer_details: {
        first_name: params.customerName,
        phone: params.customerPhone,
      },
      title: 'Booking BMTennis',
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Midtrans create payment failed ${response.status}: ${JSON.stringify(body)}`)

  return {
    order_id: body.order_id as string,
    payment_url: body.payment_url as string,
  }
}

export function isValidMidtransSignature(payload: any) {
  const signature = payload?.signature_key
  const orderId = payload?.order_id
  const statusCode = payload?.status_code
  const grossAmount = payload?.gross_amount
  if (!signature || !orderId || !statusCode || !grossAmount) return false

  const expected = createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${serverKey()}`)
    .digest('hex')

  return expected === signature
}

export function isPaidMidtransStatus(payload: any) {
  return payload?.transaction_status === 'settlement' || (payload?.transaction_status === 'capture' && payload?.fraud_status === 'accept')
}


export function isExpiredMidtransStatus(payload: any) {
  return ['expire', 'cancel', 'deny', 'failure'].includes(payload?.transaction_status)
}
