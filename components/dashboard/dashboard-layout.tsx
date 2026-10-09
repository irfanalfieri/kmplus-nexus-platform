'use client'

import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Sidebar from './sidebar'
import TopBar from './top-bar'
import OverviewLayer from './layers/overview-layer'
import DataSourcesLayer from './layers/data-sources-layer'
import ConnectorLayer from './layers/connector-layer'
import PipelineDesignerLayer from './layers/pipeline-designer-layer'
import SchedulerMonitoringLayer from './layers/scheduler-monitoring-layer'
import AnalyticsDashboardLayer from './layers/analytics-dashboard-layer'
import GovernanceLayer from './layers/governance-layer'
import WorkspaceSettingsLayer from './layers/workspace-settings-layer'
import { WorkspaceProvider, type WorkspaceInfo } from '@/components/workspace/workspace-context'

/** Marks screens that still show sample data (PRD §10), so nobody mistakes it for theirs. */
function PreviewBanner({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" role="note">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
      <div>
        <div className="font-medium">Preview: sample data</div>
        <div className="text-muted-foreground">{what} is not connected to your workspace yet. Everything below is illustrative and nothing you change here is saved.</div>
      </div>
    </div>
  )
}

export default function DashboardLayout({ workspace }: { workspace: WorkspaceInfo }) {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <WorkspaceProvider value={workspace}>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />

          <div className="flex-1 overflow-auto">
            <div className="p-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-6 grid w-full grid-cols-4 bg-muted md:grid-cols-8">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="sources">Data Sources</TabsTrigger>
                  <TabsTrigger value="connectors">Connectors</TabsTrigger>
                  <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
                  <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
                  <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  <TabsTrigger value="governance">Governance</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                  <OverviewLayer onNavigate={setActiveTab} />
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
                  <PreviewBanner what="Analytics & dashboards (PRD Layer 10, Phase 3)" />
                  <AnalyticsDashboardLayer />
                </TabsContent>

                <TabsContent value="governance" className="space-y-6">
                  <PreviewBanner what="Governance policies (PRD Layer 13). Members and roles are real and live in Settings" />
                  <GovernanceLayer />
                </TabsContent>

                <TabsContent value="settings" className="space-y-6">
                  <WorkspaceSettingsLayer />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceProvider>
  )
}
