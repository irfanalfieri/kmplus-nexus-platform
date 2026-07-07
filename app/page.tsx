import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Workflow } from 'lucide-react'

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })
  
  if (session?.user) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-2xl mx-auto px-6 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Workflow className="w-8 h-8 text-white" />
          </div>
        </div>

        <h1 className="text-5xl font-bold text-white mb-4">KMPlus Nexus</h1>
        <p className="text-xl text-slate-400 mb-2">Enterprise Data Integration Platform</p>
        <p className="text-slate-500 mb-8">
          A comprehensive 14-layer platform for managing enterprise data pipelines, integrations, and intelligence.
        </p>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold text-white mb-4">14 Integrated Layers</h2>
          <div className="grid grid-cols-2 gap-3 text-left mb-6">
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Data Source Manager</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Connector Marketplace</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Pipeline Designer</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Scheduler & Monitoring</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Data Mapping & Catalog</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Business Rules & Quality</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Analytics & Dashboards</div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-1.5 flex-shrink-0" />
              <div className="text-sm text-slate-400">Governance & AI</div>
            </div>
          </div>
        </div>

        <div className="flex gap-4 justify-center">
          <Link href="/sign-up">
            <Button size="lg" className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600">
              Get Started
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800">
              Sign In
            </Button>
          </Link>
        </div>
      </div>
    </main>
  )
}
