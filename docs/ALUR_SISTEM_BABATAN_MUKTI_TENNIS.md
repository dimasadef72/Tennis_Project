# ALUR SISTEM — BABATAN MUKTI TENNIS BOOKING ASSISTANT

## 1. Identitas Project

**Nama Project:** Babatan Mukti Tennis Booking Assistant  
**Short Name:** BMTennis  
**Chatbot Name:** BMTennis Assistant  

Sistem ini merupakan chatbot booking lapangan tenis berbasis WhatsApp untuk fasilitas tenis di kawasan Babatan Mukti.

Sistem memiliki **2 lapangan tenis** dan memungkinkan customer untuk:

- bertanya mengenai ketersediaan lapangan;
- melihat slot yang tersedia;
- memilih lapangan;
- memilih tanggal dan jam;
- melakukan booking selama satu atau beberapa jam;
- melakukan pembayaran;
- menerima konfirmasi booking;
- menerima bukti pembayaran dalam bentuk PDF;
- melihat status booking melalui percakapan WhatsApp.

Admin memiliki dashboard untuk melakukan visualisasi data booking dan pembayaran.

---

# 2. Requirement Utama

## 2.1 Lapangan

Jumlah lapangan:

- Lapangan 1
- Lapangan 2

---

## 2.2 Jam Booking

Customer boleh melakukan booking di luar jam operasional umum.

Sistem tidak membatasi booking berdasarkan jam buka/tutup pada MVP.

Validasi waktu hanya memastikan format jam valid dan booking tetap menggunakan interval per jam.

---

## 2.3 Durasi Booking

Booking menggunakan interval per jam.

Customer dapat booking:

```text
1 jam
2 jam
3 jam
4 jam
dan seterusnya
```

selama seluruh slot dalam durasi tersebut tersedia.

Booking pecahan jam tidak diperbolehkan.

Contoh tidak valid:

```text
18.30 - 19.30
1,5 jam
2,5 jam
```

---

## 2.4 Harga

Harga seluruh lapangan:

```text
Rp100.000 / jam
```

Formula:

```text
Total = Durasi × Rp100.000
```

Contoh:

```text
1 jam = Rp100.000
2 jam = Rp200.000
3 jam = Rp300.000
4 jam = Rp400.000
```

Harga final selalu dihitung oleh backend.

---

## 2.5 Identitas Customer

Identitas customer:

```text
Nama
Nomor WhatsApp
```

Nomor WhatsApp menjadi identifier utama customer.

Nomor WhatsApp diambil dari webhook WhatsApp Cloud API.

Nama customer diambil dari `profile.name` pada webhook apabila tersedia.
Jika tidak tersedia, backend dapat menggunakan fallback sederhana seperti `Customer` dan hanya menanyakan nama apabila benar-benar dibutuhkan untuk receipt atau operasional.

Customer tidak membutuhkan:

- username;
- password;
- registrasi akun manual.

---

## 2.6 WhatsApp Whitelist

Chatbot hanya dapat digunakan oleh nomor WhatsApp yang sudah masuk whitelist.

Backend tetap menerima webhook dari WhatsApp, tetapi pesan hanya diproses apabila nomor pengirim terdaftar.

```text
Incoming WhatsApp Message
        ↓
Extract Sender Number
        ↓
Check Whitelist
        ↓
┌─────────────────┬─────────────────┐
│ WHITELISTED     │ NOT WHITELISTED │
│                 │                 │
▼                 ▼
Process Message   Ignore Message
```

Nomor yang tidak masuk whitelist:

- tidak dikirim ke LLM;
- tidak dapat mengecek jadwal;
- tidak dapat booking;
- tidak mendapatkan balasan chatbot.

Whitelist disimpan pada database PostgreSQL.

---

## 2.7 Cancellation

Customer **tidak dapat melakukan cancel booking** melalui chatbot.

Setelah booking berstatus:

```text
CONFIRMED
```

booking dianggap final.

Tidak terdapat customer flow:

```text
CANCEL_BOOKING
```

pada MVP.

---

# 3. Technology Stack

## Customer Channel

```text
WhatsApp Business Platform
WhatsApp Cloud API
```

## Backend

```text
Hono
Bun
TypeScript
```

## AI / LLM

```text
OpenAI API
```

## Database

```text
PostgreSQL
Drizzle ORM
```

## Payment Gateway

```text
Midtrans
```

Development:

```text
Midtrans Sandbox
```

Production:

```text
Midtrans Production
```

## Admin Dashboard

Web dashboard read-only untuk visualisasi.

Suggested frontend:

```text
Next.js
```

## Receipt

Receipt / bukti pembayaran PDF dibuat oleh backend sendiri setelah pembayaran berhasil.

---

# 4. High-Level Architecture

```text
                        CUSTOMER
                           │
                           ▼
                      WHATSAPP
                           │
                           ▼
                WHATSAPP CLOUD API
                           │
                           │ Webhook
                           ▼
                 ┌───────────────────┐
                 │  HONO + BUN API   │
                 │    TYPESCRIPT     │
                 └─────────┬─────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
 ┌────────────────┐ ┌───────────────┐ ┌──────────────┐
 │   OPENAI API   │ │  POSTGRESQL   │ │   MIDTRANS   │
 │      LLM       │ │   + DRIZZLE   │ │   PAYMENT    │
 └────────────────┘ └───────┬───────┘ └──────┬───────┘
                            │                  │
                            │                  │ Webhook
                            │                  ▼
                            │          ┌───────────────┐
                            │          │ HONO BACKEND  │
                            │          └───────┬───────┘
                            │                  │
                            └──────────┬───────┘
                                       ▼
                                UPDATE BOOKING
                                       │
                              ┌────────┴────────┐
                              │                 │
                              ▼                 ▼
                       GENERATE PDF       WHATSAPP
                          RECEIPT         CONFIRMATION
                              │
                              ▼
                       ADMIN DASHBOARD
```

---

# 5. Pembagian Tanggung Jawab Sistem

## WhatsApp

WhatsApp hanya menjadi channel komunikasi customer.

WhatsApp bertugas untuk:

- menerima pesan customer;
- meneruskan pesan ke backend melalui webhook;
- mengirim response chatbot;
- mengirim link pembayaran;
- mengirim konfirmasi booking;
- mengirim PDF receipt.

---

## LLM

LLM digunakan untuk memahami bahasa natural customer.

LLM dapat:

- memahami intent;
- memahami tanggal;
- memahami waktu;
- memahami durasi;
- memahami pilihan lapangan;
- menyusun response conversational;
- meminta informasi yang belum lengkap.

LLM tidak boleh menjadi source of truth.

LLM **tidak menentukan**:

- apakah slot tersedia;
- apakah booking berhasil;
- harga final;
- status pembayaran;
- apakah booking confirmed;
- apakah nomor customer boleh menggunakan chatbot.

---

## Backend

Backend menjadi pusat business logic.

Backend menangani:

- whitelist validation;
- customer identification;
- booking validation;
- availability checking;
- anti-double-booking;
- temporary slot hold;
- price calculation;
- Midtrans integration;
- payment verification;
- booking status;
- PDF receipt generation;
- WhatsApp response;
- dashboard API.

---

## PostgreSQL

PostgreSQL menjadi source of truth untuk:

- customer;
- whitelist;
- lapangan;
- booking;
- pembayaran;
- invoice / receipt.

---

## Midtrans

Midtrans menjadi source of truth pembayaran.

Booking hanya boleh berubah menjadi:

```text
CONFIRMED
```

apabila backend menerima dan memverifikasi payment notification dari Midtrans.

---

# 6. Alur Incoming WhatsApp

```text
Customer
   ↓
Send WhatsApp Message
   ↓
WhatsApp Cloud API
   ↓
Webhook
   ↓
Hono Backend
   ↓
Extract Phone Number
   ↓
Check Whitelist
```

Decision:

```text
Is phone whitelisted?
        │
   ┌────┴────┐
   │         │
  NO        YES
   │         │
   ▼         ▼
IGNORE    Continue
```

Pesan dari nomor tidak dikenal tidak diteruskan ke OpenAI.

---

# 7. Alur Identifikasi Customer

Setelah nomor lolos whitelist:

```text
WhatsApp Webhook
    ↓
Extract Phone Number
Extract Profile Name if Available
    ↓
Search Customer by Phone Number
    ↓
Customer Exists?
```

Jika sudah ada:

```text
YES
 ↓
Use Existing Customer
 ↓
Continue Chat
```

Jika belum ada:

```text
NO
 ↓
Save:
- Name from WhatsApp profile if available
- Fallback name if profile name is unavailable
- WhatsApp Number
 ↓
Continue Chat
```

Contoh:

```text
Bot:
Terima kasih, Dimas.
Ada yang bisa saya bantu terkait booking lapangan tenis?
```

---

# 8. Alur Percakapan Cek Lapangan

Customer:

```text
Besok jam 7 malam ada lapangan kosong?
```

Backend menerima pesan.

```text
WhatsApp
   ↓
Hono
   ↓
OpenAI LLM
```

LLM menghasilkan structured request:

```json
{
  "intent": "check_availability",
  "date": "2026-08-11",
  "start_time": "19:00"
}
```

Jika duration belum disebutkan, chatbot dapat menanyakan:

```text
Ingin bermain selama berapa jam?
```

Customer:

```text
2 jam
```

Final request:

```json
{
  "intent": "check_availability",
  "date": "2026-08-11",
  "start_time": "19:00",
  "duration_hours": 2
}
```

---

# 9. Validasi Request Booking

Sebelum query availability, backend melakukan validasi.

## Duration Validation

```text
duration_hours >= 1
duration_hours = integer
```

## Time Format Validation

```text
start_time = HH:00
end_time = start_time + duration_hours
```

## Example Valid

```text
06:00 - 07:00
10:00 - 12:00
18:00 - 21:00
21:00 - 22:00
22:00 - 23:00
```

## Example Invalid

```text
18:30 - 19:30
1,5 jam
2,5 jam
```

---

# 10. Availability Check

Setelah request valid:

```text
Backend
   ↓
Query PostgreSQL
   ↓
Check Lapangan 1
Check Lapangan 2
```

Contoh:

```text
Requested:
11 August 2026
19:00 - 21:00

Lapangan 1:
19:00 - 20:00 BOOKED
20:00 - 21:00 BOOKED

Lapangan 2:
19:00 - 20:00 AVAILABLE
20:00 - 21:00 AVAILABLE
```

Backend mengembalikan:

```text
Lapangan 2 tersedia besok pukul 19.00-21.00.
Apakah ingin melakukan booking?
```

---

# 11. Multi-Hour Booking Rule

Untuk booking beberapa jam, **semua jam harus tersedia**.

Contoh:

```text
Lapangan 1

18:00 - 19:00 AVAILABLE
19:00 - 20:00 AVAILABLE
20:00 - 21:00 BOOKED
```

Request:

```text
18:00 selama 2 jam
```

Result:

```text
AVAILABLE
```

karena:

```text
18:00 - 20:00
```

seluruhnya kosong.

Request:

```text
18:00 selama 3 jam
```

Result:

```text
UNAVAILABLE
```

karena:

```text
20:00 - 21:00
```

sudah digunakan.

Backend tidak membuat partial booking.

---

# 12. Alternative Slot Flow

Jika slot tidak tersedia:

```text
Requested Slot
     ↓
Unavailable
     ↓
Search Nearest Available Slot
     ↓
Offer Alternative
```

Contoh:

```text
Maaf, Lapangan 1 pukul 19.00-21.00 sudah terbooking.

Pilihan yang tersedia:
- Lapangan 2 pukul 19.00-21.00
- Lapangan 1 pukul 17.00-19.00
- Lapangan 1 pukul 20.00-22.00
```

Customer kemudian dapat memilih salah satu alternatif.

---

# 13. Booking Summary

Sebelum booking dibuat, chatbot harus memberikan summary.

Contoh:

```text
Detail Booking

Nama       : Dimas
Lapangan   : Lapangan 2
Tanggal    : 11 Agustus 2026
Waktu      : 19.00 - 21.00
Durasi     : 2 jam
Harga/Jam  : Rp100.000
Total      : Rp200.000

Apakah detail booking sudah sesuai?
```

Booking belum dibuat pada tahap ini.

---

# 14. Customer Confirmation

Customer:

```text
Ya
```

Backend kemudian melakukan:

```text
RE-CHECK AVAILABILITY
```

Re-check diperlukan karena slot mungkin diambil customer lain selama percakapan berlangsung.

```text
Customer Confirm
      ↓
Backend Re-check
      ↓
Still Available?
```

Decision:

```text
NO
 ↓
Inform Customer
 ↓
Offer Alternative Slot
```

```text
YES
 ↓
Create Temporary Booking
```

---

# 15. Anti Double Booking

Backend harus mencegah dua booking aktif pada lapangan dan waktu yang bertabrakan.

Overlap rule:

```text
requested_start < existing_end
AND
requested_end > existing_start
```

Status yang memblokir slot:

```text
PENDING_PAYMENT
CONFIRMED
```

Status yang tidak memblokir:

```text
EXPIRED
```

Availability check terakhir dan insert booking sebaiknya dilakukan dalam transaction/database locking agar race condition dapat diminimalkan.

---

# 16. Temporary Booking

Setelah customer melakukan confirmation:

```text
Booking Status:
PENDING_PAYMENT
```

Backend membuat:

```text
expires_at = created_at + 5 minutes
```

Contoh record:

```text
Booking ID  : BMT-20260811-001
Customer    : Dimas
Lapangan    : Lapangan 2
Tanggal     : 11 August 2026
Start       : 19:00
End         : 21:00
Duration    : 2 hours
Price/Hour  : Rp100.000
Total       : Rp200.000
Status      : PENDING_PAYMENT
Expires At  : +5 minutes
```

---

# 17. Five-Minute Hold

Ketika booking berstatus:

```text
PENDING_PAYMENT
```

slot otomatis di-hold selama:

```text
5 MINUTES
```

Selama hold:

```text
Customer lain
     ↓
Check Slot
     ↓
Slot dianggap BOOKED/HELD
```

Tujuan:

- mencegah double booking;
- memberikan waktu customer menyelesaikan pembayaran;
- mencegah slot tertahan terlalu lama.

---

# 18. Pricing Calculation

Pricing dilakukan backend.

Constant:

```text
PRICE_PER_HOUR = 100000
```

Formula:

```text
total_amount =
duration_hours × PRICE_PER_HOUR
```

Contoh:

```text
Duration = 3
Price    = Rp100.000

Total = Rp300.000
```

OpenAI tidak menentukan harga final.

---

# 19. Create Midtrans Payment

Setelah temporary booking berhasil dibuat:

```text
Hono Backend
      ↓
Create Transaction
      ↓
Midtrans
```

Payload secara konsep:

```text
order_id
booking_id
customer_name
customer_phone
gross_amount
```

Contoh:

```text
Order ID     : BMT-20260811-001
Customer     : Dimas
Gross Amount : Rp200.000
```

Midtrans memberikan payment information.

Misalnya:

```text
Payment URL
QRIS
Virtual Account
Payment Page
```

bergantung metode yang diaktifkan.

---

# 20. WhatsApp Payment Message

Backend kemudian mengirim pesan:

```text
Booking sementara berhasil dibuat.

Lapangan : Lapangan 2
Tanggal  : 11 Agustus 2026
Waktu    : 19.00 - 21.00
Durasi   : 2 jam
Total    : Rp200.000

Silakan selesaikan pembayaran dalam waktu 5 menit.

Payment:
[PAYMENT LINK]
```

---

# 21. Payment Waiting State

Setelah link diberikan:

```text
Booking = PENDING_PAYMENT
Payment = PENDING
```

Customer memiliki waktu maksimal:

```text
5 minutes
```

Kemudian ada dua kemungkinan.

```text
             PAYMENT WAITING
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
       SUCCESS            TIMEOUT
```

---

# 22. Payment Success Flow

Customer menyelesaikan pembayaran:

```text
Customer
   ↓
Midtrans
   ↓
Payment Success
   ↓
Midtrans Payment Notification
   ↓
POST /webhooks/midtrans
   ↓
Hono Backend
```

Backend kemudian:

1. menerima webhook;
2. memverifikasi signature / status;
3. mencari payment berdasarkan `order_id`;
4. memastikan amount sesuai;
5. memastikan booking belum expired;
6. update payment;
7. update booking.

```text
Payment:
PENDING → PAID

Booking:
PENDING_PAYMENT → CONFIRMED
```

---

# 23. Payment Verification

Webhook tidak boleh dipercaya secara mentah.

Backend harus memverifikasi payment notification sebelum mengubah booking.

Minimum validation:

```text
Provider order ID
Transaction status
Gross amount
Signature / verification
Associated booking
```

Booking hanya dianggap berhasil setelah payment notification valid.

Customer tidak bisa mengatakan:

```text
"saya sudah bayar"
```

dan membuat booking otomatis confirmed.

Status tetap harus berasal dari payment gateway.

---

# 24. Booking Confirmed

Setelah payment berhasil:

```text
Booking = CONFIRMED
Payment = PAID
```

Backend menyimpan:

```text
confirmed_at
paid_at
```

Selanjutnya sistem melakukan:

```text
Generate Payment Receipt PDF
```

---

# 25. Receipt / Bukti Pembayaran

Setelah booking confirmed, backend membuat PDF sendiri.

Dokumen ini berfungsi sebagai:

```text
PAYMENT RECEIPT
BUKTI PEMBAYARAN
```

Receipt **tidak dibuat sebelum payment berhasil**.

---

# 26. Receipt Number

Suggested format:

```text
Booking ID:
BMT-20260811-001

Receipt:
RCT-BMT-20260811-001
```

atau:

```text
INV-BMT-20260811-001
```

Untuk dokumen setelah pembayaran, istilah yang disarankan:

```text
PAYMENT RECEIPT
```

---

# 27. Isi PDF Receipt

Contoh:

```text
BABATAN MUKTI TENNIS

PAYMENT RECEIPT
--------------------------------

Receipt No   : RCT-BMT-20260811-001
Booking ID   : BMT-20260811-001

CUSTOMER
Name         : Dimas
WhatsApp     : 628xxxxxxxxxx

BOOKING
Court        : Lapangan 2
Date         : 11 August 2026
Time         : 19:00 - 21:00
Duration     : 2 Hours

PAYMENT
Price / Hour : Rp100.000
Total        : Rp200.000
Status       : PAID
Paid At      : 11 August 2026, 18:45 WIB

BOOKING STATUS
CONFIRMED
```

PDF dapat ditambahkan:

- logo;
- QR code booking ID;
- timestamp;
- footer;
- contact information.

Untuk MVP, isi sederhana sudah cukup.

---

# 28. Receipt Generation Flow

```text
Midtrans Payment Success
        ↓
Payment Verified
        ↓
Payment = PAID
        ↓
Booking = CONFIRMED
        ↓
Generate Receipt Number
        ↓
Generate PDF
        ↓
Store PDF
        ↓
Save Receipt Record
        ↓
Send PDF via WhatsApp
        ↓
Display in Admin Dashboard
```

---

# 29. Storage Receipt

PDF dapat disimpan pada:

```text
Object Storage
```

Contoh pilihan:

```text
Google Cloud Storage
S3-compatible Storage
Supabase Storage
Cloudflare R2
```

Database hanya menyimpan metadata seperti:

```text
receipt_number
booking_id
file_url
issued_at
```

---

# 30. WhatsApp Confirmation Setelah Payment

Setelah pembayaran sukses, bot mengirim:

```text
Pembayaran berhasil ✅

Booking Anda telah dikonfirmasi.

Booking ID : BMT-20260811-001
Lapangan   : Lapangan 2
Tanggal    : 11 Agustus 2026
Waktu      : 19.00 - 21.00
Durasi     : 2 jam
Total      : Rp200.000

Bukti pembayaran telah diterbitkan dan dikirim bersama pesan ini.
```

Kemudian:

```text
[PAYMENT_RECEIPT.pdf]
```

---

# 31. Payment Timeout Flow

Jika tidak ada pembayaran selama 5 menit:

```text
PENDING_PAYMENT
      ↓
5 Minutes Passed
      ↓
EXPIRED
```

Payment:

```text
PENDING → EXPIRED
```

Booking:

```text
PENDING_PAYMENT → EXPIRED
```

Slot kemudian dilepas.

```text
HELD
 ↓
EXPIRED
 ↓
AVAILABLE
```

Tidak ada receipt PDF yang dibuat.

---

# 32. Late Payment Protection

Backend harus mengantisipasi kondisi payment notification datang setelah booking sudah expired.

Concept:

```text
Payment Webhook
      ↓
Check Booking Status
      ↓
Is Booking Still PENDING_PAYMENT?
```

Jika:

```text
YES
```

dan payment valid:

```text
CONFIRM BOOKING
```

Jika booking sudah:

```text
EXPIRED
```

backend **tidak boleh otomatis membuat double booking**.

Kondisi tersebut harus dicatat sebagai exception/payment issue dan ditangani secara aman.

---

# 33. Complete Booking Lifecycle

```text
                         ┌──────────────────┐
                         │ CUSTOMER MESSAGE │
                         └─────────┬────────┘
                                   ▼
                         WHATSAPP CLOUD API
                                   │
                                   ▼
                              HONO WEBHOOK
                                   │
                                   ▼
                            CHECK WHITELIST
                                   │
                        ┌──────────┴──────────┐
                        │                     │
                      DENY                  ALLOW
                        │                     │
                        ▼                     ▼
                     IGNORE            IDENTIFY CUSTOMER
                                              │
                                              ▼
                                       OPENAI / LLM
                                              │
                                              ▼
                                       PARSE REQUEST
                                              │
                                              ▼
                                         VALIDATION
                                              │
                                              ▼
                                      CHECK AVAILABILITY
                                              │
                               ┌──────────────┴─────────────┐
                               │                            │
                          UNAVAILABLE                    AVAILABLE
                               │                            │
                               ▼                            ▼
                       OFFER ALTERNATIVE             BOOKING SUMMARY
                                                            │
                                                            ▼
                                                   CUSTOMER CONFIRM
                                                            │
                                                            ▼
                                                RE-CHECK AVAILABILITY
                                                            │
                                                            ▼
                                                CREATE TEMP BOOKING
                                                            │
                                                            ▼
                                                   PENDING_PAYMENT
                                                            │
                                                            ▼
                                                     HOLD 5 MINUTES
                                                            │
                                                            ▼
                                                   CREATE MIDTRANS
                                                            │
                                                            ▼
                                                  SEND PAYMENT LINK
                                                            │
                                              ┌─────────────┴─────────────┐
                                              │                           │
                                              ▼                           ▼
                                         PAYMENT SUCCESS              TIMEOUT
                                              │                           │
                                              ▼                           ▼
                                      MIDTRANS WEBHOOK                  EXPIRED
                                              │                           │
                                              ▼                           ▼
                                      VERIFY PAYMENT                RELEASE SLOT
                                              │
                                              ▼
                                         PAYMENT PAID
                                              │
                                              ▼
                                      BOOKING CONFIRMED
                                              │
                                              ▼
                                      GENERATE RECEIPT PDF
                                              │
                                              ▼
                                      SAVE RECEIPT DATA
                                              │
                                              ▼
                               SEND CONFIRMATION + PDF VIA WA
                                              │
                                              ▼
                                      ADMIN DASHBOARD
```

---

# 34. Booking Status

Main booking status:

```text
PENDING_PAYMENT
CONFIRMED
EXPIRED
```

Lifecycle:

```text
                     PAYMENT SUCCESS
                           │
                           ▼
PENDING_PAYMENT ───────► CONFIRMED
       │
       │ 5 MINUTES
       ▼
    EXPIRED
```

Tidak terdapat customer cancellation pada MVP.

---

# 35. Payment Status

Recommended:

```text
PENDING
PAID
EXPIRED
FAILED
```

Flow:

```text
PENDING
   │
   ├── Success ───► PAID
   │
   ├── Timeout ───► EXPIRED
   │
   └── Failure ───► FAILED
```

---

# 36. Receipt Status

Recommended:

```text
ISSUED
```

Receipt hanya dibuat apabila:

```text
payment.status = PAID
AND
booking.status = CONFIRMED
```

---

# 37. Suggested Database Tables

## customers

```text
id
name
phone_number
created_at
updated_at
```

Constraint:

```text
phone_number UNIQUE
```

---

## whatsapp_whitelist

```text
id
phone_number
is_active
created_at
updated_at
```

---

## courts

```text
id
name
is_active
created_at
updated_at
```

Initial:

```text
1 | Lapangan 1
2 | Lapangan 2
```

---

## bookings

```text
id
booking_code
customer_id
court_id
booking_date
start_time
end_time
duration_hours
price_per_hour
total_amount
status
expires_at
confirmed_at
created_at
updated_at
```

---

## payments

```text
id
booking_id
provider
provider_order_id
amount
status
payment_method
payment_url
provider_transaction_id
paid_at
created_at
updated_at
```

---

## receipts

```text
id
receipt_number
booking_id
payment_id
customer_id
amount
file_url
issued_at
created_at
```

---

# 38. Database Relationship

```text
whatsapp_whitelist
        │
        │ phone validation
        ▼
customers
   │
   │ 1:N
   ▼
bookings
   │
   ├──────── N:1 ───────► courts
   │
   └──────── 1:1 ───────► payments
                              │
                              │ 1:1
                              ▼
                           receipts
```

---

# 39. Admin Dashboard

Dashboard hanya untuk visualisasi pada MVP.

Dashboard bersifat:

```text
READ ONLY
```

Admin tidak:

- membuat booking;
- cancel booking;
- edit booking;
- mengubah payment;
- mengubah customer booking.

---

# 40. Dashboard Summary Cards

Suggested:

```text
Total Booking Hari Ini
Confirmed Booking
Pending Payment
Expired Booking
Revenue Hari Ini
```

---

# 41. Dashboard Court Schedule

Contoh:

```text
LAPANGAN 1

06:00 AVAILABLE
07:00 AVAILABLE
08:00 BOOKED
09:00 BOOKED
10:00 AVAILABLE
11:00 AVAILABLE
...
21:00 AVAILABLE
```

```text
LAPANGAN 2

06:00 BOOKED
07:00 AVAILABLE
08:00 AVAILABLE
...
21:00 BOOKED
```

Status visual:

```text
AVAILABLE
HELD
BOOKED
```

Mapping:

```text
AVAILABLE = tidak ada booking aktif
HELD      = PENDING_PAYMENT
BOOKED    = CONFIRMED
```

---

# 42. Dashboard Booking Table

Suggested columns:

```text
Booking ID
Customer
WhatsApp
Court
Date
Start Time
End Time
Duration
Amount
Booking Status
Payment Status
Receipt
Created At
```

Receipt dapat memiliki action:

```text
View PDF
```

---

# 43. Revenue Dashboard

Revenue hanya dihitung berdasarkan transaksi:

```text
payment.status = PAID
```

atau booking:

```text
booking.status = CONFIRMED
```

Suggested metrics:

```text
Revenue Hari Ini
Revenue Minggu Ini
Revenue Bulan Ini
Total Confirmed Transactions
```

---

# 44. Dashboard Architecture

```text
Admin Browser
      ↓
Next.js Dashboard
      ↓
Hono API
      ↓
PostgreSQL
```

Admin dashboard tidak mengakses PostgreSQL langsung.

---

# 45. Suggested LLM Intents

```text
check_availability
request_booking
confirm_booking
get_booking_status
general_help
```

Tidak ada:

```text
cancel_booking
```

---

# 46. Suggested Internal Tools for LLM

```text
get_customer()
check_availability()
calculate_booking_price()
get_booking_summary()
create_temporary_booking()
get_booking_status()
```

Payment creation dapat dilakukan oleh booking service setelah customer memberikan confirmation.

---

# 47. Suggested Backend Modules

```text
src/
├── index.ts
│
├── routes/
│   ├── whatsapp.route.ts
│   ├── midtrans.route.ts
│   ├── booking.route.ts
│   └── dashboard.route.ts
│
├── services/
│   ├── whatsapp.service.ts
│   ├── openai.service.ts
│   ├── customer.service.ts
│   ├── whitelist.service.ts
│   ├── availability.service.ts
│   ├── booking.service.ts
│   ├── payment.service.ts
│   ├── receipt.service.ts
│   └── dashboard.service.ts
│
├── repositories/
│   ├── customer.repository.ts
│   ├── whitelist.repository.ts
│   ├── court.repository.ts
│   ├── booking.repository.ts
│   ├── payment.repository.ts
│   └── receipt.repository.ts
│
├── db/
│   ├── index.ts
│   └── schema.ts
│
├── lib/
│   ├── env.ts
│   ├── whatsapp.ts
│   ├── openai.ts
│   ├── midtrans.ts
│   └── pdf.ts
│
├── constants/
│   └── booking.ts
│
└── types/
    ├── booking.ts
    ├── payment.ts
    ├── receipt.ts
    └── whatsapp.ts
```

---

# 48. Suggested API / Webhook

## WhatsApp Webhook Verification

```text
GET /webhooks/whatsapp
```

## Incoming WhatsApp Events

```text
POST /webhooks/whatsapp
```

## Midtrans Notification

```text
POST /webhooks/midtrans
```

## Admin Dashboard

```text
GET /api/dashboard/summary
GET /api/dashboard/schedule
GET /api/bookings
GET /api/bookings/:id
GET /api/receipts/:id
```

---

# 49. Business Constants

```text
COURT_COUNT = 2

PRICE_PER_HOUR = 100000

BOOKING_HOLD_MINUTES = 5
```

---

# 50. Suggested Environment Variables

```env
# APP
PORT=
APP_URL=

# DATABASE
DATABASE_URL=

# WHATSAPP
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=

# OPENAI
OPENAI_API_KEY=

# MIDTRANS
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false

# STORAGE
RECEIPT_STORAGE_BUCKET=
```

Secret tidak boleh di-commit ke repository.

---

# 51. Complete Example Conversation

```text
Customer:
Halo, besok jam 7 malam lapangan kosong nggak?

Bot:
Halo Dimas.
Ingin bermain selama berapa jam?

Customer:
2 jam.

Bot:
Saya cek terlebih dahulu.

Lapangan 1 pukul 19.00-21.00 sudah terbooking.

Lapangan 2 tersedia pukul 19.00-21.00.

Apakah ingin booking Lapangan 2?

Customer:
Iya.

Bot:
Berikut detail booking Anda:

Nama       : Dimas
Lapangan   : Lapangan 2
Tanggal    : 11 Agustus 2026
Waktu      : 19.00-21.00
Durasi     : 2 jam
Harga/Jam  : Rp100.000
Total      : Rp200.000

Apakah detail booking sudah sesuai?

Customer:
Ya.

Backend:
Re-check availability.

Backend:
Create booking:
PENDING_PAYMENT

Backend:
Hold slot:
5 minutes

Backend:
Create Midtrans payment.

Bot:
Booking sementara telah dibuat.

Silakan selesaikan pembayaran Rp200.000 dalam waktu 5 menit melalui link berikut:

[PAYMENT LINK]

Customer:
Melakukan pembayaran.

Midtrans:
Payment Success

Midtrans:
Webhook → Hono

Backend:
Verify payment.

Backend:
Payment:
PENDING → PAID

Backend:
Booking:
PENDING_PAYMENT → CONFIRMED

Backend:
Generate:
RCT-BMT-20260811-001.pdf

Bot:
Pembayaran berhasil ✅

Booking Anda telah dikonfirmasi.

Booking ID : BMT-20260811-001
Lapangan   : Lapangan 2
Tanggal    : 11 Agustus 2026
Waktu      : 19.00-21.00
Durasi     : 2 jam
Total      : Rp200.000

Bukti pembayaran terlampir.

[PAYMENT RECEIPT PDF]
```

---

# 52. Example Expired Conversation

```text
Customer:
Ya, booking.

Backend:
Create PENDING_PAYMENT booking.

Bot:
Silakan selesaikan pembayaran dalam waktu 5 menit.

5 minutes elapsed.

Backend:
Payment:
PENDING → EXPIRED

Backend:
Booking:
PENDING_PAYMENT → EXPIRED

Backend:
Release court slot.
```

Jika customer mengirim pesan lagi:

```text
Bot:
Booking sebelumnya telah kedaluwarsa karena pembayaran tidak diselesaikan dalam 5 menit.

Silakan cek kembali ketersediaan lapangan jika ingin melakukan booking baru.
```

---

# 53. Main System Principles

## 1. WhatsApp Number First

Nomor WhatsApp harus lolos whitelist sebelum sistem memproses pesan.

## 2. LLM Only Understands Conversation

LLM tidak menentukan business truth.

## 3. Backend Controls Rules

Harga, duration, availability, booking, dan payment ditentukan backend.

## 4. PostgreSQL Is Booking Source of Truth

Ketersediaan lapangan selalu dicek dari database.

## 5. Midtrans Is Payment Source of Truth

Status `PAID` berasal dari payment gateway, bukan dari claim customer.

## 6. Five-Minute Hold

Temporary booking hanya berlaku 5 menit.

## 7. No Double Booking

PENDING_PAYMENT dan CONFIRMED memblokir slot.

## 8. No Cancellation

Customer tidak memiliki fitur cancel pada MVP.

## 9. Receipt After Payment

PDF receipt hanya dibuat setelah payment tervalidasi dan booking confirmed.

## 10. Dashboard Is Read Only

Admin dashboard versi MVP hanya digunakan untuk monitoring dan visualisasi.

---

# 54. MVP Definition of Done

MVP dianggap selesai apabila seluruh flow berikut berjalan end-to-end:

1. Customer mengirim WhatsApp.
2. WhatsApp Cloud API mengirim webhook ke Hono.
3. Backend memvalidasi whitelist.
4. Customer dikenali berdasarkan nomor WhatsApp.
5. Nama customer diambil dari WhatsApp profile apabila tersedia.
6. LLM memahami request bahasa natural.
7. Customer dapat mengecek Lapangan 1 dan Lapangan 2.
8. Sistem mendukung booking multi-hour dalam kelipatan satu jam.
9. Sistem tidak membatasi booking berdasarkan jam operasional.
10. Sistem menghitung harga Rp100.000 per jam.
11. Sistem mencegah double booking.
12. Customer mendapatkan booking summary.
13. Customer melakukan confirmation.
14. Backend melakukan re-check availability.
15. Backend membuat PENDING_PAYMENT booking.
16. Slot di-hold selama 5 menit.
17. Backend membuat transaksi Midtrans.
18. Customer mendapatkan payment link.
19. Backend menerima payment webhook.
20. Backend memverifikasi payment.
21. Payment berubah menjadi PAID.
22. Booking berubah menjadi CONFIRMED.
23. Backend membuat PDF payment receipt sendiri.
24. Receipt disimpan.
25. Confirmation dan receipt dikirim melalui WhatsApp.
26. Booking muncul pada Admin Dashboard.
27. Payment yang tidak selesai selama 5 menit membuat booking EXPIRED.
28. Slot booking expired tersedia kembali.

---

# 55. Final System Flow Summary

```text
WHATSAPP CUSTOMER
        ↓
WHATSAPP CLOUD API
        ↓
HONO + BUN BACKEND
        ↓
CHECK WHITELIST
        ↓
IDENTIFY CUSTOMER
        ↓
OPENAI LLM
        ↓
UNDERSTAND BOOKING REQUEST
        ↓
VALIDATE BUSINESS RULES
        ↓
POSTGRESQL AVAILABILITY CHECK
        ↓
BOOKING SUMMARY
        ↓
CUSTOMER CONFIRMATION
        ↓
RE-CHECK AVAILABILITY
        ↓
CREATE PENDING_PAYMENT
        ↓
HOLD SLOT 5 MINUTES
        ↓
MIDTRANS PAYMENT
        ↓
PAYMENT SUCCESS
        ↓
MIDTRANS WEBHOOK
        ↓
VERIFY PAYMENT
        ↓
PAYMENT = PAID
        ↓
BOOKING = CONFIRMED
        ↓
GENERATE PAYMENT RECEIPT PDF
        ↓
SAVE RECEIPT
        ↓
SEND CONFIRMATION + PDF TO WHATSAPP
        ↓
SHOW BOOKING IN ADMIN DASHBOARD
```

---

# 56. Final Stack

```text
WhatsApp
└── WhatsApp Cloud API

Backend
├── Hono
├── Bun
└── TypeScript

AI
└── OpenAI API

Database
├── PostgreSQL
└── Drizzle ORM

Payment
└── Midtrans

Receipt
└── Backend-generated PDF

Dashboard
└── Next.js Read-only Admin Dashboard

Core Rules
├── 2 lapangan
├── 06.00-22.00 WIB
├── Rp100.000 / jam
├── durasi kelipatan 1 jam
├── whitelist nomor WhatsApp
├── identitas: nama + nomor WhatsApp
├── payment hold 5 menit
├── anti-double-booking
├── no customer cancellation
└── PDF receipt setelah payment success
```
