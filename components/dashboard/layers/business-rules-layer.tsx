'use client'

import { useState } from 'react'
import { Plus, AlertCircle, CheckCircle2, Trash2, X, Save, Edit, Copy, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MOCK_RULES = [
  {
    id: 'rule_1',
    name: 'Duplicate Customer Check',
    ruleType: 'Validation',
    condition: 'EmailAddress matches existing record',
    action: 'Flag for manual review',
    active: true,
    priority: 'High',
    appliedTo: 'Customer Orders',
    executionCount: 15234,
    lastTriggered: '2 minutes ago',
  },
  {
    id: 'rule_2',
    name: 'Amount Threshold Alert',
    ruleType: 'Business Logic',
    condition: 'Order value > $50,000',
    action: 'Require approval',
    active: true,
    priority: 'Critical',
    appliedTo: 'Order Transactions',
    executionCount: 342,
    lastTriggered: '1 hour ago',
  },
  {
    id: 'rule_3',
    name: 'Auto Currency Conversion',
    ruleType: 'Transformation',
    condition: 'Currency != USD',
    action: 'Convert to base currency',
    active: true,
    priority: 'Medium',
    appliedTo: 'Financial Data',
    executionCount: 8901,
    lastTriggered: '5 minutes ago',
  },
  {
    id: 'rule_4',
    name: 'Date Format Standardization',
    ruleType: 'Data Quality',
    condition: 'Date format is non-standard',
    action: 'Convert to YYYY-MM-DD',
    active: false,
    priority: 'Low',
    appliedTo: 'All Date Fields',
    executionCount: 1203,
    lastTriggered: '3 days ago',
  },
]

export default function BusinessRulesLayer() {
  const [rules, setRules] = useState(MOCK_RULES)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    ruleType: '',
    condition: '',
    action: '',
    priority: 'Medium',
    appliedTo: '',
  })

  const resetForm = () => {
    setFormData({
      name: '',
      ruleType: '',
      condition: '',
      action: '',
      priority: 'Medium',
      appliedTo: '',
    })
  }

  const addRule = () => {
    if (formData.name && formData.ruleType && formData.condition && formData.action) {
      setRules([
        ...rules,
        {
          id: `rule_${Date.now()}`,
          ...formData,
          active: true,
          executionCount: 0,
          lastTriggered: 'Never',
        },
      ])
      resetForm()
      setShowNewForm(false)
    }
  }

  const updateRule = () => {
    if (editingId && formData.name && formData.ruleType) {
      setRules(
        rules.map((r) =>
          r.id === editingId ? { ...r, ...formData } : r
        )
      )
      resetForm()
      setEditingId(null)
      setShowEditForm(false)
    }
  }

  const toggleRule = (id: string) => {
    setRules(
      rules.map((r) =>
        r.id === id ? { ...r, active: !r.active } : r
      )
    )
  }

  const deleteRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id))
    if (selectedRuleId === id) setSelectedRuleId(null)
  }

  const duplicateRule = (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (rule) {
      const newRule = {
        ...rule,
        id: `rule_${Date.now()}`,
        name: `${rule.name} (Copy)`,
      }
      setRules([...rules, newRule])
    }
  }

  const startEdit = (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (rule) {
      setFormData({
        name: rule.name,
        ruleType: rule.ruleType,
        condition: rule.condition,
        action: rule.action,
        priority: rule.priority,
        appliedTo: rule.appliedTo,
      })
      setEditingId(id)
      setShowEditForm(true)
    }
  }

  const selectedRule = selectedRuleId ? rules.find((r) => r.id === selectedRuleId) : null
  const activeRules = rules.filter((r) => r.active).length

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
          <Button onClick={() => { resetForm(); setShowNewForm(true) }} className="px-6">
            <Plus className="w-4 h-4 mr-2" />
            New Rule
          </Button>
        </div>

        {showNewForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border p-6 max-w-2xl w-full space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Create Business Rule</h3>
                <Button size="sm" variant="ghost" onClick={() => { setShowNewForm(false); resetForm() }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Input
                placeholder="Rule name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />

              <div className="grid grid-cols-2 gap-4">
                <Select value={formData.ruleType} onValueChange={(val) => setFormData({ ...formData, ruleType: val })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Rule type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Validation">Validation</SelectItem>
                    <SelectItem value="Business Logic">Business Logic</SelectItem>
                    <SelectItem value="Transformation">Transformation</SelectItem>
                    <SelectItem value="Data Quality">Data Quality</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={formData.priority} onValueChange={(val) => setFormData({ ...formData, priority: val })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Input
                placeholder="Applied to (e.g., Customer Data)"
                value={formData.appliedTo}
                onChange={(e) => setFormData({ ...formData, appliedTo: e.target.value })}
              />

              <Input
                placeholder="Condition (e.g., Value > 1000)"
                value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
              />

              <Input
                placeholder="Action (e.g., Flag for review)"
                value={formData.action}
                onChange={(e) => setFormData({ ...formData, action: e.target.value })}
              />

              <div className="flex gap-2 pt-2">
                <Button onClick={addRule} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Create
                </Button>
                <Button onClick={() => { setShowNewForm(false); resetForm() }} variant="outline" className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {showEditForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border p-6 max-w-2xl w-full space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Edit Rule</h3>
                <Button size="sm" variant="ghost" onClick={() => { setShowEditForm(false); setEditingId(null) }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Input
                placeholder="Rule name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />

              <div className="grid grid-cols-2 gap-4">
                <Select value={formData.ruleType} onValueChange={(val) => setFormData({ ...formData, ruleType: val })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Rule type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Validation">Validation</SelectItem>
                    <SelectItem value="Business Logic">Business Logic</SelectItem>
                    <SelectItem value="Transformation">Transformation</SelectItem>
                    <SelectItem value="Data Quality">Data Quality</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={formData.priority} onValueChange={(val) => setFormData({ ...formData, priority: val })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Input
                placeholder="Applied to"
                value={formData.appliedTo}
                onChange={(e) => setFormData({ ...formData, appliedTo: e.target.value })}
              />

              <Input
                placeholder="Condition"
                value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
              />

              <Input
                placeholder="Action"
                value={formData.action}
                onChange={(e) => setFormData({ ...formData, action: e.target.value })}
              />

              <div className="flex gap-2 pt-2">
                <Button onClick={updateRule} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Update
                </Button>
                <Button onClick={() => { setShowEditForm(false); setEditingId(null) }} variant="outline" className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                onClick={() => setSelectedRuleId(rule.id)}
                className={`p-4 bg-muted/30 rounded-lg border-2 transition-all cursor-pointer ${
                  selectedRuleId === rule.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border/50 hover:border-border'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="font-semibold flex-1">{rule.name}</div>
                    <Badge variant="outline" className="text-xs">
                      {rule.ruleType}
                    </Badge>
                    <Badge
                      variant={
                        rule.priority === 'Critical'
                          ? 'destructive'
                          : rule.priority === 'High'
                            ? 'default'
                            : 'secondary'
                      }
                      className="text-xs"
                    >
                      {rule.priority}
                    </Badge>
                  </div>
                  <div>
                    {rule.active ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground space-y-1 mb-3">
                  <div>
                    <strong>Condition:</strong> {rule.condition}
                  </div>
                  <div>
                    <strong>Action:</strong> {rule.action}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); startEdit(rule.id) }}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); duplicateRule(rule.id) }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); toggleRule(rule.id) }}
                  >
                    {rule.active ? '✕' : '✓'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); deleteRule(rule.id) }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {selectedRule && (
            <div className="bg-muted/30 rounded-lg border border-border p-4 space-y-4">
              <h3 className="font-semibold">Rule Details</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Rule Type</div>
                  <div className="font-medium">{selectedRule.ruleType}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Priority</div>
                  <Badge className="mt-1">{selectedRule.priority}</Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Applied To</div>
                  <div className="font-medium">{selectedRule.appliedTo}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <Badge className="mt-1" variant={selectedRule.active ? 'default' : 'secondary'}>
                    {selectedRule.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Executions</div>
                  <div className="font-medium">{selectedRule.executionCount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last Triggered</div>
                  <div className="font-medium">{selectedRule.lastTriggered}</div>
                </div>
              </div>
              <Button className="w-full" size="sm">
                <Play className="w-4 h-4 mr-2" />
                Test Rule
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Rules</div>
          <div className="text-2xl font-bold mt-2">{rules.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Active</div>
          <div className="text-2xl font-bold mt-2 text-green-600">{activeRules}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Rule Types</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(rules.map((r) => r.ruleType)).size}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Executions</div>
          <div className="text-2xl font-bold mt-2">
            {rules.reduce((sum, r) => sum + r.executionCount, 0).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}
