/**
 * Seals every data_sources.credentials row with the current NEXUS_ENCRYPTION_KEY:
 * plaintext rows (saved before encryption existed) and rows sealed with a
 * retired key (after a rotation). Rows already on the current key are skipped,
 * so it is safe to re-run.
 *
 * Dry run:  node --env-file=.env.local --experimental-strip-types scripts/reencrypt-credentials.mjs
 * Apply:    node --env-file=.env.local --experimental-strip-types scripts/reencrypt-credentials.mjs --apply
 *
 * Requires DATABASE_URL, NEXUS_ENCRYPTION_KEY (new key) and, after a rotation,
 * NEXUS_ENCRYPTION_KEY_PREVIOUS (old key) so old rows can be read.
 * Key rotation steps are in lib/security/credentials.ts.
 */
import pg from 'pg'
import { scriptSsl } from './db-ssl.mjs'
import { currentKeyId, decryptCredentials, encryptCredentials, isEncryptedCredentials, needsReencryption } from '../lib/security/credentials.ts'

const apply = process.argv.includes('--apply')
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const client = new pg.Client({ connectionString, ssl: scriptSsl() })
await client.connect()

const { rows } = await client.query('select "id", "credentials" from "data_sources"')
const pending = rows.filter((r) => needsReencryption(r.credentials))
const plaintext = pending.filter((r) => !isEncryptedCredentials(r.credentials)).length
console.log(
  `${rows.length} data source(s); current key ${currentKeyId()}; ${pending.length} to re-seal ` +
    `(${plaintext} plaintext, ${pending.length - plaintext} on an older key).`
)

if (apply && pending.length) {
  await client.query('BEGIN')
  try {
    for (const row of pending) {
      const plain = decryptCredentials(row.id, row.credentials ?? {})
      const sealed = encryptCredentials(row.id, plain)
      // Round-trip check before writing.
      if (JSON.stringify(decryptCredentials(row.id, sealed)) !== JSON.stringify(plain)) {
        throw new Error(`Round-trip check failed for ${row.id}`)
      }
      await client.query('update "data_sources" set "credentials" = $1 where "id" = $2', [sealed, row.id])
    }
    await client.query('COMMIT')
    console.log(`Re-sealed ${pending.length} row(s) with key ${currentKeyId()}.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Failed, rolled back:', err.message)
    process.exitCode = 1
  }
} else if (pending.length) {
  console.log('Dry run. Pass --apply to re-seal them.')
}

await client.end()
