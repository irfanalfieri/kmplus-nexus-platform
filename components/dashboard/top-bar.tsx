'use client'

import { Search, User } from 'lucide-react'
import { Input } from '@/components/ui/input'
import NotificationBell from './notification-bell'

export default function TopBar() {
  return (
    <div className="h-16 bg-card border-b border-border px-6 flex items-center justify-between">
      <div className="flex-1 flex items-center gap-4">
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search pipelines, data sources..."
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <NotificationBell />
        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
          <User className="w-4 h-4 text-primary-foreground" />
        </div>
      </div>
    </div>
  )
}
