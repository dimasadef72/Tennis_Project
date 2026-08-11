import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { bookings, courts } from '../db/schema'
import { expireStalePendingBookings } from './booking'
import type { IntentDetectionResult } from './intent'

const OPERATING_HOURS = {
  open: '08:00',
  close: '22:00',
  slotMinutes: 60,
}

type Booking = {
  courtId: string
  startTime: string
  endTime: string
}

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
  if (!isWholeHour(normalizedStart) || normalizedStart < OPERATING_HOURS.open || normalizedStart >= OPERATING_HOURS.close) return false
  const end = addMinutes(normalizedStart, durationHours * 60)
  return end > normalizedStart && end <= OPERATING_HOURS.close
}

function slotOverlaps(start: string, end: string, booking: Booking) {
  return start < normalizeTime(booking.endTime) && end > normalizeTime(booking.startTime)
}

function courtNumber(name: string) {
  return Number(name.match(/\d+/)?.[0] ?? 0) || null
}

function operatingSlots(durationHours: number) {
  const slots = []
  const durationMinutes = durationHours * 60

  for (
    let start = OPERATING_HOURS.open, end = addMinutes(start, durationMinutes);
    end <= OPERATING_HOURS.close;
    start = addMinutes(start, OPERATING_HOURS.slotMinutes), end = addMinutes(start, durationMinutes)
  ) {
    slots.push({ start_time: start, end_time: end })
  }

  return slots
}

export async function getAvailabilityContext(intent: IntentDetectionResult) {
  await expireStalePendingBookings()
  const date = intent.date ?? todayInJakarta()
  const durationHours = intent.duration_hours ?? 1

  const activeCourts = await db
    .select({ id: courts.id, name: courts.name })
    .from(courts)
    .where(eq(courts.isActive, true))
    .orderBy(asc(courts.name))

  const activeBookings = await db
    .select({ courtId: bookings.courtId, startTime: bookings.startTime, endTime: bookings.endTime })
    .from(bookings)
    .where(and(eq(bookings.bookingDate, date), inArray(bookings.status, ['pending', 'confirmed'])))

  if (intent.start_time) {
    const startTime = intent.start_time
    if (!isValidBookingWindow(startTime, durationHours)) return { mode: 'invalid_time', allowed_minutes: '00' }
    const endTime = addMinutes(startTime, durationHours * 60)
    const availableCourts = activeCourts
      .filter((court) => !intent.court_number || courtNumber(court.name) === intent.court_number)
      .map((court) => ({
        court_number: courtNumber(court.name),
        court_name: court.name,
        status: activeBookings.some((booking) => booking.courtId === court.id && slotOverlaps(startTime, endTime, booking))
          ? 'booked'
          : 'available',
      }))

    return {
      mode: 'exact_slot',
      date,
      requested_slot: {
        date,
        start_time: startTime,
        end_time: endTime,
        duration_hours: durationHours,
      },
      courts: availableCourts,
    }
  }

  return {
    mode: 'daily_availability',
    date,
    duration_hours: durationHours,
    slots: operatingSlots(durationHours)
      .map((slot) => ({
        ...slot,
        available_courts: activeCourts
          .filter((court) => !activeBookings.some((booking) => booking.courtId === court.id && slotOverlaps(slot.start_time, slot.end_time, booking)))
          .map((court) => ({
            court_number: courtNumber(court.name),
            court_name: court.name,
          })),
      }))
      .filter((slot) => slot.available_courts.length > 0),
  }
}
