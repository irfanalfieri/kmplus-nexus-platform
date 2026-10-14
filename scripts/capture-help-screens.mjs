/**
 * Captures the screenshots in Help & FAQ (lib/help/screens.ts) from the demo
 * workspace: every screen in English and Bahasa Indonesia, light and dark, as
 * WebP in public/help/screens/<lang>/<key>[-dark].webp, plus manifest.json.
 *
 *   node --env-file=.env.local scripts/run-ts.mjs --stubs scripts/seed-demo-workspace.ts   # demo data + session cookie
 *   pnpm build && pnpm start -p 3217                                                       # in another terminal
 *   node scripts/capture-help-screens.mjs [--base http://localhost:3217] [--browser <path>] [--only overview,editor]
 *
 * Uses a headless Chromium browser (Edge or Chrome) over the DevTools protocol,
 * signed in with the local demo session (node_modules/.cache, never committed).
 * Local and dev databases only: the demo workspace holds fictional people.
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const base = arg('base', 'http://localhost:3217')
const only = arg('only', '')
const OUT = 'public/help/screens'
const COOKIE_FILE = 'node_modules/.cache/demo-session-cookie.txt'
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser =
  arg('browser') ??
  process.env.BROWSER_PATH ??
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p))
if (!browser) throw new Error('No Chromium browser found; pass --browser <path>.')
if (!existsSync(COOKIE_FILE)) throw new Error(`No demo session: run scripts/seed-demo-workspace.ts first (${COOKIE_FILE}).`)

// The editor opens from a pipeline's menu, not a URL.
const OPEN_EDITOR = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const fire = (el) => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })) }
  // Prefer a pipeline with checks (the HRIS → Employee template), else the first one.
  const triggers = [...document.querySelectorAll('[data-tour="pipelines-board"] button[aria-haspopup]')]
  const trigger = triggers.find((b) => /Employee/.test(b.getAttribute('aria-label') ?? '')) ?? triggers[0]
  if (!trigger) return 'no pipeline menu'
  fire(trigger)
  await wait(700)
  const item = document.querySelector('[role="menuitem"]')
  if (!item) return 'no menu item'
  fire(item)
  await wait(4000)
  return 'ok'
})()`

const ALL_SCREENS = [
  ['overview', '/dashboard/overview'],
  ['connectors', '/dashboard/connectors'],
  ['sources', '/dashboard/sources'],
  ['pipelines', '/dashboard/pipelines'],
  ['editor', '/dashboard/pipelines', OPEN_EDITOR],
  ['rules', '/dashboard/rules'],
  ['monitoring', '/dashboard/monitoring'],
  ['quality', '/dashboard/quality'],
  ['catalog', '/dashboard/catalog'],
  ['governance', '/dashboard/governance'],
  ['analytics', '/dashboard/analytics'],
  ['settings', '/dashboard/settings'],
]
const SCREENS = ALL_SCREENS.filter(([key]) => !only || only.split(',').includes(key))

const profile = mkdtempSync(join(tmpdir(), 'nexus-shots-'))
const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })

let wsUrl
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {}
}
if (!wsUrl) throw new Error('The browser did not start.')
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
})
const send = (method, params = {}) =>
  new Promise((r) => {
    const n = ++id
    pending.set(n, r)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const host = new URL(base).hostname
const setCookie = (name, value) => send('Network.setCookie', { name, value, domain: host, path: '/' })

const [cookieName, ...cookieValue] = readFileSync(COOKIE_FILE, 'utf8').trim().split('=')
await send('Network.enable')
await send('Page.enable')
await setCookie(cookieName, cookieValue.join('='))
// Production builds behind https name the cookie __Secure-…; local http builds don't.
await send('Network.setCookie', { name: `__Secure-${cookieName}`, value: cookieValue.join('='), domain: host, path: '/', secure: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const failures = []
try {
  for (const lang of ['en', 'id']) {
    for (const theme of ['light', 'dark']) {
      await setCookie('nexus_lang', lang)
      await setCookie('nexus_theme', theme)
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
      mkdirSync(`${OUT}/${lang}`, { recursive: true })
      for (const [key, path, script] of SCREENS) {
        await send('Page.navigate', { url: base + path })
        await sleep(9000)
        if (script) {
          const r = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })
          if (r.result?.result?.value !== 'ok') failures.push(`${lang}/${key}: ${r.result?.result?.value ?? 'script failed'}`)
        }
        await send('Runtime.evaluate', { expression: 'document.activeElement?.blur?.()' })
        const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 82 })
        const file = `${OUT}/${lang}/${key}${theme === 'dark' ? '-dark' : ''}.webp`
        writeFileSync(file, Buffer.from(result.data, 'base64'))
        console.log('saved', file)
      }
    }
  }
} finally {
  ws.close()
  proc.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}

let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim()
} catch {}
writeFileSync(
  `${OUT}/manifest.json`,
  `${JSON.stringify(
    {
      what: 'Screenshots shown in Help & FAQ (/dashboard/help). Real captures of the KMPlus Nexus interface, not mock-ups or generated images.',
      data: 'Demo workspace seeded by scripts/seed-demo-workspace.ts from the fictional HR files in test-data/ (every person, NIK and email is invented).',
      captured: new Date().toISOString().slice(0, 10),
      commit,
      tool: 'scripts/capture-help-screens.mjs (headless Chromium over the DevTools protocol)',
      viewport: '1440x900 at 1x',
      format: 'WebP, quality 82',
      variants: ['en', 'id'].flatMap((lang) => ['light', 'dark'].map((theme) => `${lang}/${theme}`)),
      screens: Object.fromEntries(ALL_SCREENS.map(([key, path]) => [key, path])),
    },
    null,
    2,
  )}\n`,
)
if (failures.length) {
  console.error('Some screens did not open as expected:\n' + failures.join('\n'))
  process.exitCode = 1
}
