'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, Database, RefreshCw, Loader, Copy, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getSupabaseTableSampleAction,
  scanSupabaseSourceSchema,
} from '@/app/actions/supabase-source'
import type { SupabaseSchemaScan, SupabaseTable } from '@/lib/supabase/types'

interface SupabaseSchemaExplorerModalProps {
  isOpen: boolean
  sourceId: string
  sourceName: string
  initialScan?: SupabaseSchemaScan | null
  onClose: () => void
  onProceed?: () => void
}

export default function SupabaseSchemaExplorerModal({
  isOpen,
  sourceId,
  sourceName,
  initialScan,
  onClose,
  onProceed,
}: SupabaseSchemaExplorerModalProps) {
  const [scan, setScan] = useState<SupabaseSchemaScan | null>(initialScan ?? null)
  const [selectedTable, setSelectedTable] = useState<SupabaseTable | null>(null)
  const [sampleColumns, setSampleColumns] = useState<string[]>([])
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([])
  const [totalRows, setTotalRows] = useState<number | null>(null)
  const [loadingScan, setLoadingScan] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const loadScan = useCallback(async () => {
    setLoadingScan(true)
    setError('')
    try {
      const result = await scanSupabaseSourceSchema(sourceId)
      setScan(result)
      if (result.tables.length > 0) {
        setSelectedTable(result.tables[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan schema')
    } finally {
      setLoadingScan(false)
    }
  }, [sourceId])

  const loadSample = useCallback(
    async (tableName: string) => {
      setLoadingSample(true)
      setError('')
      try {
        const sample = await getSupabaseTableSampleAction(sourceId, tableName, 25)
        setSampleColumns(sample.columns)
        setSampleRows(sample.rows)
        setTotalRows(sample.totalRows ?? null)
      } catch (err) {
        setSampleColumns([])
        setSampleRows([])
        setTotalRows(null)
        setError(err instanceof Error ? err.message : 'Failed to load table data')
      } finally {
        setLoadingSample(false)
      }
    },
    [sourceId]
  )

  useEffect(() => {
    if (!isOpen) return
    if (initialScan?.tables.length) {
      setScan(initialScan)
      setSelectedTable(initialScan.tables[0])
      return
    }
    void loadScan()
  }, [isOpen, initialScan, loadScan])

  useEffect(() => {
    if (!isOpen || !selectedTable) return
    void loadSample(selectedTable.name)
  }, [isOpen, selectedTable, loadSample])

  const jsonPreview = JSON.stringify(sampleRows, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonPreview)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h3 className="text-lg font-semibold">Supabase Schema Explorer</h3>
            <p className="mt-1 text-sm text-muted-foreground">{sourceName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadScan()} disabled={loadingScan}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loadingScan ? 'animate-spin' : ''}`} />
              Rescan
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid flex-1 overflow-hidden lg:grid-cols-[320px_1fr]">
          <div className="overflow-y-auto border-r border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Tables ({scan?.tables.length ?? 0})</h4>
              {scan && (
                <Badge variant="outline" className="text-xs">
                  {scan.method === 'postgres' ? 'Postgres' : 'REST API'}
                </Badge>
              )}
            </div>

            {loadingScan && !scan && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Scanning schema…
              </div>
            )}

            <div className="space-y-2">
              {scan?.tables.map((table) => (
                <button
                  key={`${table.schema}.${table.name}`}
                  type="button"
                  onClick={() => setSelectedTable(table)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedTable?.name === table.name
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 bg-muted/20 hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Database className="h-4 w-4 text-primary" />
                    {table.name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {table.columns.length} columns
                    {table.rowCount != null ? ` · ${table.rowCount.toLocaleString()} rows` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto p-6">
            {error && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {selectedTable ? (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-lg font-semibold">{selectedTable.name}</h4>
                    <Badge>{selectedTable.schema}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedTable.columns.length} columns
                    {selectedTable.rowCount != null
                      ? ` · ${selectedTable.rowCount.toLocaleString()} total rows`
                      : ''}
                  </p>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="px-4 py-2 text-left font-medium">Column</th>
                        <th className="px-4 py-2 text-left font-medium">Type</th>
                        <th className="px-4 py-2 text-left font-medium">Nullable</th>
                        <th className="px-4 py-2 text-left font-medium">PK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTable.columns.map((column) => (
                        <tr key={column.name} className="border-b border-border/50">
                          <td className="px-4 py-2 font-mono text-xs">{column.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{column.type}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {column.nullable ? 'Yes' : 'No'}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {column.isPrimaryKey ? 'Yes' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">
                      Sample data
                      {totalRows != null ? ` (${Math.min(sampleRows.length, 25)} of ${totalRows})` : ''}
                    </h4>
                    {loadingSample && <Loader className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>

                  {sampleRows.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border/50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/30">
                            {sampleColumns.map((col) => (
                              <th key={col} className="px-4 py-2 text-left font-medium">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sampleRows.map((row, idx) => (
                            <tr key={idx} className="border-b border-border/50 hover:bg-muted/20">
                              {sampleColumns.map((col) => (
                                <td key={`${idx}-${col}`} className="max-w-xs truncate px-4 py-2">
                                  <span className="text-muted-foreground">
                                    {formatCell(row[col])}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    !loadingSample && (
                      <p className="text-sm text-muted-foreground">
                        No rows returned. Check RLS policies or use a service role key for full access.
                      </p>
                    )
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">JSON preview</h4>
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      <Copy className="mr-1 h-4 w-4" />
                      {copied ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-auto rounded-lg bg-muted/30 p-4">
                    <pre className="font-mono text-xs text-muted-foreground">{jsonPreview}</pre>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-100/50 p-4">
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                    <div className="text-sm">
                      <div className="font-semibold text-blue-900">Live Supabase connection</div>
                      <p className="mt-1 text-blue-800">
                        Schema and sample rows are loaded directly from your Supabase project via PostgREST.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              !loadingScan && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No tables found in the selected schema.
                </p>
              )
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          {onProceed && (
            <Button onClick={onProceed} className="flex-1">
              Proceed to Pipeline Design
            </Button>
          )}
          <Button onClick={onClose} variant="outline" className="flex-1">
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatCell(value: unknown) {
  if (value == null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
