import { z } from 'zod'
import { BUILTIN_MAPPING_TEMPLATES } from '@/lib/pipelines/templates'
import { DOMAIN_ENTITIES } from '@/lib/domain/model'
import { AnswerError } from './prompts'
import type { ChatMessage } from './llm'

/**
 * AI-4 (which connector fits this URL, file header or error?) and AI-5
 * (natural-language catalog search). Pure; covered by scripts/engine-tests.ts.
 * Both work without a model: rules and synonym ranking answer first, and a
 * configured model only re-ranks or fills in when the rules find nothing.
 * Its answer must name a real connector or real catalog items and columns.
 */

// ── AI-4: connector suggestions ──────────────────────────────────────────────

export interface ConnectorChoice {
  slug: string
  name: string
  category: string
  description: string
}
export interface ConnectorSuggestion {
  slug: string
  /** high: an unmistakable signature; medium: a strong hint; low: a guess. */
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

const headerSets = Object.fromEntries(
  BUILTIN_MAPPING_TEMPLATES.map((t) => [t.id, new Set(t.fields.map((f) => f.from.toLowerCase().split('.').pop()!))]),
)
const TEMPLATE_CONNECTOR: Record<string, string> = { 'builtin:sap-hcm-employee': 'sap', 'builtin:talenta-employee': 'talenta', 'builtin:ad-users': 'ldap' }

const RULES: { slug: string; confidence: ConnectorSuggestion['confidence']; test: RegExp; reason: string }[] = [
  { slug: 'salesforce', confidence: 'high', test: /\b[\w-]+\.(my\.)?salesforce\.com\b|\bforce\.com\b|\bINVALID_SESSION_ID\b|\binvalid_grant\b.*salesforce/i, reason: 'Salesforce address or error' },
  { slug: 'talenta', confidence: 'high', test: /\btalenta\.co\b|\bapi\.mekari\.com\b|\bmekari\b/i, reason: 'Talenta / Mekari address' },
  { slug: 'sap', confidence: 'high', test: /\/sap\/opu\/odata\b|\bsap-client\b|\bSAP[_ ]?HCM\b|\bPA000[12]\b|\bS\/4HANA\b|\bIwfnd\b/i, reason: 'SAP OData service or SAP HCM infotype' },
  { slug: 'supabase', confidence: 'high', test: /\b[\w-]+\.supabase\.(co|com)\b|\bpooler\.supabase\.com\b/i, reason: 'Supabase project address' },
  { slug: 'snowflake', confidence: 'high', test: /\bsnowflakecomputing\.com\b|\bsnowflake\b/i, reason: 'Snowflake account address' },
  { slug: 'kmplus', confidence: 'high', test: /\b(kms|lms|tms|pms|cms|ims)\.kmplus\.co\.id\b|\/nexus\/v1\b/i, reason: 'KMPlus product address (Nexus Ingest Contract)' },
  { slug: 'oracle', confidence: 'high', test: /\bORA-\d{5}\b|\boracle:\/\/|\bjdbc:oracle\b|\bTNS:|:1521\b|\bXEPDB1\b/i, reason: 'Oracle connection string or ORA- error' },
  { slug: 'sqlserver', confidence: 'high', test: /\b(mssql|sqlserver):\/\/|\bjdbc:sqlserver\b|\bServer=tcp:|\.database\.windows\.net\b|:1433\b|Login failed for user|\bMicrosoft SQL Server\b|\bSQL Server\b|\bMsg \d+, Level \d+/i, reason: 'SQL Server connection string or error' },
  { slug: 'mysql', confidence: 'high', test: /\bmysql:\/\/|\bjdbc:mysql\b|\bER_[A-Z_]+\b|:3306\b|\bmariadb\b/i, reason: 'MySQL / MariaDB connection string or error' },
  { slug: 'postgres', confidence: 'high', test: /\bpostgres(ql)?:\/\/|\bjdbc:postgresql\b|\b28P01\b|password authentication failed for user|:5432\b|\bpg_hba\.conf\b/i, reason: 'PostgreSQL connection string or error' },
  { slug: 'ldap', confidence: 'high', test: /\bldaps?:\/\/|:636\b|:389\b|\bDC=[\w-]+,\s*DC=|\bsAMAccountName\b|\buserPrincipalName\b|\bInvalidCredentials(Error)?\b|\bActive Directory\b/i, reason: 'LDAP / Active Directory address or attribute' },
  { slug: 'file', confidence: 'medium', test: /\.(csv|tsv|xlsx|xls)\b|\bexcel\b|\bspreadsheet\b/i, reason: 'A file (CSV / Excel)' },
  { slug: 'rest', confidence: 'low', test: /\bhttps?:\/\/[^\s]+/i, reason: 'An HTTP(S) API address' },
]

/** Removes secrets from what someone pasted (passwords in URLs, tokens, keys) before it goes anywhere. */
export function scrubPasted(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+)(:[^\s/@]*)?@/gi, '$1•••@')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1$2•••')
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer •••')
    .slice(0, 2000)
}

/** Rules first: URL shapes, error signatures and known HR file headers. */
export function detectConnectors(text: string, catalog: ConnectorChoice[]): ConnectorSuggestion[] {
  const known = new Set(catalog.map((c) => c.slug))
  const out: ConnectorSuggestion[] = []
  const add = (s: ConnectorSuggestion) => {
    if (known.has(s.slug) && !out.some((o) => o.slug === s.slug)) out.push(s)
  }
  // A header line: column names separated by commas, semicolons or tabs.
  const header = text.split(/\r?\n/)[0] ?? ''
  const columns = header.split(/[,;\t|]/).map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase()).filter(Boolean)
  if (columns.length >= 3) {
    for (const [id, set] of Object.entries(headerSets)) {
      const hits = columns.filter((c) => set.has(c.split('.').pop()!))
      if (hits.length >= 3) add({ slug: TEMPLATE_CONNECTOR[id], confidence: hits.length >= 5 ? 'high' : 'medium', reason: `Column names match an export from it (${hits.slice(0, 5).join(', ')})` })
    }
  }
  for (const r of RULES) if (r.test.test(text)) add({ slug: r.slug, confidence: r.confidence, reason: r.reason })
  // A plain header with no system signature is most likely an uploaded file.
  if (!out.length && columns.length >= 3 && !/[:/]/.test(header)) add({ slug: 'file', confidence: 'medium', reason: 'Looks like the first line of a CSV/Excel export' })
  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence]).slice(0, 3)
}

export function connectorPrompt(input: { text: string; catalog: ConnectorChoice[] }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You recommend which KMPlus Nexus connector fits what a person pasted (a URL, a file's first line, or an error message). Answer with one JSON object only:
{"suggestions":[{"slug":"<connector slug>","confidence":"high|medium|low","reason":"<one short sentence>"}]}
Up to 3 suggestions, best first; an empty list if nothing fits. Connectors (use only these slugs):
${input.catalog.map((c) => `- ${c.slug}: ${c.name} (${c.category}) — ${c.description}`).join('\n')}`,
    },
    { role: 'user', content: input.text },
  ]
}

const connectorAnswer = z.object({
  suggestions: z.array(z.object({ slug: z.string(), confidence: z.enum(['high', 'medium', 'low']).default('low'), reason: z.string().max(300).default('') })).max(5),
})

export function checkConnectorAnswer(answer: unknown, catalog: ConnectorChoice[]): ConnectorSuggestion[] {
  const parsed = connectorAnswer.safeParse(answer)
  if (!parsed.success) throw new AnswerError('Expected {"suggestions":[{"slug","confidence","reason"}]}.')
  const known = new Set(catalog.map((c) => c.slug))
  const unknown = parsed.data.suggestions.filter((s) => !known.has(s.slug)).map((s) => s.slug)
  if (unknown.length) throw new AnswerError(`Unknown connector slug(s): ${unknown.join(', ')}. Use only: ${[...known].join(', ')}.`)
  return parsed.data.suggestions.slice(0, 3)
}

// ── AI-5: natural-language catalog search ────────────────────────────────────

export interface SearchItem {
  key: string
  kind: 'dataset' | 'source_table'
  name: string
  sourceName: string | null
  description: string
  tags: string[]
  domains: string[]
  columns: { name: string; doc?: string }[]
}
export interface SearchHit {
  key: string
  score: number
  columns: string[]
  reason: string
}

/** Indonesian and everyday HR words → the words column and table names use. */
const WORDS: Record<string, string[]> = {
  karyawan: ['employee', 'employees', 'staff'], pegawai: ['employee', 'employees', 'staff'], staf: ['staff', 'employee'],
  pelatihan: ['training', 'course', 'learning'], kursus: ['course', 'training'], belajar: ['learning', 'training'], training: ['course', 'learning', 'pelatihan'],
  jam: ['hours', 'hour', 'duration'], durasi: ['duration', 'hours'], hours: ['hour', 'duration', 'jam'], hour: ['hours', 'duration'],
  departemen: ['department', 'dept', 'org', 'organization', 'unit'], department: ['dept', 'org', 'organization', 'unit', 'orgeh', 'org_code'], divisi: ['division', 'department'],
  organisasi: ['organization', 'organizations', 'org'], unit: ['unit', 'org', 'department'],
  jabatan: ['position', 'job', 'title'], posisi: ['position'], position: ['positions', 'plans', 'job'],
  gaji: ['salary', 'pay', 'wage'], upah: ['wage', 'salary'], cuti: ['leave', 'absence'], absensi: ['attendance'], kehadiran: ['attendance'],
  lahir: ['birth', 'dob'], masuk: ['hire', 'join', 'joined'], keluar: ['termination', 'resign', 'exit'], resign: ['termination', 'resign'],
  aktif: ['active', 'status'], status: ['status', 'stat2'], manajer: ['manager'], atasan: ['manager', 'supervisor'], manager: ['supervisor', 'atasan'],
  pengguna: ['user', 'users', 'username'], akun: ['account', 'username'], perusahaan: ['company', 'bukrs'], lokasi: ['location', 'branch', 'werks'], cabang: ['branch', 'location'],
  nilai: ['score', 'grade'], kinerja: ['performance'], email: ['mail'], telepon: ['phone', 'mobile'], hp: ['phone', 'mobile'],
}
// Every domain field's synonyms count as the same word (e.g. "nik" ↔ national_id).
for (const entity of DOMAIN_ENTITIES) {
  for (const f of entity.fields) {
    const all = [f.name, ...f.name.split('_'), ...f.synonyms]
    for (const s of f.synonyms) WORDS[s] = [...new Set([...(WORDS[s] ?? []), ...all])]
  }
}
const STOP = new Set(
  'a an the of in on by per for to and or with is are was where which what show find list get give me my our data table tables dataset datasets di ke dari yang dan atau untuk per dengan mana dimana di-mana apa ada tampilkan cari data tabel berapa setiap tiap semua by-department'.split(' '),
)

const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

function expand(term: string): string[] {
  const singular = term.endsWith('s') && term.length > 3 ? term.slice(0, -1) : term
  return [...new Set([term, singular, ...(WORDS[term] ?? []), ...(WORDS[singular] ?? [])])]
}

/** Ranks catalog items for a question without a model: names, columns, docs, tags and domains, with synonyms. */
export function rankCatalog(question: string, items: SearchItem[], limit = 5): SearchHit[] {
  const terms = words(question).filter((t) => !STOP.has(t) && t.length > 1)
  if (!terms.length) return []
  const hits: SearchHit[] = []
  for (const item of items) {
    let score = 0
    let covered = 0
    const columns = new Set<string>()
    const nameWords = new Set(words(item.name))
    const textWords = new Set([...words(item.description), ...item.tags.flatMap(words), ...item.domains.flatMap(words), ...words(item.sourceName ?? '')])
    for (const term of terms) {
      const variants = expand(term)
      let best = 0
      if (variants.some((v) => nameWords.has(v))) best = Math.max(best, 5)
      for (const c of item.columns) {
        const cw = new Set(words(c.name))
        if (variants.some((v) => cw.has(v) || c.name.toLowerCase() === v)) {
          best = Math.max(best, 3)
          columns.add(c.name)
        } else if (c.doc && variants.some((v) => words(c.doc!).includes(v))) {
          best = Math.max(best, 2)
          columns.add(c.name)
        }
      }
      if (variants.some((v) => textWords.has(v))) best = Math.max(best, 2)
      if (best) covered++
      score += best
    }
    if (covered) hits.push({ key: item.key, score: score * (covered / terms.length) + (item.kind === 'dataset' ? 0.5 : 0), columns: [...columns].slice(0, 6), reason: '' })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function catalogPrompt(input: { question: string; items: SearchItem[] }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You find where data lives in a KMPlus Nexus data catalog. Given a question, pick the catalog items (datasets or source tables) that answer it and the columns that matter. Answer with one JSON object only:
{"results":[{"key":"<item key>","columns":["<column>",…],"reason":"<one short sentence, in the language of the question>"}]}
Up to 5 results, best first; an empty list if nothing fits. Prefer datasets over raw source tables when both hold the data. Use only these items and their columns:
${JSON.stringify(input.items.map((i) => ({ key: i.key, kind: i.kind, name: i.name, source: i.sourceName ?? undefined, description: i.description || undefined, tags: i.tags.length ? i.tags : undefined, entities: i.domains.length ? i.domains : undefined, columns: i.columns.slice(0, 60).map((c) => (c.doc ? `${c.name}: ${c.doc.slice(0, 80)}` : c.name)) })))}`,
    },
    { role: 'user', content: input.question },
  ]
}

const catalogAnswer = z.object({ results: z.array(z.object({ key: z.string(), columns: z.array(z.string()).max(12).default([]), reason: z.string().max(300).default('') })).max(8) })

export function checkCatalogAnswer(answer: unknown, items: SearchItem[]): SearchHit[] {
  const parsed = catalogAnswer.safeParse(answer)
  if (!parsed.success) throw new AnswerError('Expected {"results":[{"key","columns","reason"}]}.')
  const byKey = new Map(items.map((i) => [i.key, i]))
  const unknown = parsed.data.results.filter((r) => !byKey.has(r.key)).map((r) => r.key)
  if (unknown.length) throw new AnswerError(`Unknown item key(s): ${unknown.join(', ')}. Use only the listed keys.`)
  return parsed.data.results.slice(0, 5).map((r, i) => {
    const cols = new Set(byKey.get(r.key)!.columns.map((c) => c.name))
    // Invented columns are dropped rather than failing the whole answer.
    return { key: r.key, score: 100 - i, columns: r.columns.filter((c) => cols.has(c)), reason: r.reason }
  })
}
