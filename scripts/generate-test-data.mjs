/**
 * Generates realistic, fictional HR test data for trying KMPlus Nexus end to
 * end (see test-data/README.md). Deterministic: the same files every time.
 *
 *   node scripts/generate-test-data.mjs
 *
 * Every person, email, NIK and NPWP is invented. The files contain deliberate
 * data quality problems; test-data/README.md lists them and what each test
 * should show.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import writeXlsxFile from 'write-excel-file/node'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-data')

// ── Deterministic randomness ─────────────────────────────────────────────────
let seed = 20261012
const rand = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (a) => a[Math.floor(rand() * a.length)]
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const pad = (n, w) => String(n).padStart(w, '0')

const FIRST_M = ['Budi', 'Agus', 'Andi', 'Dedi', 'Eko', 'Fajar', 'Hendra', 'Irfan', 'Joko', 'Kurniawan', 'Rizky', 'Yoga', 'Arif', 'Bayu', 'Dimas', 'Rudi', 'Teguh', 'Wahyu', 'Fikri', 'Gilang']
const FIRST_F = ['Siti', 'Dewi', 'Ayu', 'Rina', 'Fitri', 'Lestari', 'Nadia', 'Putri', 'Ratna', 'Wulan', 'Indah', 'Maya', 'Anisa', 'Citra', 'Dian', 'Intan', 'Kartika', 'Mega', 'Nurul', 'Yuni']
const LAST = ['Santoso', 'Wijaya', 'Pratama', 'Saputra', 'Hidayat', 'Kusuma', 'Nugroho', 'Setiawan', 'Siregar', 'Nasution', 'Lubis', 'Harahap', 'Simanjuntak', 'Sinaga', 'Halim', 'Gunawan', 'Wibowo', 'Purnomo', 'Rahman', 'Syahputra', 'Hakim', 'Utomo', 'Permana', 'Susanto']
const PROVINCES = ['31', '32', '33', '34', '35', '36', '51', '12', '13', '64'] // DKI, Jabar, Jateng, DIY, Jatim, Banten, Bali, Sumut, Sumbar, Kaltim

const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`
const iso = (d) => d.toISOString().slice(0, 10)
const dmy = (d) => `${pad(d.getUTCDate(), 2)}/${pad(d.getUTCMonth() + 1, 2)}/${d.getUTCFullYear()}`
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d))
const randomDate = (fromYear, toYear) => day(int(fromYear, toYear), int(1, 12), int(1, 28))
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '.')

/** NIK: province(2) regency(2) district(2) DDMMYY (women: day + 40) sequence(4). */
function nik(birth, female) {
  const dd = birth.getUTCDate() + (female ? 40 : 0)
  return `${pick(PROVINCES)}${pad(int(1, 79), 2)}${pad(int(1, 40), 2)}${pad(dd, 2)}${pad(birth.getUTCMonth() + 1, 2)}${String(birth.getUTCFullYear()).slice(2)}${pad(int(1, 9999), 4)}`
}
const npwp = () => `${pad(int(1, 99), 2)}.${pad(int(0, 999), 3)}.${pad(int(0, 999), 3)}.${int(0, 9)}-${pad(int(0, 999), 3)}.${pad(int(0, 999), 3)}`
const phone = () => `08${pick(['11', '12', '13', '21', '22', '52', '53', '56', '57', '77', '78', '81', '95', '96'])}${pad(int(0, 99999999), 8)}`

// ── Reference data: organizations and positions ──────────────────────────────
const ORGS = [
  { org_code: '50000001', name: 'Board of Directors', type: 'Direktorat', parent_org_code: '', cost_center: 'CC-1000', company_code: 'KMP' },
  { org_code: '50000010', name: 'Finance', type: 'Divisi', parent_org_code: '50000001', cost_center: 'CC-2000', company_code: 'KMP' },
  { org_code: '50000011', name: 'Accounting & Tax', type: 'Departemen', parent_org_code: '50000010', cost_center: 'CC-2100', company_code: 'KMP' },
  { org_code: '50000020', name: 'Human Capital', type: 'Divisi', parent_org_code: '50000001', cost_center: 'CC-3000', company_code: 'KMP' },
  { org_code: '50000021', name: 'Learning & Development', type: 'Departemen', parent_org_code: '50000020', cost_center: 'CC-3100', company_code: 'KMP' },
  { org_code: '50000030', name: 'Information Technology', type: 'Divisi', parent_org_code: '50000001', cost_center: 'CC-4000', company_code: 'KMP' },
  { org_code: '50000031', name: 'Data & Integration', type: 'Departemen', parent_org_code: '50000030', cost_center: 'CC-4100', company_code: 'KMP' },
  { org_code: '50000040', name: 'Sales', type: 'Divisi', parent_org_code: '50000001', cost_center: 'CC-5000', company_code: 'KMP' },
  { org_code: '50000041', name: 'Sales Jakarta', type: 'Cabang', parent_org_code: '50000040', cost_center: 'CC-5100', company_code: 'KMP' },
  { org_code: '50000042', name: 'Sales Surabaya', type: 'Cabang', parent_org_code: '50000040', cost_center: 'CC-5200', company_code: 'KMP' },
  { org_code: '50000050', name: 'Operations', type: 'Divisi', parent_org_code: '50000001', cost_center: 'CC-6000', company_code: 'KMP' },
  { org_code: '50000060', name: 'KMI Management', type: 'Direktorat', parent_org_code: '', cost_center: 'CC-7000', company_code: 'KMI' },
  { org_code: '50000061', name: 'KMI Product', type: 'Divisi', parent_org_code: '50000060', cost_center: 'CC-7100', company_code: 'KMI' },
  { org_code: '50000062', name: 'KMI Customer Success', type: 'Divisi', parent_org_code: '50000060', cost_center: 'CC-7200', company_code: 'KMI' },
]
const LOCATIONS = { KMP: ['JKT-HQ', 'JKT-HQ', 'SBY-01', 'BDG-01'], KMI: ['JKT-02', 'YOG-01'] }
const TITLES = {
  '50000001': ['President Director', 'Director', 'Executive Assistant'],
  '50000010': ['Head of Finance', 'Senior Finance Analyst', 'Finance Staff'],
  '50000011': ['Accounting Manager', 'Senior Accountant', 'Tax Officer'],
  '50000020': ['Head of Human Capital', 'HR Business Partner', 'HR Generalist'],
  '50000021': ['L&D Manager', 'Instructional Designer', 'Training Coordinator'],
  '50000030': ['Head of IT', 'Senior Software Engineer', 'Software Engineer'],
  '50000031': ['Data Manager', 'Data Engineer', 'Integration Analyst'],
  '50000040': ['Head of Sales', 'Key Account Manager', 'Sales Executive'],
  '50000041': ['Branch Manager Jakarta', 'Account Manager', 'Sales Executive'],
  '50000042': ['Branch Manager Surabaya', 'Account Manager', 'Sales Executive'],
  '50000050': ['Head of Operations', 'Operations Supervisor', 'Operations Staff'],
  '50000060': ['KMI Director', 'Business Analyst', 'Office Manager'],
  '50000061': ['Head of Product', 'Product Manager', 'UX Designer'],
  '50000062': ['Head of Customer Success', 'Customer Success Manager', 'Support Specialist'],
}
const POSITIONS = []
let posSeq = 1
for (const org of ORGS) {
  TITLES[org.org_code].forEach((title, level) => {
    POSITIONS.push({
      position_code: `600${pad(posSeq++, 5)}`,
      title,
      job_family: org.name.replace(/ (Jakarta|Surabaya)$/, ''),
      job_level: ['L1-Head', 'L2-Senior', 'L3-Staff'][level],
      org_code: org.org_code,
      is_vacant: 'false',
    })
  })
}
// Two vacant positions for the catalog / position entity.
POSITIONS.push({ position_code: `600${pad(posSeq++, 5)}`, title: 'Data Governance Lead', job_family: 'Information Technology', job_level: 'L2-Senior', org_code: '50000031', is_vacant: 'true' })
POSITIONS.push({ position_code: `600${pad(posSeq++, 5)}`, title: 'Payroll Specialist', job_family: 'Human Capital', job_level: 'L3-Staff', org_code: '50000020', is_vacant: 'true' })
const positionOf = (org, level) => POSITIONS.find((p) => p.org_code === org && p.job_level.startsWith(`L${level}`)).position_code

// ── People ───────────────────────────────────────────────────────────────────
function person() {
  const female = rand() < 0.48
  const first = pick(female ? FIRST_F : FIRST_M)
  const last = pick(LAST)
  const birth = randomDate(1968, 2001)
  return { female, first, last, name: `${first} ${last}`, birth }
}

// KMP employees for the SAP export: one head per org, then staff.
const kmpOrgs = ORGS.filter((o) => o.company_code === 'KMP')
const sap = []
let pernr = 1001
const usedEmails = new Set()
const email = (p, domain = 'kmplus-demo.co.id') => {
  let e = `${slug(p.first)}.${slug(p.last)}@${domain}`
  for (let i = 2; usedEmails.has(e); i++) e = `${slug(p.first)}.${slug(p.last)}${i}@${domain}`
  usedEmails.add(e)
  return e
}
const headOf = {}
for (const org of kmpOrgs) {
  const p = person()
  const code = pad(pernr++, 8)
  headOf[org.org_code] = code
  sap.push({ ...p, PERNR: code, org, level: 1 })
}
while (sap.length < 150) {
  const org = pick(kmpOrgs.filter((o) => o.org_code !== '50000001'))
  const level = rand() < 0.35 ? 2 : 3
  sap.push({ ...person(), PERNR: pad(pernr++, 8), org, level })
}
// Reporting lines: CEO (first head) has none; heads report to their parent org's head; staff to their org head.
const ceo = headOf['50000001']
const managerFor = (e) => {
  if (e.PERNR === ceo) return ''
  if (e.level === 1) return headOf[e.org.parent_org_code] ?? ceo
  return headOf[e.org.org_code]
}

const sapRows = sap.map((e) => {
  const hire = randomDate(2012, 2025)
  return {
    PERNR: e.PERNR,
    ENAME: e.name.toUpperCase(),
    USRID_LONG: email(e),
    GBDAT: ymd(e.birth),
    GESCH: e.female ? '2' : '1',
    BEGDA: ymd(hire),
    ENDDA: '99991231',
    ORGEH: e.org.org_code,
    PLANS: positionOf(e.org.org_code, e.level),
    BUKRS: 'KMP',
    WERKS: pick(LOCATIONS.KMP),
    PERSG: e.level === 3 && rand() < 0.25 ? 'Kontrak' : 'Tetap',
    STAT2: '3',
    MANAGER: managerFor(e),
    _staff: e.level === 3,
  }
})
// Ten former employees (STAT2 0 = withdrawn) with a real end date.
sapRows.filter((r) => r._staff).slice(0, 10).forEach((r) => {
  r.STAT2 = '0'
  r.ENDDA = ymd(randomDate(Number(r.BEGDA.slice(0, 4)) + 1 > 2025 ? 2025 : Number(r.BEGDA.slice(0, 4)) + 1, 2025))
  if (r.ENDDA < r.BEGDA) r.ENDDA = '20251231'
})

// Deliberate problems, each on its own staff member (nobody reports to staff).
const pool = sapRows.filter((r) => r._staff && r.STAT2 === '3')
const issues = { invalidEmail: [], missingName: [], duplicate: [], endBeforeHire: [], unknownOrg: [], futureHire: [], unknownManager: [], managerCycle: [] }
const take = () => pool.splice(int(0, pool.length - 1), 1)[0]
for (const bad of ['budi.santoso@', 'rina.halim#kmplus-demo.co.id', 'agus santoso@kmplus-demo.co.id']) {
  const r = take()
  r.USRID_LONG = bad
  issues.invalidEmail.push(r.PERNR)
}
{ const r = take(); r.ENAME = ''; issues.missingName.push(r.PERNR) }
{ const r = take(); r.ENDDA = String(Number(r.BEGDA) - 10000); issues.endBeforeHire.push(r.PERNR) } // a year before hire
{ const r = take(); r.ORGEH = '59999999'; issues.unknownOrg.push(r.PERNR) }
{ const r = take(); r.BEGDA = '20271101'; issues.futureHire.push(r.PERNR) }
{ const r = take(); r.MANAGER = '00009999'; issues.unknownManager.push(r.PERNR) }
{ const a = take(); const b = take(); a.MANAGER = b.PERNR; b.MANAGER = a.PERNR; issues.managerCycle.push(a.PERNR, b.PERNR) }
// Two employee numbers appear twice (an HRIS export glitch): the second copy differs.
const dupRows = [take(), take()].map((r) => ({ ...r, ENAME: `${r.ENAME} (DUPLIKAT)`, USRID_LONG: `dup.${r.USRID_LONG}` }))
dupRows.forEach((r) => issues.duplicate.push(r.PERNR))
const SAP_COLUMNS = ['PERNR', 'ENAME', 'USRID_LONG', 'GBDAT', 'GESCH', 'BEGDA', 'ENDDA', 'ORGEH', 'PLANS', 'BUKRS', 'WERKS', 'PERSG', 'STAT2', 'MANAGER']
const sapOut = [...sapRows.slice(0, 80), dupRows[0], ...sapRows.slice(80, 120), dupRows[1], ...sapRows.slice(120)]

// ── Local HRIS (PT KMPlus Inovasi), Excel with Indonesian headers ───────────
const kmiOrgs = ORGS.filter((o) => o.company_code === 'KMI')
const kmi = []
let nip = 2001
const kmiHead = {}
for (const org of kmiOrgs) {
  const p = person()
  const code = `KMI-${nip++}`
  kmiHead[org.org_code] = code
  kmi.push({ ...p, NIP: code, org, level: 1 })
}
while (kmi.length < 90) {
  const org = pick(kmiOrgs.filter((o) => o.org_code !== '50000060'))
  kmi.push({ ...person(), NIP: `KMI-${nip++}`, org, level: rand() < 0.3 ? 2 : 3 })
}
const kmiDirector = kmiHead['50000060']
const RELIGIONS = ['Islam', 'Islam', 'Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha']
const kmiRows = kmi.map((e) => {
  const hire = randomDate(2016, 2025)
  return {
    NIP: e.NIP,
    'Nama Lengkap': e.name,
    'Email Kantor': email(e, 'kmi-demo.co.id'),
    'No HP': phone(),
    NIK: nik(e.birth, e.female),
    NPWP: npwp(),
    'Jenis Kelamin': e.female ? 'P' : 'L',
    'Tgl Lahir': dmy(e.birth),
    'Tgl Masuk': hire,
    'Kode Unit': e.org.org_code,
    'Kode Jabatan': positionOf(e.org.org_code, e.level),
    Atasan: e.NIP === kmiDirector ? '' : e.level === 1 ? kmiDirector : kmiHead[e.org.org_code],
    'Status Karyawan': e.level === 3 && rand() < 0.3 ? 'Kontrak' : 'Tetap',
    'Gaji Pokok': e.level === 1 ? int(45, 70) * 1_000_000 : e.level === 2 ? int(18, 30) * 1_000_000 : int(7, 14) * 1_000_000,
    Agama: pick(RELIGIONS),
    _staff: e.level === 3,
  }
})
const kmiIssues = { invalidNik: [], invalidPhone: [], invalidBirthDate: [], missingEmail: [] }
const kmiPool = kmiRows.filter((r) => r._staff)
const takeK = () => kmiPool.splice(int(0, kmiPool.length - 1), 1)[0]
{ const r = takeK(); r.NIK = r.NIK.slice(0, 14); kmiIssues.invalidNik.push(r.NIP) } // 14 digits
{ const r = takeK(); r.NIK = `${r.NIK.slice(0, 6)}99${r.NIK.slice(8)}`; kmiIssues.invalidNik.push(r.NIP) } // day 99
{ const r = takeK(); r.NIK = `${r.NIK.slice(0, 8)}13${r.NIK.slice(10)}`; kmiIssues.invalidNik.push(r.NIP) } // month 13
{ const r = takeK(); r['No HP'] = '021-5551234'; kmiIssues.invalidPhone.push(r.NIP) } // landline
{ const r = takeK(); r['No HP'] = '8123'; kmiIssues.invalidPhone.push(r.NIP) }
{ const r = takeK(); r['Tgl Lahir'] = '31/02/1990'; kmiIssues.invalidBirthDate.push(r.NIP) }
for (let i = 0; i < 2; i++) { const r = takeK(); r['Email Kantor'] = ''; kmiIssues.missingEmail.push(r.NIP) }
const KMI_COLUMNS = ['NIP', 'Nama Lengkap', 'Email Kantor', 'No HP', 'NIK', 'NPWP', 'Jenis Kelamin', 'Tgl Lahir', 'Tgl Masuk', 'Kode Unit', 'Kode Jabatan', 'Atasan', 'Status Karyawan', 'Gaji Pokok', 'Agama']

// ── Training history (LMS) ───────────────────────────────────────────────────
const COURSES = [
  ['TRN-ONB', 'Onboarding KMPlus', 8], ['TRN-K3', 'K3 & Keselamatan Kerja', 4], ['TRN-PDP', 'UU PDP: Pelindungan Data Pribadi', 3],
  ['TRN-LEAD', 'Leadership Fundamentals', 16], ['TRN-EXCEL', 'Advanced Excel', 12], ['TRN-SQL', 'SQL for Analysts', 16],
  ['TRN-SALES', 'Consultative Selling', 12], ['TRN-AGILE', 'Agile & Scrum', 8], ['TRN-ANTI', 'Anti-Korupsi & Etika Bisnis', 2],
]
const trainingRows = []
const employeesForTraining = [...sapRows.map((r) => r.PERNR), ...kmiRows.map((r) => r.NIP)]
let recordId = 1
while (trainingRows.length < 395) {
  const [code, title, hours] = pick(COURSES)
  const start = randomDate(2024, 2026)
  if (start > day(2026, 9, 30)) continue
  const end = new Date(start.getTime() + int(0, 4) * 86_400_000)
  const status = rand() < 0.82 ? 'Completed' : rand() < 0.6 ? 'In Progress' : 'Failed'
  trainingRows.push({
    record_id: `TR-${pad(recordId++, 6)}`,
    employee_code: pick(employeesForTraining),
    course_code: code,
    course_name: title,
    start_date: iso(start),
    end_date: status === 'In Progress' ? '' : iso(end),
    hours: status === 'Completed' ? hours : status === 'Failed' ? Math.round(hours / 2) : '',
    status,
    score: status === 'Completed' ? int(70, 100) : status === 'Failed' ? int(30, 64) : '',
  })
}
// Five records point at people who aren't employees (an "exists in dataset" rule catches them).
const unknownTrainees = ['00008001', '00008002', 'KMI-9001', 'KMI-9002', 'EXT-0001']
unknownTrainees.forEach((code) => {
  const [c, t, h] = pick(COURSES)
  trainingRows.push({ record_id: `TR-${pad(recordId++, 6)}`, employee_code: code, course_code: c, course_name: t, start_date: '2026-03-02', end_date: '2026-03-02', hours: h, status: 'Completed', score: int(70, 95) })
})

// ── Active Directory users export ────────────────────────────────────────────
const nameOf = new Map(sapRows.map((r) => [r.PERNR, r.ENAME]))
const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
const dn = (name, ou = 'Staff') => `CN=${titleCase(name)},OU=${ou},OU=KMPlus,DC=kmplus-demo,DC=co,DC=id`
const adRows = []
const usedLogins = new Set()
sapRows.forEach((r, i) => {
  if (i % 15 === 7) return // ten people without an AD account
  if (!r.ENAME) return
  const [first, ...rest] = titleCase(r.ENAME).split(' ')
  let login = `${first[0]}${rest.join('')}`.toLowerCase()
  for (let n = 2; usedLogins.has(login); n++) login = `${first[0]}${rest.join('')}${n}`.toLowerCase()
  usedLogins.add(login)
  adRows.push({
    sAMAccountName: login,
    employeeID: r.PERNR,
    displayName: titleCase(r.ENAME),
    mail: r.USRID_LONG.includes('@') && !r.USRID_LONG.endsWith('@') ? r.USRID_LONG : '',
    department: r.ORGEH === '59999999' ? '' : ORGS.find((o) => o.org_code === r.ORGEH).name,
    title: POSITIONS.find((p) => p.position_code === r.PLANS).title,
    telephoneNumber: `+62 21 555${pad(int(0, 9999), 4)}`,
    manager: r.MANAGER && nameOf.get(r.MANAGER) ? dn(nameOf.get(r.MANAGER), 'Management') : '',
    userAccountControl: r.STAT2 === '0' ? '514' : '512',
    whenChanged: `${ymd(randomDate(2025, 2026))}${pad(int(0, 23), 2)}${pad(int(0, 59), 2)}00.0Z`,
  })
})
for (const svc of ['svc-backup', 'svc-nexus', 'svc-printer', 'svc-scanner', 'svc-sql']) {
  adRows.push({ sAMAccountName: svc, employeeID: '', displayName: `Service ${svc.slice(4)}`, mail: '', department: 'Information Technology', title: 'Service Account', telephoneNumber: '', manager: '', userAccountControl: '66048', whenChanged: '20260901080000.0Z' })
}

// ── Write files ──────────────────────────────────────────────────────────────
function csv(rows, columns) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}
function write(rel, content) {
  const path = join(OUT, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

write('hris/employees_sap_pa0001.csv', csv(sapOut, SAP_COLUMNS))
write('reference/organizations.csv', csv(ORGS.map((o) => ({ ...o, head_employee_code: headOf[o.org_code] ?? kmiHead[o.org_code] ?? '' })), ['org_code', 'name', 'type', 'parent_org_code', 'cost_center', 'company_code', 'head_employee_code']))
write('reference/positions.csv', csv(POSITIONS, ['position_code', 'title', 'job_family', 'job_level', 'org_code', 'is_vacant']))
write('learning/training_history.csv', csv(trainingRows, ['record_id', 'employee_code', 'course_code', 'course_name', 'start_date', 'end_date', 'hours', 'status', 'score']))
write('identity/ad_users.csv', csv(adRows, ['sAMAccountName', 'employeeID', 'displayName', 'mail', 'department', 'title', 'telephoneNumber', 'manager', 'userAccountControl', 'whenChanged']))

const header = (cols) => cols.map((c) => ({ value: c, fontWeight: 'bold' }))
const karyawan = [
  header(KMI_COLUMNS),
  ...kmiRows.map((r) =>
    KMI_COLUMNS.map((c) => {
      const v = r[c]
      if (v instanceof Date) return { value: v, type: Date, format: 'dd/mm/yyyy' }
      if (typeof v === 'number') return { value: v, type: Number, format: '#,##0' }
      return v === '' ? null : { value: String(v), type: String }
    })
  ),
]
const units = [header(['Kode Unit', 'Nama Unit', 'Induk']), ...kmiOrgs.map((o) => [o.org_code, o.name, o.parent_org_code || null].map((v) => (v === null ? null : { value: v, type: String })))]
mkdirSync(join(OUT, 'hris'), { recursive: true })
await writeXlsxFile([
  { data: karyawan, sheet: 'Karyawan' },
  { data: units, sheet: 'Unit Organisasi' },
]).toFile(join(OUT, 'hris', 'karyawan_kmi.xlsx'))

const summary = {
  employees_sap_pa0001: { rows: sapOut.length, uniqueEmployees: sapRows.length, issues },
  karyawan_kmi: { rows: kmiRows.length, issues: kmiIssues },
  organizations: ORGS.length,
  positions: POSITIONS.length,
  training_history: { rows: trainingRows.length, unknownTrainees },
  ad_users: { rows: adRows.length, disabled: adRows.filter((r) => r.userAccountControl === '514').length, serviceAccounts: 5 },
}
write('expected.json', JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
