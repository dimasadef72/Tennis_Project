import { createHmac } from 'crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { db } from './db/client'
import { bookings, courts, whitelistedNumbers } from './db/schema'
import { expireStalePendingBookings } from './lib/booking'

const SESSION_COOKIE = 'bmtennis_admin_session'

const HOURS = { open: '08:00', close: '22:00', slotMinutes: 60 }
const ACTIVE_STATUSES = ['pending', 'confirmed'] as const

type BookingRow = typeof bookings.$inferSelect
type CourtRow = { id: string; name: string }
type WhitelistRow = typeof whitelistedNumbers.$inferSelect

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

function formatRupiah(amount: number) {
  return `Rp${new Intl.NumberFormat('id-ID').format(amount)}`
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

function sessionToken() {
  return createHmac('sha256', process.env.ADMIN_PASSWORD ?? '').update(SESSION_COOKIE).digest('hex')
}

function checkCredentials(username: string, password: string) {
  return username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD
}

function renderLogin(error?: string) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Masuk - BMTennis Admin</title>
<style>
:root{color-scheme:light;--bg:#f4f5f0;--ink:#111816;--muted:#6a746f;--line:#e2e6df;--accent:#0f6b4f;--accent2:#e9f6ef;--danger:#a13b35;--danger2:#fff0ed;--shadow:0 18px 50px rgba(18,28,24,.07)}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 20% 0%,#fff 0,#f7f8f4 34%,var(--bg) 100%);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.card{width:100%;max-width:360px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:32px 28px}
.card h1{font-size:22px;margin:0 0 4px;font-weight:780}
.card p{margin:0 0 22px;color:var(--muted);font-size:14px}
.card label{display:grid;gap:7px;color:var(--muted);font-size:13px;margin-bottom:14px}
.card label span{font-weight:700;color:#3d4843}
.card input{height:44px;border:1px solid var(--line);border-radius:7px;padding:0 12px;background:#fff;color:var(--ink);font:inherit;outline:none;width:100%}
.card input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(15,107,79,.12)}
.card button{width:100%;height:46px;border:0;border-radius:7px;background:linear-gradient(135deg,#0f6b4f,#0b513d);color:#fff;font-weight:780;font-size:15px;box-shadow:0 12px 22px rgba(15,107,79,.2);margin-top:6px;cursor:pointer}
.error{background:var(--danger2);color:var(--danger);border:1px solid #f0c7c1;border-radius:7px;padding:11px 13px;font-size:13px;margin-bottom:18px}
</style>
</head>
<body>
<form class="card" method="post" action="/admin/login">
  <h1>BMTennis Admin</h1>
  <p>Masuk untuk mengelola jadwal dan booking.</p>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <label><span>Username</span><input name="username" required autofocus autocomplete="username"></label>
  <label><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
  <button type="submit">Masuk</button>
</form>
</body>
</html>`
}

async function loadAdminData(date: string) {
  const [courtRows, bookingRows, whitelistRows] = await Promise.all([
    db.select({ id: courts.id, name: courts.name }).from(courts).where(eq(courts.isActive, true)).orderBy(asc(courts.name)),
    db.select().from(bookings).where(eq(bookings.bookingDate, date)).orderBy(asc(bookings.startTime), asc(bookings.courtId)),
    db.select().from(whitelistedNumbers).orderBy(asc(whitelistedNumbers.createdAt)),
  ])

  return { courtRows, bookingRows, whitelistRows }
}

function renderAdmin(params: {
  date: string
  courtRows: CourtRow[]
  bookingRows: BookingRow[]
  whitelistRows: WhitelistRow[]
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
  const revenueToday = params.bookingRows
    .filter((booking) => booking.status === 'confirmed')
    .reduce((sum, booking) => sum + (booking.paymentAmount ?? 0), 0)

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
        .map((booking) => {
          const canCancel = booking.status === 'pending' || booking.status === 'confirmed'
          const payment = booking.paymentAmount
            ? booking.status === 'confirmed'
              ? `<a href="/receipts/${encodeURIComponent(booking.bookingCode)}" target="_blank" rel="noopener">${formatRupiah(booking.paymentAmount)}</a>`
              : formatRupiah(booking.paymentAmount)
            : '-'
          const action = canCancel
            ? `<form method="post" action="/admin/bookings/cancel"><input type="hidden" name="id" value="${escapeHtml(booking.id)}"><input type="hidden" name="booking_date" value="${escapeHtml(booking.bookingDate)}"><button class="small-button" type="submit">Batalkan</button></form>`
            : ''

          return `<tr data-search="${escapeHtml(`${booking.bookingCode} ${booking.customerName} ${booking.customerPhone}`.toLowerCase())}">
<td>${escapeHtml(booking.bookingCode)}</td>
<td>${escapeHtml(booking.customerName)}<small>${escapeHtml(booking.customerPhone)}</small></td>
<td>${escapeHtml(params.courtRows.find((court) => court.id === booking.courtId)?.name ?? '-')}</td>
<td>${normalizeTime(booking.startTime)}-${normalizeTime(booking.endTime)}</td>
<td><span class="pill ${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></td>
<td>${payment}</td>
<td>${escapeHtml(booking.notes ?? '')}</td>
<td>${action}</td>
</tr>`
        })
        .join('')
    : '<tr><td colspan="8" class="empty">Belum ada booking di tanggal ini.</td></tr>'

  const courtOptions = params.courtRows.map((court) => `<option value="${court.id}">${escapeHtml(court.name)}</option>`).join('')

  const whitelistList = params.whitelistRows.length
    ? params.whitelistRows
        .map(
          (row) => `<tr><td>${escapeHtml(row.phone)}</td><td><form method="post" action="/admin/whitelist/delete"><input type="hidden" name="phone" value="${escapeHtml(row.phone)}"><button class="small-button" type="submit">Hapus</button></form></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="2" class="empty">Whitelist kosong. Semua nomor masih boleh memakai bot.</td></tr>'

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BMTennis Admin</title>
<style>
:root{color-scheme:light;--bg:#f4f5f0;--panel:#ffffff;--ink:#111816;--muted:#6a746f;--line:#e2e6df;--line2:#eef1eb;--accent:#0f6b4f;--accent2:#e9f6ef;--danger:#a13b35;--danger2:#fff0ed;--warn:#8a6500;--warn2:#fff6d9;--shadow:0 18px 50px rgba(18,28,24,.07)}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0%,#fff 0,#f7f8f4 34%,var(--bg) 100%);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}main{max-width:1320px;margin:0 auto;padding:34px 22px 64px}.top{display:flex;gap:18px;align-items:flex-end;justify-content:space-between;margin-bottom:24px}.brand h1{font-size:30px;line-height:1.05;margin:0 0 8px;font-weight:780}.brand p{margin:0;color:var(--muted);font-size:15px}.datebar{display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.75);border:1px solid var(--line);padding:8px;border-radius:8px;box-shadow:0 8px 24px rgba(18,28,24,.04)}.datebar a,.datebar button{border:1px solid transparent;background:#fff;color:var(--ink);height:40px;padding:0 16px;border-radius:7px;text-decoration:none;font-weight:680;box-shadow:0 1px 0 rgba(18,28,24,.05)}.datebar button{background:var(--ink);color:#fff}.datebar input,.form input,.form select,.form textarea{height:42px;border:1px solid var(--line);border-radius:7px;padding:0 12px;background:#fff;color:var(--ink);font:inherit;outline:none}.datebar input:focus,.form input:focus,.form select:focus,.form textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(15,107,79,.12)}.grid{display:grid;grid-template-columns:minmax(0,1.65fr) 420px;gap:20px}.cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin-bottom:20px}.card,.panel{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}.card{padding:18px 20px}.card span{display:block;color:var(--muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.card strong{display:block;font-size:28px;line-height:1;margin-top:12px}.panel{overflow:hidden}.panel h2{font-size:15px;margin:0;padding:17px 20px;border-bottom:1px solid var(--line2);font-weight:760}.timeline{padding:10px 14px 16px}.time-row{display:grid;grid-template-columns:86px 1fr;gap:14px;padding:10px 0;border-bottom:1px solid var(--line2)}.time-row:last-child{border-bottom:0}.time{font-weight:780;font-size:16px;padding-top:10px}.time span{display:block;color:var(--muted);font-size:12px;font-weight:540;margin-top:2px}.slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.slot{min-height:64px;border-radius:8px;padding:12px 14px;border:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;gap:3px}.slot span,.slot small{font-size:12px;color:var(--muted)}.slot strong{font-size:15px}.available{background:linear-gradient(180deg,#f4fff9 0%,var(--accent2) 100%);border-color:#cbe8da}.available strong{color:var(--accent)}.booked{background:linear-gradient(180deg,#fff8f6 0%,var(--danger2) 100%);border-color:#f0c7c1}.booked strong{color:var(--danger)}.side{display:flex;flex-direction:column;gap:20px}.booking-panel{position:sticky;top:18px}.booking-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.court-mark{width:54px;height:30px;border:1px solid #cfe4d8;border-radius:6px;background:linear-gradient(90deg,transparent 49%,#cfe4d8 49%,#cfe4d8 51%,transparent 51%),linear-gradient(0deg,transparent 49%,#cfe4d8 49%,#cfe4d8 51%,transparent 51%),#f5fff9}.form{padding:18px 20px 20px;display:grid;gap:14px}.form-intro{margin:0 0 2px;color:var(--muted);font-size:13px;line-height:1.45}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.form label{display:grid;gap:7px;color:var(--muted);font-size:13px}.form label span{font-weight:700;color:#3d4843}.form textarea{height:76px;padding-top:10px;resize:vertical}.form button{height:46px;border:0;border-radius:7px;background:linear-gradient(135deg,#0f6b4f,#0b513d);color:#fff;font-weight:780;font-size:15px;box-shadow:0 12px 22px rgba(15,107,79,.2)}.small-button{height:32px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--danger);font-weight:760;padding:0 10px}.form-feedback{padding:12px 13px;border-radius:7px;border:1px solid;font-size:13px;line-height:1.45}.form-feedback.notice{background:var(--accent2);color:var(--accent);border-color:#cbe8da}.form-feedback.error{background:var(--danger2);color:var(--danger);border-color:#f0c7c1}table{width:100%;border-collapse:collapse;font-size:14px;background:#fff}th,td{text-align:left;padding:13px 14px;border-bottom:1px solid var(--line2);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em;background:#fbfcf9}td small{display:block;color:var(--muted);margin-top:3px}.pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:#eef1ed;color:var(--muted);font-size:12px;font-weight:780}.pill.confirmed{background:var(--accent2);color:var(--accent)}.pill.pending{background:var(--warn2);color:var(--warn)}.pill.expired{background:var(--danger2);color:var(--danger)}.pill.cancelled{background:var(--line2);color:var(--muted)}.empty{text-align:center;color:var(--muted);padding:28px}.table-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line2)}.table-toolbar input{width:260px}.card.revenue strong{color:var(--accent)}td form{margin:0}tr.is-hidden{display:none}@media(max-width:980px){.top,.datebar{align-items:stretch;flex-direction:column}.grid,.cards,.field-row{grid-template-columns:1fr}.table-toolbar{flex-direction:column;align-items:stretch}.table-toolbar input{width:100%}.slots{grid-template-columns:1fr}.booking-panel{position:static}}
</style>
</head>
<body>
<main>
  <div class="top"><div class="brand"><h1>BMTennis Admin</h1><p>Visualisasi jadwal, data booking, dan input booking manual.</p></div><div style="display:flex;align-items:center;gap:12px"><form class="datebar" method="get" action="/admin"><a href="/admin?date=${dateOffset(params.date, -1)}">Sebelumnya</a><input type="date" name="date" value="${escapeHtml(params.date)}"><button type="submit">Lihat</button><a href="/admin?date=${dateOffset(params.date, 1)}">Berikutnya</a></form><form method="post" action="/admin/logout"><button class="small-button" type="submit">Keluar</button></form></div></div>
  <div class="cards"><div class="card"><span>Tanggal</span><strong>${escapeHtml(params.date)}</strong></div><div class="card"><span>Lapangan Aktif</span><strong>${params.courtRows.length}</strong></div><div class="card"><span>Booking Aktif</span><strong>${activeBookings.length}</strong></div><div class="card"><span>Slot Kosong</span><strong>${availableCells}</strong></div><div class="card revenue"><span>Revenue Hari Ini</span><strong>${formatRupiah(revenueToday)}</strong></div></div>
  <div class="grid"><section class="panel"><h2>Timeline Harian</h2><div class="timeline">${timeline}</div></section><aside class="side"><section class="panel booking-panel"><h2 class="booking-head"><span>Booking Manual</span><span class="court-mark" aria-hidden="true"></span></h2><form class="form" method="post" action="/admin/bookings"><input type="hidden" name="booking_date" value="${escapeHtml(params.date)}"><p class="form-intro">Input booking langsung ke jadwal ${escapeHtml(params.date)}. Sistem akan menolak slot yang bentrok.</p>${params.message ? `<div class="form-feedback notice">${escapeHtml(params.message)}</div>` : ''}${params.error ? `<div class="form-feedback error">${escapeHtml(params.error)}</div>` : ''}<label><span>Nama Customer</span><input name="customer_name" required placeholder="Contoh: Dimas"></label><label><span>Nomor WhatsApp</span><input name="customer_phone" required placeholder="628xxxxxxxxxx"></label><div class="field-row"><label><span>Lapangan</span><select name="court_id" required>${courtOptions}</select></label><label><span>Status</span><select name="status"><option value="confirmed">Confirmed</option><option value="pending">Pending</option></select></label></div><div class="field-row"><label><span>Jam Mulai</span><input type="time" name="start_time" required value="19:00"></label><label><span>Jam Selesai</span><input type="time" name="end_time" required value="20:00"></label></div><label><span>Catatan</span><textarea name="notes" placeholder="Catatan internal admin"></textarea></label><button type="submit">Simpan ke Jadwal</button></form></section><section class="panel"><h2>Whitelist WhatsApp</h2><form class="form" method="post" action="/admin/whitelist"><p class="form-intro">Jika daftar ini diisi, hanya nomor aktif di bawah yang diproses bot.</p><label><span>Nomor WhatsApp</span><input name="phone" required placeholder="628xxxxxxxxxx"></label><button type="submit">Tambah Nomor</button></form><table><thead><tr><th>Nomor</th><th></th></tr></thead><tbody>${whitelistList}</tbody></table></section></aside></div>
  <section class="panel" style="margin-top:18px"><h2>Data Booking</h2><div class="table-toolbar"><span style="color:var(--muted);font-size:13px">${params.bookingRows.length} booking di tanggal ini</span><input id="booking-search" type="search" placeholder="Cari kode, nama, atau nomor..."></div><div style="overflow-x:auto"><table><thead><tr><th>Kode</th><th>Customer</th><th>Lapangan</th><th>Jam</th><th>Status</th><th>Bayar</th><th>Catatan</th><th></th></tr></thead><tbody id="booking-rows">${bookingList}</tbody></table></div></section>
</main>
<script>
document.getElementById('booking-search').addEventListener('input', function (event) {
  const query = event.target.value.trim().toLowerCase()
  document.querySelectorAll('#booking-rows tr[data-search]').forEach(function (row) {
    row.classList.toggle('is-hidden', query.length > 0 && !row.dataset.search.includes(query))
  })
})
</script>
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
    if (c.req.path === '/admin/login') return next()
    if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_USERNAME) return c.text('Set ADMIN_USERNAME and ADMIN_PASSWORD env before opening /admin.', 503)
    if (getCookie(c, SESSION_COOKIE) !== sessionToken()) return c.redirect('/admin/login')
    await next()
  }

  app.use('/admin', guard)
  app.use('/admin/*', guard)

  app.get('/admin/login', (c) => c.html(renderLogin()))

  app.post('/admin/login', async (c) => {
    const form = await c.req.parseBody()
    const username = String(form.username || '')
    const password = String(form.password || '')

    if (!checkCredentials(username, password)) {
      return c.html(renderLogin('Username atau password salah.'), 401)
    }

    setCookie(c, SESSION_COOKIE, sessionToken(), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 })
    return c.redirect('/admin')
  })

  app.post('/admin/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.redirect('/admin/login')
  })

  app.get('/admin', async (c) => {
    const date = c.req.query('date') || today()
    await expireStalePendingBookings()
    const data = await loadAdminData(date)
    return c.html(renderAdmin({ date, ...data, message: c.req.query('message'), error: c.req.query('error') }))
  })

  app.post('/admin/whitelist', async (c) => {
    const form = await c.req.parseBody()
    const phone = String(form.phone || '').replace(/[^0-9]/g, '')
    if (phone) {
      await db
        .insert(whitelistedNumbers)
        .values({ phone, isActive: true, updatedAt: new Date() })
        .onConflictDoUpdate({ target: whitelistedNumbers.phone, set: { isActive: true, updatedAt: new Date() } })
    }

    return c.redirect('/admin?message=' + encodeURIComponent('Nomor whitelist berhasil disimpan.'))
  })

  app.post('/admin/whitelist/delete', async (c) => {
    const form = await c.req.parseBody()
    const phone = String(form.phone || '')
    if (phone) await db.delete(whitelistedNumbers).where(eq(whitelistedNumbers.phone, phone))
    return c.redirect('/admin?message=' + encodeURIComponent('Nomor whitelist berhasil dihapus.'))
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

  app.post('/admin/bookings/cancel', async (c) => {
    const form = await c.req.parseBody()
    const id = String(form.id || '')
    const date = String(form.booking_date || today())

    if (id) {
      await db
        .update(bookings)
        .set({ status: 'cancelled', paymentStatus: 'cancelled', updatedAt: new Date() })
        .where(eq(bookings.id, id))
    }

    return c.redirect(`/admin?date=${encodeURIComponent(date)}&message=${encodeURIComponent('Booking dibatalkan.')}`)
  })
}
