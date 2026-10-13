/**
 * Server error messages in the reader's language. Actions throw English (logs,
 * tests and the Data API stay English); guard() (lib/server-action.ts) passes
 * every action error through localizeServerError for the caller's language.
 * Messages live in server-errors-table.ts ({pN} = runtime values); zod's own
 * messages are below. scripts/engine-tests.ts fails when a thrown message has
 * no translation. Client-safe and pure.
 */
import type { Locale } from './config'
import { SERVER_ERRORS } from './server-errors-table'
import { localizeCheck } from '@/lib/pipelines/check-messages'

/** zod 3 default messages (used when a schema gives none). */
const ZOD_DEFAULTS: { en: string; id: string }[] = [
  { en: 'Required', id: 'Wajib diisi' },
  { en: 'Invalid input', id: 'Masukan tidak valid' },
  { en: 'Invalid input.', id: 'Masukan tidak valid.' },
  { en: 'Invalid email', id: 'Email tidak valid' },
  { en: 'Invalid url', id: 'URL tidak valid' },
  { en: 'Invalid uuid', id: 'UUID tidak valid' },
  { en: 'Invalid date', id: 'Tanggal tidak valid' },
  { en: 'Invalid datetime', id: 'Tanggal dan waktu tidak valid' },
  { en: 'Expected {p0}, received {p1}', id: 'Diharapkan {p0}, diterima {p1}' },
  { en: 'Invalid enum value. Expected {p0}, received {p1}', id: 'Nilai tidak valid. Diharapkan {p0}, diterima {p1}' },
  { en: 'Invalid literal value, expected {p0}', id: 'Nilai tidak valid, diharapkan {p0}' },
  { en: 'String must contain at least {p0} character(s)', id: 'Minimal {p0} karakter' },
  { en: 'String must contain at most {p0} character(s)', id: 'Maksimal {p0} karakter' },
  { en: 'String must contain exactly {p0} character(s)', id: 'Harus tepat {p0} karakter' },
  { en: 'Number must be greater than or equal to {p0}', id: 'Angka harus lebih besar dari atau sama dengan {p0}' },
  { en: 'Number must be less than or equal to {p0}', id: 'Angka harus lebih kecil dari atau sama dengan {p0}' },
  { en: 'Number must be greater than {p0}', id: 'Angka harus lebih besar dari {p0}' },
  { en: 'Number must be less than {p0}', id: 'Angka harus lebih kecil dari {p0}' },
  { en: 'Expected integer, received float', id: 'Harus bilangan bulat' },
  { en: 'Array must contain at least {p0} element(s)', id: 'Minimal {p0} item' },
  { en: 'Array must contain at most {p0} element(s)', id: 'Maksimal {p0} item' },
  { en: 'Unrecognized key(s) in object: {p0}', id: 'Kunci tidak dikenal: {p0}' },
  { en: 'Something went wrong. Please try again.', id: 'Terjadi kesalahan. Silakan coba lagi.' },
]

const ALL = [...SERVER_ERRORS, ...ZOD_DEFAULTS]
const exact = new Map(ALL.filter((e) => !/\{p\d+\}/.test(e.en)).map((e) => [e.en, e.id]))
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const patterns = ALL.filter((e) => /\{p\d+\}/.test(e.en))
  .map((e) => {
    const names: string[] = []
    const source = e.en
      .split(/(\{p\d+\})/)
      .map((part) => {
        const m = /^\{(p\d+)\}$/.exec(part)
        if (!m) return escape(part)
        names.push(m[1])
        return '([\\s\\S]+?)'
      })
      .join('')
    // More literal text = more specific; try those first.
    return { re: new RegExp(`^${source}$`), names, id: e.id, literal: e.en.replace(/\{p\d+\}/g, '').length }
  })
  .sort((a, b) => b.literal - a.literal)

function translate(text: string, depth: number): string | null {
  const hit = exact.get(text)
  if (hit !== undefined) return hit
  for (const p of patterns) {
    const m = p.re.exec(text)
    if (!m) continue
    const values: Record<string, string> = {}
    p.names.forEach((n, i) => {
      // A value that is itself a known message (messages built from messages) is translated too.
      values[n] = depth < 2 ? (translate(m[i + 1], depth + 1) ?? m[i + 1]) : m[i + 1]
    })
    return p.id.replace(/\{(p\d+)\}/g, (s, n: string) => values[n] ?? s)
  }
  return null
}

export function localizeServerError(text: string, locale: Locale): string {
  if (locale === 'en' || !text) return text
  const direct = translate(text, 0)
  if (direct !== null) return direct
  // zod issues arrive as "<path>: <message>".
  const zod = /^([A-Za-z_][\w.]*): ([\s\S]+)$/.exec(text)
  if (zod) {
    const rest = translate(zod[2], 0)
    if (rest !== null) return `${zod[1]}: ${rest}`
  }
  const check = localizeCheck(text, locale)
  return check
}
