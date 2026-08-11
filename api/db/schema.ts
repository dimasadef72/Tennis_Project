import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const bookingStatus = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'cancelled',
  'expired',
])

export const courts = pgTable('courts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingCode: text('booking_code').notNull().unique(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    courtId: uuid('court_id')
      .notNull()
      .references(() => courts.id),
    bookingDate: date('booking_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    status: bookingStatus('status').notNull().default('pending'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bookings_customer_phone_idx').on(table.customerPhone),
    index('bookings_date_idx').on(table.bookingDate),
    uniqueIndex('bookings_active_slot_unique')
      .on(table.courtId, table.bookingDate, table.startTime, table.endTime)
      .where(sql`${table.status} in ('pending', 'confirmed')`),
  ],
)


export const conversationStates = pgTable('conversation_states', {
  phone: text('phone').primaryKey(),
  state: text('state').notNull(),
  payload: jsonb('payload').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
