import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Production DB is Supabase Postgres via the transaction pooler (port 6543).
 * Supabase signs its certificates with its own CA, which Node doesn't trust by
 * default. Always use TLS; verify the server against DATABASE_CA_CERT (PEM,
 * Supabase Dashboard → Database Settings → SSL) when set, otherwise encrypt
 * without CA verification. An `sslmode` in DATABASE_URL overrides this.
 */
export function databaseSsl() {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n')
  return ca ? { ca } : { rejectUnauthorized: false }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl(),
})

export const db = drizzle(pool, { schema })
