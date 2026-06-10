import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { getDb } from './db'

await migrate(getDb(), { migrationsFolder: './drizzle' })

console.log('迁移完成')
