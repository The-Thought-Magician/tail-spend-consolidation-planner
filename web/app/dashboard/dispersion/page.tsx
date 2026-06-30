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

type Dispersion = {
  id: string
  workspace_id: string
  category_id?: string | null
  item_key?: string | null
  min_price?: number | string | null
  max_price?: number | string | null
  median_price?: number | string | null
  p25_price?: number | string | null
  p75_price?: number | string | null
  dispersion_index?: number | string | null
  total_quantity?: number | string | null
  addressable_savings?: number | string | null
  computed_at?: string | null
}

type Category = { id: string; name: string; code?: string }

type Fragmentation = {
  total?: number | string | null
  byCategory?: Array<{
    category_id?: string | null
    name?: string | null
    addressable_savings?: number | string | null
    item_count?: number | string | null
  }>
}

function getWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('tscp_workspace_id') || localStorage.getItem('tscp_workspace') || null
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

function price(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dispersionTone(idx: number): 'rose' | 'amber' | 'green' {
  if (idx >= 0.5) return 'rose'
  if (idx >= 0.2) return 'amber'
  return 'green'
}

export default function DispersionPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rows, setRows] = useState<Dispersion[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [frag, setFrag] = useState<Fragmentation | null>(null)

  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'savings' | 'dispersion'>('savings')
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  async function loadAll(ws: string) {
    const [d, c, f] = await Promise.all([
      api.getDispersion(ws),
      api.listCategories(ws),
      api.getCostOfFragmentation(ws),
    ])
    setRows(Array.isArray(d) ? d : d?.rows ?? [])
    setCategories(Array.isArray(c) ? c : c?.rows ?? [])
    setFrag(f && typeof f === 'object' ? f : null)
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadAll(workspaceId)
      .catch((e) => !cancelled && setError(e.message || 'Failed to load dispersion data'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function handleCompute() {
    if (!workspaceId) return
    setComputing(true)
    setError(null)
    try {
      await api.computeDispersion({ workspace_id: workspaceId })
      await loadAll(workspaceId)
    } catch (e: any) {
      setError(e.message || 'Compute failed')
    } finally {
      setComputing(false)
    }
  }

  const catName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = rows.filter((r) => {
      if (categoryFilter !== 'all' && r.category_id !== categoryFilter) return false
      if (!q) return true
      return [r.item_key, r.category_id && catName.get(r.category_id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
    return [...list].sort((a, b) => {
      if (sortBy === 'savings') return num(b.addressable_savings) - num(a.addressable_savings)
      return num(b.dispersion_index) - num(a.dispersion_index)
    })
  }, [rows, categoryFilter, search, sortBy, catName])

  const totals = useMemo(() => {
    const totalSavings = rows.reduce((s, r) => s + num(r.addressable_savings), 0)
    const avgDisp = rows.length ? rows.reduce((s, r) => s + num(r.dispersion_index), 0) / rows.length : 0
    const highVar = rows.filter((r) => num(r.dispersion_index) >= 0.5).length
    return { totalSavings, avgDisp, highVar, items: rows.length }
  }, [rows])

  const byCategory = useMemo(() => {
    if (frag?.byCategory && frag.byCategory.length) {
      return frag.byCategory.map((c) => ({
        id: c.category_id || '',
        name: c.name || (c.category_id ? catName.get(c.category_id) : '') || 'Uncategorized',
        savings: num(c.addressable_savings),
      }))
    }
    // derive from rows if endpoint returned only total
    const m = new Map<string, number>()
    for (const r of rows) {
      const key = r.category_id || 'uncat'
      m.set(key, (m.get(key) || 0) + num(r.addressable_savings))
    }
    return Array.from(m.entries()).map(([id, savings]) => ({
      id,
      name: id === 'uncat' ? 'Uncategorized' : catName.get(id) || id,
      savings,
    }))
  }, [frag, rows, catName])

  const fragTotal = frag?.total != null ? num(frag.total) : byCategory.reduce((s, c) => s + c.savings, 0)
  const maxCatSavings = Math.max(0.0001, ...byCategory.map((c) => c.savings))

  if (!workspaceId && !loading) {
    return (
      <div className="space-y-6">
        <Header onCompute={handleCompute} computing={computing} disabled />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace to analyze price dispersion."
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
      <Header onCompute={handleCompute} computing={computing} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading price dispersion..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Cost of fragmentation" value={money(fragTotal)} tone="rose" hint="Addressable savings" />
            <Stat label="Items analyzed" value={totals.items} tone="cyan" />
            <Stat label="High-variance items" value={totals.highVar} tone="amber" hint="dispersion ≥ 0.50" />
            <Stat label="Avg dispersion index" value={totals.avgDisp.toFixed(2)} />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Cost of fragmentation by category</h2>
              <p className="text-xs text-slate-500">Addressable savings from price harmonization across categories</p>
            </CardHeader>
            <CardBody>
              {byCategory.length === 0 ? (
                <p className="text-sm text-slate-500">No category breakdown yet. Run compute to populate dispersion stats.</p>
              ) : (
                <div className="space-y-3">
                  {[...byCategory]
                    .sort((a, b) => b.savings - a.savings)
                    .map((c) => (
                      <div key={c.id}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="truncate text-slate-300">{c.name}</span>
                          <span className="font-medium text-amber-300">{money(c.savings)}</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-amber-500"
                            style={{ width: `${Math.min(100, (c.savings / maxCatSavings) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Price dispersion by item</h2>
                <p className="text-xs text-slate-500">{filtered.length} of {rows.length} items</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items..."
                  className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'savings' | 'dispersion')}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="savings">Sort: Savings</option>
                  <option value="dispersion">Sort: Dispersion</option>
                </select>
              </div>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title={rows.length === 0 ? 'No dispersion data' : 'No items match your filters'}
                    description={
                      rows.length === 0
                        ? 'Compute per-item price statistics and addressable savings from your transactions.'
                        : 'Try clearing the search or category filter.'
                    }
                    action={
                      rows.length === 0 ? (
                        <Button onClick={handleCompute} disabled={computing}>
                          {computing ? 'Computing...' : 'Compute dispersion'}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Item / Category</TH>
                      <TH className="text-right">Min</TH>
                      <TH className="text-right">Median</TH>
                      <TH className="text-right">Max</TH>
                      <TH>Price range</TH>
                      <TH className="text-right">Dispersion</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Addressable</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const min = num(r.min_price)
                      const max = num(r.max_price)
                      const median = num(r.median_price)
                      const p25 = num(r.p25_price)
                      const p75 = num(r.p75_price)
                      const span = Math.max(0.0001, max - min)
                      const idx = num(r.dispersion_index)
                      const boxLeft = ((Math.max(min, p25) - min) / span) * 100
                      const boxWidth = (((p75 || max) - (p25 || min)) / span) * 100
                      const medianLeft = ((median - min) / span) * 100
                      return (
                        <TR key={r.id}>
                          <TD>
                            <div className="font-mono text-xs text-slate-200">{r.item_key || '—'}</div>
                            <div className="text-[11px] text-slate-500">
                              {r.category_id ? catName.get(r.category_id) || 'Category' : 'Uncategorized'}
                            </div>
                          </TD>
                          <TD className="text-right tabular-nums text-slate-400">{price(min)}</TD>
                          <TD className="text-right tabular-nums text-slate-200">{price(median)}</TD>
                          <TD className="text-right tabular-nums text-slate-400">{price(max)}</TD>
                          <TD>
                            <div className="relative h-3 w-32 rounded-full bg-slate-800">
                              <div
                                className="absolute top-0 h-3 rounded-full bg-cyan-500/30"
                                style={{ left: `${Math.max(0, boxLeft)}%`, width: `${Math.min(100, Math.max(2, boxWidth))}%` }}
                              />
                              <div
                                className="absolute top-[-1px] h-[14px] w-0.5 bg-cyan-300"
                                style={{ left: `${Math.min(100, Math.max(0, medianLeft))}%` }}
                              />
                            </div>
                          </TD>
                          <TD className="text-right">
                            <Badge tone={dispersionTone(idx)}>{idx.toFixed(2)}</Badge>
                          </TD>
                          <TD className="text-right tabular-nums text-slate-400">
                            {num(r.total_quantity).toLocaleString()}
                          </TD>
                          <TD className="text-right font-semibold tabular-nums text-amber-300">
                            {money(r.addressable_savings)}
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

function Header({
  onCompute,
  computing,
  disabled,
}: {
  onCompute: () => void
  computing: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Price Dispersion</h1>
        <p className="text-sm text-slate-500">Per-item price spread, dispersion index, and the cost of fragmentation.</p>
      </div>
      <Button onClick={onCompute} disabled={computing || disabled}>
        {computing ? 'Computing...' : 'Compute dispersion'}
      </Button>
    </div>
  )
}
