'use client'

import Link from 'next/link'
import { BarChart3, Database, Zap, Settings, LogOut, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <div className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-2">
          <Workflow className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">KMPlus Nexus</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Enterprise Integration</p>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-auto">
        <NavItem
          icon={<BarChart3 className="w-5 h-5" />}
          label="Dashboard"
          onClick={() => setActiveTab('overview')}
          active={activeTab === 'overview'}
        />
        <NavItem
          icon={<Database className="w-5 h-5" />}
          label="Data Sources"
          onClick={() => setActiveTab('sources')}
          active={activeTab === 'sources'}
        />
        <NavItem
          icon={<Zap className="w-5 h-5" />}
          label="Connectors"
          onClick={() => setActiveTab('connectors')}
          active={activeTab === 'connectors'}
        />
        <NavItem
          icon={<Workflow className="w-5 h-5" />}
          label="Pipelines"
          onClick={() => setActiveTab('pipelines')}
          active={activeTab === 'pipelines'}
        />
        <NavItem
          icon={<BarChart3 className="w-5 h-5" />}
          label="Monitoring"
          onClick={() => setActiveTab('monitoring')}
          active={activeTab === 'monitoring'}
        />
        <NavItem
          icon={<BarChart3 className="w-5 h-5" />}
          label="Analytics"
          onClick={() => setActiveTab('analytics')}
          active={activeTab === 'analytics'}
        />
        <NavItem
          icon={<Settings className="w-5 h-5" />}
          label="Governance"
          onClick={() => setActiveTab('governance')}
          active={activeTab === 'governance'}
        />
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <Button variant="outline" className="w-full justify-start" size="sm">
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive"
          size="sm"
          onClick={async () => {
            await authClient.signOut()
            window.location.href = '/'
          }}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  )
}

interface NavItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active: boolean
}

function NavItem({ icon, label, onClick, active }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-foreground'
      }`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}
