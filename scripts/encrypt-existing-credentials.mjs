/**
 * Encrypts data_sources.credentials rows that were saved before encryption
 * existed. Already-encrypted rows are skipped, so it is safe to re-run.
 *
 * Dry run:  node --experimental-strip-types scripts/encrypt-existing-credentials.mjs
 * Apply:    node --experimental-strip-types scripts/encrypt-existing-credentials.mjs --apply
 *
 * Requires DATABASE_URL and the same NEXUS_ENCRYPTION_KEY the app uses.
 * Run scripts/db-repair-schema.mjs first.
 */
import pg from 'pg'
import { decryptCredentials, encryptCredentials, isEncryptedCredentials } from '../lib/security/credentials.ts'

const apply = process.argv.includes('--apply')
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

const { rows } = await client.query('select "id", "credentials" from "data_sources"')
const pending = rows.filter((r) => !isEncryptedCredentials(r.credentials))
console.log(`${rows.length} data source(s); ${pending.length} with plaintext credentials.`)

if (apply && pending.length) {
  await client.query('BEGIN')
  try {
    for (const row of pending) {
      const sealed = encryptCredentials(row.id, row.credentials ?? {})
      // Round-trip check before writing.
      JSON.stringify(decryptCredentials(row.id, sealed)) === JSON.stringify(row.credentials ?? {}) ||
        (() => { throw new Error(`Round-trip check failed for ${row.id}`) })()
      await client.query('update "data_sources" set "credentials" = $1 where "id" = $2', [sealed, row.id])
    }
    await client.query('COMMIT')
    console.log(`Encrypted ${pending.length} row(s).`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Failed, rolled back:', err.message)
    process.exitCode = 1
  }
} else if (pending.length) {
  console.log('Dry run. Pass --apply to encrypt them.')
}

await client.end()
