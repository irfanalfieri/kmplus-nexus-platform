/**
 * Bundles a TypeScript script (resolving the @/ alias via tsconfig paths) and runs it.
 *   node scripts/run-ts.mjs scripts/engine-tests.ts
 *   node scripts/run-ts.mjs scripts/connector-harness.ts
 *   node --env-file=.env.local scripts/run-ts.mjs scripts/connector-harness.ts   # + DB fixture / private creds
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildSync } = require('esbuild')

// Inside the project so the bundle's external imports resolve from node_modules.
const outDir = join('node_modules', '.cache', 'nexus-harness')
mkdirSync(outDir, { recursive: true })
const entry = process.argv[2]
if (!entry) {
  console.error('Usage: node scripts/run-ts.mjs <file.ts>')
  process.exit(1)
}
const outfile = join(outDir, `${Date.now()}.mjs`)
try {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    packages: 'external',
    // @/ imports resolve through tsconfig.json "paths".
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
  })
  // Run from the project root so external packages resolve from node_modules.
  const { status } = spawnSync(process.execPath, ['--no-warnings', outfile], { stdio: 'inherit' })
  process.exitCode = status ?? 1
} finally {
  rmSync(outfile, { force: true })
}
