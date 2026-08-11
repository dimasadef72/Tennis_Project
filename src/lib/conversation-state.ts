import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { conversationStates } from '../db/schema'

type ConversationState = {
  phone: string
  state: string
  payload: unknown
  expiresAt: Date
}

export async function getConversationState(phone: string): Promise<ConversationState | null> {
  if (!phone) return null

  const [row] = await db.select().from(conversationStates).where(eq(conversationStates.phone, phone)).limit(1)
  if (!row) return null

  if (row.expiresAt.getTime() <= Date.now()) {
    await clearConversationState(phone)
    return null
  }

  return {
    phone: row.phone,
    state: row.state,
    payload: row.payload,
    expiresAt: row.expiresAt,
  }
}

export async function setConversationState(phone: string, state: string, payload: unknown, ttlMinutes = 10) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)

  await db
    .insert(conversationStates)
    .values({ phone, state, payload, expiresAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: conversationStates.phone,
      set: { state, payload, expiresAt, updatedAt: new Date() },
    })
}

export async function clearConversationState(phone: string) {
  if (!phone) return
  await db.delete(conversationStates).where(eq(conversationStates.phone, phone))
}
