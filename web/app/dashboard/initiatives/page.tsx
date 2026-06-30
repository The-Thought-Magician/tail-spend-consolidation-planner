'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Initiative {
  id: string
  workspace_id: string
  title: string
  description?: string | null
  category_id?: string | null
  scenario_id?: string | null
  owner_id?: string | null
  target_savings?: number | string | null
  status?: string | null
  start_date?: string | null
  due_date?: string | null
  created_at?: string
  updated_at?: string
}

interface Category {
  id: string
  name: string
  code?: string
}

interface Portfolio {
  total_target_savings?: number | string
  total_initiatives?: number
  by_status?: Record<string, number> | Array<{ status: string; count: number; target_savings?: number | string }>
  [key: string]: unknown
}

const STATUSES = ['proposed', 'approved', 'in_progress', 'completed', 'on_hold', 'cancelled']

const statusTone: Record<string, 'default' | 'cyan' | 'green' | 'amber' | 'rose' | 'slate' | 'violet'> = {
  proposed: 'slate',
  approved: 'cyan',
  in_progress: 'violet',
  completed: 'green',
  on_hold: 'amber',
  cancelled: 'rose',
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

function labelize(s?: string | null): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function InitiativesPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category_id: '',
    target_savings: '',
    status: 'proposed',
    start_date: '',
    due_date: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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
      const [i, c, p] = await Promise.all([
        api.listInitiatives(ws),
        api.listCategories(ws),
        api.getPortfolio(ws).catch(() => null),
      ])
      setInitiatives(Array.isArray(i) ? i : [])
      setCategories(Array.isArray(c) ? c : [])
      setPortfolio(p && typeof p === 'object' ? p : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load initiatives')
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
    return initiatives.filter((i) => {
      if (statusFilter && (i.status || '') !== statusFilter) return false
      if (q && !(i.title || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [initiatives, search, statusFilter])

  const totalTarget = useMemo(
    () => initiatives.reduce((acc, i) => acc + num(i.target_savings), 0),
    [initiatives],
  )

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>()
    initiatives.forEach((i) => {
      const s = i.status || 'proposed'
      m.set(s, (m.get(s) || 0) + 1)
    })
    return m
  }, [initiatives])

  const activeCount = useMemo(
    () => initiatives.filter((i) => ['approved', 'in_progress'].includes(i.status || '')).length,
    [initiatives],
  )

  const portfolioTarget = portfolio ? num(portfolio.total_target_savings) : 0

  async function handleCreate() {
    if (!wsId) return
    if (!form.title.trim()) {
      setFormError('Title is required')
      return
    }
    const session = await authClient.getSession().catch(() => null)
    setSaving(true)
    setFormError(null)
    try {
      await api.createInitiative({
        workspace_id: wsId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        target_savings: form.target_savings ? num(form.target_savings) : 0,
        status: form.status,
        owner_id: (session as { user?: { id?: string } } | null)?.user?.id ?? null,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      })
      setCreateOpen(false)
      setForm({ title: '', description: '', category_id: '', target_savings: '', status: 'proposed', start_date: '', due_date: '' })
      await load(wsId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create initiative')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!wsId) return
    if (!confirm('Delete this initiative? This cannot be undone.')) return
    setDeleting(id)
    try {
      await api.deleteInitiative(id)
      await load(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete initiative')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <PageSpinner label="Loading initiatives..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace before tracking consolidation initiatives."
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

  const maxStatusCount = Math.max(1, ...STATUSES.map((s) => statusCounts.get(s) || 0))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Initiative Portfolio</h1>
          <p className="mt-1 text-sm text-slate-400">
            Drive consolidation savings from idea to realized value. Track owners, due dates, and target savings.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New Initiative</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Initiatives" value={initiatives.length} tone="cyan" />
        <Stat
          label="Target Savings"
          value={fmtMoney(portfolio ? portfolioTarget : totalTarget)}
          tone="green"
          hint={portfolio ? 'From portfolio rollup' : undefined}
        />
        <Stat label="Active" value={activeCount} tone="cyan" hint="Approved + in progress" />
        <Stat label="Completed" value={statusCounts.get('completed') || 0} tone="amber" />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Status distribution</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          {STATUSES.map((s) => {
            const count = statusCounts.get(s) || 0
            const pct = Math.round((count / maxStatusCount) * 100)
            return (
              <div key={s} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-xs text-slate-400">{labelize(s)}</div>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-cyan-500/70"
                    style={{ width: `${count === 0 ? 0 : Math.max(pct, 4)}%` }}
                  />
                </div>
                <div className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-300">{count}</div>
              </div>
            )
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search initiatives..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{labelize(s)}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-slate-500">{filtered.length} of {initiatives.length}</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={initiatives.length === 0 ? 'No initiatives yet' : 'No matching initiatives'}
                description={
                  initiatives.length === 0
                    ? 'Create an initiative or convert a recommendation into one to start tracking savings delivery.'
                    : 'Try adjusting your search or status filter.'
                }
                icon="🎯"
                action={
                  initiatives.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>+ New Initiative</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Category</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Target Savings</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <Link
                        href={`/dashboard/initiatives/${i.id}`}
                        className="font-medium text-cyan-300 hover:text-cyan-200"
                      >
                        {i.title}
                      </Link>
                      {i.description && (
                        <div className="mt-0.5 max-w-md truncate text-xs text-slate-500">{i.description}</div>
                      )}
                    </TD>
                    <TD>
                      {i.category_id ? (
                        <Badge tone="slate">{catName.get(i.category_id) || 'Category'}</Badge>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={statusTone[i.status || 'proposed'] || 'slate'}>{labelize(i.status)}</Badge>
                    </TD>
                    <TD className="text-right font-semibold tabular-nums text-emerald-300">
                      {fmtMoney(i.target_savings)}
                    </TD>
                    <TD className="text-slate-500">
                      {i.due_date ? new Date(i.due_date).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/dashboard/initiatives/${i.id}`}>
                          <Button variant="ghost" className="px-2 py-1">Open</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-rose-400 hover:text-rose-300"
                          disabled={deleting === i.id}
                          onClick={() => handleDelete(i.id)}
                        >
                          {deleting === i.id ? '...' : 'Delete'}
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

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New consolidation initiative"
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Consolidate MRO suppliers in EMEA"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="What is the consolidation play and expected outcome?"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Category</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{labelize(s)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Target ($)</label>
              <input
                type="number"
                value={form.target_savings}
                onChange={(e) => setForm({ ...form, target_savings: e.target.value })}
                placeholder="0"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Start</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Due</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
