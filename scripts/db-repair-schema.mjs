/**
 * Brings the live Postgres schema in line with lib/db/schema.ts.
 *
 * - Creates missing tables (e.g. connector_installs)
 * - Renames lowercase columns created without quotes (userid → "userId")
 * - Adds missing columns
 * - Never drops tables or columns; extra columns are only reported
 *
 * Dry run (prints SQL):  node --experimental-strip-types scripts/db-repair-schema.mjs
 * Apply:                 node --experimental-strip-types scripts/db-repair-schema.mjs --apply
 *
 * Requires DATABASE_URL (Supabase transaction pooler URL works).
 */
import pg from 'pg'
import { is, SQL } from 'drizzle-orm'
import { PgDialect, PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '../lib/db/schema.ts'

const apply = process.argv.includes('--apply')
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const dialect = new PgDialect()
const q = (name) => `"${name.replace(/"/g, '""')}"`

function literal(value) {
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`
}

function columnDef(col, { forAdd = false, tableHasRows = false } = {}) {
  const parts = [q(col.name), col.getSQLType()]
  if (col.primary) parts.push('PRIMARY KEY')
  const hasDefault = col.default !== undefined
  if (hasDefault) parts.push(`DEFAULT ${literal(col.default)}`)
  // Adding NOT NULL without a default to a table with rows would fail.
  if (col.notNull && !col.primary && !(forAdd && tableHasRows && !hasDefault)) parts.push('NOT NULL')
  if (col.isUnique) parts.push('UNIQUE')
  return parts.join(' ')
}

// Same TLS handling as lib/db/index.ts.
const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n')
const client = new pg.Client({ connectionString, ssl: ca ? { ca } : { rejectUnauthorized: false } })
await client.connect()

const statements = []
const warnings = []

const tables = Object.values(schema).filter((v) => is(v, PgTable))

for (const table of tables) {
  const cfg = getTableConfig(table)
  const { rows: existingCols } = await client.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [cfg.name]
  )

  if (existingCols.length === 0) {
    statements.push(`CREATE TABLE ${q(cfg.name)} (\n  ${cfg.columns.map((c) => columnDef(c)).join(',\n  ')}\n);`)
    continue
  }

  const present = new Set(existingCols.map((r) => r.column_name))
  const { rows: countRows } = await client.query(`select exists(select 1 from ${q(cfg.name)}) as has_rows`)
  const tableHasRows = countRows[0].has_rows
  const expected = new Set()

  for (const col of cfg.columns) {
    expected.add(col.name)
    if (present.has(col.name)) continue
    const lower = col.name.toLowerCase()
    if (lower !== col.name && present.has(lower)) {
      statements.push(`ALTER TABLE ${q(cfg.name)} RENAME COLUMN ${q(lower)} TO ${q(col.name)};`)
      present.delete(lower)
      present.add(col.name)
      continue
    }
    statements.push(`ALTER TABLE ${q(cfg.name)} ADD COLUMN ${columnDef(col, { forAdd: true, tableHasRows })};`)
    if (col.notNull && tableHasRows && col.default === undefined) {
      warnings.push(`${cfg.name}.${col.name} added as NULLable (table has rows, no default). Backfill, then set NOT NULL.`)
    }
  }

  for (const name of present) {
    if (!expected.has(name)) warnings.push(`${cfg.name}.${name} exists in the database but not in schema.ts (left untouched).`)
  }
}

if (statements.length === 0) {
  console.log('Schema is already in sync. Nothing to do.')
} else {
  console.log(`-- ${statements.length} statement(s)${apply ? '' : ' (dry run; pass --apply to execute)'}\n`)
  console.log(statements.join('\n\n'))
}
if (warnings.length) console.log(`\n-- Warnings:\n${warnings.map((w) => `--   ${w}`).join('\n')}`)

if (apply && statements.length) {
  try {
    await client.query('BEGIN')
    for (const stmt of statements) await client.query(stmt)
    await client.query('COMMIT')
    console.log('\nApplied successfully.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFailed, rolled back:', err.message)
    process.exitCode = 1
  }
}

await client.end()
