'use client'

import { useCallback, useEffect, useState } from 'react'
import { Database, RefreshCw, Loader } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/components/i18n/i18n-provider'
import {
  getDataSourceTableSample,
  scanDataSourceSchema,
} from '@/lib/actions/connector-source'
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
  const [, setTotalRows] = useState<number | null>(null)
  const [loadingScan, setLoadingScan] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)
  const [error, setError] = useState('')
  const { t, formatNumber } = usePrefs()

  const loadScan = useCallback(async () => {
    setLoadingScan(true)
    setError('')
    try {
      const result = await scanDataSourceSchema(sourceId)
      setScan(result)
      if (result.tables.length > 0) setSelectedTable(result.tables[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('connect.schemaExplorer.scanFailed'))
    } finally {
      setLoadingScan(false)
    }
  }, [sourceId]) // eslint-disable-line react-hooks/exhaustive-deps -- rescan per source, not per language

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
        setError(err instanceof Error ? err.message : t('connect.schemaExplorer.sampleFailed'))
      } finally {
        setLoadingSample(false)
      }
    },
    [sourceId] // eslint-disable-line react-hooks/exhaustive-deps -- reload per table, not per language
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

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="full"
      title={t('connect.schemaExplorer.title')}
      description={
        <>
          {sourceName} · <span className="font-mono">{sourceType.toUpperCase()}</span>
        </>
      }
      headerActions={
        <Button size="sm" variant="outline" onClick={() => void loadScan()} disabled={loadingScan}>
          <RefreshCw className={cn(loadingScan && 'animate-spin')} aria-hidden />
          {t('connect.schemaExplorer.rescan')}
        </Button>
      }
      bodyClassName="p-0 lg:overflow-hidden"
      footer={
        <>
          <Button onClick={onClose} variant="outline">
            {t('common.close')}
          </Button>
          {onProceed && <Button onClick={onProceed}>{t('connect.schemaExplorer.proceed')}</Button>}
        </>
      }
    >
      <div className="grid lg:h-full lg:grid-cols-[320px_1fr]">
        <nav aria-label={t('connect.schemaExplorer.objectsNav')} className="border-b border-border p-4 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {t('connect.schemaExplorer.objects')} <span className="font-mono text-muted-foreground">({scan?.tables.length ?? 0})</span>
            </h3>
            {scan && (
              <Badge variant="outline" className="font-mono">
                {scan.method}
              </Badge>
            )}
          </div>
          {loadingScan && !scan && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
              <Loader className="size-4 animate-spin" aria-hidden />
              {t('connect.schemaExplorer.scanning')}
            </div>
          )}
          <ul className="space-y-2">
            {scan?.tables.map((table) => {
              const selected = selectedTable?.name === table.name
              return (
                <li key={`${table.schema}.${table.name}`}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedTable(table)}
                    className={cn(
                      'w-full rounded-md border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      selected ? 'border-primary/60 bg-accent text-accent-foreground' : 'border-border bg-card hover:bg-muted'
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Database className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 truncate font-mono text-sm">{table.name}</span>
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted-foreground">
                      {t('connect.schemaExplorer.columns', { count: table.columns.length })}
                      {table.rowCount != null ? ` · ${t('common.rows', { count: formatNumber(table.rowCount) })}` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="p-5 lg:overflow-y-auto">
          {error && (
            <Notice tone="danger" className="mb-4">
              {error}
            </Notice>
          )}
          {selectedTable ? (
            <div className="space-y-6">
              <div>
                <h3 className="font-mono text-base font-semibold">{selectedTable.name}</h3>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {t('connect.schemaExplorer.columns', { count: selectedTable.columns.length })}
                  {selectedTable.rowCount != null ? ` · ${t('connect.schemaExplorer.totalRows', { count: formatNumber(selectedTable.rowCount) })}` : ''}
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <Table label={t('connect.schemaExplorer.columnsOf', { name: selectedTable.name })}>
                  <THead>
                    <tr>
                      <Th>{t('connect.schemaExplorer.column')}</Th>
                      <Th>{t('connect.schemaExplorer.type')}</Th>
                      <Th>{t('connect.schemaExplorer.nullable')}</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {selectedTable.columns.map((col) => (
                      <Tr key={col.name}>
                        <Td className="font-mono text-xs">{col.name}</Td>
                        <Td className="font-mono text-xs text-muted-foreground">{col.type}</Td>
                        <Td className="text-muted-foreground">{col.nullable ? t('common.yes') : t('common.no')}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{t('connect.schemaExplorer.sampleData')}</h4>
                  {loadingSample && (
                    <span role="status" className="text-muted-foreground">
                      <Loader className="size-4 animate-spin" aria-hidden />
                      <span className="sr-only">{t('connect.schemaExplorer.loadingSample')}</span>
                    </span>
                  )}
                </div>
                {sampleRows.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table label={t('connect.schemaExplorer.sampleRowsOf', { name: selectedTable.name })}>
                      <THead>
                        <tr>
                          {sampleColumns.map((col) => (
                            <Th key={col}>{col}</Th>
                          ))}
                        </tr>
                      </THead>
                      <TBody>
                        {sampleRows.map((row, idx) => (
                          <Tr key={idx}>
                            {sampleColumns.map((col) => (
                              <Td key={`${idx}-${col}`} className="max-w-xs truncate text-muted-foreground">
                                {formatCell(row[col])}
                              </Td>
                            ))}
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ) : (
                  !loadingSample && <p className="text-sm text-muted-foreground">{t('connect.schemaExplorer.noRows')}</p>
                )}
              </section>

              <Notice tone="info" title={t('connect.schemaExplorer.liveTitle')} live={false}>
                {t('connect.schemaExplorer.liveBody', { type: sourceType })}
              </Notice>
            </div>
          ) : (
            !loadingScan && <p className="py-12 text-center text-sm text-muted-foreground">{t('connect.schemaExplorer.noObjects')}</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
