'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Data',
    items: [
      { label: 'Imports', href: '/dashboard/imports' },
      { label: 'Sample Data', href: '/dashboard/sample-data' },
      { label: 'Suppliers', href: '/dashboard/suppliers' },
      { label: 'Categories', href: '/dashboard/categories' },
      { label: 'Transactions', href: '/dashboard/transactions' },
      { label: 'Contracts', href: '/dashboard/contracts' },
      { label: 'Purchasing', href: '/dashboard/purchasing' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Tail Spend', href: '/dashboard/tail' },
      { label: 'Duplicates', href: '/dashboard/duplicates' },
      { label: 'Maverick Spend', href: '/dashboard/maverick' },
      { label: 'Price Dispersion', href: '/dashboard/dispersion' },
      { label: 'Transaction Cost', href: '/dashboard/transaction-cost' },
    ],
  },
  {
    title: 'Consolidation',
    items: [
      { label: 'Scenarios', href: '/dashboard/scenarios' },
      { label: 'Recommendations', href: '/dashboard/recommendations' },
      { label: 'Initiatives', href: '/dashboard/initiatives' },
      { label: 'Savings', href: '/dashboard/savings' },
    ],
  },
  {
    title: 'Output',
    items: [
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Activity', href: '/dashboard/activity' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Workspaces', href: '/dashboard/workspaces' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [workspaceName, setWorkspaceName] = useState<string>('No workspace')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      if (mounted) setReady(true)
    })()
    return () => { mounted = false }
  }, [router])

  useEffect(() => {
    try {
      const name = localStorage.getItem('tscp_workspace_name')
      if (name) setWorkspaceName(name)
    } catch { /* ignore */ }
  }, [pathname])

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
          <span className="text-sm">Loading workspace...</span>
        </div>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-5 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-400" />
          <span className="text-sm font-bold tracking-tight text-white">TailSpendConsolidationPlanner</span>
        </Link>
      </div>
      <div className="border-b border-slate-800 px-5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Workspace</div>
        <Link href="/dashboard/workspaces" className="mt-1 block truncate text-sm font-medium text-cyan-300 hover:text-cyan-200">
          {workspaceName}
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-cyan-500/10 font-medium text-cyan-300'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 lg:block">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/80" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-800 bg-slate-900">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm text-slate-400">
              <span className="text-slate-500">Workspace:</span>{' '}
              <span className="font-medium text-slate-200">{workspaceName}</span>
            </span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
