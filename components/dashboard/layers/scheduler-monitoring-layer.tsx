'use client'

import { useState } from 'react'
import { Activity, Download, Eye, FileDown, Search, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const CATALOG = [
  { name: 'employee_master', label: 'Employees', records: '84,230', owner: 'HRIS Pipeline', updated: '4 min ago', columns: '18' },
  { name: 'organization', label: 'Organization', records: '1,240', owner: 'SAP Org Sync', updated: '12 min ago', columns: '9' },
  { name: 'position', label: 'Position', records: '8,420', owner: 'SAP Org Sync', updated: '12 min ago', columns: '14' },
  { name: 'learning_history', label: 'Learning History', records: '248,902', owner: 'LMS Ingestion', updated: '31 min ago', columns: '22' },
  { name: 'kpi_daily', label: 'KPI', records: '32,480', owner: 'KPI Warehouse Load', updated: '1 hour ago', columns: '16' },
]

const RAW = 'employee_id,full_name,department,position,status\nEMP-001,Amira Rahman,Engineering,Staff Engineer,Active\nEMP-002,Daniel Lee,Operations,Operations Lead,Active\nEMP-003,Sofia Chen,Learning,Program Manager,Active\n'

export default function SchedulerMonitoringLayer() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(CATALOG[0])
  const filtered = CATALOG.filter((item) => `${item.name} ${item.label} ${item.owner}`.toLowerCase().includes(query.toLowerCase()))
  const downloadRaw = () => { const url = URL.createObjectURL(new Blob([RAW], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${selected.name}-raw.csv`; link.click(); URL.revokeObjectURL(url) }
  return <div className="space-y-6"><div className="rounded-xl border border-border bg-card p-6"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><Badge variant="outline">Monitoring & Data Catalog</Badge></div><h2 className="text-2xl font-bold">Produced Data Monitor</h2><p className="mt-2 text-muted-foreground">Browse final pipeline datasets, inspect their freshness, and download raw data exactly as produced.</p></div><div className="flex gap-2"><Badge variant="secondary">5 catalogs</Badge><Badge variant="secondary">99.2% fresh</Badge></div></div></div>
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]"><section className="rounded-xl border border-border bg-card p-5"><div className="relative mb-4"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search catalogs..." className="pl-9" /></div><div className="space-y-2">{filtered.map((item) => <button key={item.name} onClick={() => setSelected(item)} className={`w-full rounded-lg border p-3 text-left ${selected.name === item.name ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}><div className="flex items-center justify-between"><span className="font-medium">{item.label}</span><Activity className="h-4 w-4 text-green-600" /></div><div className="mt-1 text-xs text-muted-foreground">{item.name} · {item.records} records</div></button>)}</div></section><section className="rounded-xl border border-border bg-card p-6"><div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between"><div><Badge variant="outline">Dataset</Badge><h3 className="mt-2 text-xl font-semibold">{selected.label}</h3><p className="font-mono text-sm text-muted-foreground">{selected.name}</p></div><div className="flex gap-2"><Button variant="outline" onClick={downloadRaw}><Download className="mr-2 h-4 w-4" />Download raw CSV</Button><Button variant="outline"><Eye className="mr-2 h-4 w-4" />Inspect schema</Button></div></div><div className="grid gap-3 py-5 sm:grid-cols-4">{[['Records',selected.records],['Columns',selected.columns],['Owner',selected.owner],['Updated',selected.updated]].map(([label,value]) => <div key={label} className="rounded-lg bg-muted/30 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div>)}</div><div className="rounded-lg border border-border"><div className="flex items-center justify-between border-b border-border p-4"><div><h4 className="font-semibold">Raw data sample</h4><p className="text-sm text-muted-foreground">The download contains the unmodified produced records.</p></div><FileDown className="h-5 w-5 text-muted-foreground" /></div><pre className="overflow-x-auto p-4 text-xs leading-6 text-muted-foreground">{RAW}</pre></div></section></div></div>
}
