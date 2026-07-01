'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Finding = {
  id: string
  workspace_id: string
  transaction_id?: string | null
  supplier_id?: string | null
  supplier_name?: string | null
  category_id?: string | null
  category_name?: string | null
  contract_id?: string | null
  expected_price?: number | string | null
  paid_price?: number | string | null
  leakage_amount?: number | string | null
  reason?: string | null
  status?: string | null
  created_at?: string | null
}

type RateRow = {
  key?: string | null
  label?: string | null
  category_id?: string | null
  cost_center?: string | null
  total?: number | string | null
  total_amount?: number | string | null
  off_contract?: number | string | null
  off_contract_amount?: number | string | null
  maverick_rate?: number | string | null
  rate?: number | string | null
}

const STATUSES = ['open', 'remediated', 'accepted', 'false_positive'] as const

function getWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return (
      localStorage.getItem('tscp_workspace_id') ||
      localStorage.getItem('tscp_workspace') ||
      null
    )
  } catch {
    return null
  }
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function money(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(v: unknown): string {
  const n = num(v)
  // accept either fraction (0-1) or already-percent
  const p = n > 0 && n <= 1 ? n * 100 : n
  return `${p.toFixed(1)}%`
}

function statusTone(s?: string | null): 'rose' | 'green' | 'amber' | 'slate' {
  switch ((s || '').toLowerCase()) {
    case 'open':
      return 'rose'
    case 'remediated':
      return 'green'
    case 'accepted':
      return 'amber'
    default:
      return 'slate'
  }
}

export default function MaverickPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [findings, setFindings] = useState<Finding[]>([])
  const [rateRows, setRateRows] = useState<RateRow[]>([])
  const [rateBy, setRateBy] = useState<'category' | 'cost_center'>('category')

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [detecting, setDetecting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  async function loadAll(ws: string, by: 'category' | 'cost_center') {
    const [f, r] = await Promise.all([
      api.getMaverickFindings(ws),
      api.getMaverickRate(ws, { by }),
    ])
    setFindings(Array.isArray(f) ? f : f?.findings ?? [])
    const rows = Array.isArray(r) ? r : r?.rows ?? []
    setRateRows(rows)
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadAll(workspaceId, rateBy)
      .catch((e) => !cancelled && setError(e.message || 'Failed to load maverick data'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [workspaceId, rateBy])

  async function refresh() {
    if (!workspaceId) return
    try {
      await loadAll(workspaceId, rateBy)
    } catch (e: any) {
      setError(e.message || 'Failed to refresh')
    }
  }

  async function handleDetect() {
    if (!workspaceId) return
    setDetecting(true)
    setError(null)
    try {
      await api.detectMaverick({ workspace_id: workspaceId })
      await refresh()
    } catch (e: any) {
      setError(e.message || 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  async function setFindingStatus(id: string, status: string) {
    setUpdatingId(id)
    setError(null)
    try {
      const updated = await api.updateMaverickFinding(id, { status })
      setFindings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...(updated || {}), status } : f)),
      )
    } catch (e: any) {
      setError(e.message || 'Update failed')
    } finally {
      setUpdatingId(null)
    }
  }

  async function bulkSetStatus(status: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    setError(null)
    try {
      const ids = Array.from(selected)
      await Promise.all(ids.map((id) => api.updateMaverickFinding(id, { status })))
      setFindings((prev) =>
        prev.map((f) => (selected.has(f.id) ? { ...f, status } : f)),
      )
      setSelected(new Set())
    } catch (e: any) {
      setError(e.message || 'Bulk update failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return findings.filter((f) => {
      if (statusFilter !== 'all' && (f.status || '').toLowerCase() !== statusFilter) return false
      if (!q) return true
      return [f.reason, f.supplier_id, f.category_id, f.contract_id, f.transaction_id, f.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [findings, statusFilter, search])

  const totals = useMemo(() => {
    const totalLeak = findings.reduce((s, f) => s + num(f.leakage_amount), 0)
    const open = findings.filter((f) => (f.status || '').toLowerCase() === 'open')
    const openLeak = open.reduce((s, f) => s + num(f.leakage_amount), 0)
    const remediated = findings.filter((f) => (f.status || '').toLowerCase() === 'remediated').length
    return { totalLeak, openLeak, openCount: open.length, count: findings.length, remediated }
  }, [findings])

  const maxRate = useMemo(
    () =>
      Math.max(
        0.0001,
        ...rateRows.map((r) => {
          const v = num(r.maverick_rate ?? r.rate)
          return v > 1 ? v / 100 : v
        }),
      ),
    [rateRows],
  )

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) return new Set()
      return new Set(filtered.map((f) => f.id))
    })
  }

  if (!workspaceId && !loading) {
    return (
      <div className="space-y-6">
        <Header onDetect={handleDetect} detecting={detecting} disabled />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace to analyze maverick spend."
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
      <Header onDetect={handleDetect} detecting={detecting} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading maverick findings..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total leakage" value={money(totals.totalLeak)} tone="rose" hint={`${totals.count} findings`} />
            <Stat label="Open leakage" value={money(totals.openLeak)} tone="amber" hint={`${totals.openCount} open`} />
            <Stat label="Remediated" value={totals.remediated} tone="green" hint="findings closed" />
            <Stat
              label="Avg leakage / finding"
              value={money(totals.count ? totals.totalLeak / totals.count : 0)}
              tone="cyan"
            />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Maverick rate</h2>
                <p className="text-xs text-slate-500">Off-contract spend share, by {rateBy === 'category' ? 'category' : 'cost center'}</p>
              </div>
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
                {(['category', 'cost_center'] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => setRateBy(b)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      rateBy === b ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {b === 'category' ? 'Category' : 'Cost center'}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              {rateRows.length === 0 ? (
                <p className="text-sm text-slate-500">No rate data yet. Run detection to populate findings.</p>
              ) : (
                <div className="space-y-3">
                  {rateRows.map((r, i) => {
                    const raw = num(r.maverick_rate ?? r.rate)
                    const frac = raw > 1 ? raw / 100 : raw
                    const label = r.label || r.key || r.category_id || r.cost_center || `Row ${i + 1}`
                    return (
                      <div key={`${label}-${i}`}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="truncate text-slate-300">{label}</span>
                          <span className="font-medium text-rose-300">{pct(frac)}</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500"
                            style={{ width: `${Math.min(100, (frac / maxRate) * 100)}%` }}
                          />
                        </div>
                        {(r.off_contract_amount != null || r.total_amount != null) && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            {money(r.off_contract_amount ?? r.off_contract)} off-contract of {money(r.total_amount ?? r.total)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Off-contract findings</h2>
                <p className="text-xs text-slate-500">{filtered.length} of {findings.length} shown</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search findings..."
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-5 py-3 text-sm">
                <span className="text-slate-400">{selected.size} selected</span>
                <Button variant="secondary" onClick={() => bulkSetStatus('remediated')} disabled={bulkBusy}>
                  Mark remediated
                </Button>
                <Button variant="secondary" onClick={() => bulkSetStatus('accepted')} disabled={bulkBusy}>
                  Accept
                </Button>
                <Button variant="ghost" onClick={() => bulkSetStatus('false_positive')} disabled={bulkBusy}>
                  False positive
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
                  Clear
                </Button>
              </div>
            )}

            <CardBody className="px-0 py-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title={findings.length === 0 ? 'No maverick findings' : 'No findings match your filters'}
                    description={
                      findings.length === 0
                        ? 'Run detection to match transactions against contracts and compute leakage.'
                        : 'Try clearing the search or status filter.'
                    }
                    action={
                      findings.length === 0 ? (
                        <Button onClick={handleDetect} disabled={detecting}>
                          {detecting ? 'Detecting...' : 'Run detection'}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-10">
                        <input
                          type="checkbox"
                          checked={selected.size === filtered.length && filtered.length > 0}
                          onChange={toggleSelectAll}
                          className="accent-cyan-500"
                        />
                      </TH>
                      <TH>Reason</TH>
                      <TH className="text-right">Expected</TH>
                      <TH className="text-right">Paid</TH>
                      <TH className="text-right">Leakage</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((f) => (
                      <TR key={f.id}>
                        <TD>
                          <input
                            type="checkbox"
                            checked={selected.has(f.id)}
                            onChange={() => toggleSelect(f.id)}
                            className="accent-cyan-500"
                          />
                        </TD>
                        <TD>
                          <div className="text-slate-200">{f.reason || 'Off-contract purchase'}</div>
                          <div className="text-[11px] text-slate-500">
                            {f.supplier_name || (f.supplier_id ? `Supplier ${String(f.supplier_id).slice(0, 8)}` : 'No supplier')}
                            {f.contract_id ? ` · Contract ${String(f.contract_id).slice(0, 8)}` : ' · No contract'}
                          </div>
                        </TD>
                        <TD className="text-right tabular-nums">
                          {f.expected_price != null ? money(f.expected_price) : '—'}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {f.paid_price != null ? money(f.paid_price) : '—'}
                        </TD>
                        <TD className="text-right font-semibold tabular-nums text-rose-300">
                          {money(f.leakage_amount)}
                        </TD>
                        <TD>
                          <Badge tone={statusTone(f.status)}>{(f.status || 'open').replace('_', ' ')}</Badge>
                        </TD>
                        <TD className="text-right">
                          <select
                            value={(f.status || 'open').toLowerCase()}
                            disabled={updatingId === f.id}
                            onChange={(e) => setFindingStatus(f.id, e.target.value)}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s.replace('_', ' ')}
                              </option>
                            ))}
                          </select>
                        </TD>
                      </TR>
                    ))}
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

function Header({
  onDetect,
  detecting,
  disabled,
}: {
  onDetect: () => void
  detecting: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Maverick Spend</h1>
        <p className="text-sm text-slate-500">Off-contract purchases, contract-price leakage, and maverick rate.</p>
      </div>
      <Button onClick={onDetect} disabled={detecting || disabled}>
        {detecting ? 'Detecting...' : 'Run detection'}
      </Button>
    </div>
  )
}
