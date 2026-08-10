import OpenAI from "openai";
import type { IntentDetectionResult } from "./intent";

type ResponseInput = {
  userName: string;
  userMessage: string;
  intentResult: IntentDetectionResult;
  backendContext: Record<string, unknown>;
};

function promptForIntent(intent: IntentDetectionResult["intent"]) {
  if (intent === "general_help") {
    return `Kamu adalah BMTennis Assistant, asisten booking lapangan tenis Babatan Mukti.
User sedang menyapa atau meminta bantuan umum.

Tugas:
- Balas dengan ramah, profesional, sopan, dan natural dalam bahasa Indonesia.
- Sebut nama user jika tersedia.
- Fokus utama: perkenalkan singkat bahwa BMTennis Assistant membantu cek jadwal dan booking lapangan tenis Babatan Mukti.
- Jika user hanya menyapa, cukup balas sapaan + perkenalan singkat + tawaran bantuan.
- Jika user meminta menu/bantuan/cara pakai, baru beri contoh pesan secara natural.
- Contoh boleh ditulis seperti: Anda bisa menanyakan "hari ini ada lapangan kosong?".
- Akhiri dengan pertanyaan singkat yang membantu user melanjutkan.
- Jangan menyebut fitur yang belum tersedia seperti cancel booking, refund, dashboard, atau pembayaran manual.
- Jangan mengarang ketersediaan lapangan.
- Jangan mengarang status booking.
- Jangan mengulang struktur kalimat yang sama untuk semua sapaan.
- Maksimal 2 kalimat pendek untuk sapaan biasa, maksimal 3 kalimat pendek untuk menu/bantuan.
- Gunakan sapaan profesional seperti Saya/Anda, bukan aku/kamu.
- Jangan pakai emoji.
- Jangan pakai markdown seperti bold, backtick, atau bullet berlebihan.`;
  }

  if (intent === "check_availability") {
    return `Kamu adalah BMTennis Assistant.
User sedang menanyakan ketersediaan lapangan tenis.

Tugas:
- Balas natural, singkat, dan jelas dalam bahasa Indonesia.
- Gunakan hanya data availability dari backend_context.
- Jika backend_context.error ada, sampaikan bahwa jadwal belum bisa dicek saat ini dan minta user mencoba lagi sebentar.
- Jangan mengarang slot tersedia atau status booking.
- Jika mode daily_availability, tampilkan daftar slot kosong per lapangan.
- Jika mode exact_slot, jelaskan apakah slot yang diminta tersedia dan lapangan mana yang tersedia.
- Jika ada alternatives, tawarkan alternatif secara ringkas.
- Jika ada slot tersedia, akhiri dengan pertanyaan apakah user ingin booking.
- Jangan menyuruh user mengisi format kaku jika data sudah cukup untuk ditampilkan.
- Jangan menyebut database atau proses internal.
- Jangan pakai emoji.
- Jangan pakai markdown seperti bold, backtick, atau bullet berlebihan.`;
  }

  return `Kamu adalah BMTennis Assistant. Balas singkat dalam bahasa Indonesia dan arahkan user untuk cek jadwal lapangan tenis.`;
}

export async function generateResponse(input: ResponseInput) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    return "Maaf, sistem sedang belum siap memproses pesan. Coba lagi sebentar ya.";
  }

  try {
    const client = new OpenAI();
    const model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
    const response = await client.responses.create({
      model,
      input: `${promptForIntent(input.intentResult.intent)}

Data:
${JSON.stringify(input, null, 2)}

Tulis hanya final response untuk dikirim ke WhatsApp.`,
    });

    console.log("OpenAI response usage", response.usage);

    const text = response.output_text?.trim();
    if (!text)
      return "Maaf, saya belum bisa membuat balasan. Coba lagi sebentar ya.";

    console.log("Response generated", {
      intent: input.intentResult.intent,
      response: text,
    });
    return text;
  } catch (error) {
    console.error("OpenAI response error", error);
    return "Maaf, saya sedang kesulitan membuat balasan. Coba lagi sebentar ya.";
  }
}
