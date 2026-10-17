/**
 * "Go to" finder (Ctrl K): every screen, settings tab, feature and record by
 * name, in either language. Client-safe and pure; covered by scripts/engine-tests.ts.
 *
 * Labels come from i18n (`finder.features.*`, `nav.*`, `settings.*`); the
 * keywords below are search terms in English and Bahasa Indonesia together,
 * so a person finds a feature whatever language they think in.
 */
import type { Permission } from '@/lib/auth/permissions'
import type { Section, SettingsTab } from '@/lib/navigation'

export type FinderKind = 'record' | 'action' | 'screen' | 'setting' | 'preference'

export interface FinderItem {
  id: string
  kind: FinderKind
  label: string
  /** Shown on the right: the screen, or what kind of record. */
  hint: string
  keywords?: string
  section: Section
  href?: string
  /** Preferences and the tour run instead of navigating. */
  run?: 'theme:light' | 'theme:dark' | 'theme:system' | 'lang:en' | 'lang:id' | 'tour'
}

/** Search terms per screen (both languages). */
export const SECTION_KEYWORDS: Record<Section, string> = {
  overview: 'home start beranda ringkasan needs you today',
  sources: 'data sources database connection credentials hris sap talenta api sumber data koneksi kredensial',
  connectors: 'marketplace install integrations konektor pasang integrasi',
  pipelines: 'flows jobs etl sync integration alur sinkron integrasi',
  rules: 'business rules if then conditions logic aturan bisnis kondisi',
  quality: 'quarantine held rejected errors fix replay data quality karantina ditahan perbaiki kualitas',
  catalog: 'datasets tables columns lineage documentation katalog dokumentasi kolom',
  monitoring: 'runs logs history failed scheduler worker eksekusi log riwayat gagal pemantauan',
  analytics: 'dashboards charts reports widgets dasbor grafik laporan analitik',
  governance: 'policies masking pii privacy uu pdp retention erasure tata kelola kebijakan privasi',
  settings: 'preferences workspace configuration pengaturan konfigurasi',
  help: 'guide faq documentation manual how to bantuan panduan',
}

/** Search terms per settings tab (both languages). */
export const SETTINGS_KEYWORDS: Record<SettingsTab, string> = {
  general: 'workspace name rename run history log retention nama workspace riwayat',
  members: 'people users team roles invite permissions anggota pengguna peran undang izin',
  account: 'password two factor 2fa authenticator totp security my account kata sandi keamanan akun',
  access: 'sso saml oidc entra azure okta google scim provisioning single sign on login masuk',
  environments: 'environments dev development staging production prod promote promotion publish approval lock lingkungan promosi persetujuan',
  agents: 'nexus agent on premise firewall intranet private network vpn agen jaringan privat',
  ai: 'ai assistant model llm ollama vllm open source asisten',
  api: 'api keys tokens data api rest openapi kunci api',
  webhooks: 'webhooks events callbacks signed notify peristiwa',
  alerts: 'alert channels slack microsoft teams notifications sla saluran peringatan notifikasi',
  audit: 'audit log trail history who changed what jejak audit riwayat perubahan',
}

/** Features inside screens, each with its own link (see useUrlIntents). */
export const FEATURES: { id: string; section: Section; href: string; permission?: Permission; keywords: string }[] = [
  { id: 'newPipeline', section: 'pipelines', href: '/dashboard/pipelines?new=1', permission: 'pipelines:edit', keywords: 'create add build template new pipeline buat tambah baru' },
  { id: 'importPipeline', section: 'pipelines', href: '/dashboard/pipelines?import=1', permission: 'pipelines:edit', keywords: 'import json file restore copy impor berkas salin' },
  { id: 'maintenance', section: 'pipelines', href: '/dashboard/pipelines?maintenance=1', keywords: 'maintenance windows blackout dates holiday pause hold schedule pemeliharaan libur jeda tahan jadwal' },
  { id: 'approvals', section: 'pipelines', href: '/dashboard/pipelines?approvals=1', keywords: 'approvals requests review publish waiting history persetujuan tinjau terbit menunggu riwayat' },
  { id: 'datasets', section: 'pipelines', href: '/dashboard/pipelines#datasets', permission: 'data:preview', keywords: 'datasets outputs preview rows written dataset keluaran pratinjau baris' },
  { id: 'addSource', section: 'sources', href: '/dashboard/sources?add=source', permission: 'sources:manage', keywords: 'add connect source database hris sap talenta rest api file upload csv excel spreadsheet tambah sambungkan sumber unggah' },
  { id: 'addDestination', section: 'sources', href: '/dashboard/sources?add=destination', permission: 'sources:manage', keywords: 'add destination write target kmplus lms kms tms product tambah tujuan tulis produk' },
  { id: 'newRule', section: 'rules', href: '/dashboard/rules?new=1', permission: 'rules:edit', keywords: 'new rule create condition if then approval aturan baru buat kondisi' },
  { id: 'heldRows', section: 'quality', href: '/dashboard/quality', keywords: 'held rows quarantine failed checks fix replay baris ditahan karantina gagal perbaiki putar ulang' },
  { id: 'approvalRows', section: 'quality', href: '/dashboard/quality?view=approval', keywords: 'rows waiting approval approve hold baris menunggu persetujuan setujui' },
  { id: 'flaggedRows', section: 'quality', href: '/dashboard/quality?view=flag', keywords: 'flagged warnings duplicates removed ditandai peringatan duplikat' },
  { id: 'newDataset', section: 'catalog', href: '/dashboard/catalog?new=1', permission: 'catalog:edit', keywords: 'new dataset define schema columns types keys dataset baru skema kolom tipe kunci' },
  { id: 'askCatalog', section: 'catalog', href: '/dashboard/catalog?ask=1', keywords: 'ask where data lives find search ai lineage tanya cari di mana data silsilah' },
  { id: 'runs', section: 'monitoring', href: '/dashboard/monitoring#runs', keywords: 'recent runs history log retry resume continue failed eksekusi terbaru riwayat ulangi lanjutkan gagal' },
  { id: 'newDashboard', section: 'analytics', href: '/dashboard/analytics?new=1', permission: 'dashboards:edit', keywords: 'new dashboard chart widget report kpi dasbor baru grafik laporan' },
  { id: 'masking', section: 'governance', href: '/dashboard/governance#policies', permission: 'data:preview', keywords: 'masking mask pii personal sensitive classification dataset policy pseudonymize samarkan pribadi sensitif klasifikasi kebijakan' },
  { id: 'rowFilters', section: 'governance', href: '/dashboard/governance#policies', permission: 'data:preview', keywords: 'row level access filters per role restrict akses tingkat baris saring peran' },
  { id: 'retention', section: 'governance', href: '/dashboard/governance#policies', permission: 'data:preview', keywords: 'retention keep delete old rows days retensi simpan hapus lama' },
  { id: 'erasure', section: 'governance', href: '/dashboard/governance#erasure', permission: 'data:erase', keywords: 'right to erasure forget delete person uu pdp gdpr hak penghapusan lupakan hapus orang' },
  { id: 'invite', section: 'settings', href: '/dashboard/settings/members#invite', permission: 'workspace:manage', keywords: 'invite member colleague user email add person undang anggota rekan tambah' },
]

export const PREFERENCES: { id: string; run: NonNullable<FinderItem['run']>; keywords: string }[] = [
  { id: 'themeLight', run: 'theme:light', keywords: 'light mode theme appearance terang tema tampilan' },
  { id: 'themeDark', run: 'theme:dark', keywords: 'dark mode night theme appearance gelap malam tema tampilan' },
  { id: 'themeSystem', run: 'theme:system', keywords: 'system theme automatic otomatis sistem tema' },
  { id: 'langEn', run: 'lang:en', keywords: 'english language bahasa inggris' },
  { id: 'langId', run: 'lang:id', keywords: 'bahasa indonesia language indonesian' },
  { id: 'tour', run: 'tour', keywords: 'guide me tour walkthrough onboarding tutorial panduan tur' },
]

/** Lower case, accents dropped ("Kebijakán" = "kebijakan"). */
export const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const KIND_RANK: Record<FinderKind, number> = { action: 0, record: 1, screen: 2, setting: 3, preference: 4 }

/**
 * Items matching every word typed, best first: a label starting with the
 * query, then label words starting with each typed word, then keywords, then
 * anywhere in the label. An empty query lists screens and actions only.
 */
export function searchFinder<T extends FinderItem>(items: T[], query: string, limit = 40): T[] {
  const q = fold(query).trim()
  if (!q) return items.filter((i) => i.kind === 'screen' || i.kind === 'action').slice(0, limit)
  const tokens = q.split(/\s+/)
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const label = fold(item.label)
    const labelWords = words(item.label)
    const keyWords = [...words(item.keywords ?? ''), ...words(item.hint)]
    let score = label.startsWith(q) ? 8 : label === q ? 10 : 0
    let ok = true
    for (const t of tokens) {
      if (labelWords.some((w) => w.startsWith(t))) score += 3
      else if (keyWords.some((w) => w.startsWith(t))) score += 2
      else if (label.includes(t)) score += 1
      else {
        ok = false
        break
      }
    }
    if (ok) scored.push({ item, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map((s) => s.item)
}

/** Records the finder can open, and where each one opens. */
export const recordHref = {
  pipeline: (id: string) => `/dashboard/pipelines?edit=${encodeURIComponent(id)}`,
  source: (id: string) => `/dashboard/sources?source=${encodeURIComponent(id)}`,
  dataset: (name: string) => `/dashboard/catalog?item=${encodeURIComponent(`dataset:${name}`)}`,
  dashboard: (id: string) => `/dashboard/analytics?dashboard=${encodeURIComponent(id)}`,
  rule: (id: string) => `/dashboard/rules?edit=${encodeURIComponent(id)}`,
}
