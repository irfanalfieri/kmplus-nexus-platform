/**
 * Break-glass 2FA reset for an account no admin can reset in the app (e.g. the
 * only admin lost both their authenticator and backup codes). Same effect as
 * Settings → Members → Reset 2FA: 2FA off, all sessions and trusted devices
 * removed, and an audit_logs row. The user enrolls again at next sign-in.
 *
 *   node --env-file=.env.local scripts/reset-2fa.mjs --email someone@kmplus.co.id            # dry run
 *   node --env-file=.env.local scripts/reset-2fa.mjs --email someone@kmplus.co.id --apply    # do it
 *
 * Against production, set DATABASE_URL to the production URL. Verify the
 * person's identity out of band before running this.
 */
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { scriptSsl } from './db-ssl.mjs'

const args = process.argv.slice(2)
const email = args[args.indexOf('--email') + 1]
const apply = args.includes('--apply')
if (!args.includes('--email') || !email || email.startsWith('--')) {
  console.error('Usage: scripts/reset-2fa.mjs --email <address> [--apply]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: scriptSsl() })
await client.connect()
try {
  const { rows: [db] } = await client.query('select current_database() as name')
  const { rows: users } = await client.query('select id, email, "twoFactorEnabled" from "user" where lower(email) = lower($1)', [email])
  if (!users.length) {
    console.error(`No account with email ${email} in database ${db.name}.`)
    process.exitCode = 1
  } else {
    const u = users[0]
    const { rows: [s] } = await client.query('select count(*)::int as n from session where "userId" = $1', [u.id])
    console.log(`${db.name}: ${u.email} · 2FA ${u.twoFactorEnabled ? 'on' : 'off'} · ${s.n} session(s)`)
    if (!apply) {
      console.log('Dry run. Pass --apply to reset 2FA and sign this account out everywhere.')
    } else {
      await client.query('BEGIN')
      await client.query('update "user" set "twoFactorEnabled" = false, "updatedAt" = now() where id = $1', [u.id])
      await client.query('delete from "twoFactor" where "userId" = $1', [u.id])
      await client.query('delete from session where "userId" = $1', [u.id])
      await client.query(`delete from verification where value = $1 and identifier like 'trust-device-%'`, [u.id])
      await client.query(
        `insert into audit_logs ("id", "userId", "workspaceId", "action", "resource", "resourceId", "changes", "userAgent") values ($1, $2, null, 'RESET_2FA', 'account', $2, $3, 'scripts/reset-2fa.mjs')`,
        [`audit_${randomUUID()}`, u.id, JSON.stringify({ email: u.email, via: 'break-glass script' })]
      )
      await client.query('COMMIT')
      console.log('Done. They sign in with their password and set up 2FA again.')
    }
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error('Failed:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
