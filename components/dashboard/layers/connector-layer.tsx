'use client'

import { Plus, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CONNECTORS = [
  {
    id: 'conn_1',
    name: 'SAP Connector',
    category: 'Enterprise',
    version: '2.1.0',
    installed: true,
    description: 'Connect to SAP ERP systems',
  },
  {
    id: 'conn_2',
    name: 'Oracle Connector',
    category: 'Database',
    version: '1.8.5',
    installed: true,
    description: 'Oracle database connectivity',
  },
  {
    id: 'conn_3',
    name: 'MySQL Connector',
    category: 'Database',
    version: '1.5.2',
    installed: true,
    description: 'MySQL and MariaDB support',
  },
  {
    id: 'conn_4',
    name: 'REST API Connector',
    category: 'API',
    version: '3.0.1',
    installed: true,
    description: 'Generic REST API integration',
  },
  {
    id: 'conn_5',
    name: 'Salesforce Connector',
    category: 'SaaS',
    version: '2.3.0',
    installed: false,
    description: 'Salesforce CRM integration',
  },
  {
    id: 'conn_6',
    name: 'Snowflake Connector',
    category: 'Data Warehouse',
    version: '1.9.2',
    installed: false,
    description: 'Snowflake data warehouse',
  },
]

export default function ConnectorLayer() {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold mb-2">Layer 2: Connector Marketplace</h2>
        <p className="text-muted-foreground mb-6">
          Browse and manage available connectors for data integration.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {CONNECTORS.map((connector) => (
            <div
              key={connector.id}
              className="p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold">{connector.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {connector.category} • v{connector.version}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {connector.description}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {connector.installed ? (
                  <div className="flex-1 px-3 py-1 bg-green-100 text-green-800 text-xs rounded font-medium">
                    Installed
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="flex-1">
                    <Download className="w-3 h-3 mr-1" />
                    Install
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Installed Connectors</div>
          <div className="text-2xl font-bold mt-2">
            {CONNECTORS.filter((c) => c.installed).length}
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Available</div>
          <div className="text-2xl font-bold mt-2">{CONNECTORS.length}</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-sm font-medium text-muted-foreground">Categories</div>
          <div className="text-2xl font-bold mt-2">
            {new Set(CONNECTORS.map((c) => c.category)).size}
          </div>
        </div>
      </div>
    </div>
  )
}
