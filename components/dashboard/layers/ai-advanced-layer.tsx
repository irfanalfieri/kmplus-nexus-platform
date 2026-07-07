'use client'

import { Zap, Brain, Cpu, Lightbulb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const AI_FEATURES = [
  {
    id: 'ai_1',
    name: 'Intelligent Pipeline Recommendations',
    description: 'AI analyzes your data flow and suggests optimizations',
    status: 'enabled',
    icon: Brain,
  },
  {
    id: 'ai_2',
    name: 'Anomaly Detection',
    description: 'ML models detect unusual data patterns and alert you',
    status: 'enabled',
    icon: Zap,
  },
  {
    id: 'ai_3',
    name: 'Predictive Performance Analytics',
    description: 'Forecast pipeline performance and resource needs',
    status: 'enabled',
    icon: Cpu,
  },
  {
    id: 'ai_4',
    name: 'Auto-Generation of Data Mappings',
    description: 'AI suggests field mappings based on data similarity',
    status: 'beta',
    icon: Lightbulb,
  },
]

const INTEGRATIONS = [
  { name: 'Salesforce', status: 'connected' },
  { name: 'SAP Analytics Cloud', status: 'connected' },
  { name: 'Looker', status: 'available' },
  { name: 'Power BI', status: 'available' },
  { name: 'Tableau', status: 'available' },
  { name: 'Azure Synapse', status: 'available' },
]

export default function AIAdvancedLayer() {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200 p-6">
        <h2 className="text-2xl font-bold">Layers 13-14: AI & Advanced Integration</h2>
        <p className="text-muted-foreground mt-2">
          Leverage artificial intelligence and advanced integrations for next-generation data management.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="font-semibold mb-4">AI-Powered Features</h3>
          <div className="space-y-3">
            {AI_FEATURES.map((feature) => {
              const IconComponent = feature.icon
              return (
                <div
                  key={feature.id}
                  className="p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <IconComponent className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{feature.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {feature.description}
                      </div>
                      <Badge
                        variant={feature.status === 'enabled' ? 'default' : 'secondary'}
                        className="mt-2 text-xs"
                      >
                        {feature.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="font-semibold mb-4">Platform Integrations</h3>
          <div className="space-y-2">
            {INTEGRATIONS.map((integration, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50"
              >
                <div className="font-medium text-sm">{integration.name}</div>
                <Badge
                  variant={integration.status === 'connected' ? 'default' : 'outline'}
                  className="text-xs"
                >
                  {integration.status === 'connected' ? 'Connected' : 'Available'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 p-4">
          <div className="text-sm font-medium text-blue-900">ML Models Active</div>
          <div className="text-3xl font-bold text-blue-600 mt-2">5</div>
          <div className="text-xs text-blue-700 mt-2">Anomaly detection + forecasting</div>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg border border-purple-200 p-4">
          <div className="text-sm font-medium text-purple-900">AI Recommendations</div>
          <div className="text-3xl font-bold text-purple-600 mt-2">23</div>
          <div className="text-xs text-purple-700 mt-2">Awaiting review this week</div>
        </div>
        <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg border border-pink-200 p-4">
          <div className="text-sm font-medium text-pink-900">Integrations Active</div>
          <div className="text-3xl font-bold text-pink-600 mt-2">2</div>
          <div className="text-xs text-pink-700 mt-2">Salesforce + SAP Analytics</div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="font-semibold mb-4">Advanced Capabilities</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
            <h4 className="font-medium text-sm mb-2">Machine Learning Pipeline Optimization</h4>
            <p className="text-xs text-muted-foreground">
              Automatically optimize pipeline configurations based on historical performance data and patterns.
            </p>
          </div>
          <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
            <h4 className="font-medium text-sm mb-2">Natural Language Query Builder</h4>
            <p className="text-xs text-muted-foreground">
              Create complex data transformations using conversational AI commands.
            </p>
          </div>
          <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
            <h4 className="font-medium text-sm mb-2">Predictive Data Quality Scoring</h4>
            <p className="text-xs text-muted-foreground">
              AI predicts data quality issues before they impact your pipelines.
            </p>
          </div>
          <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
            <h4 className="font-medium text-sm mb-2">Automated Error Recovery</h4>
            <p className="text-xs text-muted-foreground">
              ML models suggest and execute automatic recovery strategies for pipeline failures.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
