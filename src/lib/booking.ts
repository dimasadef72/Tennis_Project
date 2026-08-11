import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { db } from '../db/client'
import { bookings, courts } from '../db/schema'
import type { IntentDetectionResult } from './intent'
import { createMidtransPayment } from './midtrans'

const ACTIVE_STATUSES = ['pending', 'confirmed'] as const
const OPERATING_OPEN = '08:00'
const OPERATING_CLOSE = '22:00'

function bookingHoldMinutes() {
  return Number(process.env.BOOKING_HOLD_MINUTES ?? 5)
}

function paymentExpiryMinutes() {
  return Number(process.env.MIDTRANS_PAYMENT_EXPIRY_MINUTES ?? 10)
}

export async function expireStalePendingBookings() {
  const now = Date.now()
  const holdCutoff = new Date(now - bookingHoldMinutes() * 60_000)
  // Matches the payment link's own expiry.duration (midtrans.ts) — reliable even when the
  // customer never opens the link, since no Midtrans webhook fires for a transaction that was
  // never created. A late "paid" webhook (index.ts) can still confirm a booking expired here.
  const paymentCutoff = new Date(now - paymentExpiryMinutes() * 60_000)

  return db
    .update(bookings)
    .set({ status: 'expired', paymentStatus: 'expired', updatedAt: new Date() })
    .where(and(
      eq(bookings.status, 'pending'),
      eq(bookings.notes, 'Created from WhatsApp'),
      or(
        and(eq(bookings.paymentStatus, 'unpaid'), lt(bookings.createdAt, holdCutoff)),
        and(eq(bookings.paymentStatus, 'pending'), lt(bookings.paymentCreatedAt, paymentCutoff)),
      ),
    ))
    .returning({ bookingCode: bookings.bookingCode })
}

type BookingRow = typeof bookings.$inferSelect

function todayInJakarta() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number)
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutes))
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function normalizeTime(time: string) {
  return time.slice(0, 5)
}

function isWholeHour(time: string) {
  return normalizeTime(time).endsWith(':00')
}

function isValidBookingWindow(start: string, durationHours: number) {
  if (!Number.isInteger(durationHours) || durationHours <= 0) return false
  const normalizedStart = normalizeTime(start)
  if (!isWholeHour(normalizedStart) || normalizedStart < OPERATING_OPEN || normalizedStart >= OPERATING_CLOSE) return false
  const end = addMinutes(normalizedStart, durationHours * 60)
  return end > normalizedStart && end <= OPERATING_CLOSE
}

function overlaps(start: string, end: string, booking: BookingRow) {
  return start < normalizeTime(booking.endTime) && end > normalizeTime(booking.startTime)
}

function courtNumber(name: string) {
  return Number(name.match(/\d+/)?.[0] ?? 0) || null
}

function bookingCode(date: string) {
  const compactDate = date.replaceAll('-', '')
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `BMT-${compactDate}-${random}`
}

export async function createBookingFromWhatsApp(params: {
  intent: IntentDetectionResult
  customerName: string
  customerPhone: string
}) {
  const missing = []
  if (!params.intent.start_time) missing.push('jam mulai')
  if (!params.intent.duration_hours) missing.push('durasi')

  if (missing.length > 0) {
    return {
      status: 'needs_more_info',
      missing,
      example: 'booking lapangan 1 besok jam 19 2 jam',
    }
  }

  await expireStalePendingBookings()

  const date = params.intent.date ?? todayInJakarta()
  const startTime = params.intent.start_time
  if (!isValidBookingWindow(startTime, params.intent.duration_hours)) return { status: 'invalid_time', allowed_minutes: '00' }
  const endTime = addMinutes(startTime, params.intent.duration_hours * 60)

  const activeCourts = await db
    .select({ id: courts.id, name: courts.name })
    .from(courts)
    .where(eq(courts.isActive, true))
    .orderBy(asc(courts.name))

  const candidateCourts = activeCourts.filter((court) => !params.intent.court_number || courtNumber(court.name) === params.intent.court_number)

  if (candidateCourts.length === 0) {
    return { status: 'court_not_found', requested_court_number: params.intent.court_number }
  }

  const activeBookings = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.bookingDate, date), inArray(bookings.status, ACTIVE_STATUSES)))

  const selectedCourt = candidateCourts.find((court) => !activeBookings.some((booking) => booking.courtId === court.id && overlaps(startTime, endTime, booking)))

  if (!selectedCourt) {
    return {
      status: 'slot_unavailable',
      requested_slot: { date, start_time: startTime, end_time: endTime, duration_hours: params.intent.duration_hours },
    }
  }

  const code = bookingCode(date)
  const [booking] = await db
    .insert(bookings)
    .values({
      bookingCode: code,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      courtId: selectedCourt.id,
      bookingDate: date,
      startTime,
      endTime,
      status: 'pending',
      notes: 'Created from WhatsApp',
    })
    .returning({ id: bookings.id, bookingCode: bookings.bookingCode })

  return {
    status: 'created',
    booking: {
      id: booking.id,
      booking_code: booking.bookingCode,
      customer_name: params.customerName,
      customer_phone: params.customerPhone,
      court_name: selectedCourt.name,
      court_number: courtNumber(selectedCourt.name),
      booking_date: date,
      start_time: startTime,
      end_time: endTime,
      status: 'pending',
    },
  }
}


export async function preparePendingPayment(customerPhone: string) {
  if (!customerPhone) return { status: 'missing_customer_phone' }

  await expireStalePendingBookings()

  const [booking] = await db
    .select({
      id: bookings.id,
      bookingCode: bookings.bookingCode,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      bookingDate: bookings.bookingDate,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      status: bookings.status,
      paymentUrl: bookings.paymentUrl,
      courtName: courts.name,
    })
    .from(bookings)
    .innerJoin(courts, eq(bookings.courtId, courts.id))
    .where(and(eq(bookings.customerPhone, customerPhone), eq(bookings.status, 'pending')))
    .orderBy(desc(bookings.createdAt))
    .limit(1)

  if (!booking) return { status: 'no_pending_booking' }

  const hourlyRate = Number(process.env.BOOKING_HOURLY_RATE ?? 100000)
  const durationHours = hoursBetween(booking.startTime, booking.endTime)
  const amount = Math.round(hourlyRate * durationHours)
  let paymentUrl = booking.paymentUrl

  if (!paymentUrl) {
    const payment = await createMidtransPayment({
      orderId: booking.bookingCode,
      amount,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
    })
    paymentUrl = payment.payment_url

    const paymentCreatedAt = new Date()

    await db
      .update(bookings)
      .set({
        paymentStatus: 'pending',
        paymentReference: payment.order_id,
        paymentAmount: amount,
        paymentUrl,
        paymentCreatedAt,
        updatedAt: paymentCreatedAt,
      })
      .where(eq(bookings.id, booking.id))
  }

  return {
    status: 'payment_link_created',
    booking: {
      id: booking.id,
      booking_code: booking.bookingCode,
      court_name: booking.courtName,
      booking_date: booking.bookingDate,
      start_time: normalizeTime(booking.startTime),
      end_time: normalizeTime(booking.endTime),
      status: booking.status,
      amount,
      payment_url: paymentUrl,
      payment_link_expiry_minutes: Number(process.env.MIDTRANS_PAYMENT_EXPIRY_MINUTES ?? 10),
    },
  }
}

export async function getLatestBookingStatus(customerPhone: string) {
  if (!customerPhone) return { status: 'missing_customer_phone' }

  await expireStalePendingBookings()

  const [booking] = await db
    .select({
      bookingCode: bookings.bookingCode,
      bookingDate: bookings.bookingDate,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
      paymentAmount: bookings.paymentAmount,
      courtName: courts.name,
    })
    .from(bookings)
    .innerJoin(courts, eq(bookings.courtId, courts.id))
    .where(eq(bookings.customerPhone, customerPhone))
    .orderBy(desc(bookings.createdAt))
    .limit(1)

  if (!booking) return { status: 'not_found' }

  return {
    status: 'found',
    booking: {
      booking_code: booking.bookingCode,
      court_name: booking.courtName,
      booking_date: booking.bookingDate,
      start_time: normalizeTime(booking.startTime),
      end_time: normalizeTime(booking.endTime),
      status: booking.status,
      payment_status: booking.paymentStatus,
      amount: booking.paymentAmount,
    },
  }
}

export async function createBookingFromState(params: {
  state: any
  customerName: string
  customerPhone: string
}) {
  const payload = params.state?.payload ?? params.state
  return createBookingFromWhatsApp({
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    intent: {
      intent: 'request_booking',
      date: payload.date ?? null,
      start_time: payload.start_time ?? null,
      duration_hours: payload.duration_hours ?? null,
      court_number: payload.court_number ?? null,
      booking_code: null,
    },
  })
}

export async function latestPendingBooking(customerPhone: string) {
  await expireStalePendingBookings()

  const [booking] = await db
    .select({
      id: bookings.id,
      bookingCode: bookings.bookingCode,
      bookingDate: bookings.bookingDate,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      courtId: bookings.courtId,
      courtName: courts.name,
    })
    .from(bookings)
    .innerJoin(courts, eq(bookings.courtId, courts.id))
    .where(and(eq(bookings.customerPhone, customerPhone), eq(bookings.status, 'pending'), eq(bookings.notes, 'Created from WhatsApp')))
    .orderBy(desc(bookings.createdAt))
    .limit(1)

  return booking
}

export async function cancelPendingBooking(customerPhone: string) {
  if (!customerPhone) return { status: 'missing_customer_phone' }

  const pending = await latestPendingBooking(customerPhone)
  if (!pending) {
    const [latest] = await db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.customerPhone, customerPhone))
      .orderBy(desc(bookings.createdAt))
      .limit(1)

    return { status: latest?.status === 'confirmed' ? 'already_confirmed' : 'no_pending_booking' }
  }

  const [cancelled] = await db
    .update(bookings)
    .set({ status: 'cancelled', paymentStatus: 'cancelled', updatedAt: new Date() })
    .where(and(eq(bookings.id, pending.id), eq(bookings.status, 'pending')))
    .returning({ bookingCode: bookings.bookingCode })

  if (!cancelled) return { status: 'already_confirmed' }

  return {
    status: 'cancelled',
    booking: {
      booking_code: pending.bookingCode,
      court_name: pending.courtName,
      booking_date: pending.bookingDate,
      start_time: normalizeTime(pending.startTime),
      end_time: normalizeTime(pending.endTime),
    },
  }
}

function hoursBetween(start: string, end: string) {
  const [startHour, startMinute] = normalizeTime(start).split(':').map(Number)
  const [endHour, endMinute] = normalizeTime(end).split(':').map(Number)
  return ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60
}

export async function proposeRescheduleFromWhatsApp(params: {
  intent: IntentDetectionResult
  customerPhone: string
}) {
  const pending = await latestPendingBooking(params.customerPhone)
  if (!pending) return null

  const nextDate = params.intent.date ?? pending.bookingDate
  const nextStartTime = params.intent.start_time ?? normalizeTime(pending.startTime)
  const nextDurationHours = params.intent.duration_hours ?? hoursBetween(pending.startTime, pending.endTime)
  if (!isValidBookingWindow(nextStartTime, nextDurationHours)) return { status: 'invalid_time', allowed_minutes: '00' }
  const nextEndTime = addMinutes(nextStartTime, nextDurationHours * 60)
  const nextCourtNumber = params.intent.court_number ?? courtNumber(pending.courtName)

  if (
    nextDate === pending.bookingDate &&
    nextStartTime === normalizeTime(pending.startTime) &&
    nextEndTime === normalizeTime(pending.endTime) &&
    nextCourtNumber === courtNumber(pending.courtName)
  ) {
    return {
      status: 'no_booking_change',
      booking: {
        booking_code: pending.bookingCode,
        court_name: pending.courtName,
        booking_date: pending.bookingDate,
        start_time: normalizeTime(pending.startTime),
        end_time: normalizeTime(pending.endTime),
        status: 'pending',
      },
    }
  }

  const activeCourts = await db
    .select({ id: courts.id, name: courts.name })
    .from(courts)
    .where(eq(courts.isActive, true))
    .orderBy(asc(courts.name))

  const candidateCourts = activeCourts.filter((court) => !params.intent.court_number || courtNumber(court.name) === params.intent.court_number)
  if (candidateCourts.length === 0) return { status: 'court_not_found', requested_court_number: params.intent.court_number }

  const activeBookings = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.bookingDate, nextDate), inArray(bookings.status, ACTIVE_STATUSES)))

  const selectedCourt = candidateCourts.find(
    (court) => !activeBookings.some((booking) => booking.id !== pending.id && booking.courtId === court.id && overlaps(nextStartTime, nextEndTime, booking)),
  )

  if (!selectedCourt) {
    return {
      status: 'reschedule_unavailable',
      current_booking: {
        booking_code: pending.bookingCode,
        court_name: pending.courtName,
        booking_date: pending.bookingDate,
        start_time: normalizeTime(pending.startTime),
        end_time: normalizeTime(pending.endTime),
      },
      requested_booking: {
        court_name: params.intent.court_number ? `Lapangan ${params.intent.court_number}` : 'Lapangan tersedia',
        booking_date: nextDate,
        start_time: nextStartTime,
        end_time: nextEndTime,
      },
    }
  }

  return {
    status: 'awaiting_reschedule_confirmation',
    current_booking: {
      id: pending.id,
      booking_code: pending.bookingCode,
      court_id: pending.courtId,
      court_name: pending.courtName,
      booking_date: pending.bookingDate,
      start_time: normalizeTime(pending.startTime),
      end_time: normalizeTime(pending.endTime),
    },
    requested_booking: {
      court_id: selectedCourt.id,
      court_name: selectedCourt.name,
      booking_date: nextDate,
      start_time: nextStartTime,
      end_time: nextEndTime,
      duration_hours: nextDurationHours,
    },
  }
}

export async function applyRescheduleFromState(state: any) {
  const payload = state?.payload ?? state
  const current = payload.current_booking
  const requested = payload.requested_booking

  if (!current?.id || !requested?.court_id || !requested?.booking_date || !requested?.start_time || !requested?.end_time) {
    return { status: 'reschedule_unavailable' }
  }

  const activeBookings = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.bookingDate, requested.booking_date), inArray(bookings.status, ACTIVE_STATUSES)))

  const isBooked = activeBookings.some((booking) => booking.id !== current.id && booking.courtId === requested.court_id && overlaps(requested.start_time, requested.end_time, booking))
  if (isBooked) return { status: 'reschedule_unavailable', requested_booking: requested }

  const [updated] = await db
    .update(bookings)
    .set({
      courtId: requested.court_id,
      bookingDate: requested.booking_date,
      startTime: requested.start_time,
      endTime: requested.end_time,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, current.id))
    .returning({ bookingCode: bookings.bookingCode, status: bookings.status })

  return {
    status: 'rescheduled',
    booking: {
      booking_code: updated.bookingCode,
      court_name: requested.court_name,
      booking_date: requested.booking_date,
      start_time: requested.start_time,
      end_time: requested.end_time,
      status: updated.status,
    },
  }
}
