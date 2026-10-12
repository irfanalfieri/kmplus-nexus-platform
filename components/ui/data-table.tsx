'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/components/i18n/i18n-provider'

/* Table primitives: one rhythm for every table in the app. */

export function Table({ className, children, label, ...props }: React.ComponentProps<'table'> & { label?: string }) {
  return (
    <div data-slot="table" className="relative w-full overflow-x-auto overflow-y-hidden">
      <table aria-label={label} className={cn('w-full border-collapse text-left text-sm tabular-nums', className)} {...props}>
        {children}
      </table>
    </div>
  )
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted/60 [&_tr]:border-b [&_tr]:border-border', className)} {...props} />
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-0', className)} {...props} />
}

export function Tr({ className, selected, ...props }: React.ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      data-selected={selected || undefined}
      aria-selected={selected || undefined}
      className={cn('transition-colors hover:bg-muted/50 data-[selected]:bg-accent data-[selected]:shadow-[inset_3px_0_0_var(--live)]', className)}
      {...props}
    />
  )
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return <th scope="col" className={cn('h-9 px-3 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase first:pl-4 last:pr-4', className)} {...props} />
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle first:pl-4 last:pr-4', className)} {...props} />
}

export interface Column<Row> {
  key: string
  header: React.ReactNode
  /** Plain-text name for the sort button's label. */
  label?: string
  cell: (row: Row) => React.ReactNode
  sortValue?: (row: Row) => string | number | null | undefined
  align?: 'left' | 'right'
  className?: string
  /** Hide on narrow screens (the row's first column always stays). */
  hideBelow?: 'sm' | 'md' | 'lg'
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const

/** A sortable data table with loading and empty states. */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  selectedKey,
  loading,
  empty,
  initialSort,
  className,
}: {
  label: string
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  selectedKey?: string | null
  loading?: boolean
  empty?: React.ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  className?: string
}) {
  const t = useT()
  const [sort, setSort] = React.useState(initialSort ?? null)
  const sorted = React.useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    return [...rows].sort((a, b) => {
      const x = get(a) ?? ''
      const y = get(b) ?? ''
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return sort!.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, sort])

  return (
    <Table label={label} className={className} aria-busy={loading || undefined}>
      <THead>
        <tr>
          {columns.map((c) => {
            const active = sort?.key === c.key
            return (
              <Th
                key={c.key}
                aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={cn(c.align === 'right' && 'text-right', c.hideBelow && HIDE[c.hideBelow], c.className)}
              >
                {c.sortValue ? (
                  <button
                    type="button"
                    className={cn('-mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase hover:text-foreground', active && 'text-foreground')}
                    aria-label={t('table.sortBy', { column: c.label ?? (typeof c.header === 'string' ? c.header : c.key) })}
                    onClick={() => setSort(active && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}
                  >
                    {c.header}
                    {active ? sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                  </button>
                ) : (
                  c.header
                )}
              </Th>
            )
          })}
        </tr>
      </THead>
      <TBody>
        {loading && rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="py-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto size-5 animate-spin" aria-hidden />
              <span className="sr-only">{t('common.loading')}</span>
            </td>
          </tr>
        ) : sorted.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{empty ?? <p className="py-8 text-center text-muted-foreground">{t('table.empty')}</p>}</td>
          </tr>
        ) : (
          sorted.map((row) => {
            const key = rowKey(row)
            return (
              <Tr key={key} selected={selectedKey === key}>
                {columns.map((c) => (
                  <Td key={c.key} className={cn(c.align === 'right' && 'text-right', c.hideBelow && HIDE[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </Td>
                ))}
              </Tr>
            )
          })
        )}
      </TBody>
    </Table>
  )
}
