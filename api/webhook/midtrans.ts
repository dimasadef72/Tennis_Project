import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { bookings } from '../db/schema'
import { isPaidMidtransStatus, isValidMidtransSignature } from '../lib/midtrans'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

  const body = req.body
  console.log('Midtrans webhook received', {
    order_id: body?.order_id,
    transaction_status: body?.transaction_status,
    fraud_status: body?.fraud_status,
  })

  if (!isValidMidtransSignature(body)) {
    console.error('Invalid Midtrans signature', { order_id: body?.order_id })
    return res.status(403).send('Forbidden')
  }

  if (isPaidMidtransStatus(body)) {
    await db
      .update(bookings)
      .set({
        status: 'confirmed',
        paymentStatus: 'paid',
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bookings.bookingCode, body.order_id))
  }

  return res.status(200).send('OK')
}
