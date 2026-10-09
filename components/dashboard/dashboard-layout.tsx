'use client'

import { useState } from 'react'
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
                  <AnalyticsDashboardLayer onNavigate={setActiveTab} />
                </TabsContent>

                <TabsContent value="governance" className="space-y-6">
                  <GovernanceLayer onNavigate={setActiveTab} />
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
