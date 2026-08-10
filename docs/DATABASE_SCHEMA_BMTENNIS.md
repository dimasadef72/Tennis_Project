# BMTennis Database Schema

Dokumen ini berisi schema minimal untuk MVP BMTennis Assistant.

Stack:

- Database: Supabase Postgres
- ORM: Drizzle ORM
- Channel: WhatsApp Cloud API

Prinsip MVP:

- Simpan data lapangan dan booking saja.
- Jam operasional belum perlu tabel.
- Availability dihitung dari jam operasional hardcoded dikurangi booking aktif.

---

## 1. Tables

MVP hanya butuh:

```text
courts
bookings
```

Belum perlu:

- `operating_hours`
- `payments`
- `customers`

Tabel itu ditambah nanti kalau benar-benar dipakai.

---

## 2. `courts`

Menyimpan daftar lapangan.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | yes | Primary key |
| `name` | `text` | yes | Contoh: `Lapangan 1` |
| `is_active` | `boolean` | yes | Untuk menonaktifkan lapangan tanpa hapus data |
| `created_at` | `timestamptz` | yes | Default `now()` |

Contoh data awal:

```text
Lapangan 1
Lapangan 2
```

---

## 3. `bookings`

Menyimpan data booking dari WhatsApp.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | yes | Primary key |
| `booking_code` | `text` | yes | Kode unik untuk customer |
| `customer_name` | `text` | yes | Nama dari WhatsApp profile |
| `customer_phone` | `text` | yes | Nomor WhatsApp customer, format internasional tanpa `+` |
| `court_id` | `uuid` | yes | FK ke `courts.id` |
| `booking_date` | `date` | yes | Tanggal main |
| `start_time` | `time` | yes | Jam mulai |
| `end_time` | `time` | yes | Jam selesai |
| `status` | `text` | yes | `pending`, `confirmed`, `cancelled`, `expired` |
| `notes` | `text` | no | Catatan opsional |
| `created_at` | `timestamptz` | yes | Default `now()` |
| `updated_at` | `timestamptz` | yes | Default `now()` |

Status aktif yang mengunci jadwal:

```text
pending
confirmed
```

Status tidak aktif:

```text
cancelled
expired
```

---

## 4. Availability Rule

Jam operasional disimpan di code dulu:

```ts
const OPERATING_HOURS = {
  open: '08:00',
  close: '22:00',
  slotMinutes: 60,
}
```

Cara cek availability:

```text
available slots = operating hour slots - active bookings
```

Active bookings:

```sql
status in ('pending', 'confirmed')
```

Kalau user tidak menyebut jam:

```text
Tampilkan semua slot kosong pada tanggal itu.
```

Kalau user menyebut jam:

```text
Cek apakah slot itu kosong di salah satu lapangan.
```

---

## 5. Double Booking Guard

Backend harus mencegah dua booking aktif pada lapangan dan jam yang sama.

Constraint yang dibutuhkan di Postgres:

```sql
create unique index bookings_active_slot_unique
on bookings (court_id, booking_date, start_time, end_time)
where status in ('pending', 'confirmed');
```

Ini tetap perlu walaupun backend sudah cek availability, karena request bisa masuk bersamaan.

---

## 6. Drizzle Shape

Contoh bentuk schema Drizzle:

```ts
import { boolean, date, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core'

export const courts = pgTable('courts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingCode: text('booking_code').notNull().unique(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  courtId: uuid('court_id').notNull().references(() => courts.id),
  bookingDate: date('booking_date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  status: text('status').notNull().default('pending'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Partial unique index untuk active booking bisa dibuat lewat SQL migration Supabase.

---

## 7. Next Step

Implementasi berikutnya:

1. Pasang Drizzle + Supabase connection.
2. Buat migration `courts` dan `bookings`.
3. Seed `Lapangan 1` dan `Lapangan 2`.
4. Ganti mock availability di bot menjadi query database.
