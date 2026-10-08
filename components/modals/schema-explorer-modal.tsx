'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, Database, RefreshCw, Loader, Copy, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getDataSourceTableSample,
  scanDataSourceSchema,
} from '@/app/actions/connector-source'
import type { SchemaScanResult, SchemaTable } from '@/lib/connectors/types'

interface SchemaExplorerModalProps {
  isOpen: boolean
  sourceId: string
  sourceName: string
  sourceType: string
  initialScan?: SchemaScanResult | null
  onClose: () => void
  onProceed?: () => void
}

function formatCell(value: unknown) {
  if (value == null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function SchemaExplorerModal({
  isOpen,
  sourceId,
  sourceName,
  sourceType,
  initialScan,
  onClose,
  onProceed,
}: SchemaExplorerModalProps) {
  const [scan, setScan] = useState<SchemaScanResult | null>(initialScan ?? null)
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null)
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
      const result = await scanDataSourceSchema(sourceId)
      setScan(result)
      if (result.tables.length > 0) setSelectedTable(result.tables[0])
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
        const sample = await getDataSourceTableSample(sourceId, tableName, 25)
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h3 className="text-lg font-semibold">Schema Explorer</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {sourceName} · {sourceType.toUpperCase()}
            </p>
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
              <h4 className="text-sm font-semibold">Objects ({scan?.tables.length ?? 0})</h4>
              {scan && <Badge variant="outline">{scan.method}</Badge>}
            </div>
            {loadingScan && !scan && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Scanning…
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
                  <h4 className="text-lg font-semibold">{selectedTable.name}</h4>
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
                        <th className="px-4 py-2 text-left">Column</th>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-left">Nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTable.columns.map((col) => (
                        <tr key={col.name} className="border-b border-border/50">
                          <td className="px-4 py-2 font-mono text-xs">{col.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{col.type}</td>
                          <td className="px-4 py-2 text-muted-foreground">{col.nullable ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">Sample data</h4>
                    {loadingSample && <Loader className="h-4 w-4 animate-spin" />}
                  </div>
                  {sampleRows.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border/50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/30">
                            {sampleColumns.map((col) => (
                              <th key={col} className="px-4 py-2 text-left">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sampleRows.map((row, idx) => (
                            <tr key={idx} className="border-b border-border/50">
                              {sampleColumns.map((col) => (
                                <td key={`${idx}-${col}`} className="max-w-xs truncate px-4 py-2 text-muted-foreground">
                                  {formatCell(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    !loadingSample && (
                      <p className="text-sm text-muted-foreground">No rows returned for this object.</p>
                    )
                  )}
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-100/50 p-4">
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600" />
                    <div className="text-sm">
                      <div className="font-semibold text-blue-900">Live connection</div>
                      <p className="mt-1 text-blue-800">
                        Schema and samples are loaded from your production {sourceType} connection.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              !loadingScan && (
                <p className="py-12 text-center text-sm text-muted-foreground">No schema objects found.</p>
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
