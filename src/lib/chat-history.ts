import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { chatHistories } from '../db/schema'
import type { Usage } from './usage'

const HISTORY_LIMIT = 5

export type ChatHistoryEntry = {
  userMessage: string
  aiResponse: string
  intent: string | null
}

export async function getRecentChatHistory(phone: string): Promise<ChatHistoryEntry[]> {
  if (!phone) return []

  const rows = await db
    .select({ userMessage: chatHistories.userMessage, aiResponse: chatHistories.aiResponse, intent: chatHistories.intent })
    .from(chatHistories)
    .where(eq(chatHistories.phone, phone))
    .orderBy(desc(chatHistories.createdAt))
    .limit(HISTORY_LIMIT)

  return rows.reverse()
}

export async function saveChatHistory(params: {
  phone: string
  name: string
  userMessage: string
  aiResponse: string
  intent: string
  backendContext: unknown
  model: string
  usage: Usage
  error?: string
  whatsappMessageId?: string
}) {
  if (!params.phone) return

  await db.insert(chatHistories).values({
    phone: params.phone,
    name: params.name,
    userMessage: params.userMessage,
    aiResponse: params.aiResponse,
    intent: params.intent,
    backendContext: params.backendContext,
    model: params.model,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    totalTokens: params.usage.totalTokens,
    error: params.error ?? null,
    whatsappMessageId: params.whatsappMessageId ?? null,
  })
}

export async function isMessageAlreadyProcessed(whatsappMessageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatHistories.id })
    .from(chatHistories)
    .where(eq(chatHistories.whatsappMessageId, whatsappMessageId))
    .limit(1)

  return Boolean(row)
}
