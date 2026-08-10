import type { IntentDetectionResult } from './intent'

const OPERATING_HOURS = {
  open: '08:00',
  close: '22:00',
  slotMinutes: 60,
}

type Court = {
  id: string
  name: string
}

type Booking = {
  court_id: string
  start_time: string
  end_time: string
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

function slotOverlaps(start: string, end: string, booking: Booking) {
  return start < normalizeTime(booking.end_time) && end > normalizeTime(booking.start_time)
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
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL')
    return { error: 'database_not_configured' }
  }

  const date = intent.date ?? todayInJakarta()
  const durationHours = intent.duration_hours ?? 1
  const sql = new Bun.SQL(databaseUrl)

  try {
    const courts = (await sql`
      select id, name
      from courts
      where is_active = true
      order by name
    `) as Court[]

    const bookings = (await sql`
      select court_id, start_time, end_time
      from bookings
      where booking_date = ${date}
        and status in ('pending', 'confirmed')
    `) as Booking[]

    if (intent.start_time) {
      const startTime = intent.start_time
      const endTime = addMinutes(startTime, durationHours * 60)
      const availableCourts = courts
        .filter((court) => !intent.court_number || courtNumber(court.name) === intent.court_number)
        .map((court) => ({
          court_number: courtNumber(court.name),
          court_name: court.name,
          status: bookings.some((booking) => booking.court_id === court.id && slotOverlaps(startTime, endTime, booking))
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
          available_courts: courts
            .filter((court) => !bookings.some((booking) => booking.court_id === court.id && slotOverlaps(slot.start_time, slot.end_time, booking)))
            .map((court) => ({
              court_number: courtNumber(court.name),
              court_name: court.name,
            })),
        }))
        .filter((slot) => slot.available_courts.length > 0),
    }
  } finally {
    await sql.close()
  }
}
