import { getAvailabilityContext } from './availability'
import { clearConversationState, getConversationState, setConversationState } from './conversation-state'
import { applyRescheduleFromState, createBookingFromState, createBookingFromWhatsApp, preparePendingPayment, proposeRescheduleFromWhatsApp } from './booking'
import { detectConfirmation, detectIntent, type IntentDetectionResult } from './intent'
import { generateResponse } from './response'

function paymentStatePayload(result: any) {
  if (result?.status === 'created' || result?.status === 'rescheduled') return result.booking
  return null
}

async function setPaymentConfirmationState(customerPhone: string, result: any) {
  const payload = paymentStatePayload(result)
  if (customerPhone && payload) await setConversationState(customerPhone, 'awaiting_payment_confirmation', payload)
}

function mergeBookingIntent(intent: IntentDetectionResult, payload: any): IntentDetectionResult {
  return {
    ...intent,
    date: intent.date ?? payload?.date ?? null,
    start_time: intent.start_time ?? payload?.start_time ?? null,
    duration_hours: intent.duration_hours ?? payload?.duration_hours ?? null,
    court_number: intent.court_number ?? payload?.court_number ?? null,
  }
}

function bookingDetailStatePayload(intent: IntentDetectionResult) {
  return {
    date: intent.date,
    start_time: intent.start_time,
    duration_hours: intent.duration_hours,
    court_number: intent.court_number,
  }
}

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
      const mergedIntent = ['last_availability_lookup', 'awaiting_booking_details'].includes(state?.state ?? '')
        ? mergeBookingIntent(intent, payload)
        : intent

      const reschedule = await proposeRescheduleFromWhatsApp({ intent: mergedIntent, customerPhone })
      if (reschedule) {
        if ((reschedule as any).status === 'awaiting_reschedule_confirmation') {
          await setConversationState(customerPhone, 'awaiting_reschedule_confirmation', reschedule)
        }
        return reschedule
      }

      const result = await createBookingFromWhatsApp({ intent: mergedIntent, customerName, customerPhone })
      if ((result as any).status === 'needs_more_info') {
        await setConversationState(customerPhone, 'awaiting_booking_details', bookingDetailStatePayload(mergedIntent))
      } else {
        await setPaymentConfirmationState(customerPhone, result)
      }
      return result
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
        await setPaymentConfirmationState(customerPhone, result)
        return { ...result, source: 'conversation_state' }
      }

      if (state?.state === 'awaiting_reschedule_confirmation') {
        const result = await applyRescheduleFromState(state)
        await clearConversationState(customerPhone)
        await setPaymentConfirmationState(customerPhone, result)
        return { ...result, source: 'conversation_state' }
      }

      if (state?.state === 'awaiting_payment_confirmation') {
        const result = await preparePendingPayment(customerPhone)
        await clearConversationState(customerPhone)
        return result
      }

      return await preparePendingPayment(customerPhone)
    } catch (error) {
      console.error('Prepare payment error', error)
      return { status: 'payment_unavailable' }
    }
  }

  return {}
}

export async function getReplyText(name: string, text: string, phone = '') {
  const state = await getConversationState(phone)
  const isAwaitingConfirmation = ['awaiting_booking_confirmation', 'awaiting_reschedule_confirmation', 'awaiting_payment_confirmation'].includes(state?.state ?? '')
  const isConfirmed = isAwaitingConfirmation ? await detectConfirmation(text, { state: state?.state, payload: state?.payload }) : false
  const intent: IntentDetectionResult = isConfirmed
    ? { intent: 'confirm_booking', date: null, start_time: null, duration_hours: null, court_number: null, booking_code: null }
    : await detectIntent(text, new Date(), state?.state === 'awaiting_booking_details' ? { state: state.state, payload: state.payload } : null)

  console.log('Intent detected', { input: text, result: intent, state: state?.state, isConfirmed })

  const backendContext = await contextForIntent(intent, name, phone)
  console.log('Backend context', { intent: intent.intent, backendContext })

  return generateResponse({
    userName: name,
    userMessage: text,
    intentResult: intent,
    backendContext,
  })
}
