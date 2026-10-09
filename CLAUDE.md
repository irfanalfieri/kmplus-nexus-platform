# KMPlus Nexus

Enterprise integration platform (EiPaaS): connect, transform, govern, and distribute enterprise data (HR-first) for KMPlus products (KMS, LMS, TMS, PMS, CMS, IMS) and third-party systems.

**Read [docs/PRD.md](docs/PRD.md) before building a feature.** It defines the product, the glossary (§5), the requirements per layer with IDs (§7), what's real and what's still mock (§10), the target architecture (§11), and the build rules (§14). When a feature moves from mock to real, update the §10 status table in the same change.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Better Auth · Drizzle ORM on Supabase Postgres (project `kissurqzqwvkvwcyfbhc`, Tokyo, via the transaction pooler) · deployed on Vercel (push to `main` auto-deploys).

## Commands
```bash
pnpm install          # pnpm only, never npm/yarn
pnpm dev
pnpm build
vercel env pull .env.local --environment=development --scope irfanalfieris-projects --project kmplus-nexus-platform
node --env-file=.env.local scripts/db-migrate.mjs           # list pending drizzle/*.sql migrations
node --env-file=.env.local scripts/db-migrate.mjs --apply   # apply them (tracked in public.nexus_migrations)
node --env-file=.env.local --experimental-strip-types scripts/db-repair-schema.mjs   # drift check: live DB vs lib/db/schema.ts
node scripts/run-ts.mjs scripts/engine-tests.ts                                       # pipeline engine/transform/watermark tests (no DB)
node --env-file=.env.local scripts/run-ts.mjs scripts/connector-harness.ts            # test → scan → sample for every connector
node --env-file=.env.local scripts/run-ts.mjs --stubs scripts/integration-tests.ts    # server actions, permissions, worker (nexus_dev/nexus_test only)
node --env-file=.env.local --experimental-strip-types scripts/reencrypt-credentials.mjs [--apply]   # after an encryption key rotation
```
**Databases:** Production uses the `postgres` database; Preview and Development (and therefore `.env.local`) use the separate `nexus_dev` database on the same Supabase server, with their own `NEXUS_ENCRYPTION_KEY`. To migrate production, run `db-migrate` with `DATABASE_URL` set to the production URL (same as dev with `/postgres` instead of `/nexus_dev`). Production `DATABASE_URL` is a sensitive Vercel variable and can't be pulled. Dev and preview have no scheduler.

**Checks before pushing:** `pnpm typecheck`, `pnpm test:engine`, `pnpm test:integration`, `pnpm build` (CI runs the same on every push and PR; integration tests run against a Postgres service container).

## Rules
- **pnpm only.** After any dependency change, commit `pnpm-lock.yaml`. Vercel installs with `--frozen-lockfile`, so a stale lockfile fails the deploy.
- **Schema changes:** edit `lib/db/schema.ts`, run `DATABASE_URL=postgres://unused npx drizzle-kit generate --name <change>` (or `--custom` for hand-written SQL), commit the SQL in `drizzle/`, then apply with `scripts/db-migrate.mjs --apply`. Never apply migrations by hand, or the tracking table falls out of sync. **Never edit a migration that has been applied**: `db-migrate` stores a checksum and refuses to run if an applied file changed; put the change in a new migration. Every new table needs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (see `drizzle/0001_enable_rls.sql`): Supabase exposes `public` through its REST API, and RLS without policies blocks that while the app (connecting as `postgres`) is unaffected. Column names are camelCase and must be quoted in raw SQL (`"userId"`). Unquoted SQL creates lowercase columns and breaks Drizzle queries.
- **Workspaces & permissions:** all shared data belongs to a workspace (`workspaceId` column); `userId` only records who created or acted. Every server action starts with `const ctx = await requireWorkspace('<permission>')` (or no argument for read-only), validates every argument with zod, **scopes every query by `ctx.workspaceId`**, records mutations and views of real data with `recordAudit(ctx, { action, resource, resourceId, changes })` from `lib/audit.ts` (adds IP + user agent; never put secret values in `changes`), then `revalidatePath('/dashboard')`. Permissions and roles live in `lib/auth/permissions.ts` (client-safe); the UI hides controls with `useCan(permission)` from `components/workspace/workspace-context.tsx`, but the server check is the real one. Create ids with `newId('prefix')` (UUID), never `Date.now()`. New tables holding workspace data need `workspaceId` + an index. Dataset physical tables are named per workspace; existing ones keep their stored `tableName`.
- **Credentials:** `data_sources.credentials` is encrypted with AES-256-GCM via `lib/security/credentials.ts` (`encryptCredentials(id, obj)` on write, `decryptCredentials(id, stored)` on read). Never return credentials to the client, never log them. Requires `NEXUS_ENCRYPTION_KEY` (32 bytes, base64). Envelopes carry a key id; to rotate, set the new key, move the old one to `NEXUS_ENCRYPTION_KEY_PREVIOUS`, deploy, run `scripts/reencrypt-credentials.mjs --apply`, then drop the old key. Custom credential forms (REST, Salesforce) are edited with secrets masked as `KEEP` (`lib/connectors/secret-mask.ts`); add new secret fields there.
- **No new mock data.** Many dashboard layers are still hardcoded UI (PRD §10). Turning a mock layer real means: table → server actions → load in the layer → empty/loading/error states.
- **Connectors:** add the slug in `lib/connectors/types.ts`, the definition in `lib/connectors/catalog.ts`, the driver in `lib/connectors/drivers/<slug>.ts`, dispatch cases in `lib/connectors/runtime.ts` (test / scan / sample), **and a case in `scripts/connector-harness.ts`** (it warns about catalog connectors without one). Throw `NonRetryableError` (`lib/pipelines/io.ts`) for configuration problems so runs don't retry them. While `CONNECTOR_BILLING_ENABLED` isn't `true`, every connector installs free. Full recipe in PRD §14.3.
- **Email:** everything goes through `sendEmail()` in `lib/email.ts` (SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`; Brevo free tier). Without SMTP, development prints emails to the server console and production skips email verification.
- **Auth:** sign-up requires email verification (when email works) and **every account must enroll TOTP 2FA** (Better Auth `twoFactor` plugin; `/setup-2fa`, `/verify-2fa`). `requireSession()` rejects accounts without 2FA; server pages use `requirePageUser(next)`. Logins and 2FA enrollment are audited by a Better Auth plugin in `lib/auth.ts`.
- **Alerts:** failed runs (and rejected rows, if the pipeline opts in) create a `notifications` row (bell icon) via `lib/notifications.ts`, plus one email when SMTP is configured. Alerting must never fail a run.
- **Production errors** are hidden behind a digest. Read the real message with `vercel logs kmplus-nexus-platform.vercel.app --scope irfanalfieris-projects`.
- **Pipelines:** the definition format is the zod schema in `lib/pipelines/definition.ts` (shared by UI and engine; keep it client-safe). `engine.ts`, `transforms.ts` and `columns.ts` are pure (covered by `scripts/engine-tests.ts`); all I/O lives in `io.ts`; Runs execute in the background worker `jobs.ts`: `enqueueRun()` queues (one active job per pipeline), `processJobs()` claims jobs with leases and runs 5,000-row chunks, checkpointing after each (resumes across invocations, retries from the checkpoint, advances incremental watermarks in `pipelines.state` only after the whole run succeeds). Start a worker with `startWorker()` / `nudgeWorker()` (`lib/pipelines/worker.ts`, uses `after()`), never run a pipeline inline in a request. `runner.ts` keeps test runs, summaries and alerts. Timestamps without a zone are always treated as UTC. Writes to customer databases only go to data sources added as destinations, never create or truncate their tables. Scheduling is Supabase pg_cron (`drizzle/0011_scheduler_jobs.sql`, fires when a pipeline is due or a job waits) calling `/api/cron/pipelines` with `CRON_SECRET`, which must match the Vault secret `nexus_cron_secret`.
- **DB TLS:** `lib/db/index.ts` and `scripts/db-ssl.mjs` verify the server certificate against the bundled Supabase root CA (`lib/db/supabase-ca.ts`, or `DATABASE_CA_CERT`); only localhost connects without TLS. Postgres data sources choose verify / require / disable (+ CA); Supabase hosts are always verified.
- **Type errors fail the build.** Run `pnpm typecheck` before pushing.

## Layout
- `app/actions/` server actions · `app/api/` auth + OAuth callbacks · `app/dashboard/` main app
- `components/dashboard/layers/` one screen per platform layer · `components/modals/` · `components/connectors/` · `components/ui/` (shadcn)
- `components/pipelines/` pipeline editor, step editors, run history
- `lib/connectors/` catalog, runtime dispatch, drivers · `lib/pipelines/` definition, engine, transforms, I/O, runner, schedule · `lib/db/` Drizzle schema + pool · `lib/security/` credential encryption · `lib/auth.ts` Better Auth
- `app/api/cron/pipelines` scheduler tick · `drizzle/` SQL migrations · `vercel.json` (functions run in Tokyo `hnd1`, next to the DB)
- `app/actions/monitoring.ts` Monitoring, Overview + notifications · `components/dashboard/notification-bell.tsx`
- `app/actions/workspaces.ts` workspace context, switching, members, roles, invites · `app/invite/[token]` invite acceptance · `components/workspace/` switcher + context · `components/dashboard/layers/workspace-settings-layer.tsx`
- `lib/auth/session.ts` `requireWorkspace` / `requireUserId` / `newId` · `lib/safe-redirect.ts` (`?next=` must stay same-site)
- `lib/pipelines/jobs.ts` + `worker.ts` background worker · `lib/email.ts` SMTP · `lib/audit.ts` audit trail · `app/setup-2fa`, `app/verify-2fa` 2FA screens · `components/workspace/audit-log.tsx`
- `scripts/` DB maintenance (`db-migrate`, `db-repair-schema`, `reencrypt-credentials`), test runners (`run-ts.mjs`, `engine-tests.ts`, `integration-tests.ts` with `test/stubs.ts`, `connector-harness.ts`)
