'use client'

import { Plus, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const RULES = [
  {
    id: 'rule_1',
    name: 'Duplicate Customer Check',
    ruleType: 'Validation',
    condition: 'EmailAddress matches existing record',
    action: 'Flag for manual review',
    active: true,
  },
  {
    id: 'rule_2',
    name: 'Amount Threshold Alert',
    ruleType: 'Business Logic',
    condition: 'Order value > $50,000',
    action: 'Require approval',
    active: true,
  },
  {
    id: 'rule_3',
    name: 'Auto Currency Conversion',
    ruleType: 'Transformation',
    condition: 'Currency != USD',
    action: 'Convert to base currency',
    active: true,
  },
  {
    id: 'rule_4',
    name: 'Date Format Standardization',
    ruleType: 'Data Quality',
    condition: 'Date format is non-standard',
    action: 'Convert to YYYY-MM-DD',
    active: false,
  },
]

export default function BusinessRulesLayer() {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Layer 8: Business Rules Engine</h2>
            <p className="text-muted-foreground mt-2">
              Define and enforce business logic, validations, and data transformations.
            </p>
          </div>
          <Button className="px-6">
            <Plus className="w-4 h-4 mr-2" />
            New Rule
          </Button>
        </div>

        <div className="space-y-3">
          {RULES.map((rule) => (
            <div
              key={rule.id}
              className="p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{rule.name}</div>
                    <Badge variant="outline" className="text-xs">
                      {rule.ruleType}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-2 space-y-1">
                    <div>
                      <strong>Condition:</strong> {rule.condition}
                    </div>
                    <div>
                      <strong>Action:</strong> {rule.action}
                    </div>
                  </div>
                </div>
                <div>
                  {rule.active ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Rules</div>
          <div className="text-2xl font-bold mt-2">{RULES.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Active</div>
          <div className="text-2xl font-bold mt-2">
            {RULES.filter((r) => r.active).length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Rule Types</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(RULES.map((r) => r.ruleType)).size}
          </div>
        </div>
      </div>
    </div>
  )
}
