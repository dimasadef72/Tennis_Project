# BMTennis Response Generation Specification

## 1. Purpose

Response generation is Step 2 after intent detection.

Step 1 detects what the user means and extracts entities.

Step 2 writes the final WhatsApp message that the user will receive.

The final response should not be a rigid hardcoded template. Gemini may generate the wording, but the backend must provide clear boundaries and factual context.

---

## 2. Core Rule

```text
AI may write the message.
Backend owns the facts.
```

AI must not invent:

- court availability;
- booking success;
- payment status;
- booking price truth;
- booking codes;
- receipt status.

For intents that require factual data, backend must fetch or validate the data first, then pass that context to the response generator.

---

## 3. Pipeline

```text
User WhatsApp Message
        ↓
AI Intent Detection
        ↓
Backend Intent Router
        ↓
Backend Action / Validation
        ↓
AI Response Generation
        ↓
Send WhatsApp Reply
```

Intent detection and response generation are separate steps.

---

## 4. Response Generation Input

The response generator receives:

```ts
type ResponseGenerationInput = {
  user_name: string
  user_message: string
  intent_result: {
    intent: string
    date: string | null
    start_time: string | null
    duration_hours: number | null
    court_number: 1 | 2 | null
    booking_code: string | null
  }
  backend_context: Record<string, unknown>
}
```

`backend_context` depends on the intent.

For simple intents, it can be empty.

For action intents, it must contain backend-verified facts.

---

## 5. Intent Routing Status

```text
general_help        -> FIXED
check_availability  -> FIXED
request_booking     -> TO DISCUSS
confirm_booking     -> TO DISCUSS
get_booking_status  -> TO DISCUSS
unknown             -> TO DISCUSS
```

This document will be updated intent by intent.

---

# 6. Intent: `general_help` — FIXED

## 6.1 When This Intent Happens

`general_help` is used when the user greets the bot or asks for general help.

Examples:

```text
halo
hai
menu
bantuan
cara booking gimana?
bisa bantu apa?
```

---

## 6.2 Routing

```text
intent = general_help
        ↓
No database needed
        ↓
Generate final response with Gemini
        ↓
Send WhatsApp reply
```

This intent does not require:

- availability check;
- booking state;
- payment data;
- database lookup.

---

## 6.3 Backend Context

For `general_help`, backend context can be minimal:

```json
{
  "supported_actions": [
    "cek jadwal lapangan",
    "booking lapangan tenis"
  ],
  "example_message": "cek lapangan besok jam 19 2 jam",
  "unsupported_actions": [
    "cancel booking melalui chatbot",
    "refund melalui chatbot"
  ]
}
```

---

## 6.4 Response Prompt

Prompt for Gemini response generation:

```text
Kamu adalah BMTennis Assistant.
User sedang menyapa atau meminta bantuan umum.

Tugas:
- Balas ramah, singkat, dan natural dalam bahasa Indonesia.
- Sebut nama user jika tersedia.
- Jelaskan bahwa kamu bisa membantu cek jadwal dan booking lapangan tenis.
- Beri tepat satu contoh format pesan.
- Jangan menyebut fitur yang belum tersedia seperti cancel booking, refund, dashboard, atau pembayaran manual.
- Jangan mengarang ketersediaan lapangan.
- Jangan mengarang status booking.
- Jangan terlalu panjang.

Data:
Nama user: {user_name}
Pesan user: {user_message}
Contoh format: cek lapangan besok jam 19 2 jam
```

---

## 6.5 Expected Style

Good response example:

```text
Halo Dimas, saya BMTennis Assistant. Saya bisa bantu cek jadwal dan booking lapangan tenis. Coba kirim: "cek lapangan besok jam 19 2 jam".
```

Also acceptable:

```text
Hai Dimas, saya siap bantu cek jadwal lapangan tenis dan proses booking. Untuk mulai, kirim contoh seperti: "cek lapangan besok jam 19 2 jam".
```

---

## 6.6 Bad Responses

Do not generate responses like:

```text
Lapangan tersedia besok jam 19.
```

Reason: `general_help` does not check availability.

```text
Saya bisa bantu cancel dan refund booking kamu.
```

Reason: cancellation and refund are not supported in MVP.

```text
Booking kamu sudah dikonfirmasi.
```

Reason: booking status must come from backend/database.

---

## 6.7 Backend Behavior

For `general_help`, backend may directly call response generation.

No follow-up validation is required.

Pseudo-flow:

```text
if intent == general_help:
  response = generate_response(
    prompt = general_help_prompt,
    user_name,
    user_message,
    intent_result,
    backend_context
  )
  send_whatsapp(response)
```

---

# 7. Intent: `check_availability` — FIXED

## 7.1 When This Intent Happens

`check_availability` is used when the user asks whether a court or schedule is available.

Examples:

```text
hari ini ada yang kosong?
besok ada lapangan kosong?
besok jam 7 malam kosong?
cek lapangan besok jam 19 2 jam
lapangan 2 besok jam 8 kosong?
```

---

## 7.2 UX Principle

Do not make the user follow a rigid format.

The bot should avoid asking unnecessary follow-up questions.

Default behavior:

```text
date missing         -> use today
start_time missing   -> show available slots for the date
duration missing     -> use 1-hour slots
court_number missing -> check all courts
```

This means the user can simply ask:

```text
hari ini ada yang kosong?
```

and the system should show available slots for today.

---

## 7.3 Routing

```text
intent = check_availability
        ↓
Normalize missing fields
        ↓
If start_time exists:
  Check exact slot
Else:
  List available slots for the date
        ↓
Generate final response with Gemini using backend availability context
        ↓
Send WhatsApp reply
```

---

## 7.4 Backend Normalization

Before checking availability, backend normalizes missing values.

```ts
const date = intent.date ?? todayInAsiaJakarta
const durationHours = intent.duration_hours ?? 1
const courtNumber = intent.court_number ?? null
```

`start_time` is not required.

If `start_time` is missing, backend should list available slots for the selected date.

---

## 7.5 Exact Slot Mode

Used when user provides `start_time`.

Example user message:

```text
besok jam 19 kosong 2 jam?
```

Intent result:

```json
{
  "intent": "check_availability",
  "date": "2026-08-12",
  "start_time": "19:00",
  "duration_hours": 2,
  "court_number": null,
  "booking_code": null
}
```

Backend checks:

```text
2026-08-12 19:00-21:00
```

Backend context example:

```json
{
  "mode": "exact_slot",
  "requested_slot": {
    "date": "2026-08-12",
    "start_time": "19:00",
    "end_time": "21:00",
    "duration_hours": 2
  },
  "courts": [
    { "court_number": 1, "status": "booked" },
    { "court_number": 2, "status": "available" }
  ]
}
```

Gemini may generate:

```text
Besok pukul 19.00-21.00, Lapangan 2 tersedia. Mau saya bantu booking?
```

---

## 7.6 Daily Availability Mode

Used when user does not provide `start_time`.

Example user message:

```text
hari ini ada yang kosong?
```

Intent result:

```json
{
  "intent": "check_availability",
  "date": "2026-08-11",
  "start_time": null,
  "duration_hours": null,
  "court_number": null,
  "booking_code": null
}
```

Backend normalizes:

```text
date = 2026-08-11
duration_hours = 1
```

Backend lists all available 1-hour slots for that date.

Backend context example:

```json
{
  "mode": "daily_availability",
  "date": "2026-08-11",
  "duration_hours": 1,
  "slots": [
    { "court_number": 1, "start_time": "08:00", "end_time": "09:00" },
    { "court_number": 1, "start_time": "10:00", "end_time": "11:00" },
    { "court_number": 2, "start_time": "19:00", "end_time": "20:00" }
  ]
}
```

Gemini may generate:

```text
Hari ini masih ada beberapa slot kosong:
- Lapangan 1: 08.00-09.00, 10.00-11.00
- Lapangan 2: 19.00-20.00

Mau booking jam yang mana?
```

---

## 7.7 No Available Slot

If no courts are available for the requested date or slot, backend must state that in context.

Backend context example:

```json
{
  "mode": "exact_slot",
  "requested_slot": {
    "date": "2026-08-12",
    "start_time": "19:00",
    "end_time": "21:00",
    "duration_hours": 2
  },
  "courts": [
    { "court_number": 1, "status": "booked" },
    { "court_number": 2, "status": "booked" }
  ],
  "alternatives": [
    { "court_number": 1, "start_time": "17:00", "end_time": "19:00" },
    { "court_number": 2, "start_time": "20:00", "end_time": "22:00" }
  ]
}
```

Gemini may generate:

```text
Maaf, besok pukul 19.00-21.00 semua lapangan sudah terisi. Alternatif yang tersedia: Lapangan 1 pukul 17.00-19.00 atau Lapangan 2 pukul 20.00-22.00.
```

---

## 7.8 Response Prompt

Prompt for Gemini response generation:

```text
Kamu adalah BMTennis Assistant.
User sedang menanyakan ketersediaan lapangan tenis.

Tugas:
- Balas natural, singkat, dan jelas dalam bahasa Indonesia.
- Gunakan hanya data availability dari backend_context.
- Jangan mengarang slot tersedia atau status booking.
- Jika mode daily_availability, tampilkan daftar slot kosong per lapangan.
- Jika mode exact_slot, jelaskan apakah slot yang diminta tersedia dan lapangan mana yang tersedia.
- Jika ada alternatives, tawarkan alternatif secara ringkas.
- Jika ada slot tersedia, akhiri dengan pertanyaan apakah user ingin booking.
- Jangan menyuruh user mengisi format kaku jika data sudah cukup untuk ditampilkan.
- Jangan menyebut database atau proses internal.

Data:
Nama user: {user_name}
Pesan user: {user_message}
Intent result: {intent_result}
Backend context: {backend_context}
```

---

## 7.9 Bad Responses

Do not generate:

```text
Untuk jam berapa ingin bermain?
```

when the user only asks:

```text
hari ini ada yang kosong?
```

Reason: backend can list daily availability without asking for a specific time.

Do not generate:

```text
Lapangan 1 tersedia.
```

unless backend context says Lapangan 1 is available.

Do not generate:

```text
Silakan bayar sekarang.
```

Reason: availability check does not create booking or payment.

---

## 7.10 Backend Behavior

Pseudo-flow:

```text
if intent == check_availability:
  date = intent.date ?? today
  duration_hours = intent.duration_hours ?? 1

  if intent.start_time exists:
    backend_context = check_exact_slot(date, start_time, duration_hours, court_number)
  else:
    backend_context = list_available_slots(date, duration_hours, court_number)

  response = generate_response(
    prompt = check_availability_prompt,
    user_name,
    user_message,
    intent_result,
    backend_context
  )

  send_whatsapp(response)
```

---

# 8. Intent: `request_booking` — TO DISCUSS

This section will define how the bot responds when the user asks to book a court.

Pending decisions:

- Whether the bot can use previous availability context.
- How to display booking summary.
- When to wait for `confirm_booking`.

---

# 9. Intent: `confirm_booking` — TO DISCUSS

This section will define how the bot responds when the user confirms a booking summary.

Pending decisions:

- What happens if no pending summary exists.
- How to phrase temporary booking and payment instructions.
- When to create payment link.

---

# 10. Intent: `get_booking_status` — TO DISCUSS

This section will define how the bot responds when the user asks for booking or payment status.

Pending decisions:

- Lookup by booking code vs latest booking.
- How to show booking status and payment status.

---

# 11. Intent: `unknown` — TO DISCUSS

This section will define fallback responses for unsupported or unclear messages.

Pending decisions:

- How strict the fallback should be.
- How many examples to include.
- How to handle unsupported cancellation requests.
