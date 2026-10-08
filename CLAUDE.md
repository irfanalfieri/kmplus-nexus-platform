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
```
`.env.local` points at the production Supabase DB (there is no separate dev DB yet), so treat local runs as production.

## Rules
- **pnpm only.** After any dependency change, commit `pnpm-lock.yaml`. Vercel installs with `--frozen-lockfile`, so a stale lockfile fails the deploy.
- **Schema changes:** edit `lib/db/schema.ts`, run `DATABASE_URL=postgres://unused npx drizzle-kit generate --name <change>` (or `--custom` for hand-written SQL), commit the SQL in `drizzle/`, then apply with `scripts/db-migrate.mjs --apply`. Never apply migrations by hand, or the tracking table falls out of sync. Every new table needs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (see `drizzle/0001_enable_rls.sql`): Supabase exposes `public` through its REST API, and RLS without policies blocks that while the app (connecting as `postgres`) is unaffected. Column names are camelCase and must be quoted in raw SQL (`"userId"`). Unquoted SQL creates lowercase columns and breaks Drizzle queries.
- **Server actions** (`app/actions/*`): get the session user → scope every query by `userId` → write an `audit_logs` row for mutations → `revalidatePath('/dashboard')`.
- **Credentials:** `data_sources.credentials` is encrypted with AES-256-GCM via `lib/security/credentials.ts` (`encryptCredentials(id, obj)` on write, `decryptCredentials(id, stored)` on read). Never return credentials to the client, never log them. Requires the `NEXUS_ENCRYPTION_KEY` env var (32 bytes, base64); rotating it makes existing credentials unreadable.
- **No new mock data.** Many dashboard layers are still hardcoded UI (PRD §10). Turning a mock layer real means: table → server actions → load in the layer → empty/loading/error states.
- **Connectors:** add the slug in `lib/connectors/types.ts`, the definition in `lib/connectors/catalog.ts`, the driver in `lib/connectors/drivers/<slug>.ts`, and dispatch cases in `lib/connectors/runtime.ts` (test / scan / sample). Full recipe in PRD §14.3.
- **Production errors** are hidden behind a digest. Read the real message with `vercel logs kmplus-nexus-platform.vercel.app --scope irfanalfieris-projects`.
- **Pipelines:** the definition format is the zod schema in `lib/pipelines/definition.ts` (shared by UI and engine; keep it client-safe). `engine.ts` and `transforms.ts` are pure; all I/O lives in `io.ts`; `runner.ts` records runs. Writes to customer databases only go to data sources added as destinations, never create or truncate their tables. Scheduling is Supabase pg_cron (`drizzle/0003_pipeline_scheduler.sql`) calling `/api/cron/pipelines` with `CRON_SECRET`, which must match the Vault secret `nexus_cron_secret`.
- **DB TLS:** `lib/db/index.ts` always uses TLS; set `DATABASE_CA_CERT` (Supabase CA PEM) to also verify the server certificate.
- `next.config.mjs` has `ignoreBuildErrors: true`, so the build won't catch type errors. Run `npx tsc --noEmit` and don't add new errors.

## Layout
- `app/actions/` server actions · `app/api/` auth + OAuth callbacks · `app/dashboard/` main app
- `components/dashboard/layers/` one screen per platform layer · `components/modals/` · `components/connectors/` · `components/ui/` (shadcn)
- `components/pipelines/` pipeline editor, step editors, run history
- `lib/connectors/` catalog, runtime dispatch, drivers · `lib/pipelines/` definition, engine, transforms, I/O, runner, schedule · `lib/db/` Drizzle schema + pool · `lib/security/` credential encryption · `lib/auth.ts` Better Auth
- `app/api/cron/pipelines` scheduler tick · `drizzle/` SQL migrations · `vercel.json` (functions run in Tokyo `hnd1`, next to the DB)
- `scripts/` live connector tests and DB maintenance
