'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Loader2,
  RefreshCw,
  Server,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type PipelineTelemetry = {
  name: string
  source: string
  destination: string
}

type PhaseStatus = 'complete' | 'running' | 'queued' | 'failed'

type Phase = {
  name: string
  label: string
  description: string
  status: PhaseStatus
  duration: string
  recordsIn: string
  recordsOut: string
  throughput: string
  errors: number
  progress: number
}

const phaseIcons = {
  Extraction: Server,
  Transformation: Zap,
  Load: Database,
}

function statusStyles(status: PhaseStatus) {
  if (status === 'complete') return { icon: CheckCircle2, tone: 'text-emerald-500', badge: 'default' as const }
  if (status === 'running') return { icon: Loader2, tone: 'text-sky-500', badge: 'secondary' as const }
  if (status === 'failed') return { icon: AlertCircle, tone: 'text-destructive', badge: 'destructive' as const }
  return { icon: Clock3, tone: 'text-muted-foreground', badge: 'outline' as const }
}

export default function PipelineExecutionVisualizer({
  isOpen,
  pipeline,
  onClose,
}: {
  isOpen: boolean
  pipeline: PipelineTelemetry | null
  onClose: () => void
}) {
  const [selectedRun, setSelectedRun] = useState('run_2048')

  const phases = useMemo<Phase[]>(() => [
    {
      name: 'Extraction',
      label: 'Extract',
      description: `Reading from ${pipeline?.source || 'source system'}`,
      status: 'complete',
      duration: '00:42',
      recordsIn: '15,420',
      recordsOut: '15,401',
      throughput: '366 rows/s',
      errors: 19,
      progress: 100,
    },
    {
      name: 'Transformation',
      label: 'Transform',
      description: 'Validating, cleansing, and applying mappings',
      status: 'running',
      duration: '01:18',
      recordsIn: '15,401',
      recordsOut: '15,388',
      throughput: '198 rows/s',
      errors: 13,
      progress: 72,
    },
    {
      name: 'Load',
      label: 'Load',
      description: `Writing records to ${pipeline?.destination || 'destination system'}`,
      status: 'queued',
      duration: '—',
      recordsIn: '—',
      recordsOut: '—',
      throughput: '—',
      errors: 0,
      progress: 0,
    },
  ], [pipeline])

  if (!isOpen || !pipeline) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-start justify-between border-b border-border p-6">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <Badge variant="secondary">Live execution view</Badge>
              <span className="text-xs text-muted-foreground">Run {selectedRun}</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{pipeline.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Observe every handoff from extraction through load.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close execution visualizer">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="overflow-y-auto p-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Records processed', value: '15,388', detail: 'of 15,420 extracted', icon: Database },
              { label: 'Pipeline health', value: '99.8%', detail: 'within expected range', icon: Gauge },
              { label: 'Elapsed time', value: '02:00', detail: 'estimated 03:12 total', icon: Clock3 },
              { label: 'Throughput', value: '198/s', detail: 'current records per second', icon: RefreshCw },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium uppercase tracking-wide">{metric.label}</span>
                  <metric.icon className="h-4 w-4" />
                </div>
                <div className="mt-2 text-2xl font-semibold">{metric.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{metric.detail}</div>
              </div>
            ))}
          </section>

          <section className="mt-6 rounded-lg border border-border p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Pipeline phase flow</h3>
                <p className="text-sm text-muted-foreground">Each phase reports its own latency, volume, and failures.</p>
              </div>
              <Badge variant="secondary">2 of 3 phases active</Badge>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
              {phases.map((phase, index) => {
                const Icon = phaseIcons[phase.name as keyof typeof phaseIcons]
                const styles = statusStyles(phase.status)
                const StatusIcon = styles.icon
                return (
                  <div key={phase.name} className="contents">
                    <div className="rounded-lg border border-border bg-background p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="rounded-md bg-muted p-2"><Icon className="h-5 w-5" /></div>
                          <div>
                            <h4 className="font-medium">{phase.name}</h4>
                            <p className="text-xs text-muted-foreground">{phase.description}</p>
                          </div>
                        </div>
                        <StatusIcon className={`h-4 w-4 ${styles.tone} ${phase.status === 'running' ? 'animate-spin' : ''}`} />
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${phase.progress}%` }} />
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>{phase.progress}% complete</span>
                        <span>{phase.duration}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                        <div><div className="text-muted-foreground">Records in</div><div className="mt-1 font-medium">{phase.recordsIn}</div></div>
                        <div><div className="text-muted-foreground">Records out</div><div className="mt-1 font-medium">{phase.recordsOut}</div></div>
                        <div><div className="text-muted-foreground">Throughput</div><div className="mt-1 font-medium">{phase.throughput}</div></div>
                        <div><div className="text-muted-foreground">Errors</div><div className={`mt-1 font-medium ${phase.errors ? 'text-amber-500' : ''}`}>{phase.errors}</div></div>
                      </div>
                    </div>
                    {index < phases.length - 1 && <ArrowRight className="mx-auto hidden h-5 w-5 text-muted-foreground lg:block" />}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
            <div className="rounded-lg border border-border p-5">
              <div className="mb-4 flex items-center justify-between">
                <div><h3 className="font-semibold">Recent executions</h3><p className="text-sm text-muted-foreground">Compare duration and outcome across runs.</p></div>
                <Button variant="outline" size="sm"><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button>
              </div>
              <div className="space-y-2">
                {[
                  ['run_2048', 'Running', '02:00', '15,388', 'Today, 10:42'],
                  ['run_2047', 'Success', '03:12', '15,420', 'Today, 08:00'],
                  ['run_2046', 'Success', '03:08', '15,418', 'Yesterday, 08:00'],
                  ['run_2045', 'Failed', '00:45', '0', 'Mon, 08:00'],
                ].map(([id, status, duration, records, started]) => (
                  <button key={id} onClick={() => setSelectedRun(id)} className={`grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/40 ${selectedRun === id ? 'border-primary bg-muted/30' : 'border-border'}`}>
                    <span className="font-medium">{id}</span><Badge variant={status === 'Success' ? 'default' : status === 'Failed' ? 'destructive' : 'secondary'}>{status}</Badge><span className="text-muted-foreground">{duration}</span><span className="text-muted-foreground">{records} rows · {started}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border p-5">
              <h3 className="font-semibold">Operational signals</h3>
              <div className="mt-4 space-y-4">
                {[
                  ['Data quality', '99.8%', 'No blocking issues detected', 'text-emerald-500'],
                  ['Retries', '1', 'Automatic retry budget: 3', 'text-amber-500'],
                  ['Last heartbeat', '12 sec ago', 'Source and worker responding', 'text-sky-500'],
                  ['Schema drift', 'None', 'Contract matches destination', 'text-emerald-500'],
                ].map(([label, value, detail, tone]) => <div key={label} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"><div><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted-foreground">{detail}</div></div><span className={`text-sm font-semibold ${tone}`}>{value}</span></div>)}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
