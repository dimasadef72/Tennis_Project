import { getAvailabilityContext } from './availability'
import { createBookingFromWhatsApp } from './booking'
import { detectIntent, type IntentDetectionResult } from './intent'
import { generateResponse } from './response'

function buildGeneralHelpContext() {
  return {
    supported_actions: ['cek jadwal lapangan', 'booking lapangan tenis'],
    example_message: 'cek lapangan besok jam 19 2 jam',
    unsupported_actions: ['cancel booking melalui chatbot', 'refund melalui chatbot'],
  }
}

async function contextForIntent(intent: IntentDetectionResult, customerName: string, customerPhone: string) {
  if (intent.intent === 'general_help') return buildGeneralHelpContext()

  if (intent.intent === 'check_availability') {
    try {
      return await getAvailabilityContext(intent)
    } catch (error) {
      console.error('Availability context error', error)
      return { error: 'availability_unavailable' }
    }
  }

  if (intent.intent === 'request_booking') {
    try {
      return await createBookingFromWhatsApp({ intent, customerName, customerPhone })
    } catch (error) {
      console.error('Create booking error', error)
      return { status: 'booking_unavailable' }
    }
  }

  return {}
}

export async function getReplyText(name: string, text: string, phone = '') {
  const intent = await detectIntent(text)
  console.log('Intent detected', { input: text, result: intent })

  const backendContext = await contextForIntent(intent, name, phone)
  console.log('Backend context', { intent: intent.intent, backendContext })

  return generateResponse({
    userName: name,
    userMessage: text,
    intentResult: intent,
    backendContext,
  })
}
