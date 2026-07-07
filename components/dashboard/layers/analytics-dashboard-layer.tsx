'use client'

import { BarChart3, LineChart, PieChart } from 'lucide-react'

export default function AnalytticsDashboardLayer() {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold">Layer 10: Analytics & Dashboards</h2>
        <p className="text-muted-foreground mt-2">
          Create custom analytics dashboards and visualizations for data insights.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Pipeline Performance</h3>
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Daily Avg:</span>
              <span className="font-bold">24.5K records</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Success Rate:</span>
              <span className="font-bold text-green-600">98.2%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Avg Duration:</span>
              <span className="font-bold">2m 34s</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Data Volume Trend</h3>
            <LineChart className="w-5 h-5 text-blue-600" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">This Week:</span>
              <span className="font-bold">1.2M records</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Growth:</span>
              <span className="font-bold text-green-600">+12% vs last week</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Peak Day:</span>
              <span className="font-bold">428K records</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Pipeline Distribution</h3>
            <PieChart className="w-5 h-5 text-orange-600" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Active:</span>
              <span className="font-bold">8 pipelines</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Draft:</span>
              <span className="font-bold">2 pipelines</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Archived:</span>
              <span className="font-bold">3 pipelines</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold mb-4">Key Performance Indicators</h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-3xl font-bold">2.4M</div>
            <div className="text-sm text-muted-foreground mt-1">Total Records Processed</div>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-3xl font-bold">412h</div>
            <div className="text-sm text-muted-foreground mt-1">Total Pipeline Hours</div>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-3xl font-bold">94%</div>
            <div className="text-sm text-muted-foreground mt-1">Data Quality Score</div>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-3xl font-bold">8</div>
            <div className="text-sm text-muted-foreground mt-1">Active Connectors</div>
          </div>
        </div>
      </div>
    </div>
  )
}
