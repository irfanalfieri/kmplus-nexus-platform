/**
 * Applies pending SQL migrations from drizzle/ in order, one transaction each,
 * and records them (with a SHA-256 checksum) in public.nexus_migrations.
 *
 * Dry run:  node --env-file=.env.local scripts/db-migrate.mjs
 * Apply:    node --env-file=.env.local scripts/db-migrate.mjs --apply
 *
 * Applied migrations are immutable (TD-16): if an applied file's content has
 * changed, the runner refuses to continue. Fix it by reverting the file and
 * adding a NEW migration. Rows recorded before checksums existed get their
 * checksum filled from the current file on first run (baseline).
 *
 * Bootstrap: 0000_init and 0001_enable_rls were applied by hand before this
 * runner existed; if the schema already exists they are recorded, not re-run.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import pg from 'pg'
import { scriptSsl } from './db-ssl.mjs'

const apply = process.argv.includes('--apply')
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: scriptSsl() })
await client.connect()

await client.query(`CREATE TABLE IF NOT EXISTS public.nexus_migrations (name text PRIMARY KEY, "appliedAt" timestamptz NOT NULL DEFAULT now())`)
await client.query(`ALTER TABLE public.nexus_migrations ADD COLUMN IF NOT EXISTS checksum text`)
await client.query(`ALTER TABLE public.nexus_migrations ENABLE ROW LEVEL SECURITY`)

// Line endings normalized so Windows and Unix checkouts hash the same.
const read = (file) => readFileSync(`drizzle/${file}`, 'utf8').replace(/\r\n/g, '\n')
const checksum = (text) => createHash('sha256').update(text).digest('hex')

const { rows: appliedRows } = await client.query('SELECT name, checksum FROM public.nexus_migrations')
const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]))

if (!applied.size) {
  const { rows } = await client.query(`SELECT to_regclass('public.pipelines') IS NOT NULL AS has_schema`)
  if (rows[0].has_schema) {
    for (const name of ['0000_init', '0001_enable_rls']) {
      await client.query('INSERT INTO public.nexus_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name])
      applied.set(name, null)
    }
    console.log('Bootstrapped: recorded 0000_init and 0001_enable_rls as already applied.')
  }
}

const files = readdirSync('drizzle').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()

// Integrity check for applied migrations.
const changed = []
for (const file of files) {
  const name = file.replace(/\.sql$/, '')
  if (!applied.has(name)) continue
  const sum = checksum(read(file))
  const recorded = applied.get(name)
  if (!recorded) {
    await client.query('UPDATE public.nexus_migrations SET checksum = $1 WHERE name = $2', [sum, name])
  } else if (recorded !== sum) {
    changed.push(name)
  }
}
if (changed.length) {
  console.error(`REFUSING: applied migration(s) were edited after being applied: ${changed.join(', ')}.`)
  console.error('Revert those files and put the change in a new migration. Nothing was applied.')
  await client.end()
  process.exit(1)
}

const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')))
if (!pending.length) console.log('No pending migrations.')

for (const file of pending) {
  const name = file.replace(/\.sql$/, '')
  const text = read(file)
  const statements = text
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  if (!apply) {
    console.log(`pending: ${name} (${statements.length} statements)`)
    continue
  }
  try {
    await client.query('BEGIN')
    for (const stmt of statements) await client.query(stmt)
    await client.query('INSERT INTO public.nexus_migrations (name, checksum) VALUES ($1, $2)', [name, checksum(text)])
    await client.query('COMMIT')
    console.log(`applied: ${name} (${statements.length} statements)`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`FAILED: ${name}: ${err.message}`)
    process.exitCode = 1
    break
  }
}
if (!apply && pending.length) console.log('Dry run. Pass --apply to execute.')

await client.end()
