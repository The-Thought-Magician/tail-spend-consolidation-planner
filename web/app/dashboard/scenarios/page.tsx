'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Scenario {
  id: string
  workspace_id: string
  name: string
  category_id?: string | null
  from_supplier_ids?: string[] | null
  to_supplier_ids?: string[] | null
  assumptions?: Record<string, unknown> | null
  results?: Record<string, unknown> | null
  modeled_savings?: number | string | null
  created_at?: string
  updated_at?: string
}

interface Category {
  id: string
  name: string
  code?: string
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

export default function ScenariosPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string[]>([])
  const [compareData, setCompareData] = useState<Scenario[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWsId(localStorage.getItem('tscp_workspace_id'))
    }
  }, [])

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const [s, c] = await Promise.all([
        api.listScenarios(ws),
        api.listCategories(ws),
      ])
      setScenarios(Array.isArray(s) ? s : [])
      setCategories(Array.isArray(c) ? c : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) load(wsId)
    else setLoading(false)
  }, [wsId, load])

  const catName = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.id, c.name))
    return m
  }, [categories])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scenarios.filter((s) => {
      if (catFilter && s.category_id !== catFilter) return false
      if (q && !s.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [scenarios, search, catFilter])

  const totalModeled = useMemo(
    () => scenarios.reduce((acc, s) => acc + num(s.modeled_savings), 0),
    [scenarios],
  )
  const bestScenario = useMemo(() => {
    if (scenarios.length === 0) return null
    return scenarios.reduce((best, s) =>
      num(s.modeled_savings) > num(best.modeled_savings) ? s : best,
    )
  }, [scenarios])

  async function handleCreate() {
    if (!wsId) return
    if (!newName.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createScenario({
        workspace_id: wsId,
        name: newName.trim(),
        category_id: newCat || null,
        from_supplier_ids: [],
        to_supplier_ids: [],
        assumptions: {},
      })
      setCreateOpen(false)
      setNewName('')
      setNewCat('')
      await load(wsId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create scenario')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!wsId) return
    if (!confirm('Delete this scenario? This cannot be undone.')) return
    setDeleting(id)
    try {
      await api.deleteScenario(id)
      setSelected((prev) => prev.filter((x) => x !== id))
      setCompareData(null)
      await load(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete scenario')
    } finally {
      setDeleting(null)
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function runCompare() {
    if (!wsId || selected.length < 2) return
    setComparing(true)
    setCompareError(null)
    setCompareData(null)
    try {
      const res = await api.compareScenarios(wsId, { ids: selected.join(',') })
      const rows: Scenario[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.scenarios)
          ? res.scenarios
          : []
      setCompareData(rows)
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Failed to compare scenarios')
    } finally {
      setComparing(false)
    }
  }

  if (loading) return <PageSpinner label="Loading scenarios..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace before building consolidation scenarios."
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

  const maxCompareSavings = compareData
    ? Math.max(1, ...compareData.map((s) => num(s.modeled_savings)))
    : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Consolidation Scenarios</h1>
          <p className="mt-1 text-sm text-slate-400">
            Model supplier consolidation moves and compare projected savings side by side.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New Scenario</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Scenarios" value={scenarios.length} tone="cyan" />
        <Stat label="Total Modeled Savings" value={fmtMoney(totalModeled)} tone="green" />
        <Stat
          label="Top Scenario"
          value={bestScenario ? fmtMoney(bestScenario.modeled_savings) : '$0'}
          hint={bestScenario?.name}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search scenarios..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {selected.length} selected
            </span>
            <Button
              variant="secondary"
              disabled={selected.length < 2 || comparing}
              onClick={runCompare}
            >
              {comparing ? 'Comparing...' : 'Compare selected'}
            </Button>
            {selected.length > 0 && (
              <Button variant="ghost" onClick={() => { setSelected([]); setCompareData(null) }}>
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={scenarios.length === 0 ? 'No scenarios yet' : 'No matching scenarios'}
                description={
                  scenarios.length === 0
                    ? 'Create a scenario or convert a recommendation into one to start modeling savings.'
                    : 'Try adjusting your search or category filter.'
                }
                icon="📊"
                action={
                  scenarios.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>+ New Scenario</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10" />
                  <TH>Name</TH>
                  <TH>Category</TH>
                  <TH className="text-right">From → To</TH>
                  <TH className="text-right">Modeled Savings</TH>
                  <TH>Updated</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.includes(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="h-4 w-4 accent-cyan-500"
                        aria-label={`Select ${s.name}`}
                      />
                    </TD>
                    <TD>
                      <Link
                        href={`/dashboard/scenarios/${s.id}`}
                        className="font-medium text-cyan-300 hover:text-cyan-200"
                      >
                        {s.name}
                      </Link>
                    </TD>
                    <TD>
                      {s.category_id ? (
                        <Badge tone="slate">{catName.get(s.category_id) || 'Category'}</Badge>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-400">
                      {(s.from_supplier_ids?.length ?? 0)} → {(s.to_supplier_ids?.length ?? 0)}
                    </TD>
                    <TD className="text-right font-semibold tabular-nums text-emerald-300">
                      {fmtMoney(s.modeled_savings)}
                    </TD>
                    <TD className="text-slate-500">
                      {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/dashboard/scenarios/${s.id}`}>
                          <Button variant="ghost" className="px-2 py-1">Open</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-rose-400 hover:text-rose-300"
                          disabled={deleting === s.id}
                          onClick={() => handleDelete(s.id)}
                        >
                          {deleting === s.id ? '...' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {compareError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {compareError}
        </div>
      )}

      {compareData && compareData.length > 0 && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">
              Side-by-side comparison ({compareData.length})
            </h2>
            <Button variant="ghost" onClick={() => setCompareData(null)}>Dismiss</Button>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(compareData.length, 4)}, minmax(0, 1fr))` }}>
              {compareData.map((s) => {
                const sv = num(s.modeled_savings)
                const pct = Math.round((sv / maxCompareSavings) * 100)
                return (
                  <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="truncate text-sm font-semibold text-white" title={s.name}>{s.name}</div>
                    {s.category_id && (
                      <div className="mt-1 text-xs text-slate-500">{catName.get(s.category_id) || 'Category'}</div>
                    )}
                    <div className="mt-3 text-xl font-bold text-emerald-300">{fmtMoney(sv)}</div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <div>
                        <div className="text-slate-600">From</div>
                        <div className="font-medium text-slate-200">{s.from_supplier_ids?.length ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-slate-600">To</div>
                        <div className="font-medium text-slate-200">{s.to_supplier_ids?.length ?? 0}</div>
                      </div>
                    </div>
                    <Link href={`/dashboard/scenarios/${s.id}`} className="mt-3 block text-xs font-medium text-cyan-300 hover:text-cyan-200">
                      Open builder →
                    </Link>
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New consolidation scenario"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Create'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Consolidate office supplies"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Category (optional)</label>
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}
