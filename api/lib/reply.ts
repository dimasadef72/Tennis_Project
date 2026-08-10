import { detectIntent, type IntentDetectionResult } from './intent'
import { generateResponse } from './response'

function todayInJakarta() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

function addHours(time: string, hours: number) {
  const [hour, minute] = time.split(':').map(Number)
  return `${String(hour + hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function buildGeneralHelpContext() {
  return {
    supported_actions: ['cek jadwal lapangan', 'booking lapangan tenis'],
    example_message: 'cek lapangan besok jam 19 2 jam',
    unsupported_actions: ['cancel booking melalui chatbot', 'refund melalui chatbot'],
  }
}

function buildAvailabilityContext(intent: IntentDetectionResult) {
  const date = intent.date ?? todayInJakarta()
  const durationHours = intent.duration_hours ?? 1

  if (intent.start_time) {
    const requestedSlot = {
      date,
      start_time: intent.start_time,
      end_time: addHours(intent.start_time, durationHours),
      duration_hours: durationHours,
    }

    return {
      simulation: true,
      mode: 'exact_slot',
      requested_slot: requestedSlot,
      courts: intent.court_number
        ? [{ court_number: intent.court_number, status: 'available' }]
        : [
            { court_number: 1, status: 'available' },
            { court_number: 2, status: 'available' },
          ],
    }
  }

  return {
    simulation: true,
    mode: 'daily_availability',
    date,
    duration_hours: durationHours,
    slots: [
      { court_number: 1, start_time: '08:00', end_time: '09:00' },
      { court_number: 1, start_time: '10:00', end_time: '11:00' },
      { court_number: 2, start_time: '19:00', end_time: '20:00' },
    ],
  }
}

function temporaryContext(intent: IntentDetectionResult) {
  if (intent.intent === 'general_help') return buildGeneralHelpContext()
  if (intent.intent === 'check_availability') return buildAvailabilityContext(intent)
  return {}
}

export async function getReplyText(name: string, text: string) {
  const intent = await detectIntent(text)
  console.log('Intent detected', { input: text, result: intent })

  return generateResponse({
    userName: name,
    userMessage: text,
    intentResult: intent,
    backendContext: temporaryContext(intent),
  })
}
