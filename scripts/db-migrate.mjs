/**
 * Applies pending SQL migrations from drizzle/ in order, one transaction each,
 * and records them in public.nexus_migrations.
 *
 * Dry run:  node --env-file=.env.local scripts/db-migrate.mjs
 * Apply:    node --env-file=.env.local scripts/db-migrate.mjs --apply
 *
 * Bootstrap: 0000_init and 0001_enable_rls were applied by hand before this
 * runner existed; if the schema already exists they are recorded, not re-run.
 */
import { readFileSync, readdirSync } from 'node:fs'
import pg from 'pg'

const apply = process.argv.includes('--apply')
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca } : { rejectUnauthorized: false } })
await client.connect()

await client.query(`CREATE TABLE IF NOT EXISTS public.nexus_migrations (name text PRIMARY KEY, "appliedAt" timestamptz NOT NULL DEFAULT now())`)
await client.query(`ALTER TABLE public.nexus_migrations ENABLE ROW LEVEL SECURITY`)

const { rows: appliedRows } = await client.query('SELECT name FROM public.nexus_migrations')
const applied = new Set(appliedRows.map((r) => r.name))

if (!applied.size) {
  const { rows } = await client.query(`SELECT to_regclass('public.pipelines') IS NOT NULL AS has_schema`)
  if (rows[0].has_schema) {
    for (const name of ['0000_init', '0001_enable_rls']) {
      await client.query('INSERT INTO public.nexus_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name])
      applied.add(name)
    }
    console.log('Bootstrapped: recorded 0000_init and 0001_enable_rls as already applied.')
  }
}

const files = readdirSync('drizzle').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')))
if (!pending.length) console.log('No pending migrations.')

for (const file of pending) {
  const name = file.replace(/\.sql$/, '')
  const statements = readFileSync(`drizzle/${file}`, 'utf8')
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
    await client.query('INSERT INTO public.nexus_migrations (name) VALUES ($1)', [name])
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
