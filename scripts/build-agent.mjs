/**
 * Builds the Nexus Agent (agent/main.ts) into one file Nexus serves for
 * download: public/downloads/nexus-agent.mjs (Node 20+, no install needed for
 * PostgreSQL, MySQL, Supabase, REST, SAP, LDAP, Talenta and KMPlus products).
 * Oracle and Snowflake drivers are loaded when first used:
 * `npm install oracledb` / `npm install snowflake-sdk` next to the file.
 *
 *   node scripts/build-agent.mjs        (runs before `next build`)
 */
import { mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')

const LAZY = ['oracledb', 'snowflake-sdk']
const lazyDrivers = {
  name: 'lazy-optional-drivers',
  setup(b) {
    b.onResolve({ filter: new RegExp(`^(${LAZY.join('|')})$`) }, (args) => ({ path: args.path, namespace: 'lazy-driver' }))
    b.onLoad({ filter: /.*/, namespace: 'lazy-driver' }, (args) => ({
      contents: `
        import { createRequire } from 'node:module'
        const req = createRequire(process.argv[1] ?? import.meta.url)
        let mod
        const load = () => {
          if (!mod) {
            try { mod = req(${JSON.stringify(args.path)}) } catch {
              throw new Error('This connection needs the ${args.path} package: run "npm install ${args.path}" in the folder of nexus-agent.mjs, then restart the agent.')
            }
          }
          return mod
        }
        export default new Proxy({}, { get: (_t, key) => load()[key] })
      `,
      loader: 'js',
      resolveDir: process.cwd(),
    }))
  },
}

mkdirSync('public/downloads', { recursive: true })
const outfile = 'public/downloads/nexus-agent.mjs'
await build({
  entryPoints: ['agent/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  minify: true,
  legalComments: 'none',
  // Optional native add-ons some packages probe for.
  external: ['pg-native', 'cloudflare:sockets'],
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [lazyDrivers],
  logLevel: 'warning',
})
console.log(`Built ${outfile} (${(statSync(outfile).size / 1024 / 1024).toFixed(1)} MB)`)
