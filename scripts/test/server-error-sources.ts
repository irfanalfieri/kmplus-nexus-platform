import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Finds the user-facing messages the server code throws (throw new Error('…'),
 * zod custom messages) as templates with {pN} for runtime values, so a test can
 * check each one has a translation in lib/i18n/server-errors-table.ts.
 */
const ROOTS = ['app/actions', 'lib']
const SKIP = /lib[\\/](i18n|db[\\/]supabase-ca|pipelines[\\/]check-messages)/

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name) && !SKIP.test(p)) out.push(p)
  }
  return out
}

function toTemplate(raw: string, quote: string) {
  if (quote !== '`') return raw.replace(/\\'/g, "'").replace(/\\"/g, '"')
  let i = 0
  let out = ''
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === '$' && raw[k + 1] === '{') {
      let depth = 0
      let j = k + 1
      for (; j < raw.length; j++) {
        if (raw[j] === '{') depth++
        else if (raw[j] === '}' && --depth === 0) break
      }
      out += `{p${i++}}`
      k = j
    } else out += raw[k]
  }
  return out.replace(/\\`/g, '`')
}

const PATTERNS = [
  /throw new (?:Error|NonRetryableError|AnswerError)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*[,)]/g,
  /\.(?:min|max|length|regex|email|url|uuid|refine|nonempty|int|positive)\([^'"`)]*?(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)/g,
  /message:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
]

export function serverErrorTemplates(): { en: string; file: string }[] {
  const found = new Map<string, string>()
  for (const f of ROOTS.flatMap((r) => walk(r, []))) {
    const src = readFileSync(f, 'utf8')
    for (const re of PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const t = toTemplate(m[2], m[1]).trim()
        if (t.length < 4 || !/[a-z]/i.test(t) || /^\{p\d+\}$/.test(t)) continue
        if (!found.has(t)) found.set(t, f.replace(/\\/g, '/'))
      }
    }
  }
  return [...found.entries()].map(([en, file]) => ({ en, file }))
}
