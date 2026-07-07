'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Sidebar from './sidebar'
import TopBar from './top-bar'
import DataSourcesLayer from './layers/data-sources-layer'
import ConnectorLayer from './layers/connector-layer'
import PipelineDesignerLayer from './layers/pipeline-designer-layer'
import SchedulerMonitoringLayer from './layers/scheduler-monitoring-layer'
import DataMappingLayer from './layers/data-mapping-layer'
import DataCatalogLayer from './layers/data-catalog-layer'
import BusinessRulesLayer from './layers/business-rules-layer'
import DataQualityLayer from './layers/data-quality-layer'
import AnalyticsDashboardLayer from './layers/analytics-dashboard-layer'
import VersionControlLayer from './layers/version-control-layer'
import GovernanceLayer from './layers/governance-layer'
import AIAdvancedLayer from './layers/ai-advanced-layer'

export default function DashboardLayout() {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        <div className="flex-1 overflow-auto">
          <div className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-7 w-full mb-6 bg-muted">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="sources">Data Sources</TabsTrigger>
                <TabsTrigger value="connectors">Connectors</TabsTrigger>
                <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
                <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="governance">Governance</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <OverviewSection />
              </TabsContent>

              <TabsContent value="sources" className="space-y-6">
                <DataSourcesLayer />
              </TabsContent>

              <TabsContent value="connectors" className="space-y-6">
                <ConnectorLayer />
              </TabsContent>

              <TabsContent value="pipelines" className="space-y-6">
                <PipelineDesignerLayer />
              </TabsContent>

              <TabsContent value="monitoring" className="space-y-6">
                <SchedulerMonitoringLayer />
              </TabsContent>

              <TabsContent value="analytics" className="space-y-6">
                <AnalyticsDashboardLayer />
              </TabsContent>

              <TabsContent value="governance" className="space-y-6">
                <GovernanceLayer />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverviewSection() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg border border-border">
          <div className="text-sm font-medium text-muted-foreground">Active Pipelines</div>
          <div className="text-3xl font-bold mt-2">12</div>
          <div className="text-xs text-muted-foreground mt-2">3 running now</div>
        </div>
        <div className="bg-card p-4 rounded-lg border border-border">
          <div className="text-sm font-medium text-muted-foreground">Data Sources</div>
          <div className="text-3xl font-bold mt-2">8</div>
          <div className="text-xs text-muted-foreground mt-2">6 connected</div>
        </div>
        <div className="bg-card p-4 rounded-lg border border-border">
          <div className="text-sm font-medium text-muted-foreground">Data Quality Score</div>
          <div className="text-3xl font-bold mt-2">94%</div>
          <div className="text-xs text-muted-foreground mt-2">+2% this week</div>
        </div>
        <div className="bg-card p-4 rounded-lg border border-border">
          <div className="text-sm font-medium text-muted-foreground">Total Records</div>
          <div className="text-3xl font-bold mt-2">2.4M</div>
          <div className="text-xs text-muted-foreground mt-2">Processed today</div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold mb-4">Platform Overview</h3>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h4 className="font-medium mb-3">14-Layer Architecture</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 1: Data Source Manager
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 2: Connector Marketplace
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 3: Pipeline Designer
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 4: Scheduler
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 5: Monitoring Dashboard
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 6: Data Mapping Studio
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                Layer 7: Data Catalog
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-3">Advanced Features</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full" />
                Layer 8: Business Rules Engine
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full" />
                Layer 9: Data Quality Framework
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full" />
                Layer 10: Analytics & Dashboards
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full" />
                Layer 11: Version Control
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full" />
                Layer 12: Governance & Compliance
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full" />
                Layer 13-14: AI & Advanced
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
