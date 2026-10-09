'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createWorkspace, switchWorkspace } from '@/lib/actions/workspaces'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { useWorkspace } from './workspace-context'

export default function WorkspaceSwitcher() {
  const { workspace, role, workspaces } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  // A full reload resets every screen to the new workspace's data.
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left hover:bg-muted"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          {workspace.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{workspace.name}</div>
          <div className="text-xs text-muted-foreground">{ROLE_INFO[role].label}</div>
        </div>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <div className="px-2 py-1 text-xs text-muted-foreground">Workspaces</div>
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  disabled={busy}
                  onClick={() => (w.id === workspace.id ? setOpen(false) : void run(() => switchWorkspace(w.id)))}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  role="option"
                  aria-selected={w.id === workspace.id}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_INFO[w.role].label}</span>
                  {w.id === workspace.id && <Check className="h-4 w-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-border pt-1">
            {creating ? (
              <form
                className="space-y-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => createWorkspace(name))
                }}
              >
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name, e.g. PT Contoh" className="h-8" />
                <div className="flex gap-2">
                  <Button size="sm" type="submit" disabled={busy || !name.trim()} className="flex-1">
                    {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Create
                  </Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Plus className="h-4 w-4" /> New workspace
              </button>
            )}
            {error && <p className="px-2 pb-1 text-xs text-destructive">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
