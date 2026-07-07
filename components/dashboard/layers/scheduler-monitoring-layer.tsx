'use client'

import { useState } from 'react'
import { Clock, Activity, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const EXECUTIONS = [
  {
    id: 'exec_1',
    pipeline: 'Daily SAP to Oracle Sync',
    status: 'success',
    recordsProcessed: 15420,
    duration: '2m 34s',
    startTime: '2 hours ago',
  },
  {
    id: 'exec_2',
    pipeline: 'REST API Data Ingestion',
    status: 'running',
    recordsProcessed: 3200,
    duration: 'In progress',
    startTime: '5 minutes ago',
  },
  {
    id: 'exec_3',
    pipeline: 'Data Quality Check Pipeline',
    status: 'success',
    recordsProcessed: 98400,
    duration: '1m 45s',
    startTime: '1 hour ago',
  },
  {
    id: 'exec_4',
    pipeline: 'Daily SAP to Oracle Sync',
    status: 'failed',
    recordsProcessed: 0,
    duration: '45s',
    startTime: '26 hours ago',
  },
]

export default function SchedulerMonitoringLayer() {
  const [executions, setExecutions] = useState(EXECUTIONS)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const retryExecution = (id: string) => {
    setRetryingId(id)
    setTimeout(() => {
      setExecutions(
        executions.map((e) =>
          e.id === id
            ? {
                ...e,
                status: 'running',
                recordsProcessed: 0,
                duration: 'In progress',
                startTime: 'Just now',
              }
            : e
        )
      )
      setRetryingId(null)
    }, 800)
  }

  const successCount = executions.filter((e) => e.status === 'success').length
  const failureCount = executions.filter((e) => e.status === 'failed').length
  const runningCount = executions.filter((e) => e.status === 'running').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-2xl font-bold mb-2">Layer 4: Scheduler</h2>
          <p className="text-muted-foreground text-sm">
            Schedule and manage recurring pipeline executions with flexible timing.
          </p>
        </div>
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-2xl font-bold mb-2">Layer 5: Monitoring Dashboard</h2>
          <p className="text-muted-foreground text-sm">
            Real-time monitoring and alerts for pipeline execution status.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Running</div>
          <div className="text-3xl font-bold mt-2 text-blue-600">{runningCount}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Successful</div>
          <div className="text-3xl font-bold mt-2 text-green-600">{successCount}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Failed</div>
          <div className="text-3xl font-bold mt-2 text-red-600">{failureCount}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Avg Duration</div>
          <div className="text-3xl font-bold mt-2">2m 15s</div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold mb-4">Recent Executions</h3>
        <div className="space-y-3">
          {executions.map((exec) => (
            <div
              key={exec.id}
              className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
            >
              <div className="flex items-center gap-3 flex-1">
                {exec.status === 'running' ? (
                  <Activity className="w-5 h-5 text-blue-600 animate-spin" />
                ) : exec.status === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600" />
                )}
                <div className="flex-1">
                  <div className="font-medium text-sm">{exec.pipeline}</div>
                  <div className="text-xs text-muted-foreground">
                    {exec.recordsProcessed.toLocaleString()} records • {exec.duration}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant={
                    exec.status === 'success'
                      ? 'default'
                      : exec.status === 'running'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {exec.status}
                </Badge>
                <div className="text-xs text-muted-foreground w-20 text-right">
                  {exec.startTime}
                </div>
                {exec.status === 'failed' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => retryExecution(exec.id)}
                    disabled={retryingId === exec.id}
                    title="Retry execution"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
