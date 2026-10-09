import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { SUPABASE_ROOT_CA } from './supabase-ca'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * TLS for the Nexus database (Supabase, transaction pooler). The server
 * certificate is always verified: against DATABASE_CA_CERT when set (PEM; "\n"
 * escapes allowed), otherwise against the bundled Supabase root CA. Only a
 * database on localhost (CI's Postgres service) is reached without TLS.
 */
export function databaseSsl(connectionString = process.env.DATABASE_URL) {
  try {
    if (connectionString && LOCAL_HOSTS.has(new URL(connectionString).hostname)) return false
  } catch {
    // Not a URL: keep TLS.
  }
  const override = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim()
  return { ca: override || SUPABASE_ROOT_CA, rejectUnauthorized: true }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl(),
})

export const db = drizzle(pool, { schema })
