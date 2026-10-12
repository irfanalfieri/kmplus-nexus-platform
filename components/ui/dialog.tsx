'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { AlertDialog as AlertPrimitive } from '@base-ui/react/alert-dialog'
import { Loader2, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/components/i18n/i18n-provider'

/*
 * Dialogs are the only layer above the board (with menus and toasts): one
 * backdrop, one shadow. Focus is trapped, Escape closes, the title names it.
 */

const SIZES = {
  sm: 'sm:max-w-[420px]',
  md: 'sm:max-w-[560px]',
  lg: 'sm:max-w-[720px]',
  xl: 'sm:max-w-[960px]',
  full: 'sm:max-w-[min(1400px,calc(100vw-2rem))] sm:h-[calc(100dvh-2rem)]',
} as const
export type DialogSize = keyof typeof SIZES

const backdropClass =
  'fixed inset-0 z-50 bg-[#081a1c]/45 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-black/60'
const popupClass =
  'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-raised outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

interface DialogContentProps extends Omit<DialogPrimitive.Popup.Props, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  size?: DialogSize
  footer?: React.ReactNode
  /** Extra controls in the header, before the close button. */
  headerActions?: React.ReactNode
  bodyClassName?: string
}

function DialogContent({ title, description, size = 'md', footer, headerActions, className, bodyClassName, children, ...props }: DialogContentProps) {
  const t = useT()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className={backdropClass} />
      <DialogPrimitive.Popup data-slot="dialog" className={cn(popupClass, SIZES[size], className)} {...props}>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-base leading-6 font-semibold text-balance">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>}
          </div>
          {headerActions}
          <DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" aria-label={t('common.close')} />}>
            <XIcon />
          </DialogPrimitive.Close>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

interface ModalProps extends Omit<DialogContentProps, 'onClose'> {
  open?: boolean
  onClose: () => void
  /** When true, closing asks before discarding changes. */
  dirty?: boolean
}

/** A controlled dialog for components that mount when opened and call `onClose`. */
function Modal({ open = true, onClose, dirty = false, ...content }: ModalProps) {
  const [asking, setAsking] = React.useState(false)
  const t = useT()
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) return
          if (dirty) setAsking(true)
          else onClose()
        }}
      >
        <DialogContent {...content} />
      </Dialog>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('dialog.unsavedTitle')}
        description={t('dialog.unsavedBody')}
        confirmLabel={t('dialog.discard')}
        cancelLabel={t('dialog.keepEditing')}
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          onClose()
        }}
      />
    </>
  )
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  confirmLabel: React.ReactNode
  cancelLabel?: React.ReactNode
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

/** Asks before an irreversible or outward-facing action. The confirm button names the action. */
function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, cancelLabel, tone = 'default', busy, onConfirm }: ConfirmDialogProps) {
  const t = useT()
  return (
    <AlertPrimitive.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Backdrop className={backdropClass} />
        <AlertPrimitive.Popup data-slot="confirm-dialog" className={cn(popupClass, SIZES.sm, 'p-5')}>
          <AlertPrimitive.Title className="text-base leading-6 font-semibold text-balance">{title}</AlertPrimitive.Title>
          {description && <AlertPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">{description}</AlertPrimitive.Description>}
          {children && <div className="mt-3 text-sm">{children}</div>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertPrimitive.Close render={<Button variant="outline" disabled={busy} />}>{cancelLabel ?? t('common.cancel')}</AlertPrimitive.Close>
            <Button variant={tone === 'danger' ? 'danger' : 'default'} disabled={busy} onClick={() => void onConfirm()}>
              {busy && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </AlertPrimitive.Popup>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  )
}

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm' | 'busy' | 'children'>

/**
 * `const [confirm, confirmDialog] = useConfirm()`; render `confirmDialog`, then
 * `if (await confirm({ title, confirmLabel, tone: 'danger' })) ...`.
 */
function useConfirm() {
  const [pending, setPending] = React.useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const confirm = React.useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })), [])
  const element = pending ? (
    <ConfirmDialog
      {...pending}
      open
      onOpenChange={(open) => {
        if (!open) {
          pending.resolve(false)
          setPending(null)
        }
      }}
      onConfirm={() => {
        pending.resolve(true)
        setPending(null)
      }}
    />
  ) : null
  return [confirm, element] as const
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, Modal, ConfirmDialog, useConfirm }
