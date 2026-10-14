/** Client-safe map of the dashboard: one URL per screen. */
import type { Permission, Role } from '@/lib/auth/permissions'

export const SECTIONS = ['overview', 'sources', 'connectors', 'pipelines', 'rules', 'quality', 'catalog', 'monitoring', 'analytics', 'governance', 'settings', 'help'] as const
export type Section = (typeof SECTIONS)[number]

export const NAV_GROUPS = [
  { group: 'home', items: ['overview'] },
  { group: 'build', items: ['sources', 'connectors', 'pipelines', 'rules'] },
  { group: 'operate', items: ['monitoring', 'quality'] },
  { group: 'govern', items: ['catalog', 'governance'] },
  { group: 'analyze', items: ['analytics'] },
  { group: 'workspace', items: ['settings'] },
] as const satisfies readonly { group: string; items: readonly Section[] }[]

export function isSection(value: unknown): value is Section {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value)
}

export const sectionHref = (section: Section) => `/dashboard/${section}`

/** Where /dashboard lands: stewards start in the quarantine inbox, everyone else on the overview. */
export function landingSection(role: Role): Section {
  return role === 'steward' ? 'quality' : 'overview'
}

export const SETTINGS_TABS = ['general', 'members', 'account', 'access', 'environments', 'agents', 'ai', 'api', 'webhooks', 'audit'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** Tabs a role can't use are hidden (the server checks again). `null` = every member. */
export const SETTINGS_TAB_PERMISSION: Record<SettingsTab, Permission | null> = {
  general: null,
  members: null,
  account: null,
  access: 'workspace:manage',
  environments: 'workspace:manage',
  agents: 'workspace:manage',
  ai: 'workspace:manage',
  api: 'api:manage',
  webhooks: 'api:manage',
  audit: 'audit:view',
}

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value)
}

export const settingsHref = (tab: SettingsTab) => (tab === 'general' ? '/dashboard/settings' : `/dashboard/settings/${tab}`)
