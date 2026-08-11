import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { bookings, courts } from '../db/schema'
import type { IntentDetectionResult } from './intent'

const ACTIVE_STATUSES = ['pending', 'confirmed'] as const

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
  if (!params.intent.date) missing.push('tanggal')
  if (!params.intent.start_time) missing.push('jam mulai')
  if (!params.intent.duration_hours) missing.push('durasi')

  if (missing.length > 0) {
    return {
      status: 'needs_more_info',
      missing,
      example: 'booking lapangan 1 besok jam 19 2 jam',
    }
  }

  const date = params.intent.date ?? todayInJakarta()
  const startTime = params.intent.start_time
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
