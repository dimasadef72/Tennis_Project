export function getReplyText(name: string, text: string) {
  const message = text.toLowerCase()

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
