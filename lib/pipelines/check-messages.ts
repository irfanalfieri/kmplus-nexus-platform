/**
 * Messages written by checks (Validate, Map conversions, manager checks,
 * approval holds). Client-safe and pure.
 *
 * The engine writes the English text (`checkText`) into quarantine rows, so
 * stored rows stay readable everywhere. The UI turns any stored message back
 * into its code with the English template and shows it in the reader's
 * language (`localizeCheck`); that also covers rows written before codes existed.
 * One table drives both directions, so they cannot drift apart.
 */
import type { Locale } from '@/lib/i18n/config'

const CHECKS = {
  required: { en: '{field} is required', id: '{field} wajib diisi' },
  email: { en: '{field} is not a valid email', id: '{field} bukan alamat email yang valid' },
  phone: { en: '{field} "{value}" is not a valid phone number', id: '{field} "{value}" bukan nomor telepon yang valid' },
  nik: { en: '{field} "{value}" is not a valid NIK (16 digits with a birth date)', id: '{field} "{value}" bukan NIK yang valid (16 digit dengan tanggal lahir)' },
  npwp: { en: '{field} "{value}" is not a valid NPWP (15 or 16 digits)', id: '{field} "{value}" bukan NPWP yang valid (15 atau 16 digit)' },
  duplicate: { en: '{field} "{value}" is duplicated', id: '{field} "{value}" duplikat' },
  regex: { en: "{field} doesn't match {pattern}", id: '{field} tidak cocok dengan pola {pattern}' },
  badRegex: { en: 'Invalid regex "{pattern}" on {field}', id: 'Regex "{pattern}" pada {field} tidak valid' },
  minLength: { en: '{field} is shorter than {limit}', id: '{field} lebih pendek dari {limit}' },
  maxLength: { en: '{field} is longer than {limit}', id: '{field} lebih panjang dari {limit}' },
  min: { en: '{field} is below {limit}', id: '{field} di bawah {limit}' },
  max: { en: '{field} is above {limit}', id: '{field} di atas {limit}' },
  oneOf: { en: '{field} "{value}" is not one of {allowed}', id: '{field} "{value}" bukan salah satu dari {allowed}' },
  date: { en: '{field} "{value}" is not a valid date', id: '{field} "{value}" bukan tanggal yang valid' },
  future: { en: '{field} {value} is in the future', id: '{field} {value} berada di masa depan' },
  compare: { en: '{field} ({value}) must be {operator} {other} ({otherValue})', id: '{field} ({value}) harus {operator} {other} ({otherValue})' },
  lookupMissing: { en: "Lookup {lookup} isn't available", id: 'Lookup {lookup} tidak tersedia' },
  notIn: { en: '{field} "{value}" is not in {lookup}', id: '{field} "{value}" tidak ada di {lookup}' },
  ruleMissing: { en: 'Business rule {rule} not found', id: 'Aturan bisnis {rule} tidak ditemukan' },
  ruleNotMet: { en: '{field}: rule "{rule}" not met', id: '{field}: aturan "{rule}" tidak terpenuhi' },
  conditionNotMet: { en: '{field}: condition not met', id: '{field}: kondisi tidak terpenuhi' },
  ownManager: { en: '{key} is their own manager', id: '{key} tercatat sebagai atasan dirinya sendiri' },
  unknownManager: { en: 'manager {manager} of {key} is not an employee in this run', id: 'atasan {manager} dari {key} bukan karyawan dalam eksekusi ini' },
  managerCycle: { en: '{key} is in a circular reporting line', id: '{key} berada dalam rantai pelaporan yang melingkar' },
  needsApproval: { en: 'Needs approval ({reason})', id: 'Perlu persetujuan ({reason})' },
  // Map step conversions (prefixed "<target field>: " by applyMap).
  notRecognizableDate: { en: '"{value}" is not a recognizable date', id: '"{value}" bukan tanggal yang dikenali' },
  notNumber: { en: '"{value}" is not a number', id: '"{value}" bukan angka' },
  notInteger: { en: '"{value}" is not an integer', id: '"{value}" bukan bilangan bulat' },
  notBoolean: { en: '"{value}" is not a boolean', id: '"{value}" bukan nilai benar/salah' },
  notDate: { en: '"{value}" is not a date', id: '"{value}" bukan tanggal' },
  notTimestamp: { en: '"{value}" is not a timestamp', id: '"{value}" bukan stempel waktu' },
} as const satisfies Record<string, { en: string; id: string }>

/** Comparison words used inside `compare` ("less than" etc.). */
const OPERATORS: Record<string, string> = {
  equals: 'sama dengan',
  'not equals': 'tidak sama dengan',
  contains: 'mengandung',
  'not contains': 'tidak mengandung',
  'starts with': 'diawali',
  'ends with': 'diakhiri',
  'greater than': 'lebih besar dari',
  'less than': 'lebih kecil dari',
  'greater or equal': 'lebih besar atau sama dengan',
  'less or equal': 'lebih kecil atau sama dengan',
  'in list': 'ada dalam daftar',
  'matches regex': 'cocok dengan regex',
}

export type CheckCode = keyof typeof CHECKS
export type CheckParams = Record<string, string | number>

const fill = (template: string, params: CheckParams) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))

/** The English message the engine stores for a check. */
export function checkText(code: CheckCode, params: CheckParams): string {
  return fill(CHECKS[code].en, params)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PATTERNS = (Object.keys(CHECKS) as CheckCode[]).map((code) => {
  const names: string[] = []
  const source = CHECKS[code].en
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part)
      if (!m) return escape(part)
      names.push(m[1])
      // Operators are known phrases ("greater or equal"); match them whole, longest first.
      if (m[1] === 'operator') return `(${Object.keys(OPERATORS).sort((a, b) => b.length - a.length).map(escape).join('|')})`
      return '(.+?)'
    })
    .join('')
  return { code, names, re: new RegExp(`^${source}$`, 's') }
})

/** Reads a stored English message back into its code and values (null when it isn't a known check). */
export function parseCheck(text: string): { code: CheckCode; params: Record<string, string> } | null {
  for (const p of PATTERNS) {
    const m = p.re.exec(text)
    if (m) return { code: p.code, params: Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])) }
  }
  return null
}

/**
 * A stored check message in the reader's language. Unknown text (product
 * refusals, a rule's own approval reason) is shown as written. "<prefix>: <check>"
 * (Map conversions, rule calculations) keeps its prefix and translates the rest.
 */
export function localizeCheck(text: string, locale: Locale): string {
  if (locale === 'en') return text
  const hit = parseCheck(text)
  if (hit) {
    const params = { ...hit.params }
    if (hit.code === 'compare' && params.operator in OPERATORS) params.operator = OPERATORS[params.operator]
    if (hit.code === 'needsApproval') params.reason = localizeCheck(params.reason, locale)
    return fill(CHECKS[hit.code][locale], params)
  }
  const prefixed = /^([^:"]{1,120}): (.+)$/s.exec(text)
  if (prefixed) {
    const rest = localizeCheck(prefixed[2], locale)
    if (rest !== prefixed[2]) return `${prefixed[1]}: ${rest}`
  }
  return text
}
