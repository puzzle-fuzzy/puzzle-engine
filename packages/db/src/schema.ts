import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/** 账户表 - 处理用户账号登录和注册 */
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 50 }).unique().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  password: varchar('password', { length: 255 }).notNull(),
  avatar: varchar('avatar', { length: 500 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
