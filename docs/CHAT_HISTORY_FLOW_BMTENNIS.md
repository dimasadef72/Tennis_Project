# Chat History Flow BMTennis

Dokumen ini menjelaskan alur yang disarankan untuk menambahkan chat history ke BMTennis Assistant.

Tujuan utamanya:

- menyimpan riwayat percakapan user dan AI;
- memakai 5 turn terakhir sebagai konteks bahasa;
- tetap memakai database dan `conversation_states` sebagai sumber keputusan penting;
- menyimpan token usage untuk audit biaya.

---

## 1. Prinsip Utama

Jangan campur fungsi `conversation_states` dan `chat_histories`.

```text
conversation_states = state aktif untuk keputusan sistem
chat_histories      = riwayat percakapan untuk konteks AI dan audit
backendContext      = data hasil query database untuk jawaban AI
```

Rule penting:

- Booking, pembayaran, dan konfirmasi harus berdasarkan `conversation_states` atau query database.
- Chat history hanya membantu AI memahami kalimat seperti "yang tadi", "lanjut", atau "jadinya berapa?".
- Jangan jadikan chat history sebagai sumber kebenaran booking.
- Jangan kirim semua history ke AI. Pakai 5 turn terakhir saja.

---

## 2. Schema Chat History

Satu row mewakili satu turn percakapan:

```text
User mengirim pesan -> AI membalas -> simpan 1 row
```

Schema minimal yang disarankan:

```ts
export const chatHistories = pgTable(
  'chat_histories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    name: text('name'),
    userMessage: text('user_message').notNull(),
    aiResponse: text('ai_response').notNull(),
    intent: text('intent'),
    backendContext: jsonb('backend_context'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_histories_phone_created_idx').on(table.phone, table.createdAt),
  ],
)
```

Field yang sengaja tidak disimpan dulu:

- full prompt;
- raw OpenAI response;
- semua pesan WhatsApp mentah;
- status delivery/read WhatsApp.

Tambahkan field itu nanti jika benar-benar dipakai.

---

## 3. Alur Saat Ini

Alur project sebelum chat history:

```text
1. WhatsApp webhook masuk
2. Ambil phone, name, text
3. Cek whitelist
4. getReplyText(name, text, phone)
5. getConversationState(phone)
6. Jika sedang awaiting confirmation, detectConfirmation(text, state)
7. Jika bukan confirmation, detectIntent(text, now, state)
8. contextForIntent(intent, name, phone)
9. Query/update database sesuai intent
10. generateResponse(userMessage, intentResult, backendContext)
11. sendWhatsAppText(phone, reply)
```

Belum ada penyimpanan riwayat percakapan.

---

## 4. Alur Baru Dengan Chat History

Alur yang disarankan:

```text
1. WhatsApp webhook masuk
2. Ambil phone, name, text
3. Cek whitelist
4. getReplyText(name, text, phone)
5. getConversationState(phone)
6. getRecentChatHistory(phone, 5)
7. Jika sedang awaiting confirmation, detectConfirmation(text, state + history)
8. Jika bukan confirmation, detectIntent(text, now, state + history)
9. contextForIntent(intent, name, phone)
10. Query/update database sesuai intent
11. generateResponse(userMessage, history, intentResult, backendContext)
12. Simpan chatHistories 1 row
13. sendWhatsAppText(phone, reply)
```

Diagram pendek:

```text
conversation_state + 5 chat history
              |
              v
        intent detection
              |
              v
       query DB sesuai intent
              |
              v
      generate AI response
              |
              v
        save chat history
              |
              v
       send WhatsApp reply
```

---

## 5. Urutan Yang Benar

Urutan yang benar:

```text
history DB dulu -> intent -> query DB sesuai intent -> response -> save history
```

Kenapa intent sebelum query database?

Karena sebelum intent diketahui, backend belum tahu data apa yang perlu diambil.

Contoh:

```text
"besok jam 19 kosong?"
-> intent: check_availability
-> query courts + bookings

"status booking saya?"
-> intent: get_booking_status
-> query latest booking customer

"lanjut bayar"
-> intent: confirm_booking
-> query pending booking + create Midtrans payment link
```

Jangan query semua data booking sebelum intent. Itu boros dan rawan prompt terlalu besar.

---

## 6. Pemakaian Conversation State

`conversation_states` tetap dipakai untuk flow yang harus presisi.

Contoh state:

```text
awaiting_booking_confirmation
awaiting_booking_details
awaiting_reschedule_confirmation
awaiting_payment_confirmation
last_availability_lookup
```

Contoh:

```text
User: besok jam 19 kosong?
AI: Lapangan 1 tersedia. Mau saya booking?
```

Backend menyimpan:

```ts
{
  state: 'awaiting_booking_confirmation',
  payload: {
    date: '2026-08-12',
    start_time: '19:00',
    duration_hours: 1,
    court_number: 1,
  }
}
```

Jika user membalas:

```text
iya
```

Maka booking dibuat dari `conversation_states.payload`, bukan dari chat history.

---

## 7. Pemakaian Chat History

Chat history dipakai untuk bantu AI memahami konteks bahasa.

Ambil 5 turn terakhir:

```ts
const recentHistory = await db
  .select({
    userMessage: chatHistories.userMessage,
    aiResponse: chatHistories.aiResponse,
    intent: chatHistories.intent,
  })
  .from(chatHistories)
  .where(eq(chatHistories.phone, phone))
  .orderBy(desc(chatHistories.createdAt))
  .limit(5)
```

Karena query `desc`, hasilnya perlu dibalik sebelum dikirim ke AI:

```ts
const orderedHistory = recentHistory.reverse()
```

Bentuk yang dikirim ke AI:

```ts
recent_history: orderedHistory.map((row) => ({
  user: row.userMessage,
  assistant: row.aiResponse,
  intent: row.intent,
}))
```

Jangan kirim `backendContext` lama ke AI kecuali ada kebutuhan jelas. Context lama bisa basi.

---

## 8. Payload Untuk Intent Detection

Intent detection sebaiknya menerima:

```ts
{
  current_date: currentDate,
  timezone: 'Asia/Jakarta',
  message: text,
  conversation_context: {
    state: state?.state,
    payload: state?.payload,
    recent_history: recentHistory,
  }
}
```

Tujuannya:

- `state` membantu flow konfirmasi;
- `payload` menyimpan data booking yang sedang aktif;
- `recent_history` membantu memahami referensi bahasa.

Contoh pesan:

```text
yang tadi aja tapi 2 jam
```

Intent bisa membaca history, tetapi hasil akhirnya tetap berupa struktur:

```ts
{
  intent: 'request_booking',
  date: null,
  start_time: null,
  duration_hours: 2,
  court_number: null,
  booking_code: null,
}
```

Lalu `contextForIntent` menggabungkan data yang hilang dari `conversation_states.payload` jika state-nya cocok.

---

## 9. Payload Untuk Response Generation

Response generation sebaiknya menerima:

```ts
{
  userName: name,
  userMessage: text,
  recentHistory,
  intentResult,
  backendContext,
}
```

Aturan response:

- AI hanya boleh menjawab data jadwal, booking, pembayaran dari `backendContext`.
- AI boleh memakai `recentHistory` untuk membuat jawaban lebih natural.
- AI tidak boleh mengarang slot, payment link, status booking, atau harga.

---

## 10. Token Usage

Satu turn bisa memakai lebih dari satu OpenAI call:

```text
detectIntent
detectConfirmation, jika dibutuhkan
generateResponse
```

Token yang disimpan di `chat_histories` sebaiknya total gabungan semua call dalam turn itu.

Contoh:

```ts
usage = {
  inputTokens: intent.inputTokens + confirmation.inputTokens + response.inputTokens,
  outputTokens: intent.outputTokens + confirmation.outputTokens + response.outputTokens,
  totalTokens: intent.totalTokens + confirmation.totalTokens + response.totalTokens,
}
```

Jika salah satu call tidak jalan, anggap usage-nya 0.

---

## 11. Bentuk Return Yang Disarankan

Saat ini `getReplyText()` return string.

Untuk chat history dan token usage, lebih enak ubah menjadi:

```ts
type ReplyResult = {
  text: string
  intent: string
  backendContext: Record<string, unknown>
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  error?: string
}
```

Lalu webhook bisa:

```ts
const reply = await getReplyText(name, text, phone)

await db.insert(chatHistories).values({
  phone,
  name,
  userMessage: text,
  aiResponse: reply.text,
  intent: reply.intent,
  backendContext: reply.backendContext,
  model: reply.model,
  inputTokens: reply.usage.inputTokens,
  outputTokens: reply.usage.outputTokens,
  totalTokens: reply.usage.totalTokens,
  error: reply.error,
})

await sendWhatsAppText(phone, reply.text)
```

---

## 12. Error Handling

Jika OpenAI gagal, tetap boleh simpan history.

Contoh row:

```text
user_message: "halo"
ai_response: "Maaf, saya sedang kesulitan membuat balasan. Coba lagi sebentar ya."
intent: "unknown"
error: "OpenAI response error"
```

Manfaatnya:

- admin bisa lihat user mengalami error;
- biaya/token tetap bisa diaudit jika sebagian call berhasil;
- percakapan tidak hilang.

---

## 13. Best Practice Final

Pakai aturan ini:

```text
1. conversation_states untuk keputusan penting
2. chat_histories untuk konteks percakapan dan audit
3. backendContext untuk data faktual jawaban AI
4. 5 turn terakhir saja
5. intent dulu, baru query DB sesuai intent
6. save history setelah response dibuat
```

Yang tidak perlu untuk MVP:

- tabel session terpisah;
- tabel message inbound/outbound terpisah;
- summary memory;
- vector database;
- full prompt logging.

Tambahkan hanya jika ada kebutuhan nyata.
