'use client'

import { useState } from 'react'
import { BarChart3, Database, LineChart, PieChart, Plus, Play, Save, Sparkles, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const DATASETS = ['employee_master', 'organization', 'learning_history', 'kpi_daily', 'pipeline_runs']
const SAMPLE = [42, 58, 51, 76, 69, 88, 81]

export default function AnalyticsDashboardLayer() {
  const [mode, setMode] = useState<'visual' | 'sql'>('visual')
  const [dashboardName, setDashboardName] = useState('Executive Data Operations')
  const [selectedDataset, setSelectedDataset] = useState(DATASETS[0])
  const [chartType, setChartType] = useState('Bar chart')
  const [sql, setSql] = useState('SELECT department, COUNT(*) AS employees FROM employee_master GROUP BY department ORDER BY employees DESC;')
  const [saved, setSaved] = useState(false)

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between">
      <div><div className="mb-2 flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><Badge variant="outline">Layer 10</Badge></div><h2 className="text-2xl font-bold">Analytics Studio</h2><p className="mt-2 text-muted-foreground">Explore every produced dataset and build decision-ready dashboards without leaving Nexus.</p></div>
      <div className="flex gap-2"><Button variant={mode === 'visual' ? 'default' : 'outline'} onClick={() => setMode('visual')}><BarChart3 className="mr-2 h-4 w-4" />Build with UI</Button><Button variant={mode === 'sql' ? 'default' : 'outline'} onClick={() => setMode('sql')}><Table2 className="mr-2 h-4 w-4" />Write SQL</Button></div>
    </div>
    <div className="grid gap-4 md:grid-cols-4">{[['2.4M','Records available'],['18','Produced datasets'],['12','Active pipelines'],['94%','Quality score']].map(([value,label]) => <div key={label} className="rounded-lg border border-border bg-card p-4"><div className="text-2xl font-bold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></div>)}</div>
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-xl border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Datasets</h3><Database className="h-4 w-4 text-muted-foreground" /></div><div className="space-y-2">{DATASETS.map((dataset) => <button key={dataset} onClick={() => setSelectedDataset(dataset)} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selectedDataset === dataset ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><span>{dataset}</span><span className="text-xs text-muted-foreground">{dataset === 'employee_master' ? '84K' : '24K'}</span></button>)}</div><Button variant="outline" className="mt-5 w-full"><Plus className="mr-2 h-4 w-4" />Add dataset</Button></aside>
      <section className="rounded-xl border border-border bg-card p-6"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><Input value={dashboardName} onChange={(e) => setDashboardName(e.target.value)} className="max-w-sm text-lg font-semibold" /><p className="mt-1 text-sm text-muted-foreground">Dataset: {selectedDataset}</p></div><Button onClick={() => setSaved(true)}><Save className="mr-2 h-4 w-4" />{saved ? 'Saved' : 'Save dashboard'}</Button></div>
        {mode === 'visual' ? <div className="space-y-5"><div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Measure<select className="mt-2 w-full rounded-md border border-input bg-background p-2"><option>Employee count</option><option>Quality score</option><option>Records processed</option></select></label><label className="text-sm">Dimension<select className="mt-2 w-full rounded-md border border-input bg-background p-2"><option>Department</option><option>Month</option><option>Pipeline</option></select></label><label className="text-sm">Visualization<select value={chartType} onChange={(e) => setChartType(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-background p-2"><option>Bar chart</option><option>Line chart</option><option>Donut chart</option><option>KPI card</option></select></label></div><div className="rounded-lg border border-border bg-muted/20 p-5"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-semibold">{chartType} preview</h3><p className="text-sm text-muted-foreground">Employee count by department</p></div><LineChart className="h-5 w-5 text-primary" /></div><div className="flex h-52 items-end gap-4 border-b border-border px-4">{SAMPLE.map((height, index) => <div key={index} className="flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-t bg-primary/80" style={{ height: `${height}%` }} /><span className="text-xs text-muted-foreground">{['ENG','HR','OPS','FIN','MKT','IT','L&D'][index]}</span></div>)}</div></div></div> : <div className="space-y-4"><textarea value={sql} onChange={(e) => setSql(e.target.value)} className="min-h-44 w-full rounded-lg border border-input bg-background p-4 font-mono text-sm" /><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">SQL runs against the selected dataset and can be added as a dashboard tile.</span><Button><Play className="mr-2 h-4 w-4" />Run query</Button></div><div className="rounded-lg border border-border p-4"><div className="mb-3 flex items-center gap-2"><Table2 className="h-4 w-4" /><span className="font-semibold">Query result preview</span></div><div className="grid grid-cols-3 gap-2 text-sm"><span className="font-medium">Department</span><span className="font-medium">Employees</span><span className="font-medium">Share</span>{['Engineering','Operations','Human Resources'].map((name, i) => <><span key={`${name}-name`}>{name}</span><span key={`${name}-count`}>{[18420, 12680, 8420][i].toLocaleString()}</span><span key={`${name}-share`}>{[31,22,14][i]}%</span></>)}</div></div></div>}
      </section>
    </div>
  </div>
}
