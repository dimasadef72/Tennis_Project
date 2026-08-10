import { getAvailabilityContext } from './availability'
import { detectIntent, type IntentDetectionResult } from './intent'
import { generateResponse } from './response'

function buildGeneralHelpContext() {
  return {
    supported_actions: ['cek jadwal lapangan', 'booking lapangan tenis'],
    example_message: 'cek lapangan besok jam 19 2 jam',
    unsupported_actions: ['cancel booking melalui chatbot', 'refund melalui chatbot'],
  }
}

async function contextForIntent(intent: IntentDetectionResult) {
  if (intent.intent === 'general_help') return buildGeneralHelpContext()
  if (intent.intent === 'check_availability') return getAvailabilityContext(intent)
  return {}
}

export async function getReplyText(name: string, text: string) {
  const intent = await detectIntent(text)
  console.log('Intent detected', { input: text, result: intent })

  const backendContext = await contextForIntent(intent)
  console.log('Backend context', { intent: intent.intent, backendContext })

  return generateResponse({
    userName: name,
    userMessage: text,
    intentResult: intent,
    backendContext,
  })
}
