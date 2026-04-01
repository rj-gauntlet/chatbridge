import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'

// Supabase direct DB connection
// Format: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
// Using the service role key isn't the DB password — need DB password from Supabase settings
// We'll use the REST API approach instead

async function migrate() {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/001_init.sql'),
    'utf-8'
  )

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL not set. Get it from Supabase: Settings → Database → Connection string (URI)')
    process.exit(1)
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

  try {
    await client.connect()
    console.log('Connected to Supabase PostgreSQL')
    await client.query(sql)
    console.log('✅ Migration complete')
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

migrate()
