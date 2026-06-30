'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type Activity = {
  id: string
  workspace_id: string
  user_id?: string | null
  action?: string | null
  entity_type?: string | null
  entity_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

function getWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('tscp_workspace_id') || localStorage.getItem('tscp_workspace') || null
  } catch {
    return null
  }
}

function fmtDateTime(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function relTime(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${Math.max(sec, 0)}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString()
}

function dayKey(v?: string | null): string {
  if (!v) return 'Unknown'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  const today = new Date()
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function humanize(s?: string | null): string {
  if (!s) return ''
  return s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function actionTone(action?: string | null): 'green' | 'rose' | 'amber' | 'cyan' | 'violet' | 'slate' {
  const a = (action || '').toLowerCase()
  if (/create|add|generate|seed|detect|compute|book/.test(a)) return 'green'
  if (/delete|remove|reject|rollback|wipe/.test(a)) return 'rose'
  if (/update|edit|reclassify|merge|decide|model|set/.test(a)) return 'amber'
  if (/view|read|export|report/.test(a)) return 'cyan'
  return 'violet'
}

function actionIcon(action?: string | null): string {
  const a = (action || '').toLowerCase()
  if (/create|add|generate/.test(a)) return '＋'
  if (/delete|remove|wipe|rollback/.test(a)) return '✕'
  if (/update|edit|set/.test(a)) return '✎'
  if (/merge/.test(a)) return '⇄'
  if (/detect|compute/.test(a)) return '⚙'
  if (/seed/.test(a)) return '⚡'
  if (/decide|approve/.test(a)) return '✓'
  return '•'
}

function entityToHref(entityType?: string | null, entityId?: string | null): string | null {
  if (!entityType) return null
  const map: Record<string, string> = {
    supplier: '/dashboard/suppliers',
    suppliers: '/dashboard/suppliers',
    category: '/dashboard/categories',
    transaction: '/dashboard/transactions',
    contract: '/dashboard/contracts',
    scenario: '/dashboard/scenarios',
    recommendation: '/dashboard/recommendations',
    initiative: '/dashboard/initiatives',
    report: '/dashboard/reports',
    workspace: '/dashboard/workspaces',
  }
  const base = map[entityType.toLowerCase()]
  if (!base) return null
  if (entityId && (entityType.toLowerCase() === 'supplier' || entityType.toLowerCase() === 'scenario' || entityType.toLowerCase() === 'initiative')) {
    return `${base}/${entityId}`
  }
  return base
}

export default function ActivityPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rows, setRows] = useState<Activity[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  function normalize(res: any): { rows: Activity[]; total: number } {
    if (Array.isArray(res)) return { rows: res, total: res.length }
    const r = res?.rows ?? res?.data ?? []
    return { rows: Array.isArray(r) ? r : [], total: num(res?.total) || (Array.isArray(r) ? r.length : 0) }
  }

  async function loadPage(ws: string, p: number, append: boolean) {
    const res = await api.listActivity(ws, { page: p })
    const { rows: pageRows, total: t } = normalize(res)
    setTotal(t)
    setRows((prev) => (append ? [...prev, ...pageRows] : pageRows))
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPage(1)
    loadPage(workspaceId, 1, false)
      .catch((e) => !cancelled && setError(e.message || 'Failed to load activity'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function refresh() {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    setPage(1)
    try {
      await loadPage(workspaceId, 1, false)
    } catch (e: any) {
      setError(e.message || 'Failed to refresh')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!workspaceId) return
    const next = page + 1
    setLoadingMore(true)
    setError(null)
    try {
      await loadPage(workspaceId, next, true)
      setPage(next)
    } catch (e: any) {
      setError(e.message || 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }

  const actionOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.action).filter(Boolean) as string[])).sort(),
    [rows],
  )
  const entityOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entity_type).filter(Boolean) as string[])).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (actionFilter !== 'all' && r.action !== actionFilter) return false
      if (entityFilter !== 'all' && r.entity_type !== entityFilter) return false
      if (!q) return true
      const meta = r.metadata ? JSON.stringify(r.metadata) : ''
      return [r.action, r.entity_type, r.entity_id, r.user_id, meta]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [rows, search, actionFilter, entityFilter])

  const grouped = useMemo(() => {
    const groups: { day: string; items: Activity[] }[] = []
    const idx = new Map<string, number>()
    for (const r of filtered) {
      const k = dayKey(r.created_at)
      if (!idx.has(k)) {
        idx.set(k, groups.length)
        groups.push({ day: k, items: [] })
      }
      groups[idx.get(k)!].items.push(r)
    }
    return groups
  }, [filtered])

  const stats = useMemo(() => {
    const todays = rows.filter((r) => dayKey(r.created_at) === 'Today').length
    const actors = new Set(rows.map((r) => r.user_id).filter(Boolean)).size
    const entities = new Set(rows.map((r) => r.entity_type).filter(Boolean)).size
    return { todays, actors, entities }
  }, [rows])

  const hasMore = rows.length < total

  if (!workspaceId && !loading) {
    return (
      <div className="space-y-6">
        <Header onRefresh={() => {}} disabled />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace to see its audit trail."
          action={
            <a href="/dashboard/workspaces">
              <Button>Go to workspaces</Button>
            </a>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onRefresh={refresh} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading activity..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total events" value={total || rows.length} tone="cyan" />
            <Stat label="Today" value={stats.todays} tone="green" hint="events logged today" />
            <Stat label="Actors" value={stats.actors} tone="cyan" hint="distinct users" />
            <Stat label="Entity types" value={stats.entities} tone="amber" />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Audit trail</h2>
                <p className="text-xs text-slate-500">
                  {filtered.length} of {rows.length} loaded{total > rows.length ? ` · ${total} total` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search events..."
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="all">All actions</option>
                  {actionOptions.map((a) => (
                    <option key={a} value={a}>
                      {humanize(a)}
                    </option>
                  ))}
                </select>
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="all">All entities</option>
                  {entityOptions.map((e) => (
                    <option key={e} value={e}>
                      {humanize(e)}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardBody>
              {filtered.length === 0 ? (
                <EmptyState
                  title={rows.length === 0 ? 'No activity yet' : 'No events match your filters'}
                  description={
                    rows.length === 0
                      ? 'As you create suppliers, run analyses and book savings, the audit trail will populate here.'
                      : 'Try clearing the search or filters.'
                  }
                />
              ) : (
                <div className="space-y-6">
                  {grouped.map((g) => (
                    <div key={g.day}>
                      <div className="mb-3 flex items-center gap-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.day}</span>
                        <span className="h-px flex-1 bg-slate-800" />
                        <span className="text-[11px] text-slate-600">{g.items.length} events</span>
                      </div>
                      <ol className="relative space-y-4 pl-6">
                        <span className="absolute left-2 top-1 bottom-1 w-px bg-slate-800" aria-hidden />
                        {g.items.map((r) => {
                          const href = entityToHref(r.entity_type, r.entity_id)
                          const tone = actionTone(r.action)
                          return (
                            <li key={r.id} className="relative">
                              <span
                                className="absolute -left-[1.35rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-[10px] text-cyan-300"
                                aria-hidden
                              >
                                {actionIcon(r.action)}
                              </span>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone={tone}>{humanize(r.action) || 'Event'}</Badge>
                                {r.entity_type && (
                                  href ? (
                                    <a href={href} className="text-sm font-medium text-slate-200 hover:text-cyan-300">
                                      {humanize(r.entity_type)}
                                      {r.entity_id ? <span className="text-slate-500"> · {String(r.entity_id).slice(0, 8)}</span> : null}
                                    </a>
                                  ) : (
                                    <span className="text-sm font-medium text-slate-200">
                                      {humanize(r.entity_type)}
                                      {r.entity_id ? <span className="text-slate-500"> · {String(r.entity_id).slice(0, 8)}</span> : null}
                                    </span>
                                  )
                                )}
                                <span className="text-xs text-slate-500" title={fmtDateTime(r.created_at)}>
                                  {relTime(r.created_at)}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                {r.user_id && <span>by {String(r.user_id).slice(0, 12)}</span>}
                                <span>{fmtDateTime(r.created_at)}</span>
                              </div>
                              {r.metadata && Object.keys(r.metadata).length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {Object.entries(r.metadata)
                                    .slice(0, 6)
                                    .map(([k, v]) => (
                                      <span
                                        key={k}
                                        className="rounded-md border border-slate-800 bg-slate-900/60 px-1.5 py-0.5 text-[11px] text-slate-400"
                                      >
                                        <span className="text-slate-600">{humanize(k)}:</span>{' '}
                                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                      </span>
                                    ))}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ol>
                    </div>
                  ))}
                </div>
              )}

              {hasMore && filtered.length > 0 && (
                <div className="mt-6 flex justify-center">
                  <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : `Load more (${rows.length} of ${total})`}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function Header({ onRefresh, disabled }: { onRefresh: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Activity</h1>
        <p className="text-sm text-slate-500">A chronological audit trail of every change made in this workspace.</p>
      </div>
      <Button variant="secondary" onClick={onRefresh} disabled={disabled}>
        Refresh
      </Button>
    </div>
  )
}
