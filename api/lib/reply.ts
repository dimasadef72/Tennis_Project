import { getAvailabilityContext } from './availability'
import { clearConversationState, getConversationState, setConversationState } from './conversation-state'
import { createBookingFromState, createBookingFromWhatsApp, preparePendingPayment } from './booking'
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
      const context = await getAvailabilityContext(intent)
      const availableCourt = (context as any).courts?.find((court: any) => court.status === 'available')

      if ((context as any).mode === 'exact_slot' && availableCourt && customerPhone) {
        await setConversationState(customerPhone, 'awaiting_booking_confirmation', {
          date: (context as any).date,
          start_time: intent.start_time,
          duration_hours: intent.duration_hours ?? 1,
          court_number: availableCourt.court_number,
        })
      }

      if ((context as any).mode === 'daily_availability' && customerPhone) {
        await setConversationState(customerPhone, 'last_availability_lookup', {
          date: (context as any).date,
          duration_hours: intent.duration_hours ?? 1,
        })
      }

      return context
    } catch (error) {
      console.error('Availability context error', error)
      return { error: 'availability_unavailable' }
    }
  }

  if (intent.intent === 'request_booking') {
    try {
      const state = await getConversationState(customerPhone)
      const payload = state?.payload as any
      const mergedIntent = state?.state === 'last_availability_lookup'
        ? {
            ...intent,
            date: intent.date ?? payload?.date ?? null,
            duration_hours: intent.duration_hours ?? payload?.duration_hours ?? null,
          }
        : intent

      return await createBookingFromWhatsApp({ intent: mergedIntent, customerName, customerPhone })
    } catch (error) {
      console.error('Create booking error', error)
      return { status: 'booking_unavailable' }
    }
  }

  if (intent.intent === 'confirm_booking') {
    try {
      const state = await getConversationState(customerPhone)

      if (state?.state === 'awaiting_booking_confirmation') {
        const result = await createBookingFromState({ state, customerName, customerPhone })
        await clearConversationState(customerPhone)
        return { ...result, source: 'conversation_state' }
      }

      return await preparePendingPayment(customerPhone)
    } catch (error) {
      console.error('Prepare payment error', error)
      return { status: 'payment_unavailable' }
    }
  }

  return {}
}

function isAffirmative(text: string) {
  return /^(iya|ya|y|ok|oke|lanjut|gas|jadi|boleh|confirm)$/i.test(text.trim())
}

export async function getReplyText(name: string, text: string, phone = '') {
  const detectedIntent = await detectIntent(text)
  const state = await getConversationState(phone)
  const intent: IntentDetectionResult = state?.state === 'awaiting_booking_confirmation' && isAffirmative(text)
    ? { ...detectedIntent, intent: 'confirm_booking' }
    : detectedIntent
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
