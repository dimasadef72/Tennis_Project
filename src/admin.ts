import { createHmac } from 'crypto'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { db } from './db/client'
import { bookings, chatHistories, courts, whitelistedNumbers } from './db/schema'
import { expireStalePendingBookings } from './lib/booking'

const SESSION_COOKIE = 'bmtennis_admin_session'

const HOURS = { open: '08:00', close: '22:00', slotMinutes: 60 }
const ACTIVE_STATUSES = ['pending', 'confirmed'] as const

const LOGO_MARK = `<svg viewBox="0 0 48 48" role="img" aria-label="BMTennis logo"><defs><linearGradient id="logoBg" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse"><stop stop-color="#10161b"/><stop offset=".58" stop-color="#0d7a53"/><stop offset="1" stop-color="#9a6b00"/></linearGradient></defs><rect width="48" height="48" rx="14" fill="url(#logoBg)"/><path d="M15 35c11-5 18-12 21-22" fill="none" stroke="#e6f6ee" stroke-width="3" stroke-linecap="round"/><path d="M12 21c7 2 14 1 24-5" fill="none" stroke="#e6f6ee" stroke-width="2.2" stroke-linecap="round" opacity=".82"/><path d="M18 31h-5m22-12h4M31 14V9" fill="none" stroke="#bff4da" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="31" r="2.3" fill="#bff4da"/><circle cx="39" cy="19" r="2.3" fill="#bff4da"/><circle cx="31" cy="9" r="2.3" fill="#bff4da"/></svg>`

const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
const ICON_CALENDAR = `<svg ${ICON_ATTRS}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`
const ICON_GRID = `<svg ${ICON_ATTRS}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
const ICON_CHECK = `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>`
const ICON_CLOCK = `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatUsd(amount: number) {
  return `$${amount.toFixed(4)}`
}

function areaChart(days: string[], values: number[], options: { id: string; format: 'usd' | 'idr' }) {
  const width = 640
  const height = 160
  const padding = { top: 14, x: 4, bottom: 26 }
  const innerWidth = width - padding.x * 2
  const innerHeight = height - padding.top - padding.bottom
  const max = Math.max(...values, 0.000001)
  const stepX = values.length > 1 ? innerWidth / (values.length - 1) : 0
  const floorY = padding.top + innerHeight
  const gradientId = `areaFill-${options.id}`

  const points = values.map((value, index) => ({
    x: padding.x + index * stepX,
    y: padding.top + innerHeight - (value / max) * innerHeight,
    value,
    day: days[index],
  }))

  const linePath = points
    .map((point, index) => {
      if (index === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
      const prev = points[index - 1]
      const midX = ((prev.x + point.x) / 2).toFixed(1)
      return `C ${midX} ${prev.y.toFixed(1)}, ${midX} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    })
    .join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${floorY.toFixed(1)} L ${points[0].x.toFixed(1)} ${floorY.toFixed(1)} Z`

  const dayLabels = points
    .map((point) => {
      const label = new Date(`${point.day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' })
      return `<text x="${point.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" style="fill:var(--muted2)">${escapeHtml(label)}</text>`
    })
    .join('')

  const pointData = points.map((point) => ({ x: point.x, y: point.y, day: point.day, value: point.value }))

  return `<div class="area-chart-wrap">
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="area-chart" data-format="${options.format}" data-points="${escapeHtml(JSON.stringify(pointData))}" data-floor="${floorY.toFixed(1)}">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stop-color="var(--accent)" stop-opacity="0.32"/>
        <stop offset="95%" stop-color="var(--accent)" stop-opacity="0.02"/>
      </linearGradient></defs>
      <path d="${areaPath}" style="fill:url(#${gradientId})"/>
      <path d="${linePath}" fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <line class="area-chart-guide" x1="0" y1="${padding.top}" x2="0" y2="${floorY.toFixed(1)}" style="display:none"/>
      <circle class="area-chart-dot" r="4" style="display:none"/>
      ${dayLabels}
    </svg>
    <div class="area-chart-tooltip" style="display:none"></div>
  </div>`
}

function tokenPricing() {
  return {
    inputPrice: Number(process.env.OPENAI_INPUT_PRICE_PER_1M ?? 0.2),
    outputPrice: Number(process.env.OPENAI_OUTPUT_PRICE_PER_1M ?? 1.2),
    usdToIdr: Number(process.env.USD_TO_IDR_RATE ?? 16300),
  }
}

// ponytail: prices all input tokens at the non-cached rate (cached_tokens isn't tracked yet) — overestimates
// slightly rather than under; add a cachedTokens column and split the rate if precision matters later.
function tokenCostUsd(inputTokens: number, outputTokens: number, pricing: ReturnType<typeof tokenPricing>) {
  return (inputTokens / 1_000_000) * pricing.inputPrice + (outputTokens / 1_000_000) * pricing.outputPrice
}

async function loadAllTimeCost() {
  const [row] = await db
    .select({
      inputTokens: sql<string>`coalesce(sum(${chatHistories.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${chatHistories.outputTokens}), 0)`,
    })
    .from(chatHistories)

  const pricing = tokenPricing()
  const inputTokens = Number(row.inputTokens)
  const outputTokens = Number(row.outputTokens)
  const costUsd = tokenCostUsd(inputTokens, outputTokens, pricing)

  return { totalTokens: inputTokens + outputTokens, costUsd, costIdr: costUsd * pricing.usdToIdr }
}

async function loadAllTimeRevenue() {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${bookings.paymentAmount}), 0)` })
    .from(bookings)
    .where(eq(bookings.status, 'confirmed'))

  return Number(row.total)
}

async function loadRevenueTrend(date: string) {
  const startDate = dateOffset(date, -6)

  const rows = await db
    .select({ bookingDate: bookings.bookingDate, paymentAmount: bookings.paymentAmount })
    .from(bookings)
    .where(and(eq(bookings.status, 'confirmed'), gte(bookings.bookingDate, startDate), lte(bookings.bookingDate, date)))

  const byDay = new Map<string, number>()
  for (let offset = 6; offset >= 0; offset--) byDay.set(dateOffset(date, -offset), 0)
  for (const row of rows) {
    if (!byDay.has(row.bookingDate)) continue
    byDay.set(row.bookingDate, (byDay.get(row.bookingDate) ?? 0) + (row.paymentAmount ?? 0))
  }

  return { days: Array.from(byDay.keys()), trend: Array.from(byDay.values()) }
}

async function loadTokenUsage(date: string) {
  const start = new Date(`${dateOffset(date, -6)}T00:00:00+07:00`)
  const end = new Date(`${date}T23:59:59.999+07:00`)

  const rows = await db
    .select({ createdAt: chatHistories.createdAt, inputTokens: chatHistories.inputTokens, outputTokens: chatHistories.outputTokens })
    .from(chatHistories)
    .where(and(gte(chatHistories.createdAt, start), lte(chatHistories.createdAt, end)))

  const pricing = tokenPricing()

  const byDay = new Map<string, { input: number; output: number }>()
  for (let offset = 6; offset >= 0; offset--) byDay.set(dateOffset(date, -offset), { input: 0, output: 0 })
  for (const row of rows) {
    const day = row.createdAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    const bucket = byDay.get(day)
    if (!bucket) continue
    bucket.input += row.inputTokens ?? 0
    bucket.output += row.outputTokens ?? 0
  }

  const days = Array.from(byDay.keys())
  const buckets = Array.from(byDay.values())
  const trend = buckets.map((bucket) => tokenCostUsd(bucket.input, bucket.output, pricing))
  const todayBucket = buckets[buckets.length - 1]
  const todayTokens = todayBucket.input + todayBucket.output
  const todayCostUsd = trend[trend.length - 1] ?? 0

  return { todayTokens, todayCostUsd, todayCostIdr: todayCostUsd * pricing.usdToIdr, days, trend }
}

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
:root{
  color-scheme:light;
  --bg:#f3f5f0;--ink:#10161b;--muted:#68727a;
  --line:#e5e8e2;--accent:#0d7a53;--accent-ink:#0a5c3f;--accent2:#e6f6ee;
  --danger:#c1392f;--danger2:#fdecea;
  --radius:16px;--radius-sm:10px;
  --shadow-md:0 10px 28px rgba(16,22,17,.06);
  --shadow-lg:0 26px 60px rgba(16,22,17,.14);
  --ease:cubic-bezier(.4,0,.2,1)
}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background-color:var(--bg);background-image:linear-gradient(rgba(243,245,240,.6),rgba(243,245,240,.6)),url('/assets/background.png');background-size:cover;background-position:center;background-repeat:no-repeat;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-.01em}
.card{width:100%;max-width:368px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:34px 30px;animation:rise .35s var(--ease)}
@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:translateY(0) scale(1)}}
.mark{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#108058,#0a5c3f);display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:16px;box-shadow:0 10px 22px rgba(13,122,83,.28)}
.mark svg{width:22px;height:22px}
.card h1{font-size:21px;margin:0 0 4px;font-weight:800;letter-spacing:-.02em}
.card p{margin:0 0 24px;color:var(--muted);font-size:13.5px}
.card label{display:grid;gap:6px;color:var(--muted);font-size:12.5px;margin-bottom:14px}
.card label span{font-weight:680;color:#33403a}
.card input{height:44px;border:1px solid var(--line);border-radius:var(--radius-sm);padding:0 13px;background:#fff;color:var(--ink);font:inherit;outline:none;width:100%;transition:border-color .12s var(--ease),box-shadow .12s var(--ease)}
.card input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent2)}
.card button{width:100%;height:46px;border:0;border-radius:var(--radius-sm);background:linear-gradient(135deg,#108058,#0a5c3f);color:#fff;font-weight:740;font-size:14.5px;box-shadow:0 12px 24px rgba(13,122,83,.26);margin-top:6px;cursor:pointer;transition:transform .12s var(--ease),box-shadow .12s var(--ease),filter .12s var(--ease)}
.card button:hover{filter:brightness(1.06)}
.card button:active{transform:translateY(1px)}
.error{background:var(--danger2);color:var(--danger);border:1px solid #f2ccc6;border-radius:var(--radius-sm);padding:11px 13px;font-size:12.5px;margin-bottom:18px}
(max-width:620px){
  .cards{grid-template-columns:1fr}
}
</style>
</head>
<body>
<form class="card" method="post" action="/admin/login">
  <div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.4 2.6 3.6 5.7 3.6 9s-1.2 6.4-3.6 9M12 3C9.6 5.6 8.4 8.7 8.4 12s1.2 6.4 3.6 9"/></svg></div>
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
  tokenUsage: { todayTokens: number; todayCostUsd: number; todayCostIdr: number; days: string[]; trend: number[] }
  allTimeCost: { totalTokens: number; costUsd: number; costIdr: number }
  allTimeRevenue: number
  revenueTrend: { days: string[]; trend: number[] }
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
            ? `<form method="post" action="/admin/bookings/cancel"><input type="hidden" name="id" value="${escapeHtml(booking.id)}"><input type="hidden" name="booking_date" value="${escapeHtml(booking.bookingDate)}"><button class="small-button" type="button" onclick="confirmCancel(this.closest('form'), '${escapeHtml(booking.bookingCode)}')">Batalkan</button></form>`
            : ''

          return `<tr data-search="${escapeHtml(`${booking.bookingCode} ${booking.customerName} ${booking.customerPhone}`.toLowerCase())}">
<td>${escapeHtml(booking.bookingCode)}</td>
<td>${escapeHtml(booking.customerName)}<small>${escapeHtml(booking.customerPhone)}</small></td>
<td>${escapeHtml(params.courtRows.find((court) => court.id === booking.courtId)?.name ?? '-')}</td>
<td>${normalizeTime(booking.startTime)}-${normalizeTime(booking.endTime)}</td>
<td><span class="pill ${escapeHtml(booking.status)}"><i></i>${escapeHtml(booking.status)}</span></td>
<td>${payment}</td>
<td>${escapeHtml(booking.notes ?? '')}</td>
<td>${action}</td>
</tr>`
        })
        .join('')
    : '<tr><td colspan="8" class="empty">Belum ada booking di tanggal ini.</td></tr>'

  const courtOptions = params.courtRows.map((court) => `<option value="${court.id}">${escapeHtml(court.name)}</option>`).join('')
  const tableCourtFilterOptions = params.courtRows.map((court) => `<option value="${court.id}">${escapeHtml(court.name)}</option>`).join("")

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
:root{
  color-scheme:light;
  --bg:#f3f5f0;--panel:#ffffff;--ink:#10161b;--muted:#68727a;--muted2:#9aa4a9;
  --line:#e5e8e2;--line2:#eef1ea;
  --accent:#0d7a53;--accent-ink:#0a5c3f;--accent2:#e6f6ee;
  --danger:#c1392f;--danger2:#fdecea;
  --warn:#9a6b00;--warn2:#fff3d6;
  --neutral2:#eef0eb;
  --radius:16px;--radius-sm:10px;
  --shadow-sm:0 1px 2px rgba(16,22,17,.04);
  --shadow-md:0 10px 28px rgba(16,22,17,.06);
  --shadow-lg:0 26px 60px rgba(16,22,17,.12);
  --ease:cubic-bezier(.4,0,.2,1)
}
*{box-sizing:border-box}
body{margin:0;background-color:var(--bg);background-image:linear-gradient(rgba(243,245,240,.6),rgba(243,245,240,.6)),url('/assets/background.png');background-size:cover;background-position:top right;background-repeat:no-repeat;background-attachment:fixed;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-.01em}
main{max-width:1360px;margin:0 auto;padding:36px 24px 72px;animation:fade-in .4s var(--ease)}
@keyframes fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
a{color:inherit}

.top{display:flex;gap:18px;align-items:flex-end;justify-content:space-between;margin-bottom:26px}
.admin-actions{display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:13px}.brand-logo{width:46px;height:46px;flex:none;filter:drop-shadow(0 10px 18px rgba(13,122,83,.18))}.brand h1{font-size:30px;line-height:1.05;margin:0 0 7px;font-weight:850;letter-spacing:-.03em;background:linear-gradient(135deg,#071018 0%,#0d7a53 58%,#9a6b00 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.brand p{margin:0;color:var(--muted);font-size:15px;line-height:1.45;font-weight:450}
.datebar{display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.8);backdrop-filter:blur(6px);border:1px solid var(--line);padding:6px;border-radius:12px;box-shadow:var(--shadow-sm)}
.datebar a,.datebar button{border:1px solid transparent;background:#fff;color:var(--ink);height:38px;padding:0 15px;border-radius:9px;text-decoration:none;font-weight:640;font-size:13.5px;box-shadow:var(--shadow-sm);transition:transform .12s var(--ease),box-shadow .12s var(--ease),background .12s var(--ease);display:inline-flex;align-items:center}
.datebar a:hover{background:var(--neutral2)}
.datebar button{background:var(--ink);color:#fff;cursor:pointer}
.datebar button:hover{background:#000}
.datebar input,.form input,.form select,.form textarea{height:40px;border:1px solid var(--line);border-radius:9px;padding:0 12px;background:#fff;color:var(--ink);font:inherit;outline:none;transition:border-color .12s var(--ease),box-shadow .12s var(--ease)}
.datebar input:focus,.form input:focus,.form select:focus,.form textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent2)}

.grid{display:grid;grid-template-columns:minmax(0,1.65fr) 400px;gap:18px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}
.cards .card{align-self:start}
.cards .usage-panel{grid-row:span 2}
.card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-md)}
.card{padding:16px 18px;transition:transform .16s var(--ease),box-shadow .16s var(--ease);position:relative;overflow-wrap:break-word}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
.card-icon{width:32px;height:32px;border-radius:9px;background:var(--accent2);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.card-icon svg{width:16px;height:16px}
.card span{display:block;color:var(--muted);font-size:11.5px;font-weight:680;text-transform:uppercase;letter-spacing:.05em}
.card strong{display:block;font-size:24px;line-height:1.15;margin-top:6px;font-weight:780;letter-spacing:-.01em}
.usage-summary{display:flex;gap:32px;padding:18px 20px 4px}
.usage-stat span{display:block;color:var(--muted);font-size:11.5px;font-weight:680;text-transform:uppercase;letter-spacing:.05em}
.usage-stat strong{display:block;font-size:22px;line-height:1.15;margin-top:6px;font-weight:780;letter-spacing:-.01em}
.usage-stat small{display:block;color:var(--muted2);font-size:11.5px;margin-top:3px}
.usage-chart{padding:6px 12px 14px}
.area-chart-wrap{position:relative}
.area-chart{width:100%;height:160px;display:block;cursor:crosshair}
.area-chart-guide{stroke:var(--line);stroke-width:1;stroke-dasharray:3 3}
.area-chart-tooltip{position:absolute;pointer-events:none;background:var(--ink);color:#fff;padding:8px 12px;border-radius:9px;font-size:12px;line-height:1.5;box-shadow:var(--shadow-lg);transform:translate(-50%,-118%);white-space:nowrap;z-index:5;transition:opacity .08s var(--ease)}
.area-chart-tooltip strong{display:block;font-size:13px;font-weight:720}
.area-chart-tooltip small{color:var(--muted2);font-size:11px}

.panel{overflow:hidden}
.panel h2{font-size:14.5px;margin:0;padding:16px 20px;border-bottom:1px solid var(--line2);font-weight:720;letter-spacing:-.005em}

.timeline{padding:8px 14px 14px}
.time-row{display:grid;grid-template-columns:80px 1fr;gap:14px;padding:9px 0;border-bottom:1px solid var(--line2)}
.time-row:last-child{border-bottom:0}
.time{font-weight:720;font-size:15px;padding-top:11px;color:var(--ink)}
.time span{display:block;color:var(--muted2);font-size:11.5px;font-weight:520;margin-top:2px}
.slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.slot{min-height:60px;border-radius:var(--radius-sm);padding:10px 13px;border:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;gap:2px;transition:transform .12s var(--ease)}
.slot:hover{transform:translateY(-1px)}
.slot span{font-size:11.5px;color:var(--muted);font-weight:600}
.slot small{font-size:11px;color:var(--muted2)}
.slot strong{font-size:14px;font-weight:700}
.available{background:linear-gradient(155deg,#f5fffa 0%,var(--accent2) 100%);border-color:#cfe9dc}
.available strong{color:var(--accent-ink)}
.booked{background:linear-gradient(155deg,#fff8f7 0%,var(--danger2) 100%);border-color:#f2ccc6}
.booked strong{color:var(--danger)}

.side{display:flex;flex-direction:column;gap:18px}
.booking-panel{position:sticky;top:18px}
.booking-head{display:flex;align-items:center;justify-content:space-between;gap:14px}
.court-mark{width:44px;height:26px;border:1px solid #cfe4d8;border-radius:6px;background:linear-gradient(90deg,transparent 49%,#cfe4d8 49%,#cfe4d8 51%,transparent 51%),linear-gradient(0deg,transparent 49%,#cfe4d8 49%,#cfe4d8 51%,transparent 51%),#f5fff9}
.form{padding:18px 20px 20px;display:grid;gap:13px}
.form-intro{margin:0 0 2px;color:var(--muted);font-size:12.5px;line-height:1.5}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.form label{display:grid;gap:6px;color:var(--muted);font-size:12.5px}
.form label span{font-weight:680;color:#33403a}
.form textarea{height:70px;padding-top:9px;resize:vertical}
.form button{height:44px;border:0;border-radius:var(--radius-sm);background:linear-gradient(135deg,#108058,#0a5c3f);color:#fff;font-weight:720;font-size:14.5px;box-shadow:0 10px 22px rgba(13,122,83,.24);cursor:pointer;transition:transform .12s var(--ease),box-shadow .12s var(--ease),filter .12s var(--ease)}
.form button:hover{filter:brightness(1.06);box-shadow:0 12px 26px rgba(13,122,83,.3)}
.form button:active{transform:translateY(1px)}
.small-button{height:30px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--danger);font-weight:680;padding:0 11px;font-size:12.5px;cursor:pointer;transition:background .12s var(--ease),border-color .12s var(--ease),transform .12s var(--ease)}
.small-button:hover{background:var(--danger2);border-color:#f0c7c1}
.small-button:active{transform:translateY(1px)}
.form-feedback{padding:11px 13px;border-radius:var(--radius-sm);border:1px solid;font-size:12.5px;line-height:1.5}
.form-feedback.notice{background:var(--accent2);color:var(--accent-ink);border-color:#cfe9dc}
.form-feedback.error{background:var(--danger2);color:var(--danger);border-color:#f2ccc6}

table{width:100%;border-collapse:collapse;font-size:13.5px;background:#fff}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line2);vertical-align:top}
th{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;background:#fbfcf9;font-weight:700}
td small{display:block;color:var(--muted2);margin-top:2px;font-size:12px}
tbody tr{transition:background .1s var(--ease)}
tbody tr:hover{background:var(--accent2)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--neutral2);color:var(--muted);font-size:11.5px;font-weight:720}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex:none}
.pill.confirmed{background:var(--accent2);color:var(--accent-ink)}
.pill.pending{background:var(--warn2);color:var(--warn)}
.pill.expired{background:var(--danger2);color:var(--danger)}
.pill.cancelled{background:var(--neutral2);color:var(--muted)}
.empty{text-align:center;color:var(--muted);padding:32px}
.table-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 20px;border-bottom:1px solid var(--line2)}
.table-toolbar input{width:240px}
td form{margin:0}
tr.is-hidden{display:none}

dialog{border:0;border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:0;max-width:380px;width:90%;animation:rise .18s var(--ease)}
dialog::backdrop{background:rgba(16,22,17,.45);backdrop-filter:blur(2px)}
@keyframes rise{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.dialog-body{padding:26px 24px}
.dialog-body h3{margin:0 0 8px;font-size:17px;font-weight:780;letter-spacing:-.01em}
.dialog-body p{margin:0 0 22px;color:var(--muted);font-size:13.5px;line-height:1.55}
.dialog-body p strong{color:var(--ink)}
.dialog-actions{display:flex;gap:10px;justify-content:flex-end}
.dialog-actions button{height:40px;padding:0 16px;border-radius:var(--radius-sm);font-weight:680;font-size:13.5px;cursor:pointer;border:1px solid var(--line);background:#fff;transition:background .12s var(--ease),transform .12s var(--ease)}
.dialog-actions button:hover{background:var(--neutral2)}
.dialog-actions button.danger{border:0;background:var(--danger);color:#fff}
.dialog-actions button.danger:hover{background:#a83227}
.dialog-actions button:active{transform:translateY(1px)}

@media(max-width:980px){
  .top,.admin-actions,.datebar{align-items:stretch;flex-direction:column}
  .grid,.field-row{grid-template-columns:1fr}
  .cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .table-toolbar{flex-direction:column;align-items:stretch}
  .table-toolbar input{width:100%}
  .slots{grid-template-columns:1fr}
  .booking-panel{position:static}
}
</style>
</head>
<body>
<main>
  <div class="top"><div class="brand"><div class="brand-logo">${LOGO_MARK}</div><div><h1>BMTennis Admin</h1><p>Visualisasi jadwal, data booking, dan input booking manual.</p></div></div><div class="admin-actions"><form class="datebar" method="get" action="/admin"><a href="/admin?date=${dateOffset(params.date, -1)}">Sebelumnya</a><input type="date" name="date" value="${escapeHtml(params.date)}"><button type="submit">Lihat</button><a href="/admin?date=${dateOffset(params.date, 1)}">Berikutnya</a></form><form method="post" action="/admin/logout"><button class="small-button" type="submit">Keluar</button></form></div></div>
  <div class="cards">
    <div class="card"><div class="card-icon">${ICON_CALENDAR}</div><span>Tanggal</span><strong>${escapeHtml(params.date)}</strong></div>
    <div class="card"><div class="card-icon">${ICON_CLOCK}</div><span>Slot Kosong</span><strong>${availableCells}</strong></div>
    <section class="panel usage-panel">
      <h2>Revenue</h2>
      <div class="usage-summary">
        <div class="usage-stat">
          <span>Hari Ini</span>
          <strong>${formatRupiah(revenueToday)}</strong>
        </div>
        <div class="usage-stat">
          <span>Total Keseluruhan</span>
          <strong>${formatRupiah(params.allTimeRevenue)}</strong>
        </div>
      </div>
      <div class="usage-chart">${areaChart(params.revenueTrend.days, params.revenueTrend.trend, { id: 'revenue', format: 'idr' })}</div>
    </section>
    <section class="panel usage-panel">
      <h2>Biaya AI</h2>
      <div class="usage-summary">
        <div class="usage-stat">
          <span>Hari Ini</span>
          <strong>${formatUsd(params.tokenUsage.todayCostUsd)}</strong>
          <small>≈ ${formatRupiah(Math.round(params.tokenUsage.todayCostIdr))} · ${formatCompact(params.tokenUsage.todayTokens)} token</small>
        </div>
        <div class="usage-stat">
          <span>Total Keseluruhan</span>
          <strong>${formatUsd(params.allTimeCost.costUsd)}</strong>
          <small>≈ ${formatRupiah(Math.round(params.allTimeCost.costIdr))} · ${formatCompact(params.allTimeCost.totalTokens)} token · sejak awal</small>
        </div>
      </div>
      <div class="usage-chart">${areaChart(params.tokenUsage.days, params.tokenUsage.trend, { id: 'cost', format: 'usd' })}</div>
    </section>
    <div class="card"><div class="card-icon">${ICON_GRID}</div><span>Lapangan Aktif</span><strong>${params.courtRows.length}</strong></div>
    <div class="card"><div class="card-icon">${ICON_CHECK}</div><span>Booking Aktif</span><strong>${activeBookings.length}</strong></div>
  </div>
  <div class="grid"><section class="panel"><h2>Timeline Harian</h2><div class="timeline">${timeline}</div></section><aside class="side"><section class="panel booking-panel"><h2 class="booking-head"><span>Booking Manual</span><span class="court-mark" aria-hidden="true"></span></h2><form class="form" method="post" action="/admin/bookings"><input type="hidden" name="booking_date" value="${escapeHtml(params.date)}"><p class="form-intro">Input booking langsung ke jadwal ${escapeHtml(params.date)}. Sistem akan menolak slot yang bentrok.</p>${params.message ? `<div class="form-feedback notice">${escapeHtml(params.message)}</div>` : ''}${params.error ? `<div class="form-feedback error">${escapeHtml(params.error)}</div>` : ''}<label><span>Nama Customer</span><input name="customer_name" required placeholder="Contoh: Dimas"></label><label><span>Nomor WhatsApp</span><input name="customer_phone" required placeholder="628xxxxxxxxxx"></label><div class="field-row"><label><span>Lapangan</span><select name="court_id" required>${courtOptions}</select></label><label><span>Status</span><select name="status"><option value="confirmed">Confirmed</option><option value="pending">Pending</option></select></label></div><div class="field-row"><label><span>Jam Mulai</span><input type="time" name="start_time" required value="19:00"></label><label><span>Jam Selesai</span><input type="time" name="end_time" required value="20:00"></label></div><label><span>Catatan</span><textarea name="notes" placeholder="Catatan internal admin"></textarea></label><button type="submit">Simpan ke Jadwal</button></form></section><section class="panel"><h2>Whitelist WhatsApp</h2><form class="form" method="post" action="/admin/whitelist"><p class="form-intro">Jika daftar ini diisi, hanya nomor aktif di bawah yang diproses bot.</p><label><span>Nomor WhatsApp</span><input name="phone" required placeholder="628xxxxxxxxxx"></label><button type="submit">Tambah Nomor</button></form><table><thead><tr><th>Nomor</th><th></th></tr></thead><tbody>${whitelistList}</tbody></table></section></aside></div>
  <section class="panel" style="margin-top:18px"><h2>Data Booking</h2><div class="table-toolbar"><span style="color:var(--muted);font-size:13px">${params.bookingRows.length} booking di tanggal ini</span><input id="booking-search" type="search" placeholder="Cari kode, nama, atau nomor..."></div><div style="overflow-x:auto"><table><thead><tr><th>Kode</th><th>Customer</th><th>Lapangan</th><th>Jam</th><th>Status</th><th>Bayar</th><th>Catatan</th><th></th></tr></thead><tbody id="booking-rows">${bookingList}</tbody></table></div></section>
</main>
<dialog id="cancel-dialog">
  <div class="dialog-body">
    <h3>Batalkan booking ini?</h3>
    <p>Kode <strong id="cancel-dialog-code"></strong> akan dibatalkan dan slotnya dilepas. Aksi ini tidak bisa dibatalkan.</p>
    <div class="dialog-actions">
      <button type="button" onclick="document.getElementById('cancel-dialog').close()">Batal</button>
      <button type="button" class="danger" id="cancel-dialog-confirm">Ya, Batalkan</button>
    </div>
  </div>
</dialog>
<script>
document.getElementById('booking-search').addEventListener('input', function (event) {
  const query = event.target.value.trim().toLowerCase()
  document.querySelectorAll('#booking-rows tr[data-search]').forEach(function (row) {
    row.classList.toggle('is-hidden', query.length > 0 && !row.dataset.search.includes(query))
  })
})

let pendingCancelForm = null
function confirmCancel(form, code) {
  pendingCancelForm = form
  document.getElementById('cancel-dialog-code').textContent = code
  document.getElementById('cancel-dialog').showModal()
}
document.getElementById('cancel-dialog-confirm').addEventListener('click', function () {
  if (pendingCancelForm) pendingCancelForm.submit()
})

document.querySelectorAll('.area-chart').forEach(function (svg) {
  const points = JSON.parse(svg.dataset.points)
  const viewWidth = svg.viewBox.baseVal.width
  const wrap = svg.closest('.area-chart-wrap')
  const dot = svg.querySelector('.area-chart-dot')
  const guide = svg.querySelector('.area-chart-guide')
  const tooltip = wrap.querySelector('.area-chart-tooltip')

  function showAt(clientX) {
    const rect = svg.getBoundingClientRect()
    const scale = viewWidth / rect.width
    const svgX = (clientX - rect.left) * scale
    let nearest = points[0]
    for (const point of points) if (Math.abs(point.x - svgX) < Math.abs(nearest.x - svgX)) nearest = point

    dot.setAttribute('cx', nearest.x)
    dot.setAttribute('cy', nearest.y)
    dot.style.display = ''
    guide.setAttribute('x1', nearest.x)
    guide.setAttribute('x2', nearest.x)
    guide.style.display = ''

    const dayLabel = new Date(nearest.day + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const valueLabel = svg.dataset.format === 'idr' ? 'Rp' + Math.round(nearest.value).toLocaleString('id-ID') : '$' + nearest.value.toFixed(4)
    tooltip.innerHTML = '<strong>' + valueLabel + '</strong><small>' + dayLabel + '</small>'
    tooltip.style.display = ''
    const tooltipWidth = tooltip.offsetWidth
    const rawLeft = (nearest.x / viewWidth) * rect.width
    tooltip.style.left = Math.min(Math.max(rawLeft, tooltipWidth / 2 + 8), rect.width - tooltipWidth / 2 - 8) + 'px'
    tooltip.style.top = ((nearest.y / svg.viewBox.baseVal.height) * rect.height) + 'px'
  }

  function hide() {
    dot.style.display = 'none'
    guide.style.display = 'none'
    tooltip.style.display = 'none'
  }

  svg.addEventListener('mousemove', function (event) { showAt(event.clientX) })
  svg.addEventListener('mouseleave', hide)
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
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
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
    const [data, tokenUsage, allTimeCost, allTimeRevenue, revenueTrend] = await Promise.all([
      loadAdminData(date),
      loadTokenUsage(date),
      loadAllTimeCost(),
      loadAllTimeRevenue(),
      loadRevenueTrend(date),
    ])
    return c.html(renderAdmin({ date, ...data, tokenUsage, allTimeCost, allTimeRevenue, revenueTrend, message: c.req.query('message'), error: c.req.query('error') }))
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
