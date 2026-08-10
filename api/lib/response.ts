import { GoogleGenAI } from '@google/genai'
import type { IntentDetectionResult } from './intent'

type ResponseInput = {
  userName: string
  userMessage: string
  intentResult: IntentDetectionResult
  backendContext: Record<string, unknown>
}

function promptForIntent(intent: IntentDetectionResult['intent']) {
  if (intent === 'general_help') {
    return `Kamu adalah BMTennis Assistant.
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
- Jangan pakai emoji.
- Jangan pakai markdown seperti bold, backtick, atau bullet berlebihan.`
  }

  if (intent === 'check_availability') {
    return `Kamu adalah BMTennis Assistant.
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
- Jika backend_context.simulation adalah true, sebutkan secara natural bahwa ini masih simulasi sementara.
- Jangan pakai emoji.
- Jangan pakai markdown seperti bold, backtick, atau bullet berlebihan.`
  }

  return `Kamu adalah BMTennis Assistant. Balas singkat dalam bahasa Indonesia dan arahkan user untuk cek jadwal lapangan tenis.`
}

export async function generateResponse(input: ResponseInput) {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY')
    return 'Maaf, sistem sedang belum siap memproses pesan. Coba lagi sebentar ya.'
  }

  try {
    const ai = new GoogleGenAI({ apiKey })
    const model = process.env.GEMINI_RESPONSE_MODEL ?? process.env.GEMINI_INTENT_MODEL ?? 'gemini-3.6-flash'
    const interaction = await ai.interactions.create({
      model,
      input: `${promptForIntent(input.intentResult.intent)}

Data:
${JSON.stringify(input, null, 2)}

Tulis hanya final response untuk dikirim ke WhatsApp.`,
    })

    const text = interaction.output_text?.trim()
    if (!text) return 'Maaf, saya belum bisa membuat balasan. Coba lagi sebentar ya.'

    console.log('Response generated', { intent: input.intentResult.intent, response: text })
    return text
  } catch (error) {
    console.error('Gemini response error', error)
    return 'Maaf, saya sedang kesulitan membuat balasan. Coba lagi sebentar ya.'
  }
}
