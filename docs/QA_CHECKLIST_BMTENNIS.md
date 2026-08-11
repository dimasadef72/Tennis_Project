# QA Checklist — BMTennis Assistant

Checklist manual buat ngetes chatbot lewat WhatsApp. Centang tiap item, catat kalau ada yang meleset dari "Ekspektasi".

Sebelum mulai:

- Pastikan nomor HP penguji ada di whitelist (`/admin`, atau whitelist kosong = semua boleh).
- Pastikan `MIDTRANS_IS_PRODUCTION=false` (sandbox) selama testing biar gak kena charge asli.
- Testing timing (§7) butuh nunggu beneran — sisain waktu, jangan buru-buru.

---

## 1. General Help

- [ ] `halo` — **Ekspektasi:** sapaan ramah + perkenalan singkat.
- [ ] `menu` — **Ekspektasi:** kasih contoh format pesan.
- [ ] `bisa bantu apa` — **Ekspektasi:** jelasin bisa cek jadwal & booking.
- [ ] `harga sejam berapa` — **Ekspektasi:** sebut tarif per jam (dari `BOOKING_HOURLY_RATE`).
- [ ] `kalau 3 jam berapa` — **Ekspektasi:** hitung total = 3 x tarif per jam.
- [ ] `jam buka jam berapa` — **Ekspektasi:** sebut 08.00–22.00.
- [ ] `pembayaran pake apa` — **Ekspektasi:** jawab QRIS via link Midtrans setelah booking dibuat. **Bukan** ngarang alur lain (misal "konfirmasi ke pengelola").

---

## 2. Check Availability

- [ ] `hari ini ada yang kosong?` — **Ekspektasi:** daftar slot kosong hari ini (mode `daily_availability`).
- [ ] `besok jam 7 malam kosong ga` — **Ekspektasi:** jawab exact slot 19.00, tersedia/tidak.
- [ ] `lapangan 1 besok jam 8 kosong?` — **Ekspektasi:** cek spesifik Lapangan 1 saja.
- [ ] `besok jam 18-20 kosong ga` — **Ekspektasi:** dibaca sebagai 18.00–20.00, durasi 2 jam.
- [ ] `besok jam 19.30 kosong?` — **Ekspektasi:** ditolak, jelasin cuma jam bulat (invalid_time).
- [ ] `besok jam 23 kosong` — **Ekspektasi:** ditolak, di luar jam operasional (invalid_time).
- [ ] `minggu depan ada kosong?` — **Ekspektasi:** tanggal jauh tetap kebaca benar.
- [ ] Slot yang semua lapangannya penuh — **Ekspektasi:** kasih tau penuh, tawarin alternatif kalau ada.

---

## 3. Request Booking

- [ ] `booking lapangan 1 besok jam 19 2 jam` (detail lengkap sekali kirim) — **Ekspektasi:** langsung `created`, tampil kode booking + ringkasan vertikal + info hold 5 menit.
- [ ] `mau booking` (tanpa detail) — **Ekspektasi:** `needs_more_info`, nanya balik jam/durasi + kasih contoh.
- [ ] Lanjutan dari atas: balas `jam 19`, lalu `2 jam` — **Ekspektasi:** detail nyambung, akhirnya `created`.
- [ ] `booking lapangan 3` — **Ekspektasi:** `court_not_found` (lapangan cuma ada 1 & 2).
- [ ] Booking slot yang sudah dipakai booking lain — **Ekspektasi:** `slot_unavailable`, diminta pilih jam/lapangan lain.
- [ ] Setelah punya 1 booking pending, kirim request booking untuk **hari/jam lain yang gak nyambung** — **Ekspektasi (perhatikan baik-baik):** cek apakah sistem nawarin reschedule booking pertama atau malah bikin bingung. Ini area yang perlu jadi catatan, bukan cuma pass/fail.

---

## 4. Confirm Booking

- [ ] Setelah ditawarin slot dari check availability, balas `iya` — **Ekspektasi:** booking `created` dari data tawaran itu, bukan re-parsing pesan "iya".
- [ ] Setelah booking `created`, balas `lanjut bayar` — **Ekspektasi:** `payment_link_created`, link Midtrans muncul, info link berlaku 10 menit.
- [ ] Balas `iya` random tanpa ada state apa pun aktif — **Ekspektasi:** `no_pending_booking`, bukan error/crash.
- [ ] Tunggu >5 menit setelah booking dibuat, baru balas `iya` — **Ekspektasi:** booking sudah `expired`, tidak diproses sebagai konfirmasi valid.

---

## 5. Cancel Booking (fitur baru)

- [ ] Setelah booking `created` (masih pending), balas `gajadi` — **Ekspektasi:** `cancelled`, ringkasan booking yang dibatalkan ditampilkan, slot dilepas.
- [ ] Setelah ditawarin slot (booking belum benar-benar dibuat), balas `gajadi` — **Ekspektasi:** jawaban masuk akal (tidak ada yang perlu dibatalkan), bukan pesan error aneh.
- [ ] `batalin booking saya` tanpa state aktif, tapi ada booking pending dari sebelumnya — **Ekspektasi:** tetap ketemu & berhasil dibatalkan (backend cari by nomor HP, bukan cuma dari state).
- [ ] Booking sudah `confirmed` (sudah dibayar), coba `batalin` — **Ekspektasi:** ditolak dengan jelas, dijelaskan booking sudah final. **Harus TIDAK ada klaim "berhasil dibatalkan".**
- [ ] `batalin` padahal tidak ada booking sama sekali — **Ekspektasi:** `no_pending_booking`.

---

## 6. Get Booking Status

- [ ] `status booking saya gimana` — **Ekspektasi:** ringkasan booking terakhir (kode, lapangan, tanggal, jam, status booking, status bayar).
- [ ] `udah dibayar belum booking saya` — **Ekspektasi:** sama seperti di atas, fokus status bayar.
- [ ] Tanya status padahal belum pernah booking — **Ekspektasi:** `not_found`.

---

## 7. Unknown / Luar Konteks

- [ ] `apa kabar` — **Ekspektasi:** fallback sopan, arahkan ke cek jadwal.
- [ ] `mau beli raket dong` — **Ekspektasi:** fallback, tidak nyambung-nyambungin ke booking.
- [ ] `refund bisa ga` — **Ekspektasi:** dijelaskan tidak tersedia, tidak ngarang proses refund.
- [ ] Pesan random/typo (`asdkjaskjd`) — **Ekspektasi:** fallback, tidak crash, tidak ngarang status booking apa pun.

---

## 8. Reschedule (sudah punya booking pending)

- [ ] Setelah punya booking pending, `ganti ke lapangan 2` — **Ekspektasi:** `awaiting_reschedule_confirmation`, tampil booking lama vs baru.
- [ ] `ganti jam 20 aja` — **Ekspektasi:** sama seperti di atas, untuk perubahan jam.
- [ ] Reschedule ke slot yang bentrok booking lain — **Ekspektasi:** `reschedule_unavailable`, booking lama tetap utuh.
- [ ] Reschedule dengan detail yang sama persis dengan booking lama — **Ekspektasi:** `no_booking_change`, tidak dianggap error.
- [ ] Setelah `awaiting_reschedule_confirmation`, balas `iya` — **Ekspektasi:** `rescheduled`, booking ter-update ke slot baru.

---

## 9. Timing / Edge Case (butuh nunggu beneran)

- [ ] Bikin booking, **jangan** minta link bayar, tunggu 5 menit — **Ekspektasi:** booking otomatis `expired`, slot lepas (coba booking ulang di jam sama harus bisa).
- [ ] Bikin booking, minta link bayar, tunggu 10 menit tanpa bayar — **Ekspektasi:** link Midtrans expired di sisi Midtrans, webhook update booking jadi `expired`.
- [ ] Chat lagi setelah idle 10+ menit, lalu balas `iya` random — **Ekspektasi:** state lama sudah TTL habis, tidak nyambung ke booking lama, dianggap `no_pending_booking`/intent baru.
- [ ] Bayar beneran di sandbox Midtrans dalam waktu — **Ekspektasi:** webhook masuk, booking `confirmed`, resi PDF terkirim via WhatsApp.

---

## 10. Sanity Check Tambahan

- [ ] Nomor HP yang **tidak** ada di whitelist (kalau whitelist diisi) kirim pesan apa pun — **Ekspektasi:** tidak ada balasan sama sekali, tidak diproses.
- [ ] Kirim 2 pesan cepat berurutan (misal `halo` lalu langsung `booking lapangan 1 besok jam 19 2 jam`) — **Ekspektasi:** tidak ada balasan ganda/kacau untuk 1 pesan yang sama.
- [ ] Cek `/admin` — booking hasil testing dari WhatsApp muncul di timeline & tabel data booking.
