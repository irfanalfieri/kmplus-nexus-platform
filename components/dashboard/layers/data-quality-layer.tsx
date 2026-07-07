'use client'

import { TrendingUp, AlertTriangle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'

const QUALITY_METRICS = [
  {
    id: 'metric_1',
    name: 'Completeness',
    value: 98.5,
    threshold: 95,
    status: 'healthy',
    lastCheck: '5 minutes ago',
  },
  {
    id: 'metric_2',
    name: 'Accuracy',
    value: 96.2,
    threshold: 95,
    status: 'healthy',
    lastCheck: '10 minutes ago',
  },
  {
    id: 'metric_3',
    name: 'Consistency',
    value: 92.8,
    threshold: 95,
    status: 'warning',
    lastCheck: '15 minutes ago',
  },
  {
    id: 'metric_4',
    name: 'Timeliness',
    value: 94.1,
    threshold: 90,
    status: 'healthy',
    lastCheck: '2 minutes ago',
  },
]

export default function DataQualityLayer() {
  const overallScore =
    Math.round(
      (QUALITY_METRICS.reduce((sum, m) => sum + m.value, 0) / QUALITY_METRICS.length) * 10
    ) / 10

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-2xl font-bold">Layer 9: Data Quality</h2>
          <p className="text-muted-foreground mt-2">
            Monitor data quality metrics and enforce quality standards.
          </p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 p-6">
          <div className="text-sm font-medium text-blue-900">Overall Quality Score</div>
          <div className="text-4xl font-bold text-blue-600 mt-2">{overallScore}%</div>
          <TrendingUp className="w-5 h-5 text-blue-600 mt-2" />
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold mb-4">Quality Metrics</h3>
        <div className="space-y-6">
          {QUALITY_METRICS.map((metric) => (
            <div key={metric.id}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{metric.name}</div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-bold">{metric.value}%</div>
                  <Badge
                    variant={metric.status === 'healthy' ? 'default' : 'destructive'}
                    className="text-xs"
                  >
                    {metric.status === 'healthy' ? 'Healthy' : 'Warning'}
                  </Badge>
                </div>
              </div>
              <Progress value={metric.value} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">
                Threshold: {metric.threshold}% • Last check: {metric.lastCheck}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Metrics Tracked</div>
          <div className="text-2xl font-bold mt-2">{QUALITY_METRICS.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Healthy</div>
          <div className="text-2xl font-bold mt-2 text-green-600">
            {QUALITY_METRICS.filter((m) => m.status === 'healthy').length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Warnings</div>
          <div className="text-2xl font-bold mt-2 text-orange-600">
            {QUALITY_METRICS.filter((m) => m.status === 'warning').length}
          </div>
        </div>
      </div>
    </div>
  )
}
