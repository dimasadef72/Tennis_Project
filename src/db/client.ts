import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

// max: keep each process to a handful of connections — the pooler caps total sessions at 15,
// and Bun's --hot reload re-runs this module on every file save without closing the old client,
// so an unbounded pool here leaks a connection per reload until the whole pool is exhausted.
// idle_timeout: let unused connections close themselves instead of sitting open forever.
const client = postgres(databaseUrl, { prepare: false, max: 3, idle_timeout: 20 })

export const db = drizzle(client)
