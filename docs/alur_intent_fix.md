# Intent & Conversation State Flow — BMTennis Assistant

Dokumen ini menjelaskan **bagaimana tiap intent dieksekusi**, **kapan AI (OpenAI) dipanggil**, dan **bagaimana tiap conversation state dipakai** — berdasarkan kode aktual di `src/lib/reply.ts`, `src/lib/intent.ts`, `src/lib/booking.ts`, `src/lib/availability.ts`, dan `src/lib/response.ts`.

Referensi terkait:

- `docs/INTENT_DETECTION_BMTENNIS.md` — spec awal ekstraksi intent.
- `docs/RESPONSE_GENERATION_BMTENNIS.md` — spec awal penulisan balasan.
- `docs/CHAT_HISTORY_FLOW_BMTENNIS.md` — alur riwayat percakapan (`chat_histories`), sudah diimplementasi.

---

## 1. Tiga Lapis Konteks

```text
intent              = apa yang mau dilakukan user DI PESAN INI
                       (dideteksi ulang tiap pesan oleh OpenAI)

conversation_state   = apa yang backend SEDANG TUNGGU dari user
                       (disimpan di tabel conversation_states, TTL 10 menit)

chat_histories        = 5 turn terakhir, cuma bantu bahasa
                       ("yang tadi", "lanjut", "jadinya berapa")
```

Aturan tetap:

- Booking, pembayaran, dan konfirmasi **selalu** berdasarkan `conversation_states.payload` atau query database — bukan dari tebakan model, bukan dari chat history.
- `chat_histories` hanya masuk ke prompt OpenAI, tidak pernah dibaca oleh kode backend untuk mengambil keputusan.

---

## 2. Aturan Pasti: Kapan AI Dipanggil

Ini jawaban langsung buat pertanyaan "abis intent ke-detect, dia balik ke AI lagi atau udah final" — **ada aturan tetap yang berlaku buat SEMUA intent, gak ada pengecualian per-kasus**:

```text
1. detectConfirmation  -> dipanggil HANYA KALAU ada conversation_state
                           yang statusnya awaiting_* (awaiting_booking_confirmation /
                           awaiting_reschedule_confirmation / awaiting_payment_confirmation).
                           Kalau gak ada state itu, langkah ini DI-SKIP total.

2. detectIntent        -> dipanggil HANYA KALAU langkah 1 tidak menghasilkan "confirmed=true".
                           Kalau langkah 1 bilang confirmed, langkah ini DI-SKIP —
                           intent langsung dipaksa jadi confirm_booking tanpa nanya AI lagi.

3. contextForIntent     -> BUKAN AI CALL. Ini kode backend murni (query/insert/update Postgres,
                           atau baca objek statis). Untuk SEMUA 6 intent, langkah ini
                           TIDAK PERNAH manggil OpenAI.

4. generateResponse     -> SELALU dipanggil, SELALU tepat 1 kali, dan SELALU jadi
                           AI CALL TERAKHIR di turn itu. Tidak ada intent yang balik lagi
                           ke detectIntent/detectConfirmation setelah langkah ini.
                           Begitu generateResponse selesai, alur langsung ke saveChatHistory
                           + sendWhatsAppText. SELESAI.
```

Jadi per turn, jumlah AI call itu **2 atau 3**, tergantung ada/tidaknya state aktif:

| Kondisi | AI call yang jalan | Total |
|---|---|---|
| Tidak ada state `awaiting_*` aktif | `detectIntent` → `generateResponse` | **2x** |
| Ada state `awaiting_*`, dan pesan **bukan** konfirmasi | `detectConfirmation` (false) → `detectIntent` → `generateResponse` | **3x** |
| Ada state `awaiting_*`, dan pesan **adalah** konfirmasi | `detectConfirmation` (true) → `generateResponse` (skip `detectIntent`) | **2x** |

> Catatan: shortcut regex `asksAboutPayment` yang sebelumnya bisa maksa `isConfirmed = true` tanpa manggil AI sudah **dihapus** — sekarang semua keputusan konfirmasi 100% lewat `detectConfirmation`, gak ada jalur pintas keyword lagi.

`contextForIntent` (langkah 3) itu titik yang sering bikin bingung — dia **kelihatannya** kompleks (banyak percabangan, insert/update DB), tapi dia **bukan** AI call. Semua percabangannya deterministik dari `intent.intent` + `state.state`, bukan dari nanya OpenAI lagi.

---

## 3. Step Trace per Intent — Sampai Final Response

Format: `[AI]` = manggil OpenAI, `[DB]` = query/insert/update Postgres, `[LOGIC]` = kode murni tanpa I/O.

### 3.1 `general_help`

```text
1. [DB]    getConversationState(phone)          -> biasanya null (general_help jarang muncul
                                                    saat ada state awaiting_* aktif)
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectIntent(text, ...)               -> intent.intent = "general_help"
4. [LOGIC] contextForIntent -> buildGeneralHelpContext()
           -> objek statis { supported_actions, example_message, unsupported_actions }
           -> TIDAK ada query DB, TIDAK ada AI call di sini
5. [AI]    generateResponse(...)  <-- FINAL. Tulis balasan pakai prompt general_help
           + backendContext dari langkah 4.
6. [DB]    saveChatHistory + sendWhatsAppText
```

**Jawaban langsung:** general_help gak pernah "dilempar ke AI lagi" di tengah. Alurnya cuma 1x AI buat deteksi intent, lalu backend jawab dengan data statis, lalu 1x AI lagi (generateResponse) buat nulis kalimatnya — dan itu **sudah final**, langsung dikirim ke WhatsApp.

---

### 3.2 `check_availability`

```text
1. [DB]    getConversationState(phone)
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectIntent(text, ...)               -> intent.intent = "check_availability"
4. [DB]    contextForIntent -> getAvailabilityContext(intent)
           -> expireStalePendingBookings() dulu (bersihin hold basi)
           -> query courts + bookings, hitung exact_slot / daily_availability / invalid_time
5. [DB]    (kondisional) setConversationState(...)
           -> exact_slot + ada lapangan kosong  => set awaiting_booking_confirmation
           -> daily_availability                => set last_availability_lookup
           -> invalid_time / gagal              => tidak set apa-apa
6. [AI]    generateResponse(...)  <-- FINAL. Tulis balasan berdasar backendContext (mode,
           slot yang tersedia, alternatif).
7. [DB]    saveChatHistory + sendWhatsAppText
```

Tidak ada AI call kedua buat "mikirin" hasil availability — semua logic milih exact_slot vs daily_availability vs invalid_time itu `[LOGIC]`/`[DB]` murni di `availability.ts`, bukan AI.

---

### 3.3 `request_booking`

```text
1. [DB]    getConversationState(phone)
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectIntent(text, ...)               -> intent.intent = "request_booking"
4. [DB]    contextForIntent -> getConversationState(phone) lagi (re-fetch state buat merge)
5. [LOGIC] kalau state sebelumnya last_availability_lookup / awaiting_booking_details
           -> mergeBookingIntent(intent, payload)  (isi bolong tanggal/durasi/lapangan)
6. [DB]    proposeRescheduleFromWhatsApp(...)
           -> cek: user punya booking pending lain? (query bookings)
           -> kalau ADA -> lanjut ke reschedule branch (7a)
           -> kalau TIDAK ADA (null) -> lanjut ke create-baru branch (7b)

7a. [DB]   (reschedule) hasil: invalid_time / no_booking_change / court_not_found /
           reschedule_unavailable / awaiting_reschedule_confirmation
           -> kalau awaiting_reschedule_confirmation -> setConversationState(...)

7b. [DB]   (create baru) createBookingFromWhatsApp(...)
           -> hasil: needs_more_info / invalid_time / court_not_found / slot_unavailable / created
           -> needs_more_info -> setConversationState('awaiting_booking_details', ...)
           -> created         -> setPaymentConfirmationState -> setConversationState('awaiting_payment_confirmation', ...)

8. [AI]    generateResponse(...)  <-- FINAL. Tulis balasan sesuai status apa pun yang
           dihasilkan langkah 7a/7b.
9. [DB]    saveChatHistory + sendWhatsAppText
```

Sama sekali gak ada AI call tambahan buat "mutusin reschedule apa create baru" — itu murni `if (reschedule) {...} else {...}` di `contextForIntent`, dan `proposeRescheduleFromWhatsApp` sendiri cuma query database (cek ada booking pending atau nggak), bukan nanya AI.

---

### 3.4 `confirm_booking`

Ini satu-satunya intent yang **bisa dipicu tanpa `detectIntent` sama sekali** (lihat §2, baris ke-3 di tabel).

**Jalur A — dipicu lewat `detectConfirmation` (ada state aktif, user bilang "iya"):**

```text
1. [DB]    getConversationState(phone)           -> state.state = salah satu awaiting_*
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectConfirmation(text, ctx)          -> result: true
4. [LOGIC] intent dipaksa = confirm_booking TANPA manggil detectIntent
5. [DB]    contextForIntent -> getConversationState(phone) lagi -> cabang sesuai state.state:
           - awaiting_booking_confirmation   -> createBookingFromState (INSERT booking)
           - awaiting_reschedule_confirmation -> applyRescheduleFromState (UPDATE booking)
           - awaiting_payment_confirmation    -> preparePendingPayment (createMidtransPayment)
6. [DB]    clearConversationState(phone), lalu (kondisional) set state baru
           -> created/rescheduled -> awaiting_payment_confirmation
           -> payment_link_created -> tidak set state baru (sudah final)
7. [AI]    generateResponse(...)  <-- FINAL.
8. [DB]    saveChatHistory + sendWhatsAppText
```

**Jalur B — dipicu lewat `detectIntent` langsung (TIDAK ada state aktif, tapi user bilang "lanjut bayar" dari obrolan lama / booking code):**

```text
1. [DB]    getConversationState(phone)           -> null (state sudah expired / gak pernah ada)
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectConfirmation DI-SKIP (isAwaitingConfirmation = false)
4. [AI]    detectIntent(text, ...)               -> intent.intent = "confirm_booking"
5. [DB]    contextForIntent -> state null, gak match salah satu awaiting_*
           -> fallback: langsung preparePendingPayment(phone)
           -> cari booking pending TERAKHIR milik nomor itu di DB
6. [AI]    generateResponse(...)  <-- FINAL.
7. [DB]    saveChatHistory + sendWhatsAppText
```

> **Catatan:** prompt `confirm_booking` di `response.ts` masih menyebut status `payment_not_ready` ("payment gateway belum aktif, admin proses manual"), tapi **tidak ada kode yang pernah mengembalikan status ini** — sisa instruksi lama dari sebelum Midtrans terintegrasi. Harmless (model gak akan pernah pakai baris itu karena statusnya gak pernah muncul), tapi bisa dibersihkan kalau mau rapi.

---

### 3.5 `get_booking_status`

```text
1. [DB]    getConversationState(phone)
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectIntent(text, ...)               -> intent.intent = "get_booking_status"
4. [DB]    contextForIntent -> getLatestBookingStatus(phone)
           -> query 1 booking terakhir (apa pun statusnya), balikin found/not_found/missing_customer_phone
           -> TIDAK menyentuh conversation_states sama sekali
5. [AI]    generateResponse(...)  <-- FINAL.
6. [DB]    saveChatHistory + sendWhatsAppText
```

Paling simpel — gak ada percabangan state, gak ada insert/update, cuma 1 SELECT.

---

### 3.6 `unknown`

```text
1. [DB]    getConversationState(phone)
2. [DB]    getRecentChatHistory(phone)
3. [AI]    detectIntent(text, ...)               -> intent.intent = "unknown"
4. [LOGIC] contextForIntent -> tidak match salah satu dari 5 intent lain -> return {} (kosong)
5. [AI]    generateResponse(...)  <-- FINAL. Pakai prompt fallback generik ("arahkan user
           untuk cek jadwal lapangan tenis").
6. [DB]    saveChatHistory + sendWhatsAppText
```

---

## 4. Efek ke `conversation_states` per Intent — Ringkasan Tabel

| Intent | Baca state? | Bisa set state baru? | Bisa clear state? |
|---|---|---|---|
| `general_help` | tidak | tidak | tidak |
| `check_availability` | tidak (langsung query DB) | ya — `awaiting_booking_confirmation` atau `last_availability_lookup` | tidak |
| `request_booking` | ya (buat merge detail bolong) | ya — `awaiting_booking_details`, `awaiting_reschedule_confirmation`, atau `awaiting_payment_confirmation` | tidak |
| `confirm_booking` | ya (WAJIB — sumber kebenaran aksi) | ya — `awaiting_payment_confirmation` (kalau lanjut dari created/rescheduled) | ya — selalu clear di awal eksekusi cabangnya |
| `get_booking_status` | tidak | tidak | tidak |
| `unknown` | tidak | tidak | tidak |

---

## 5. Detail Lima Conversation State

Semua state disimpan di 1 row per nomor HP (`conversation_states`, primary key `phone`), TTL 10 menit dari `setConversationState` terakhir. State baru **menimpa** state lama (bukan antrian) — nomor HP cuma bisa "menunggu" 1 hal dalam satu waktu.

### `last_availability_lookup`

```text
Di-set oleh   : check_availability, mode daily_availability
Payload       : { date, duration_hours }
Dibaca oleh   : request_booking (buat isi bolong tanggal/durasi kalau user gak sebut ulang)
Di-clear oleh : tidak pernah di-clear eksplisit — ketiban state baru atau expired sendiri (TTL)
```

### `awaiting_booking_details`

```text
Di-set oleh   : request_booking, saat start_time/duration_hours masih kosong (needs_more_info)
Payload       : { date, start_time, duration_hours, court_number } — parsial, ada yang null
Dibaca oleh   : request_booking berikutnya (mergeBookingIntent, isi bolong dari sini)
Di-clear oleh : tidak eksplisit — ketiban state baru kalau booking akhirnya lengkap/berhasil
```

### `awaiting_booking_confirmation`

```text
Di-set oleh   : check_availability (exact_slot + 1 lapangan kosong)
Payload       : { date, start_time, duration_hours, court_number }
Dibaca oleh   : confirm_booking -> createBookingFromState (insert booking BENERAN dari sini,
                bukan dari pesan "iya" user)
Di-clear oleh : confirm_booking, setelah createBookingFromState dieksekusi (sukses atau gagal)
```

### `awaiting_reschedule_confirmation`

```text
Di-set oleh   : request_booking, saat user sudah punya booking pending dan minta slot baru yang valid
Payload       : { current_booking: {...}, requested_booking: {...} }
Dibaca oleh   : confirm_booking -> applyRescheduleFromState (update booking existing pakai
                current_booking.id sebagai target)
Di-clear oleh : confirm_booking, setelah applyRescheduleFromState dieksekusi
```

### `awaiting_payment_confirmation`

```text
Di-set oleh   : setPaymentConfirmationState, dipanggil setelah booking 'created' ATAU 'rescheduled'
Payload       : booking object lengkap { id, booking_code, court_name, booking_date, start_time,
                end_time, status }
Dibaca oleh   : confirm_booking -> preparePendingPayment (generate link Midtrans kalau belum ada)
Di-clear oleh : confirm_booking, setelah preparePendingPayment dieksekusi (tidak set state baru lagi)
```

Diagram alur state (jalur paling umum):

```text
check_availability (exact_slot)
        |
        v
awaiting_booking_confirmation
        |  user: "iya"
        v
confirm_booking -> createBookingFromState -> insert bookings (status pending)
        |
        v
awaiting_payment_confirmation
        |  user: "lanjut bayar"
        v
confirm_booking -> preparePendingPayment -> createMidtransPayment
        |
        v
(state di-clear, tunggu webhook Midtrans di luar percakapan)
```

Jalur alternatif kalau user udah punya booking pending & minta ubah:

```text
request_booking (ada pending booking lain)
        |
        v
proposeRescheduleFromWhatsApp -> awaiting_reschedule_confirmation
        |  user: "ya"
        v
confirm_booking -> applyRescheduleFromState -> update bookings
        |
        v
awaiting_payment_confirmation (lanjut sama seperti jalur utama)
```

⚠️ **Catatan penting (belum ditangani khusus):** kalau ada state `awaiting_*` aktif dan user malah nanya hal lain (misal `check_availability` buat jam berbeda), state lama bisa **ketiban tanpa peringatan** — lihat §7.

---

## 6. Tabel Referensi Semua Status String

Dipakai buat mapping cepat: status apa dari backend → instruksi mana di `response.ts` yang aktif.

| Status | Sumber fungsi | Dipakai di prompt intent |
|---|---|---|
| `needs_more_info` | `createBookingFromWhatsApp` | `request_booking` |
| `invalid_time` | `createBookingFromWhatsApp`, `proposeRescheduleFromWhatsApp`, `getAvailabilityContext` (mode) | `check_availability`, `request_booking` |
| `court_not_found` | `createBookingFromWhatsApp`, `proposeRescheduleFromWhatsApp` | `request_booking` |
| `slot_unavailable` | `createBookingFromWhatsApp` | `request_booking` |
| `created` | `createBookingFromWhatsApp` | `request_booking`, `confirm_booking` |
| `no_booking_change` | `proposeRescheduleFromWhatsApp` | `request_booking` |
| `reschedule_unavailable` | `proposeRescheduleFromWhatsApp`, `applyRescheduleFromState` | `request_booking`, `confirm_booking` |
| `awaiting_reschedule_confirmation` | `proposeRescheduleFromWhatsApp` | `request_booking` |
| `rescheduled` | `applyRescheduleFromState` | `confirm_booking` |
| `payment_link_created` | `preparePendingPayment` | `confirm_booking` |
| `no_pending_booking` | `preparePendingPayment` | `confirm_booking` |
| `missing_customer_phone` | `preparePendingPayment`, `getLatestBookingStatus` | `confirm_booking`, `get_booking_status` |
| `found` | `getLatestBookingStatus` | `get_booking_status` |
| `not_found` | `getLatestBookingStatus` | `get_booking_status` |
| `booking_unavailable` | catch block, `request_booking` | `request_booking` |
| `payment_unavailable` | catch block, `confirm_booking` | `confirm_booking` |
| `status_unavailable` | catch block, `get_booking_status` | `get_booking_status` |
| `payment_not_ready` | — (tidak ada kode yang mengembalikan ini) | `confirm_booking` (mati, lihat catatan §3.4) |

---

## 7. Yang Sudah Dijaga Otomatis vs Yang Belum

**Sudah dijaga:**

- **Anti double-booking**: partial unique index di Postgres (`bookings_active_slot_unique`) — race condition antar 2 request bersamaan tetap ketahan di level DB, bukan cuma cek di application code.
- **Hold 5 menit vs expiry link 10 menit**: dua cutoff terpisah di `expireStalePendingBookings` — `paymentCutoff` pakai `paymentCreatedAt` (bukan `createdAt` booking), jadi begitu link dibuat, sisa waktu bayar dihitung ulang dari situ, bukan dari waktu booking dibuat.
- **LLM tidak pernah jadi source of truth**: baik `detectIntent` maupun `detectConfirmation` cuma menghasilkan *sinyal* (intent + boolean). Semua keputusan booking/harga/status tetap query database di `booking.ts`/`availability.ts`.

**Belum ditangani (gap yang diketahui, belum di-fix):**

- **State ke-overwrite tanpa peringatan**: kalau ada `awaiting_booking_confirmation` aktif dan user nanya `check_availability` buat jam lain yang ternyata kosong, `reply.ts` bakal nimpa state itu ke tawaran baru tanpa bilang apa-apa ke user soal tawaran lama yang hilang. Kalau jam baru itu ternyata gak kosong/invalid, state lama malah tetap nyangkut (kebetulan, bukan disengaja) — behavior-nya gak konsisten tergantung hasil query.
