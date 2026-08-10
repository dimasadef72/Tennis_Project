import { detectIntent, type IntentDetectionResult } from './intent'

function replyFromIntent(name: string, result: IntentDetectionResult) {
  if (result.intent === 'check_availability') {
    const missing = []
    if (!result.date) missing.push('tanggal')
    if (!result.start_time) missing.push('jam')
    if (!result.duration_hours) missing.push('durasi')

    if (missing.length) {
      return `Siap ${name}. Mohon lengkapi ${missing.join(', ')}.

Contoh:
cek lapangan besok jam 19 2 jam`
    }

    return `Siap ${name}. Saya cek dulu ya.

Request:
Tanggal: ${result.date}
Jam: ${result.start_time}
Durasi: ${result.duration_hours} jam

Untuk sementara, simulasi: Lapangan 1 dan Lapangan 2 tersedia.`
  }

  if (result.intent === 'request_booking') {
    return `Siap ${name}. Saya perlu tampilkan ringkasan booking dulu.

Untuk sekarang kirim format lengkap:
booking lapangan 1 besok jam 19 2 jam`
  }

  if (result.intent === 'confirm_booking') {
    return `Baik ${name}. Belum ada ringkasan booking yang perlu dikonfirmasi.`
  }

  if (result.intent === 'get_booking_status') {
    return `Siap ${name}. Fitur cek status booking akan aktif setelah database booking dipasang.`
  }

  if (result.intent === 'general_help') {
    return `Halo ${name}, saya BMTennis Assistant.

Saya bisa bantu cek jadwal dan booking lapangan tenis.

Ketik contoh:
cek lapangan besok jam 19 2 jam`
  }

  return `Maaf ${name}, saya belum paham.

Ketik: menu
atau contoh:
cek lapangan besok jam 19 2 jam`
}

export async function getReplyText(name: string, text: string) {
  const intent = await detectIntent(text)
  console.log('Intent detected', { input: text, result: intent })
  return replyFromIntent(name, intent)
}
