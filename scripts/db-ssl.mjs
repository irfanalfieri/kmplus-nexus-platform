/**
 * TLS settings for maintenance scripts: verify the Nexus DB certificate with
 * DATABASE_CA_CERT if set, otherwise the Supabase root CA bundled in
 * lib/db/supabase-ca.ts (same rule as lib/db/index.ts). A database on
 * localhost (CI's Postgres service, a local Postgres) is reached without TLS.
 */
import { readFileSync } from 'node:fs'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function scriptSsl(connectionString = process.env.DATABASE_URL) {
  try {
    if (connectionString && LOCAL_HOSTS.has(new URL(connectionString).hostname)) return false
  } catch {
    // Not a URL: fall through to TLS.
  }
  const override = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim()
  if (override) return { ca: override, rejectUnauthorized: true }
  const source = readFileSync(new URL('../lib/db/supabase-ca.ts', import.meta.url), 'utf8')
  const pem = source.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0]
  if (!pem) throw new Error('Supabase CA not found in lib/db/supabase-ca.ts')
  return { ca: pem, rejectUnauthorized: true }
}
