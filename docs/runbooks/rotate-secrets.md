# Runbook: rotate the database and mailbox passwords

The production database password and the `noreply@kmplus.co.id` mailbox password were shared in a chat transcript (2026-10-08/09). Rotate both. Changing passwords is done by a person with access to Supabase, cPanel and Vercel. Never paste new passwords into chats, tickets or command lines.

Time needed: about 15 minutes. Expect up to a minute of failed requests between steps 1 and 3.

## 1. Database password (Supabase)

1. Supabase dashboard → project **kissurqzqwvkvwcyfbhc** → **Project Settings → Database → Reset database password**. Use the generated password.
   - This is the `postgres` role. Both databases on the server use it: `postgres` (production) and `nexus_dev` (preview, development).
2. Build the two connection strings from the **Connect → Transaction pooler** URI (port 6543) with the new password:
   - production: `…/postgres`
   - preview and development: `…/nexus_dev`

## 2. Vercel environment variables

Vercel → project **kmplus-nexus-platform** → **Settings → Environment Variables**:

| Variable | Environment | Value |
|---|---|---|
| `DATABASE_URL` | Production | production string (`/postgres`). Keep it **Sensitive** |
| `DATABASE_URL` | Preview, Development | dev string (`/nexus_dev`) |
| `SMTP_PASSWORD` | Production, Preview, Development | new mailbox password (step 4) |

Using the CLI instead? Let it prompt for the value. Never pass it as an argument:

```bash
vercel env rm DATABASE_URL production --scope irfanalfieris-projects --yes
```

```bash
vercel env add DATABASE_URL production --scope irfanalfieris-projects --sensitive
```

## 3. Redeploy and refresh local settings

1. Vercel → Deployments → latest production deployment → **Redeploy**, so functions pick up the new values.
2. On each developer machine:

```bash
vercel env pull .env.local --environment=development --scope irfanalfieris-projects --project kmplus-nexus-platform
```

Not affected: the Supabase pg_cron job (it uses `CRON_SECRET` from Vault), GitHub CI (its own Postgres container), and data source credentials (they're encrypted with `NEXUS_ENCRYPTION_KEY`, not the database password).

## 4. Mailbox password (cPanel)

1. IT: cPanel → **Email Accounts** → `noreply@kmplus.co.id` → **Manage** → change the password.
2. Update `SMTP_PASSWORD` in all three Vercel environments (step 2), then redeploy (step 3).
3. Check: sign up with a test address you control, or invite a colleague in Workspace settings. The email must arrive.

## 5. Check the rotation

- `https://kmplus-nexus-platform.vercel.app/sign-in` loads, and signing in works.
- Monitoring shows runs finishing, and the scheduler keeps running.
- Run `vercel logs kmplus-nexus-platform.vercel.app --scope irfanalfieris-projects`. It shows no `password authentication failed` errors.
- The old database password no longer connects.

Afterwards, mark the "accepted risk" in `docs/PRD.md` §10 as resolved, with the date.

## Credential re-encryption (TD-22): automatic

The scheduler tick (`/api/cron/pipelines`) re-seals any data source credentials still in the old envelope with per-workspace keys, 50 per minute, using production's own `NEXUS_ENCRYPTION_KEY`. No key handling needed. To check, open Governance → Controls: "on current key" equals the number of data sources. To force it from a terminal that has the production key, run `scripts/reencrypt-credentials.mjs --apply`.
