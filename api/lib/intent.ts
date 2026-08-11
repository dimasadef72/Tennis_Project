import OpenAI from 'openai'

export type Intent =
  | 'check_availability'
  | 'request_booking'
  | 'confirm_booking'
  | 'get_booking_status'
  | 'general_help'
  | 'unknown'

export type IntentDetectionResult = {
  intent: Intent
  date: string | null
  start_time: string | null
  duration_hours: number | null
  court_number: 1 | 2 | null
  booking_code: string | null
}

const emptyResult: IntentDetectionResult = {
  intent: 'unknown',
  date: null,
  start_time: null,
  duration_hours: null,
  court_number: null,
  booking_code: null,
}

function isIntentResult(value: any): value is IntentDetectionResult {
  return [
    'check_availability',
    'request_booking',
    'confirm_booking',
    'get_booking_status',
    'general_help',
    'unknown',
  ].includes(value?.intent)
}

function normalizeIntentResult(value: IntentDetectionResult) {
  if (value.court_number !== null && value.court_number !== 1 && value.court_number !== 2) {
    value.court_number = null
  }

  if (value.duration_hours !== null && !Number.isInteger(value.duration_hours)) {
    value.duration_hours = null
  }

  return value
}

export async function detectIntent(text: string, now = new Date()): Promise<IntentDetectionResult> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY')
    return emptyResult
  }

  try {
    const client = new OpenAI()
    const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna'
    const currentDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    const response = await client.responses.create({
      model,
      input: `You are an intent extraction engine for BMTennis Assistant.
Return JSON only.
Do not answer the customer.
Do not decide court availability, booking success, payment status, or price truth.
Extract only intent and entities.
Use Asia/Jakarta timezone.
Return date as ISO YYYY-MM-DD, never words like hari ini, besok, lusa.
Normalize time to 24-hour HH:mm.
Indonesian time rules: pagi means AM; siang, sore, and malam mean PM unless the hour is already 13-23.
Examples: jam 7 malam -> 19:00, jam 7 pagi -> 07:00, pukul 19 -> 19:00.
If the message contains a time range like 18-20, 18.00-20.00, or jam 18 sampai 20, set start_time to the first time and duration_hours to the range length.
Examples: 18.00-20.00 -> start_time 18:00 and duration_hours 2.
If duration is missing and there is no time range, return null.
If missing or uncertain, return null.
There is no cancel_booking intent; cancellation is unsupported in MVP.

Schema:
{"intent":"check_availability|request_booking|confirm_booking|get_booking_status|general_help|unknown","date":"YYYY-MM-DD|null","start_time":"HH:mm|null","duration_hours":"integer|null","court_number":"1|2|null","booking_code":"string|null"}

Examples:
Message: besok jam 7 malam lapangan kosong untuk 2 jam?
JSON: {"intent":"check_availability","date":"2026-08-11","start_time":"19:00","duration_hours":2,"court_number":null,"booking_code":null}
Message: booking lapangan 1 besok jam 19 2 jam
JSON: {"intent":"request_booking","date":"2026-08-11","start_time":"19:00","duration_hours":2,"court_number":1,"booking_code":null}
Message: aku mau ambil jam 18.00 - 20.00
JSON: {"intent":"request_booking","date":null,"start_time":"18:00","duration_hours":2,"court_number":null,"booking_code":null}
Message: halo
JSON: {"intent":"general_help","date":null,"start_time":null,"duration_hours":null,"court_number":null,"booking_code":null}

Input JSON:
${JSON.stringify({ current_date: currentDate, timezone: 'Asia/Jakarta', message: text })}`,
    })

    console.log('OpenAI intent usage', response.usage)

    const parsed = JSON.parse(response.output_text ?? '{}')
    return isIntentResult(parsed) ? normalizeIntentResult(parsed) : emptyResult
  } catch (error) {
    console.error('OpenAI intent error', error)
    return emptyResult
  }
}
