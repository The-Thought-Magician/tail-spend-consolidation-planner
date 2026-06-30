'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Recommendation {
  id: string
  workspace_id: string
  type?: string
  category_id?: string | null
  title: string
  rationale?: string
  impact?: number | string | null
  effort?: number | string | null
  priority?: number | string | null
  supplier_ids?: string[] | null
  status?: string
  created_at?: string
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0
  if (!isFinite(n)) return '$0'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0
  return isFinite(n) ? n : 0
}

const TYPE_TONES: Record<string, 'cyan' | 'green' | 'amber' | 'violet' | 'rose' | 'slate'> = {
  consolidation: 'cyan',
  duplicate: 'violet',
  maverick: 'rose',
  dispersion: 'amber',
  tail: 'green',
}

function statusTone(s?: string): 'cyan' | 'green' | 'amber' | 'slate' | 'rose' {
  switch ((s || '').toLowerCase()) {
    case 'open': case 'new': case 'active': return 'cyan'
    case 'converted': case 'accepted': case 'done': return 'green'
    case 'snoozed': return 'amber'
    case 'dismissed': case 'rejected': return 'rose'
    default: return 'slate'
  }
}

// Quadrant classification. Impact = $ savings, effort = relative difficulty.
function quadrant(impact: number, effort: number, impactMid: number, effortMid: number): string {
  const hiImpact = impact >= impactMid
  const loEffort = effort <= effortMid
  if (hiImpact && loEffort) return 'Quick Wins'
  if (hiImpact && !loEffort) return 'Major Projects'
  if (!hiImpact && loEffort) return 'Fill-ins'
  return 'Low Priority'
}

export default function RecommendationsPage() {
  const router = useRouter()
  const [wsId, setWsId] = useState<string | null>(null)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWsId(localStorage.getItem('tscp_workspace_id'))
    }
  }, [])

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.listRecommendations(ws)
      setRecs(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recommendations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) load(wsId)
    else setLoading(false)
  }, [wsId, load])

  const types = useMemo(() => {
    const set = new Set<string>()
    recs.forEach((r) => r.type && set.add(r.type))
    return Array.from(set).sort()
  }, [recs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recs.filter((r) => {
      if (statusFilter && (r.status || '') !== statusFilter) return false
      if (typeFilter && (r.type || '') !== typeFilter) return false
      if (q && !(r.title.toLowerCase().includes(q) || (r.rationale || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [recs, statusFilter, typeFilter, search])

  const totalImpact = useMemo(() => recs.reduce((a, r) => a + num(r.impact), 0), [recs])
  const openCount = useMemo(
    () => recs.filter((r) => ['open', 'new', 'active', ''].includes((r.status || '').toLowerCase())).length,
    [recs],
  )

  // Quadrant midpoints based on visible set.
  const { impactMid, effortMid, impactMax, effortMax } = useMemo(() => {
    const impacts = filtered.map((r) => num(r.impact))
    const efforts = filtered.map((r) => num(r.effort))
    const iMax = Math.max(1, ...impacts)
    const eMax = Math.max(1, ...efforts)
    return {
      impactMid: iMax / 2,
      effortMid: eMax / 2,
      impactMax: iMax,
      effortMax: eMax,
    }
  }, [filtered])

  async function handleGenerate() {
    if (!wsId) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      await api.generateRecommendations({ workspace_id: wsId })
      await load(wsId)
      setNotice('Recommendations regenerated from latest findings.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate recommendations')
    } finally {
      setGenerating(false)
    }
  }

  async function setStatus(id: string, status: string) {
    if (!wsId) return
    setBusyId(id)
    setError(null)
    try {
      await api.updateRecommendation(id, { status })
      setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update recommendation')
    } finally {
      setBusyId(null)
    }
  }

  async function toScenario(id: string) {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      const sc = await api.recommendationToScenario(id, {})
      setNotice('Scenario created from recommendation.')
      if (sc?.id) {
        router.push(`/dashboard/scenarios/${sc.id}`)
      } else if (wsId) {
        await load(wsId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create scenario')
    } finally {
      setBusyId(null)
    }
  }

  async function toInitiative(id: string) {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      const it = await api.recommendationToInitiative(id, {})
      setNotice('Initiative created from recommendation.')
      if (it?.id) {
        router.push(`/dashboard/initiatives/${it.id}`)
      } else if (wsId) {
        await load(wsId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create initiative')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading recommendations..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace before viewing recommendations."
          icon="🗂️"
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to Workspaces</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Recommendations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Prioritized consolidation plays plotted by impact and effort. Convert the best into scenarios or initiatives.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating...' : 'Generate recommendations'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Recommendations" value={recs.length} tone="cyan" />
        <Stat label="Open" value={openCount} tone="amber" />
        <Stat label="Total Potential Impact" value={fmtMoney(totalImpact)} tone="green" />
      </div>

      {recs.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No recommendations yet"
              description="Run the analysis modules (tail, duplicates, dispersion) then generate recommendations from the findings."
              icon="💡"
              action={<Button onClick={handleGenerate} disabled={generating}>{generating ? 'Generating...' : 'Generate recommendations'}</Button>}
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Impact / Effort quadrant */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Impact / Effort matrix</h2>
              <p className="mt-1 text-xs text-slate-500">
                Higher = more savings impact. Right = more effort. Bubble color encodes type.
              </p>
            </CardHeader>
            <CardBody>
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No recommendations match the current filters.</p>
              ) : (
                <div className="relative">
                  <div className="relative ml-10 h-[420px] rounded-lg border border-slate-800 bg-slate-950/60">
                    {/* quadrant divider lines */}
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-700/60" />
                    <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-slate-700/60" />
                    {/* quadrant labels */}
                    <span className="pointer-events-none absolute left-3 top-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-400/70">Quick Wins</span>
                    <span className="pointer-events-none absolute right-3 top-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-400/70">Major Projects</span>
                    <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Fill-ins</span>
                    <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Low Priority</span>

                    {filtered.map((r) => {
                      const impact = num(r.impact)
                      const effort = num(r.effort)
                      const x = Math.min(96, Math.max(2, (effort / effortMax) * 92 + 2))
                      const y = Math.min(96, Math.max(2, 96 - (impact / impactMax) * 92))
                      const tone = TYPE_TONES[(r.type || '').toLowerCase()] || 'slate'
                      const colorMap: Record<string, string> = {
                        cyan: 'bg-cyan-400 border-cyan-200',
                        green: 'bg-emerald-400 border-emerald-200',
                        amber: 'bg-amber-400 border-amber-200',
                        violet: 'bg-violet-400 border-violet-200',
                        rose: 'bg-rose-400 border-rose-200',
                        slate: 'bg-slate-400 border-slate-200',
                      }
                      const size = 10 + Math.min(28, (impact / impactMax) * 28)
                      return (
                        <div
                          key={r.id}
                          className="group absolute -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${x}%`, top: `${y}%` }}
                        >
                          <div
                            className={`rounded-full border opacity-80 transition-transform group-hover:scale-125 ${colorMap[tone]}`}
                            style={{ width: size, height: size }}
                            title={`${r.title} — impact ${fmtMoney(impact)}, effort ${effort}`}
                          />
                          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden w-48 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200 shadow-xl group-hover:block">
                            <div className="font-semibold">{r.title}</div>
                            <div className="mt-1 text-slate-400">Impact {fmtMoney(impact)} · Effort {effort}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* axis labels */}
                  <div className="mt-1 ml-10 text-center text-[10px] uppercase tracking-wide text-slate-500">Effort →</div>
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-wide text-slate-500">Impact →</div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Filters + table */}
          <Card>
            <CardHeader className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All types</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="snoozed">Snoozed</option>
                <option value="dismissed">Dismissed</option>
                <option value="converted">Converted</option>
              </select>
              <span className="ml-auto text-xs text-slate-500">{filtered.length} shown</span>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No matching recommendations" description="Adjust the filters above." icon="🔍" />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Recommendation</TH>
                      <TH>Type</TH>
                      <TH>Quadrant</TH>
                      <TH className="text-right">Impact</TH>
                      <TH className="text-right">Effort</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered
                      .slice()
                      .sort((a, b) => num(b.impact) - num(a.impact))
                      .map((r) => {
                        const impact = num(r.impact)
                        const effort = num(r.effort)
                        const q = quadrant(impact, effort, impactMid, effortMid)
                        const busy = busyId === r.id
                        return (
                          <TR key={r.id}>
                            <TD className="max-w-sm">
                              <div className="font-medium text-slate-100">{r.title}</div>
                              {r.rationale && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{r.rationale}</div>}
                            </TD>
                            <TD>
                              {r.type ? (
                                <Badge tone={TYPE_TONES[(r.type || '').toLowerCase()] || 'slate'}>{r.type}</Badge>
                              ) : <span className="text-slate-600">—</span>}
                            </TD>
                            <TD className="text-xs text-slate-400">{q}</TD>
                            <TD className="text-right font-semibold tabular-nums text-emerald-300">{fmtMoney(impact)}</TD>
                            <TD className="text-right tabular-nums text-slate-300">{effort || '—'}</TD>
                            <TD><Badge tone={statusTone(r.status)}>{r.status || 'open'}</Badge></TD>
                            <TD>
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button variant="secondary" className="px-2 py-1" disabled={busy} onClick={() => toScenario(r.id)}>
                                  → Scenario
                                </Button>
                                <Button variant="secondary" className="px-2 py-1" disabled={busy} onClick={() => toInitiative(r.id)}>
                                  → Initiative
                                </Button>
                                <Button variant="ghost" className="px-2 py-1" disabled={busy} onClick={() => setStatus(r.id, 'snoozed')}>
                                  Snooze
                                </Button>
                                <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" disabled={busy} onClick={() => setStatus(r.id, 'dismissed')}>
                                  Dismiss
                                </Button>
                              </div>
                            </TD>
                          </TR>
                        )
                      })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
