'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Supplier {
  id: string
  name: string
  normalized_name?: string
  category_id?: string | null
  status?: string | null
  country?: string | null
  domain?: string | null
  tax_id?: string | null
  spend?: number
  txn_count?: number
}
interface Category {
  id: string
  name: string
  code?: string
}

function useWorkspaceId() {
  const [ws, setWs] = useState<string | null>(null)
  useEffect(() => {
    try {
      setWs(localStorage.getItem('tscp_workspace_id'))
    } catch {
      setWs(null)
    }
  }, [])
  return ws
}

function money(n: unknown) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function statusTone(s?: string | null): 'green' | 'amber' | 'slate' {
  if (s === 'active') return 'green'
  if (s === 'inactive' || s === 'blocked') return 'amber'
  return 'slate'
}

export default function SuppliersPage() {
  const ws = useWorkspaceId()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [top, setTop] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // filters
  const [q, setQ] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [topBy, setTopBy] = useState<'spend' | 'txn_count'>('spend')

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', category_id: '', country: '', domain: '', tax_id: '' })

  const catName = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.id, c.name))
    return m
  }, [categories])

  const loadSuppliers = useCallback(async () => {
    if (!ws) return
    const params: Record<string, unknown> = {}
    if (q.trim()) params.q = q.trim()
    if (categoryFilter) params.category_id = categoryFilter
    const rows = await api.listSuppliers(ws, params)
    setSuppliers(Array.isArray(rows) ? rows : rows?.rows || [])
  }, [ws, q, categoryFilter])

  const loadTop = useCallback(async () => {
    if (!ws) return
    const rows = await api.getTopSuppliers(ws, { by: topBy, limit: 10 })
    setTop(Array.isArray(rows) ? rows : rows?.rows || [])
  }, [ws, topBy])

  const loadAll = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [cats] = await Promise.all([api.listCategories(ws)])
      setCategories(Array.isArray(cats) ? cats : cats?.rows || [])
      await Promise.all([loadSuppliers(), loadTop()])
    } catch (e: any) {
      setError(e?.message || 'Failed to load suppliers')
    } finally {
      setLoading(false)
    }
  }, [ws, loadSuppliers, loadTop])

  useEffect(() => {
    if (ws !== null) loadAll()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws])

  // re-run filtered list when filters change (after initial load)
  useEffect(() => {
    if (!ws || loading) return
    loadSuppliers().catch((e: any) => setError(e?.message || 'Failed to filter suppliers'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, categoryFilter])

  useEffect(() => {
    if (!ws || loading) return
    loadTop().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topBy])

  const create = async () => {
    if (!ws || !form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.createSupplier({
        workspace_id: ws,
        name: form.name.trim(),
        category_id: form.category_id || null,
        country: form.country.trim() || null,
        domain: form.domain.trim() || null,
        tax_id: form.tax_id.trim() || null,
      })
      setCreateOpen(false)
      setForm({ name: '', category_id: '', country: '', domain: '', tax_id: '' })
      await Promise.all([loadSuppliers(), loadTop()])
    } catch (e: any) {
      setError(e?.message || 'Failed to create supplier')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: Supplier) => {
    if (!confirm(`Delete supplier "${s.name}"? Transactions referencing it will lose their link.`)) return
    setError('')
    try {
      await api.deleteSupplier(s.id)
      await Promise.all([loadSuppliers(), loadTop()])
    } catch (e: any) {
      setError(e?.message || 'Failed to delete supplier')
    }
  }

  const totalSpend = useMemo(
    () => suppliers.reduce((a, s) => a + Number(s.spend || 0), 0),
    [suppliers],
  )
  const activeCount = useMemo(
    () => suppliers.filter((s) => (s.status ?? 'active') === 'active').length,
    [suppliers],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Suppliers</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your supplier master. Search, classify, and merge duplicates to shrink the long tail.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!ws}>
          + New Supplier
        </Button>
      </div>

      {!ws && (
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace, then seed sample data to populate suppliers."
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to Workspaces</Button>
            </Link>
          }
        />
      )}

      {ws && (
        <>
          {error && (
            <div className="rounded-lg border border-rose-700 bg-rose-900/30 p-3 text-sm text-rose-300">{error}</div>
          )}

          {loading ? (
            <PageSpinner label="Loading suppliers..." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Suppliers" value={suppliers.length.toLocaleString()} tone="cyan" />
                <Stat label="Active" value={activeCount.toLocaleString()} tone="green" />
                <Stat label="Categories" value={categories.length.toLocaleString()} />
                <Stat label="Total Spend" value={money(totalSpend)} />
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                {/* Master list */}
                <Card className="lg:col-span-2">
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-base font-semibold text-white">Supplier master</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search name..."
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="">All categories</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </CardHeader>
                  <CardBody className="p-0">
                    {suppliers.length === 0 ? (
                      <div className="p-6">
                        <EmptyState
                          title="No suppliers found"
                          description={q || categoryFilter ? 'Try clearing your filters.' : 'Create a supplier or seed sample data.'}
                          action={
                            !q && !categoryFilter ? (
                              <Link href="/dashboard/sample-data">
                                <Button variant="secondary">Seed Sample Data</Button>
                              </Link>
                            ) : undefined
                          }
                        />
                      </div>
                    ) : (
                      <Table>
                        <THead>
                          <TR>
                            <TH>Supplier</TH>
                            <TH>Category</TH>
                            <TH>Status</TH>
                            <TH className="text-right">Spend</TH>
                            <TH className="text-right">Txns</TH>
                            <TH className="text-right">Actions</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {suppliers.map((s) => (
                            <TR key={s.id}>
                              <TD>
                                <Link
                                  href={`/dashboard/suppliers/${s.id}`}
                                  className="font-medium text-cyan-300 hover:text-cyan-200"
                                >
                                  {s.name}
                                </Link>
                                {s.country && <span className="ml-2 text-xs text-slate-500">{s.country}</span>}
                              </TD>
                              <TD className="text-slate-400">
                                {s.category_id ? catName.get(s.category_id) || '—' : '—'}
                              </TD>
                              <TD>
                                <Badge tone={statusTone(s.status)}>{s.status ?? 'active'}</Badge>
                              </TD>
                              <TD className="text-right">{money(s.spend)}</TD>
                              <TD className="text-right text-slate-400">{Number(s.txn_count || 0).toLocaleString()}</TD>
                              <TD className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Link href={`/dashboard/suppliers/${s.id}`}>
                                    <Button variant="ghost" className="px-2 py-1 text-xs">
                                      View
                                    </Button>
                                  </Link>
                                  <Button variant="ghost" className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300" onClick={() => remove(s)}>
                                    Delete
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

                {/* Top suppliers */}
                <Card>
                  <CardHeader className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Top suppliers</h2>
                    <select
                      value={topBy}
                      onChange={(e) => setTopBy(e.target.value as 'spend' | 'txn_count')}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="spend">By spend</option>
                      <option value="txn_count">By txn count</option>
                    </select>
                  </CardHeader>
                  <CardBody>
                    {top.length === 0 ? (
                      <p className="text-sm text-slate-500">No data yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {(() => {
                          const max = Math.max(
                            ...top.map((s) => Number(topBy === 'spend' ? s.spend : s.txn_count) || 0),
                            1,
                          )
                          return top.map((s, i) => {
                            const val = Number(topBy === 'spend' ? s.spend : s.txn_count) || 0
                            return (
                              <div key={s.id} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <Link
                                    href={`/dashboard/suppliers/${s.id}`}
                                    className="truncate text-slate-200 hover:text-cyan-300"
                                  >
                                    <span className="mr-1.5 text-slate-600">{i + 1}.</span>
                                    {s.name}
                                  </Link>
                                  <span className="shrink-0 font-medium text-slate-300">
                                    {topBy === 'spend' ? money(val) : val.toLocaleString()}
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                  <div
                                    className="h-full rounded-full bg-cyan-500"
                                    style={{ width: `${Math.max((val / max) * 100, 3)}%` }}
                                  />
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    )}
                  </CardBody>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New Supplier"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={create} disabled={saving || !form.name.trim()}>
              {saving ? <Spinner /> : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
              placeholder="Acme Office Supplies"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Category</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Country</label>
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                placeholder="US"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Domain</label>
              <input
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                placeholder="acme.com"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Tax ID</label>
            <input
              value={form.tax_id}
              onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
              placeholder="optional"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
