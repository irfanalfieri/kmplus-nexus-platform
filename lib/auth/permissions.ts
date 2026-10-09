/**
 * Workspace roles and what each may do (PRD §4 permission matrix).
 * Client-safe: the server enforces these in requireWorkspace(); the UI uses the
 * same table to hide or disable controls.
 */

export const ROLES = ['admin', 'steward', 'operator', 'analyst', 'auditor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  admin: { label: 'Admin', description: 'Everything: data sources, connectors, pipelines, members and roles.' },
  steward: { label: 'Data steward', description: 'Builds and runs pipelines, previews data, reads the audit log.' },
  operator: { label: 'Operator', description: 'Runs and schedules pipelines and watches monitoring; cannot edit them.' },
  analyst: { label: 'Analyst', description: 'Browses pipelines, monitoring and dataset contents.' },
  auditor: { label: 'Auditor', description: 'Read-only, including dataset contents and the audit log.' },
  viewer: { label: 'Viewer', description: 'Read-only overview of pipelines and monitoring; no data contents.' },
}

const MATRIX = {
  /** Rename the workspace, manage members, roles and invites. */
  'workspace:manage': ['admin'],
  /** Add, edit, re-test, switch role and delete data sources (credentials). */
  'sources:manage': ['admin'],
  /** Install and uninstall connectors. */
  'connectors:manage': ['admin'],
  /** Create, edit, delete, restore and reset pipelines. */
  'pipelines:edit': ['admin', 'steward'],
  /** Run now and pause/resume schedules. */
  'pipelines:run': ['admin', 'steward', 'operator'],
  /** See actual data rows: dataset previews, source samples, test-run rows, rejected rows. */
  'data:preview': ['admin', 'steward', 'operator', 'analyst', 'auditor'],
  /** Read the audit log. */
  'audit:view': ['admin', 'steward', 'auditor'],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof MATRIX

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && (MATRIX[permission] as readonly Role[]).includes(role)
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Message shown when a role lacks a permission. */
export function deniedMessage(role: Role, permission: Permission) {
  const who = MATRIX[permission].map((r) => ROLE_INFO[r].label).join(', ')
  return `Your role (${ROLE_INFO[role].label}) can't do this. Allowed: ${who}. Ask a workspace admin to change your role.`
}
