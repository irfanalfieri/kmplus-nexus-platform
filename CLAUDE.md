# KMPlus Nexus

Enterprise integration platform (EiPaaS): connect, transform, govern, and distribute enterprise data (HR-first) for KMPlus products (KMS, LMS, TMS, PMS, CMS, IMS) and third-party systems.

**Read [docs/PRD.md](docs/PRD.md) before building a feature.** It defines the product, the glossary (§5), the requirements per layer with IDs (§7), what's real and what's still mock (§10), the target architecture (§11), and the build rules (§14). When a feature moves from mock to real, update the §10 status table in the same change.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Better Auth · Drizzle ORM on Neon Postgres · deployed on Vercel (push to `main` auto-deploys).

## Commands
```bash
pnpm install          # pnpm only, never npm/yarn
pnpm dev
pnpm build
node --experimental-strip-types scripts/db-repair-schema.mjs           # diff live DB vs lib/db/schema.ts (dry run)
node --experimental-strip-types scripts/db-repair-schema.mjs --apply   # apply it
```

## Rules
- **pnpm only.** After any dependency change, commit `pnpm-lock.yaml`. Vercel installs with `--frozen-lockfile`, so a stale lockfile fails the deploy.
- **Schema changes:** edit `lib/db/schema.ts`, then run `scripts/db-repair-schema.mjs` against each environment's database. Column names are camelCase and must be quoted in raw SQL (`"userId"`). Unquoted SQL creates lowercase columns and breaks Drizzle queries.
- **Server actions** (`app/actions/*`): get the session user → scope every query by `userId` → write an `audit_logs` row for mutations → `revalidatePath('/dashboard')`.
- **Credentials:** `data_sources.credentials` is encrypted with AES-256-GCM via `lib/security/credentials.ts` (`encryptCredentials(id, obj)` on write, `decryptCredentials(id, stored)` on read). Never return credentials to the client, never log them. Requires the `NEXUS_ENCRYPTION_KEY` env var (32 bytes, base64); rotating it makes existing credentials unreadable.
- **No new mock data.** Many dashboard layers are still hardcoded UI (PRD §10). Turning a mock layer real means: table → server actions → load in the layer → empty/loading/error states.
- **Connectors:** add the slug in `lib/connectors/types.ts`, the definition in `lib/connectors/catalog.ts`, the driver in `lib/connectors/drivers/<slug>.ts`, and dispatch cases in `lib/connectors/runtime.ts` (test / scan / sample). Full recipe in PRD §14.3.
- **Production errors** are hidden behind a digest. Read the real message with `vercel logs kmplus-nexus-platform.vercel.app --scope irfanalfieris-projects`.
- `next.config.mjs` has `ignoreBuildErrors: true`, so the build won't catch type errors. Run `npx tsc --noEmit` and don't add new errors.

## Layout
- `app/actions/` server actions · `app/api/` auth + OAuth callbacks · `app/dashboard/` main app
- `components/dashboard/layers/` one screen per platform layer · `components/modals/` · `components/connectors/` · `components/ui/` (shadcn)
- `lib/connectors/` catalog, runtime dispatch, drivers · `lib/db/` Drizzle schema + pool · `lib/security/` credential encryption · `lib/auth.ts` Better Auth
- `scripts/` live connector tests and DB maintenance
