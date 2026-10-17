import type { Permission } from '@/lib/auth/permissions'

/**
 * Upgrade notices: a dismissible banner for a new capability that changes how
 * people should work (e.g. defined dataset schemas). Shown on the screens a
 * notice names to the people with its permission, until each person dismisses
 * it (upgrade_notice_dismissals). Add new notices here, with their copy in
 * i18n (the defined-schemas notice: `schemas.upgrade`).
 */
export type UpgradeScreen = 'catalog' | 'overview'

export interface UpgradeNotice {
  id: string
  permission: Permission
  /** Screens that show it. */
  screens: UpgradeScreen[]
  /** Help chapter section it links to. */
  help: string
}

export const UPGRADE_NOTICES: UpgradeNotice[] = [{ id: 'defined-schemas', permission: 'catalog:edit', screens: ['catalog', 'overview'], help: 'catalog-schemas' }]
