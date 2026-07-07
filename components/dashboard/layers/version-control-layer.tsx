'use client'

import { GitBranch, Clock, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const VERSIONS = [
  {
    id: 'v_1',
    pipeline: 'Daily SAP to Oracle Sync',
    version: 3,
    changes: 'Updated mapping rules and added error handling',
    createdBy: 'admin@example.com',
    createdAt: '2 hours ago',
    current: true,
  },
  {
    id: 'v_2',
    pipeline: 'Daily SAP to Oracle Sync',
    version: 2,
    changes: 'Added retry logic and improved performance',
    createdBy: 'admin@example.com',
    createdAt: '1 day ago',
    current: false,
  },
  {
    id: 'v_3',
    pipeline: 'Daily SAP to Oracle Sync',
    version: 1,
    changes: 'Initial pipeline creation',
    createdBy: 'admin@example.com',
    createdAt: '5 days ago',
    current: false,
  },
  {
    id: 'v_4',
    pipeline: 'REST API Data Ingestion',
    version: 2,
    changes: 'Updated API endpoint URLs',
    createdBy: 'admin@example.com',
    createdAt: '3 hours ago',
    current: true,
  },
]

export default function VersionControlLayer() {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold">Layer 11: Version Control</h2>
        <p className="text-muted-foreground mt-2">
          Track pipeline versions, changes, and enable rollback to previous configurations.
        </p>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="w-5 h-5" />
          Version History
        </h3>
        <div className="space-y-3">
          {VERSIONS.map((v) => (
            <div
              key={v.id}
              className="p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-sm">{v.pipeline}</div>
                    <Badge className="text-xs">v{v.version}</Badge>
                    {v.current && (
                      <Badge variant="default" className="text-xs bg-green-600">
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">{v.changes}</div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-3">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {v.createdBy}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {v.createdAt}
                    </div>
                  </div>
                </div>
                {!v.current && (
                  <Button size="sm" variant="outline">
                    Rollback
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Versions</div>
          <div className="text-2xl font-bold mt-2">{VERSIONS.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Pipelines Versioned</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(VERSIONS.map((v) => v.pipeline)).size}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Current Versions</div>
          <div className="text-2xl font-bold mt-2">
            {VERSIONS.filter((v) => v.current).length}
          </div>
        </div>
      </div>
    </div>
  )
}
