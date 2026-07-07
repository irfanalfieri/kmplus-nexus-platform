'use client'

import { Shield, Lock, Users, FileText, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const POLICIES = [
  {
    id: 'policy_1',
    name: 'Data Access Control',
    type: 'Access Control',
    status: 'active',
    appliedTo: 'All Data Sources',
    description: 'Restrict access based on user roles and departments',
  },
  {
    id: 'policy_2',
    name: 'Data Retention Policy',
    type: 'Data Lifecycle',
    status: 'active',
    appliedTo: 'Transaction Data',
    description: 'Archive data older than 2 years',
  },
  {
    id: 'policy_3',
    name: 'PII Protection',
    type: 'Data Privacy',
    status: 'active',
    appliedTo: 'Customer Data',
    description: 'Mask sensitive personal information',
  },
  {
    id: 'policy_4',
    name: 'Change Approval Workflow',
    type: 'Change Management',
    status: 'active',
    appliedTo: 'Production Pipelines',
    description: 'Require approval for production changes',
  },
]

const AUDIT_SUMMARY = [
  { action: 'Pipeline Updated', count: 24, timespan: 'last 7 days' },
  { action: 'Access Granted', count: 12, timespan: 'last 7 days' },
  { action: 'Configuration Changed', count: 8, timespan: 'last 7 days' },
  { action: 'Data Exported', count: 5, timespan: 'last 7 days' },
]

export default function GovernanceLayer() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-2xl font-bold">Layer 12: Governance & Compliance</h2>
          <p className="text-muted-foreground mt-2">
            Enforce policies, track compliance, and maintain audit trails.
          </p>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg border border-green-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-green-900">Compliance Score</div>
              <div className="text-3xl font-bold text-green-600 mt-1">98%</div>
            </div>
            <Shield className="w-12 h-12 text-green-600 opacity-20" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Governance Policies
            </h3>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
          <div className="space-y-3">
            {POLICIES.map((policy) => (
              <div key={policy.id} className="p-3 bg-muted/30 rounded-lg border border-border/50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{policy.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {policy.description}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {policy.type}
                      </Badge>
                      <Badge className="text-xs bg-green-100 text-green-800">
                        {policy.appliedTo}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Audit Activity
          </h3>
          <div className="space-y-4">
            {AUDIT_SUMMARY.map((audit, idx) => (
              <div key={idx} className="p-3 bg-muted/30 rounded-lg border border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{audit.action}</div>
                    <div className="text-xs text-muted-foreground">{audit.timespan}</div>
                  </div>
                  <div className="text-2xl font-bold text-primary">{audit.count}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Active Policies</div>
          <div className="text-2xl font-bold mt-2">
            {POLICIES.filter((p) => p.status === 'active').length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Audit Logs</div>
          <div className="text-2xl font-bold mt-2">
            {AUDIT_SUMMARY.reduce((sum, a) => sum + a.count, 0)}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Data Classifications</div>
          <div className="text-2xl font-bold mt-2">3</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Users Managed</div>
          <div className="text-2xl font-bold mt-2">8</div>
        </div>
      </div>
    </div>
  )
}
