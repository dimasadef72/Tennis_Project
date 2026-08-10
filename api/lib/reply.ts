function parseAvailabilityRequest(text: string) {
  const message = text.toLowerCase()
  const hour = message.match(/(?:jam|pukul)\s*(\d{1,2})/)?.[1]
  const duration = message.match(/(\d+)\s*jam(?!\s*(?:malam|pagi|siang|sore))/)?.[1]

  if (!hour) return null

  return {
    date: message.includes('besok') ? 'besok' : 'hari ini',
    hour: Number(hour),
    duration: duration ? Number(duration) : 1,
  }
}

export function getReplyText(name: string, text: string) {
  const message = text.toLowerCase().trim()
  const request = parseAvailabilityRequest(message)

  if (request) {
    return `Siap ${name}. Saya cek dulu ya.

Request:
Tanggal: ${request.date}
Jam: ${request.hour}:00
Durasi: ${request.duration} jam

Untuk sementara, simulasi: Lapangan 1 dan Lapangan 2 tersedia.`
  }

  if (message.includes('lapangan') || message.includes('booking') || message.includes('jadwal')) {
    return `Siap ${name}. Untuk cek lapangan, kirim format:
cek lapangan [tanggal] [jam] [durasi]

Contoh:
cek lapangan besok jam 19 2 jam`
  }

  if (message.includes('halo') || message.includes('hai') || message.includes('menu') || message === '/start') {
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
