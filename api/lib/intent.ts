import { GoogleGenAI } from '@google/genai'

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
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY')
    return emptyResult
  }

  try {
    const ai = new GoogleGenAI({ apiKey })
    const model = process.env.GEMINI_INTENT_MODEL ?? 'gemini-3.6-flash'
    const currentDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    const input = `You are an intent extraction engine for BMTennis Assistant.
Return JSON only.
Do not answer the customer.
Do not decide court availability, booking success, payment status, or price truth.
Extract only intent and entities.
Use Asia/Jakarta timezone.
Return date as ISO YYYY-MM-DD, never words like hari ini, besok, lusa.
Normalize time to 24-hour HH:mm.
Indonesian time rules: pagi means AM; siang, sore, and malam mean PM unless the hour is already 13-23.
Examples: jam 7 malam -> 19:00, jam 7 pagi -> 07:00, pukul 19 -> 19:00.
If duration is missing, return null.
If missing or uncertain, return null.
There is no cancel_booking intent; cancellation is unsupported in MVP.

Examples:
Message: besok jam 7 malam lapangan kosong untuk 2 jam?
JSON: {"intent":"check_availability","date":"2026-08-11","start_time":"19:00","duration_hours":2,"court_number":null,"booking_code":null}
Message: halo
JSON: {"intent":"general_help","date":null,"start_time":null,"duration_hours":null,"court_number":null,"booking_code":null}

Input JSON:
${JSON.stringify({ current_date: currentDate, timezone: 'Asia/Jakarta', message: text })}`

    const interaction = await ai.interactions.create({
      model,
      input,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              enum: ['check_availability', 'request_booking', 'confirm_booking', 'get_booking_status', 'general_help', 'unknown'],
            },
            date: { type: ['string', 'null'] },
            start_time: { type: ['string', 'null'] },
            duration_hours: { type: ['integer', 'null'] },
            court_number: { type: ['integer', 'null'] },
            booking_code: { type: ['string', 'null'] },
          },
          required: ['intent', 'date', 'start_time', 'duration_hours', 'court_number', 'booking_code'],
          additionalProperties: false,
        },
      },
    } as any)

    const parsed = JSON.parse(interaction.output_text ?? '{}')
    return isIntentResult(parsed) ? normalizeIntentResult(parsed) : emptyResult
  } catch (error) {
    console.error('Gemini intent error', error)
    return emptyResult
  }
}
