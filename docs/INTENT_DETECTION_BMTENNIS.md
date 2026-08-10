# BMTennis Intent Detection Specification

## 1. Purpose

Intent detection is used to understand what the customer wants from a WhatsApp message.

For BMTennis, AI is used only to extract structured intent and entities from natural language.

AI must not decide:

- whether a court is available;
- whether a booking is successful;
- whether payment is paid;
- final price truth;
- whether a customer is allowed to use the bot.

Those decisions belong to the backend, database, and payment gateway.

---

## 2. Pipeline

```text
Incoming WhatsApp Message
        ↓
Whitelist Check
        ↓
Customer Identification
        ↓
AI Intent Detection
        ↓
Backend Validation
        ↓
Backend Action
        ↓
WhatsApp Reply
```

AI receives the message text and returns JSON only.

Backend validates the JSON before taking action.

---

## 3. Supported Intents

The MVP supports these intents:

```ts
type Intent =
  | 'check_availability'
  | 'request_booking'
  | 'confirm_booking'
  | 'get_booking_status'
  | 'general_help'
  | 'unknown'
```

There is no `cancel_booking` intent in the MVP.

Customer cancellation through chatbot is not supported.

---

## 4. Intent Definitions

### 4.1 `check_availability`

Customer wants to check available courts or schedules.

Examples:

```text
besok jam 7 malam lapangan kosong?
cek lapangan besok jam 19 2 jam
ada jadwal malam ini?
lapangan 1 kosong besok jam 8?
minggu depan ada lapangan kosong?
```

Expected extracted entities:

```json
{
  "intent": "check_availability",
  "date": "2026-08-11",
  "start_time": "19:00",
  "duration_hours": 2,
  "court_number": null,
  "booking_code": null
}
```

If duration is missing, return `duration_hours: null`.

Backend will ask customer for duration.

---

### 4.2 `request_booking`

Customer wants to book a court or choose an offered slot.

Examples:

```text
booking lapangan 2
ambil lapangan 1
pesan yang jam 7 malam
oke booking yang itu
saya mau lapangan 2 besok jam 19 2 jam
```

Expected extracted entities:

```json
{
  "intent": "request_booking",
  "date": "2026-08-11",
  "start_time": "19:00",
  "duration_hours": 2,
  "court_number": 2,
  "booking_code": null
}
```

If the user says "booking yang itu" and the message depends on previous context, AI may return missing entities as `null`.

Backend conversation state decides which previous offer is being referenced.

---

### 4.3 `confirm_booking`

Customer confirms a booking summary or agrees to continue.

Examples:

```text
ya
iya
benar
sudah sesuai
ok
lanjut
confirm
```

Expected extracted entities:

```json
{
  "intent": "confirm_booking",
  "date": null,
  "start_time": null,
  "duration_hours": null,
  "court_number": null,
  "booking_code": null
}
```

Backend may only treat this as confirmation if there is a pending booking summary in conversation state.

If there is no pending summary, backend should ask what the customer wants to confirm.

---

### 4.4 `get_booking_status`

Customer asks about booking, payment, or confirmation status.

Examples:

```text
cek status booking
booking saya sudah confirmed?
pembayaran saya sudah masuk?
status BMT-20260811-001 gimana?
apakah booking saya masih aktif?
```

Expected extracted entities:

```json
{
  "intent": "get_booking_status",
  "date": null,
  "start_time": null,
  "duration_hours": null,
  "court_number": null,
  "booking_code": "BMT-20260811-001"
}
```

If booking code is missing, return `booking_code: null`.

Backend can search the latest booking for the customer phone number.

---

### 4.5 `general_help`

Customer greets the bot, asks for help, or asks how to use the service.

Examples:

```text
halo
hai
menu
help
cara booking gimana?
bisa bantu apa?
```

Expected extracted entities:

```json
{
  "intent": "general_help",
  "date": null,
  "start_time": null,
  "duration_hours": null,
  "court_number": null,
  "booking_code": null
}
```

---

### 4.6 `unknown`

Message is unclear, unrelated, or unsupported.

Examples:

```text
apa kabar?
saya mau beli raket
cancel booking saya
refund bisa?
```

Expected extracted entities:

```json
{
  "intent": "unknown",
  "date": null,
  "start_time": null,
  "duration_hours": null,
  "court_number": null,
  "booking_code": null
}
```

If customer asks for cancellation, return `unknown` for MVP because cancellation is not supported.
Backend should reply that cancellation through chatbot is not available.

---

## 5. Output JSON Schema

AI must return exactly one JSON object.

```ts
type IntentDetectionResult = {
  intent:
    | 'check_availability'
    | 'request_booking'
    | 'confirm_booking'
    | 'get_booking_status'
    | 'general_help'
    | 'unknown'
  date: string | null
  start_time: string | null
  duration_hours: number | null
  court_number: 1 | 2 | null
  booking_code: string | null
}
```

Field rules:

- `date` must be ISO date `YYYY-MM-DD` when known.
- `start_time` must be `HH:mm` 24-hour format when known.
- `duration_hours` must be an integer when known.
- `court_number` must be `1`, `2`, or `null`.
- `booking_code` must be a booking code string or `null`.
- Unknown or missing values must be `null`.

---

## 6. Date and Time Interpretation

System timezone:

```text
Asia/Jakarta
```

Relative dates must be resolved using current date in Asia/Jakarta.

Examples if current date is `2026-08-10`:

```text
hari ini -> 2026-08-10
besok    -> 2026-08-11
lusa     -> 2026-08-12
```

Time normalization examples:

```text
jam 7 malam -> 19:00
jam 7 pagi  -> 07:00
pukul 19    -> 19:00
19.00       -> 19:00
```

If the user says `jam 7` without morning/afternoon/evening context, AI may infer based on tennis booking context when obvious, otherwise return `start_time: null`.

---

## 7. Backend Validation After AI

Backend must validate AI output before acting.

Validation includes:

- intent is one of the supported intents;
- date format is valid if present;
- start time format is valid if present;
- duration is an integer if present;
- court number is only 1 or 2;
- required fields exist before checking availability or creating booking.

Backend must ask follow-up questions when required fields are missing.

Examples:

```text
Missing duration_hours:
"Ingin bermain selama berapa jam?"
```

```text
Missing start_time:
"Untuk jam berapa ingin bermain?"
```

```text
Missing date:
"Untuk tanggal berapa bookingnya?"
```

---

## 8. Backend Actions by Intent

```text
general_help
  -> send help/menu message

check_availability
  -> validate required fields
  -> check database availability
  -> offer available court/alternative

request_booking
  -> validate required fields or use conversation context
  -> show booking summary
  -> wait for confirm_booking

confirm_booking
  -> only valid if pending summary exists
  -> re-check availability
  -> create PENDING_PAYMENT booking
  -> create payment link

get_booking_status
  -> lookup booking by booking_code or latest customer booking
  -> reply with booking/payment status

unknown
  -> send fallback/help message
```

---

## 9. Prompt Contract

Recommended system prompt for AI extraction:

```text
You are an intent extraction engine for BMTennis Assistant.
Return JSON only.
Do not answer the customer.
Do not decide court availability, booking success, payment status, or price truth.
Extract only the user's intent and entities from the message.
Use Asia/Jakarta timezone.
If a value is missing or uncertain, return null.
Supported intents: check_availability, request_booking, confirm_booking, get_booking_status, general_help, unknown.
There is no cancel_booking intent. Cancellation is unsupported in MVP.
```

Recommended user payload:

```json
{
  "current_date": "2026-08-10",
  "timezone": "Asia/Jakarta",
  "message": "besok jam 7 malam lapangan kosong?"
}
```

Expected AI response:

```json
{
  "intent": "check_availability",
  "date": "2026-08-11",
  "start_time": "19:00",
  "duration_hours": null,
  "court_number": null,
  "booking_code": null
}
```

---

## 10. MVP Notes

For MVP, intent detection can be AI-based while backend responses remain deterministic.

Do not let AI directly create bookings or confirm payments.

The backend remains the source of truth.
