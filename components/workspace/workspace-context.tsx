'use client'

import { createContext, useContext } from 'react'
import type { getWorkspaceContext } from '@/lib/actions/workspaces'
import { can, ROLE_INFO, type Permission } from '@/lib/auth/permissions'

export type WorkspaceInfo = Awaited<ReturnType<typeof getWorkspaceContext>>

const WorkspaceCtx = createContext<WorkspaceInfo | null>(null)

export function WorkspaceProvider({ value, children }: { value: WorkspaceInfo; children: React.ReactNode }) {
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceCtx)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}

/** UI-side permission check. The server enforces the same table; this only hides/disables controls. */
export function useCan(permission: Permission) {
  return can(useWorkspace().role, permission)
}

/** Tooltip text for a disabled control. */
export function useDeniedHint(permission: Permission) {
  const { role } = useWorkspace()
  return can(role, permission) ? undefined : `Not available for your role (${ROLE_INFO[role].label})`
}
