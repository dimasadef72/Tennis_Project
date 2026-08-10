import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Hono } from 'hono'
import { db } from '../api/db/client'
import { bookings, courts } from '../api/db/schema'

const HOURS = { open: '08:00', close: '22:00', slotMinutes: 60 }
const ACTIVE_STATUSES = ['pending', 'confirmed'] as const

type BookingRow = typeof bookings.$inferSelect
type CourtRow = { id: string; name: string }

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number)
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutes))
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function slots() {
  const result = []
  for (let start = HOURS.open, end = addMinutes(start, HOURS.slotMinutes); end <= HOURS.close; start = end, end = addMinutes(start, HOURS.slotMinutes)) {
    result.push({ start, end })
  }
  return result
}

function normalizeTime(time: string) {
  return time.slice(0, 5)
}

function overlaps(start: string, end: string, booking: BookingRow) {
  return start < normalizeTime(booking.endTime) && end > normalizeTime(booking.startTime)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function bookingCode() {
  const compactDate = today().replaceAll('-', '')
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `BMT-${compactDate}-${random}`
}

function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="BMTennis Admin"' },
  })
}

function checkAuth(authHeader: string | undefined) {
  const password = process.env.ADMIN_PASSWORD
  if (!password || !authHeader?.startsWith('Basic ')) return false

  try {
    const decoded = atob(authHeader.slice(6))
    return decoded.slice(decoded.indexOf(':') + 1) === password
  } catch {
    return false
  }
}

async function loadAdminData(date: string) {
  const [courtRows, bookingRows] = await Promise.all([
    db.select({ id: courts.id, name: courts.name }).from(courts).where(eq(courts.isActive, true)).orderBy(asc(courts.name)),
    db.select().from(bookings).where(eq(bookings.bookingDate, date)).orderBy(asc(bookings.startTime), asc(bookings.courtId)),
  ])

  return { courtRows, bookingRows }
}

function renderAdmin(params: {
  date: string
  courtRows: CourtRow[]
  bookingRows: BookingRow[]
  message?: string
  error?: string
}) {
  const slotRows = slots()
  const activeBookings = params.bookingRows.filter((booking) => ACTIVE_STATUSES.includes(booking.status as (typeof ACTIVE_STATUSES)[number]))
  const totalCells = slotRows.length * params.courtRows.length
  const bookedCells = slotRows.reduce(
    (sum, slot) => sum + params.courtRows.filter((court) => activeBookings.some((booking) => booking.courtId === court.id && overlaps(slot.start, slot.end, booking))).length,
    0,
  )
  const availableCells = totalCells - bookedCells

  const timeline = slotRows
    .map((slot) => {
      const cells = params.courtRows
        .map((court) => {
          const booking = activeBookings.find((item) => item.courtId === court.id && overlaps(slot.start, slot.end, item))
          if (!booking) return `<div class="slot available"><span>${escapeHtml(court.name)}</span><strong>Kosong</strong></div>`
          return `<div class="slot booked"><span>${escapeHtml(court.name)}</span><strong>${escapeHtml(booking.customerName)}</strong><small>${escapeHtml(booking.status)} · ${escapeHtml(booking.customerPhone)}</small></div>`
        })
        .join('')

      return `<section class="time-row"><div class="time">${slot.start}<span>${slot.end}</span></div><div class="slots">${cells}</div></section>`
    })
    .join('')

  const bookingList = params.bookingRows.length
    ? params.bookingRows
        .map(
          (booking) => `<tr>
<td>${escapeHtml(booking.bookingCode)}</td>
<td>${escapeHtml(booking.customerName)}<small>${escapeHtml(booking.customerPhone)}</small></td>
<td>${escapeHtml(params.courtRows.find((court) => court.id === booking.courtId)?.name ?? '-')}</td>
<td>${normalizeTime(booking.startTime)}-${normalizeTime(booking.endTime)}</td>
<td><span class="pill ${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></td>
<td>${escapeHtml(booking.notes ?? '')}</td>
</tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="empty">Belum ada booking di tanggal ini.</td></tr>'

  const courtOptions = params.courtRows.map((court) => `<option value="${court.id}">${escapeHtml(court.name)}</option>`).join('')

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BMTennis Admin</title>
<style>
:root{color-scheme:light;--bg:#f6f7f2;--panel:#fff;--ink:#19201d;--muted:#68736d;--line:#dfe5dd;--green:#116149;--green2:#e3f4ec;--red:#9d2f2f;--red2:#f8e3df;--shadow:0 16px 40px rgba(25,32,29,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1240px;margin:0 auto;padding:28px 20px 56px}.top{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;margin-bottom:22px}.brand h1{font-size:28px;line-height:1.1;margin:0 0 6px}.brand p{margin:0;color:var(--muted)}.datebar{display:flex;gap:8px;align-items:center}.datebar a,.datebar button{border:1px solid var(--line);background:var(--panel);color:var(--ink);height:40px;padding:0 14px;border-radius:8px;text-decoration:none;font-weight:650}.datebar input,.form input,.form select,.form textarea{height:40px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:#fff;color:var(--ink);font:inherit}.grid{display:grid;grid-template-columns:1.6fr .9fr;gap:18px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}.card{padding:16px}.card span{display:block;color:var(--muted);font-size:13px}.card strong{display:block;font-size:26px;margin-top:8px}.panel{overflow:hidden}.panel h2{font-size:16px;margin:0;padding:16px 18px;border-bottom:1px solid var(--line)}.timeline{padding:8px 12px 14px}.time-row{display:grid;grid-template-columns:78px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #edf0eb}.time-row:last-child{border-bottom:0}.time{font-weight:750}.time span{display:block;color:var(--muted);font-size:12px;font-weight:500}.slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.slot{min-height:58px;border-radius:8px;padding:10px;border:1px solid var(--line);display:flex;flex-direction:column;gap:2px}.slot span,.slot small{font-size:12px;color:var(--muted)}.slot strong{font-size:14px}.available{background:var(--green2);border-color:#b9ddcd}.available strong{color:var(--green)}.booked{background:var(--red2);border-color:#edc1bb}.booked strong{color:var(--red)}.side{display:flex;flex-direction:column;gap:18px}.form{padding:16px;display:grid;gap:11px}.form label{display:grid;gap:6px;color:var(--muted);font-size:13px}.form label span{font-weight:650}.form textarea{height:72px;padding-top:10px;resize:vertical}.form button{height:42px;border:0;border-radius:8px;background:var(--green);color:#fff;font-weight:750;font-size:15px}.notice,.error{margin-bottom:14px;padding:12px 14px;border-radius:8px}.notice{background:var(--green2);color:var(--green)}.error{background:var(--red2);color:var(--red)}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}td small{display:block;color:var(--muted);margin-top:2px}.pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#eef1ed;color:var(--muted);font-size:12px;font-weight:750}.pill.confirmed{background:var(--green2);color:var(--green)}.pill.pending{background:#fff1c7;color:#765600}.pill.cancelled,.pill.expired{background:var(--red2);color:var(--red)}.empty{text-align:center;color:var(--muted);padding:26px}@media(max-width:900px){.top,.datebar{align-items:stretch;flex-direction:column}.grid,.cards{grid-template-columns:1fr}.slots{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
  <div class="top"><div class="brand"><h1>BMTennis Admin</h1><p>Visualisasi jadwal, data booking, dan input booking manual.</p></div><form class="datebar" method="get" action="/admin"><a href="/admin?date=${dateOffset(params.date, -1)}">Sebelumnya</a><input type="date" name="date" value="${escapeHtml(params.date)}"><button type="submit">Lihat</button><a href="/admin?date=${dateOffset(params.date, 1)}">Berikutnya</a></form></div>
  ${params.message ? `<div class="notice">${escapeHtml(params.message)}</div>` : ''}
  ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ''}
  <div class="cards"><div class="card"><span>Tanggal</span><strong>${escapeHtml(params.date)}</strong></div><div class="card"><span>Lapangan Aktif</span><strong>${params.courtRows.length}</strong></div><div class="card"><span>Booking Aktif</span><strong>${activeBookings.length}</strong></div><div class="card"><span>Slot Kosong</span><strong>${availableCells}</strong></div></div>
  <div class="grid"><section class="panel"><h2>Timeline Harian</h2><div class="timeline">${timeline}</div></section><aside class="side"><section class="panel"><h2>Booking Manual</h2><form class="form" method="post" action="/admin/bookings"><input type="hidden" name="booking_date" value="${escapeHtml(params.date)}"><label><span>Nama Customer</span><input name="customer_name" required placeholder="Nama customer"></label><label><span>Nomor WhatsApp</span><input name="customer_phone" required placeholder="628xxxxxxxxxx"></label><label><span>Lapangan</span><select name="court_id" required>${courtOptions}</select></label><label><span>Jam Mulai</span><input type="time" name="start_time" required value="19:00"></label><label><span>Jam Selesai</span><input type="time" name="end_time" required value="20:00"></label><label><span>Status</span><select name="status"><option value="confirmed">confirmed</option><option value="pending">pending</option></select></label><label><span>Catatan</span><textarea name="notes" placeholder="Opsional"></textarea></label><button type="submit">Simpan Booking</button></form></section></aside></div>
  <section class="panel" style="margin-top:18px"><h2>Data Booking</h2><table><thead><tr><th>Kode</th><th>Customer</th><th>Lapangan</th><th>Jam</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${bookingList}</tbody></table></section>
</main>
</body>
</html>`
}

async function createManualBooking(form: Record<string, FormDataEntryValue>) {
  const bookingDate = String(form.booking_date || today())
  const courtId = String(form.court_id || '')
  const startTime = String(form.start_time || '')
  const endTime = String(form.end_time || '')
  const status = String(form.status || 'confirmed') as 'pending' | 'confirmed'

  if (!courtId || !startTime || !endTime || startTime >= endTime) throw new Error('Data booking belum lengkap atau jam tidak valid.')
  if (!String(form.customer_name || '').trim() || !String(form.customer_phone || '').trim()) throw new Error('Nama dan nomor WhatsApp wajib diisi.')

  const activeBookings = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.bookingDate, bookingDate), eq(bookings.courtId, courtId), inArray(bookings.status, ['pending', 'confirmed'])))

  if (activeBookings.some((booking) => overlaps(startTime, endTime, booking))) throw new Error('Slot ini sudah terisi. Pilih jam atau lapangan lain.')

  await db.insert(bookings).values({
    bookingCode: bookingCode(),
    customerName: String(form.customer_name).trim(),
    customerPhone: String(form.customer_phone).trim(),
    courtId,
    bookingDate,
    startTime,
    endTime,
    status,
    notes: String(form.notes || '').trim() || null,
  })
}

export function registerAdminRoutes(app: Hono) {
  const guard = async (c: any, next: any) => {
    if (!process.env.ADMIN_PASSWORD) return c.text('Set ADMIN_PASSWORD env before opening /admin.', 503)
    if (!checkAuth(c.req.header('authorization'))) return unauthorized()
    await next()
  }

  app.use('/admin', guard)
  app.use('/admin/*', guard)

  app.get('/admin', async (c) => {
    const date = c.req.query('date') || today()
    const data = await loadAdminData(date)
    return c.html(renderAdmin({ date, ...data, message: c.req.query('message'), error: c.req.query('error') }))
  })

  app.post('/admin/bookings', async (c) => {
    const form = await c.req.parseBody()
    const date = String(form.booking_date || today())

    try {
      await createManualBooking(form)
      return c.redirect(`/admin?date=${encodeURIComponent(date)}&message=${encodeURIComponent('Booking berhasil disimpan.')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Booking gagal disimpan.'
      return c.redirect(`/admin?date=${encodeURIComponent(date)}&error=${encodeURIComponent(message)}`)
    }
  })
}
