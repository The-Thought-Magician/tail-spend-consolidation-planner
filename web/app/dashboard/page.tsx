'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type Kpis = {
  total_spend?: number
  supplier_count?: number
  tail_spend?: number
  tail_spend_pct?: number
  tail_supplier_count?: number
  duplicate_groups?: number
  maverick_leakage?: number
  maverick_rate?: number
  identified_savings?: number
  realized_savings?: number
  [k: string]: unknown
}

type FunnelStage = {
  stage?: string
  label?: string
  name?: string
  amount?: number
  value?: number
  count?: number
}

type Opportunity = {
  id: string
  title?: string
  type?: string
  rationale?: string
  impact?: number | string
  effort?: number | string
  priority?: number | string
  status?: string
}

type SampleStatus = { seeded?: boolean; counts?: Record<string, number> }

function getWorkspaceId(): string | null {
  try {
    return localStorage.getItem('tscp_workspace_id')
  } catch {
    return null
  }
}

function fmtCurrency(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n)
  if (!isFinite(v)) return '—'
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function fmtNum(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n)
  if (!isFinite(v)) return '—'
  return v.toLocaleString()
}

function fmtPct(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n)
  if (!isFinite(v)) return '—'
  // Treat values <= 1 as fractional.
  const pct = v <= 1 && v >= 0 ? v * 100 : v
  return `${pct.toFixed(1)}%`
}

const impactTone = (impact: unknown): 'green' | 'amber' | 'slate' => {
  const v = typeof impact === 'number' ? impact : Number(impact)
  if (isFinite(v)) {
    if (v >= 100_000) return 'green'
    if (v >= 10_000) return 'amber'
    return 'slate'
  }
  const s = String(impact ?? '').toLowerCase()
  if (s === 'high') return 'green'
  if (s === 'medium') return 'amber'
  return 'slate'
}

export default function DashboardPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [funnel, setFunnel] = useState<FunnelStage[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [sample, setSample] = useState<SampleStatus | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const [k, f, o, s] = await Promise.all([
        api.getDashboardKpis(id),
        api.getDashboardFunnel(id),
        api.getTopOpportunities(id),
        api.getSampleDataStatus(id),
      ])
      setKpis(k || {})
      const stages = Array.isArray(f) ? f : f?.stages ?? []
      setFunnel(Array.isArray(stages) ? stages : [])
      setOpps(Array.isArray(o) ? o : o?.recommendations ?? [])
      setSample(s || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = getWorkspaceId()
    setWsId(id)
    if (id) load(id)
    else setLoading(false)
  }, [load])

  if (loading) return <PageSpinner label="Loading dashboard..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon="◷"
          title="No workspace selected"
          description="Pick or create a workspace to view your spend analytics overview."
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to Workspaces</Button>
            </Link>
          }
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-5 text-sm text-rose-300">
          <div className="font-semibold">Could not load dashboard</div>
          <div className="mt-1 text-rose-400/90">{error}</div>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => load(wsId)}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const k = kpis || {}
  const maxFunnel = Math.max(
    1,
    ...funnel.map((s) => Number(s.amount ?? s.value ?? s.count ?? 0) || 0),
  )
  const sampleEmpty = sample && sample.seeded === false

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Spend Overview</h1>
          <p className="mt-1 text-sm text-stone-500">
            Tail spend, leakage and consolidation savings at a glance.
          </p>
        </div>
        <Link href="/dashboard/recommendations">
          <Button variant="secondary">View all opportunities</Button>
        </Link>
      </div>

      {sampleEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-800/60 bg-cyan-950/30 px-5 py-4">
          <div className="text-sm text-cyan-200">
            This workspace has no data yet. Seed a demo dataset to explore the analytics.
          </div>
          <Link href="/dashboard/sample-data">
            <Button>Seed sample data</Button>
          </Link>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total Spend" value={fmtCurrency(k.total_spend)} tone="cyan" hint="Across all suppliers" />
        <Stat label="Suppliers" value={fmtNum(k.supplier_count)} hint={`${fmtNum(k.tail_supplier_count)} in tail`} />
        <Stat
          label="Tail Spend"
          value={fmtCurrency(k.tail_spend)}
          tone="amber"
          hint={`${fmtPct(k.tail_spend_pct)} of total`}
        />
        <Stat
          label="Maverick Leakage"
          value={fmtCurrency(k.maverick_leakage)}
          tone="rose"
          hint={k.maverick_rate != null ? `${fmtPct(k.maverick_rate)} off-contract` : undefined}
        />
        <Stat label="Duplicate Groups" value={fmtNum(k.duplicate_groups)} hint="Potential consolidations" />
        <Stat label="Identified Savings" value={fmtCurrency(k.identified_savings)} tone="cyan" hint="Pipeline" />
        <Stat label="Realized Savings" value={fmtCurrency(k.realized_savings)} tone="green" hint="Booked to date" />
        <Stat
          label="Realization Rate"
          value={
            Number(k.identified_savings) > 0
              ? fmtPct(Number(k.realized_savings ?? 0) / Number(k.identified_savings))
              : '—'
          }
          tone="green"
          hint="Realized / identified"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Savings funnel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Savings Opportunity Funnel</h2>
          </CardHeader>
          <CardBody>
            {funnel.length === 0 ? (
              <EmptyState
                title="No funnel data"
                description="Run analysis to populate the savings funnel."
              />
            ) : (
              <div className="space-y-3">
                {funnel.map((s, i) => {
                  const amount = Number(s.amount ?? s.value ?? s.count ?? 0) || 0
                  const pct = Math.round((amount / maxFunnel) * 100)
                  const label = s.stage ?? s.label ?? s.name ?? `Stage ${i + 1}`
                  return (
                    <div key={`${label}-${i}`}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium capitalize text-stone-300">{label}</span>
                        <span className="text-stone-400">{fmtCurrency(amount)}</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-stone-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300 transition-all"
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Top opportunities */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Top Opportunities</h2>
            <Link href="/dashboard/recommendations" className="text-xs text-cyan-300 hover:text-cyan-200">
              View all →
            </Link>
          </CardHeader>
          <CardBody>
            {opps.length === 0 ? (
              <EmptyState
                title="No opportunities yet"
                description="Generate recommendations from your tail, duplicate and dispersion analyses."
                action={
                  <Link href="/dashboard/recommendations">
                    <Button variant="secondary">Generate recommendations</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-stone-800/70">
                {opps.slice(0, 6).map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {o.type && (
                          <Badge tone="cyan" className="capitalize">
                            {String(o.type).replace(/_/g, ' ')}
                          </Badge>
                        )}
                        <span className="truncate text-sm font-medium text-stone-200">
                          {o.title ?? 'Recommendation'}
                        </span>
                      </div>
                      {o.rationale && (
                        <p className="mt-1 line-clamp-2 text-xs text-stone-500">{o.rationale}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={impactTone(o.impact)}>
                        {typeof o.impact === 'number' ? fmtCurrency(o.impact) : `Impact: ${o.impact ?? '—'}`}
                      </Badge>
                      {o.effort != null && (
                        <span className="text-[11px] text-stone-500">
                          Effort: {typeof o.effort === 'number' ? o.effort : String(o.effort)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
