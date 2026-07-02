'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import {
  LayoutDashboard,
  Upload,
  Database,
  Building2,
  FolderTree,
  Receipt,
  FileText,
  ShoppingCart,
  PieChart,
  Copy,
  ShieldAlert,
  BarChart3,
  Calculator,
  Layers,
  Sparkles,
  Target,
  PiggyBank,
  FileBarChart,
  Activity,
  Briefcase,
  Settings,
  LogOut,
  Menu,
  type LucideIcon,
} from 'lucide-react'

type NavItem = { label: string; href: string; icon: LucideIcon }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Data',
    items: [
      { label: 'Imports', href: '/dashboard/imports', icon: Upload },
      { label: 'Sample Data', href: '/dashboard/sample-data', icon: Database },
      { label: 'Suppliers', href: '/dashboard/suppliers', icon: Building2 },
      { label: 'Categories', href: '/dashboard/categories', icon: FolderTree },
      { label: 'Transactions', href: '/dashboard/transactions', icon: Receipt },
      { label: 'Contracts', href: '/dashboard/contracts', icon: FileText },
      { label: 'Purchasing', href: '/dashboard/purchasing', icon: ShoppingCart },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Tail Spend', href: '/dashboard/tail', icon: PieChart },
      { label: 'Duplicates', href: '/dashboard/duplicates', icon: Copy },
      { label: 'Maverick Spend', href: '/dashboard/maverick', icon: ShieldAlert },
      { label: 'Price Dispersion', href: '/dashboard/dispersion', icon: BarChart3 },
      { label: 'Transaction Cost', href: '/dashboard/transaction-cost', icon: Calculator },
    ],
  },
  {
    title: 'Consolidation',
    items: [
      { label: 'Scenarios', href: '/dashboard/scenarios', icon: Layers },
      { label: 'Recommendations', href: '/dashboard/recommendations', icon: Sparkles },
      { label: 'Initiatives', href: '/dashboard/initiatives', icon: Target },
      { label: 'Savings', href: '/dashboard/savings', icon: PiggyBank },
    ],
  },
  {
    title: 'Output',
    items: [
      { label: 'Reports', href: '/dashboard/reports', icon: FileBarChart },
      { label: 'Activity', href: '/dashboard/activity', icon: Activity },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Workspaces', href: '/dashboard/workspaces', icon: Briefcase },
      { label: 'Settings', href: '/dashboard/settings', icon: Settings },
    ],
  },
]

const ALL_ITEMS: NavItem[] = NAV.flatMap((section) => section.items)

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
      <div className="flex min-h-screen items-center justify-center bg-stone-950">
        <div className="flex items-center gap-3 text-stone-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-stone-700 border-t-cyan-400" />
          <span className="text-sm">Loading workspace...</span>
        </div>
      </div>
    )
  }

  // Icon-only rail: every nav destination from the original sidebar is preserved,
  // rendered as an icon button with a hover tooltip showing its label.
  const rail = (
    <nav className="flex h-full flex-col items-center">
      <div className="border-b border-stone-800 px-2 py-4">
        <Link
          href="/dashboard"
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10"
          aria-label="TailSpendConsolidationPlanner home"
        >
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-400" />
          <RailTooltip label="TailSpendConsolidationPlanner" />
        </Link>
      </div>

      <div className="border-b border-stone-800 px-2 py-3">
        <Link
          href="/dashboard/workspaces"
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-cyan-300 hover:bg-stone-800/60"
          aria-label={`Workspace: ${workspaceName}`}
        >
          <Briefcase size={18} />
          <RailTooltip label={`Workspace: ${workspaceName}`} />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        <div className="flex flex-col items-center gap-1">
          {ALL_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={`group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? 'bg-cyan-500/10 text-cyan-300'
                    : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-100'
                }`}
              >
                <Icon size={18} />
                <RailTooltip label={item.label} />
              </Link>
            )
          })}
        </div>
      </div>

      <div className="border-t border-stone-800 px-2 py-3">
        <button
          onClick={signOut}
          aria-label="Sign out"
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
        >
          <LogOut size={18} />
          <RailTooltip label="Sign out" />
        </button>
      </div>
    </nav>
  )

  // Wider labeled variant used only inside the mobile drawer, so small-screen users
  // still get full-text navigation without losing any destinations.
  const drawerNav = (
    <nav className="flex h-full flex-col">
      <div className="border-b border-stone-800 px-5 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-400" />
          <span className="text-sm font-bold tracking-tight text-white">TailSpendConsolidationPlanner</span>
        </Link>
      </div>
      <div className="border-b border-stone-800 px-5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Workspace</div>
        <Link href="/dashboard/workspaces" className="mt-1 block truncate text-sm font-medium text-cyan-300 hover:text-cyan-200">
          {workspaceName}
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-600">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-cyan-500/10 font-medium text-cyan-300'
                        : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-100'
                    }`}
                  >
                    <Icon size={16} />
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
    <div className="flex min-h-screen bg-stone-950">
      <aside className="hidden w-14 shrink-0 border-r border-stone-800 bg-stone-900/60 lg:block">
        {rail}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-stone-950/80" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-stone-800 bg-stone-900">
            {drawerNav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-800 bg-stone-900/40 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-stone-700 px-2.5 py-1.5 text-stone-300 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
            <span className="text-sm text-stone-400">
              <span className="text-stone-500">Workspace:</span>{' '}
              <span className="font-medium text-stone-200">{workspaceName}</span>
            </span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:bg-stone-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}

function RailTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs font-medium text-stone-100 opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100">
      {label}
    </span>
  )
}
