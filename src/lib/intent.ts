import OpenAI from 'openai'
import { emptyUsage, extractUsage, type Usage } from './usage'

export type Intent =
  | 'check_availability'
  | 'request_booking'
  | 'confirm_booking'
  | 'cancel_booking'
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

export type ConfirmationDetectionResult = {
  is_confirmed: boolean
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
    'cancel_booking',
    'get_booking_status',
    'general_help',
    'unknown',
  ].includes(value?.intent)
}

function isConfirmationResult(value: any): value is ConfirmationDetectionResult {
  return typeof value?.is_confirmed === 'boolean'
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

export async function detectIntent(text: string, now = new Date(), context: Record<string, unknown> | null = null): Promise<{ result: IntentDetectionResult; usage: Usage }> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY')
    return { result: emptyResult, usage: emptyUsage() }
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
Common Indonesian chat abbreviations: bsk, bsok, besok, and bs in booking context mean besok/tomorrow. hr ini means hari ini/today. lusa means the day after tomorrow.
Normalize time to 24-hour HH:mm.
Indonesian time rules: pagi means AM; siang, sore, and malam mean PM unless the hour is already 13-23.
Examples: jam 7 malam -> 19:00, jam 7 pagi -> 07:00, pukul 19 -> 19:00.
If the message contains a whole-hour time range like 18-20, 18.00-20.00, or jam 18 sampai 20, set start_time to the first time and duration_hours to the range length.
Booking duration must be whole hours only, minimum 1 hour. 30 menit, setengah jam, 2 setengah jam, 19.30, and ranges ending at half-hours are invalid/unsupported; do not extract them as valid duration_hours.
Examples: 18.00-20.00 -> start_time 18:00 and duration_hours 2. 09.00-12.00 -> start_time 09:00 and duration_hours 3.
If duration is missing and there is no time range, return null.
If conversation_context contains a pending booking or pending payment confirmation and the user supplies or changes booking details such as court, date, time, or duration, keep intent as request_booking and extract the supplied fields.
Examples with pending booking context: "1 jam" -> intent request_booking with duration_hours 1. "hari ini jam 19" -> intent request_booking with date and start_time. "ganti ke lapangan 2" -> intent request_booking with court_number 2.
If missing or uncertain, return null.
Questions about receipt, payment proof, bukti pembayaran, PDF receipt, whether to show it on arrival, or what to do after payment should be classified as get_booking_status.
general_help is ONLY for greetings, asking how to use the bot, or basic questions about BMTennis itself (price per hour, operating hours, payment method, number of courts). Any question unrelated to BMTennis or tennis court booking (general knowledge, other topics, small talk unrelated to the service) must be classified as unknown, not general_help.
cancel_booking is used when the user wants to back out of, reject, or say never mind about whatever is currently pending: cancelling their own pending (unpaid) booking entirely, declining a newly offered slot before it becomes a booking, OR declining a proposed change/reschedule to a booking they already have (they want to keep the existing booking as-is, not lose it). This includes short rejections like "gajadi", "gak jadi", "batal", "batalin aja", "gausah diubah" when conversation_context shows a pending booking, a pending reschedule proposal, or a pending payment/booking confirmation. Cancelling the booking entirely and declining a proposed change are two different outcomes, but you do not need to tell them apart — always return cancel_booking as the intent for both, and the backend will decide the exact outcome from conversation_context.state. A confirmed (already paid) booking cannot be cancelled through chat, but you should still return cancel_booking as the intent and let the backend decide the correct outcome.

Schema:
{"intent":"check_availability|request_booking|confirm_booking|cancel_booking|get_booking_status|general_help|unknown","date":"YYYY-MM-DD|null","start_time":"HH:mm|null","duration_hours":"integer|null","court_number":"1|2|null","booking_code":"string|null"}

Examples:
Message: Lapangan 1 bsk bisa gak ya?
JSON: {"intent":"check_availability","date":"2026-08-11","start_time":null,"duration_hours":null,"court_number":1,"booking_code":null}
Message: besok jam 7 malam lapangan kosong untuk 2 jam?
JSON: {"intent":"check_availability","date":"2026-08-11","start_time":"19:00","duration_hours":2,"court_number":null,"booking_code":null}
Message: booking lapangan 1 besok jam 19 2 jam
JSON: {"intent":"request_booking","date":"2026-08-11","start_time":"19:00","duration_hours":2,"court_number":1,"booking_code":null}
Message: aku mau ambil jam 18.00 - 20.00
JSON: {"intent":"request_booking","date":null,"start_time":"18:00","duration_hours":2,"court_number":null,"booking_code":null}
Message: halo
JSON: {"intent":"general_help","date":null,"start_time":null,"duration_hours":null,"court_number":null,"booking_code":null}
Message: gajadi (conversation_context has a pending booking)
JSON: {"intent":"cancel_booking","date":null,"start_time":null,"duration_hours":null,"court_number":null,"booking_code":null}
Message: siapa presiden sekarang / dimana letak surabaya / apa kabar
JSON: {"intent":"unknown","date":null,"start_time":null,"duration_hours":null,"court_number":null,"booking_code":null}
Message: ini ditunjukin besok pas udah dateng?
JSON: {"intent":"get_booking_status","date":null,"start_time":null,"duration_hours":null,"court_number":null,"booking_code":null}

Input JSON:
${JSON.stringify({ current_date: currentDate, timezone: 'Asia/Jakarta', message: text, conversation_context: context })}`,
    })

    console.log('OpenAI intent usage', response.usage)

    const parsed = JSON.parse(response.output_text ?? '{}')
    const result = isIntentResult(parsed) ? normalizeIntentResult(parsed) : emptyResult
    return { result, usage: extractUsage(response.usage) }
  } catch (error) {
    console.error('OpenAI intent error', error)
    return { result: emptyResult, usage: emptyUsage() }
  }
}


export async function detectConfirmation(text: string, context: Record<string, unknown>): Promise<{ result: boolean; usage: Usage }> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY')
    return { result: false, usage: emptyUsage() }
  }

  try {
    const client = new OpenAI()
    const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna'
    const response = await client.responses.create({
      model,
      input: `You are a confirmation classifier for BMTennis Assistant.
Return JSON only.
The backend is waiting for the customer to confirm a pending booking action.
Decide whether the customer's latest message clearly confirms the pending action.
Return true only when the message clearly means yes/continue/approve/change it/proceed.
Return false when the message rejects, hesitates, asks a question, changes topic, or is ambiguous.
Do not extract booking details.
Do not answer the customer.

Schema:
{"is_confirmed":true|false}

Input JSON:
${JSON.stringify({ message: text, pending_action_context: context })}`,
    })

    console.log('OpenAI confirmation usage', response.usage)

    const parsed = JSON.parse(response.output_text ?? '{}')
    const result = isConfirmationResult(parsed) ? parsed.is_confirmed : false
    return { result, usage: extractUsage(response.usage) }
  } catch (error) {
    console.error('OpenAI confirmation error', error)
    return { result: false, usage: emptyUsage() }
  }
}
