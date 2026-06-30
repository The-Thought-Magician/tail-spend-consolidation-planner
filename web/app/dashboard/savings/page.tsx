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

interface SavingsEntry {
  id: string
  workspace_id?: string
  initiative_id?: string | null
  period?: string | null
  type?: string | null
  target_amount?: number | string | null
  realized_amount?: number | string | null
  note?: string | null
  created_at?: string
}

interface WaterfallStage {
  stage?: string
  label?: string
  amount?: number | string
  value?: number | string
}

interface RealizationRow {
  key?: string
  label?: string
  name?: string
  target?: number | string
  target_amount?: number | string
  realized?: number | string
  realized_amount?: number | string
  rate?: number | string
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

const REALIZATION_DIMS = ['initiative', 'category', 'owner']

export default function SavingsPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [entries, setEntries] = useState<SavingsEntry[]>([])
  const [waterfall, setWaterfall] = useState<WaterfallStage[]>([])
  const [realization, setRealization] = useState<RealizationRow[]>([])
  const [realizationBy, setRealizationBy] = useState('initiative')
  const [loading, setLoading] = useState(true)
  const [realizationLoading, setRealizationLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ period: '', type: 'target', target_amount: '', realized_amount: '', note: '', initiative_id: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [editEntry, setEditEntry] = useState<SavingsEntry | null>(null)
  const [editForm, setEditForm] = useState({ period: '', type: 'target', target_amount: '', realized_amount: '', note: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

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
      const [e, w, r] = await Promise.all([
        api.listSavings(ws),
        api.getSavingsWaterfall(ws).catch(() => null),
        api.getSavingsRealization(ws, { by: 'initiative' }).catch(() => null),
      ])
      setEntries(Array.isArray(e) ? e : [])
      const stages = Array.isArray(w) ? w : Array.isArray(w?.stages) ? w.stages : []
      setWaterfall(stages)
      const rows = Array.isArray(r) ? r : Array.isArray(r?.rows) ? r.rows : []
      setRealization(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load savings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) load(wsId)
    else setLoading(false)
  }, [wsId, load])

  const loadRealization = useCallback(async (ws: string, by: string) => {
    setRealizationLoading(true)
    try {
      const r = await api.getSavingsRealization(ws, { by })
      const rows = Array.isArray(r) ? r : Array.isArray(r?.rows) ? r.rows : []
      setRealization(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load realization')
    } finally {
      setRealizationLoading(false)
    }
  }, [])

  function changeRealizationBy(by: string) {
    setRealizationBy(by)
    if (wsId) loadRealization(wsId, by)
  }

  const totals = useMemo(() => {
    let target = 0
    let realized = 0
    for (const e of entries) {
      target += num(e.target_amount)
      realized += num(e.realized_amount)
    }
    const gap = target - realized
    const rate = target > 0 ? Math.round((realized / target) * 100) : 0
    return { target, realized, gap, rate }
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (typeFilter && (e.type || '') !== typeFilter) return false
      if (q && !(e.period || '').toLowerCase().includes(q) && !(e.note || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, search, typeFilter])

  // build waterfall: fall back to deriving from entries if endpoint empty
  const waterfallStages = useMemo(() => {
    if (waterfall.length > 0) {
      return waterfall.map((s) => ({
        label: labelize(s.label || s.stage || ''),
        amount: num(s.amount ?? s.value),
      }))
    }
    return [
      { label: 'Target', amount: totals.target },
      { label: 'Realized', amount: totals.realized },
    ]
  }, [waterfall, totals])

  const maxWaterfall = Math.max(1, ...waterfallStages.map((s) => s.amount))

  async function handleCreate() {
    if (!wsId) return
    if (!form.period.trim()) {
      setFormError('Period is required (e.g. 2026-Q1)')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createSavingsEntry({
        workspace_id: wsId,
        initiative_id: form.initiative_id.trim() || null,
        period: form.period.trim(),
        type: form.type,
        target_amount: form.target_amount ? num(form.target_amount) : 0,
        realized_amount: form.realized_amount ? num(form.realized_amount) : 0,
        note: form.note.trim() || null,
      })
      setCreateOpen(false)
      setForm({ period: '', type: 'target', target_amount: '', realized_amount: '', note: '', initiative_id: '' })
      await load(wsId)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to book savings entry')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(e: SavingsEntry) {
    setEditEntry(e)
    setEditForm({
      period: e.period || '',
      type: e.type || 'target',
      target_amount: e.target_amount != null ? String(num(e.target_amount)) : '',
      realized_amount: e.realized_amount != null ? String(num(e.realized_amount)) : '',
      note: e.note || '',
    })
    setEditError(null)
  }

  async function saveEdit() {
    if (!wsId || !editEntry) return
    if (!editForm.period.trim()) {
      setEditError('Period is required')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      await api.updateSavingsEntry(editEntry.id, {
        period: editForm.period.trim(),
        type: editForm.type,
        target_amount: editForm.target_amount ? num(editForm.target_amount) : 0,
        realized_amount: editForm.realized_amount ? num(editForm.realized_amount) : 0,
        note: editForm.note.trim() || null,
      })
      setEditEntry(null)
      await load(wsId)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update entry')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete(id: string) {
    if (!wsId) return
    if (!confirm('Delete this savings entry?')) return
    setDeleting(id)
    try {
      await api.deleteSavingsEntry(id)
      await load(wsId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <PageSpinner label="Loading savings..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace before tracking savings realization."
          icon="🗂️"
          action={<Link href="/dashboard/workspaces"><Button>Go to Workspaces</Button></Link>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Savings Tracking</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track identified savings through approval to realized value, and measure realization rate.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Book Savings</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Target" value={fmtMoney(totals.target)} tone="cyan" />
        <Stat label="Realized" value={fmtMoney(totals.realized)} tone="green" />
        <Stat label="Gap" value={fmtMoney(totals.gap)} tone="amber" hint="Target minus realized" />
        <Stat label="Realization Rate" value={`${totals.rate}%`} tone="default" />
      </div>

      {/* Waterfall */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Savings waterfall</h2>
          <p className="text-xs text-slate-500">Target vs realized progression</p>
        </CardHeader>
        <CardBody className="space-y-3">
          {waterfallStages.map((s, idx) => {
            const pct = Math.round((s.amount / maxWaterfall) * 100)
            const isLast = idx === waterfallStages.length - 1
            return (
              <div key={`${s.label}-${idx}`} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-xs text-slate-400">{s.label}</div>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-800/60">
                  <div
                    className={`h-full rounded-md ${isLast ? 'bg-emerald-400' : 'bg-cyan-500/70'}`}
                    style={{ width: `${s.amount === 0 ? 0 : Math.max(pct, 2)}%` }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right text-sm tabular-nums text-slate-200">{fmtMoney(s.amount)}</div>
              </div>
            )
          })}
        </CardBody>
      </Card>

      {/* Realization by dimension */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Realization rate</h2>
            <p className="text-xs text-slate-500">Realized as % of target, grouped by {realizationBy}</p>
          </div>
          <div className="flex gap-1">
            {REALIZATION_DIMS.map((d) => (
              <Button
                key={d}
                variant={realizationBy === d ? 'primary' : 'ghost'}
                className="px-3 py-1"
                onClick={() => changeRealizationBy(d)}
                disabled={realizationLoading}
              >
                {labelize(d)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {realizationLoading ? (
            <div className="py-6"><PageSpinner label="Loading..." /></div>
          ) : realization.length === 0 ? (
            <EmptyState title="No realization data" description="Book target and realized savings to populate this view." icon="📈" />
          ) : (
            <div className="space-y-3">
              {realization.map((r, idx) => {
                const target = num(r.target ?? r.target_amount)
                const realized = num(r.realized ?? r.realized_amount)
                const rate = r.rate != null ? num(r.rate) : target > 0 ? Math.round((realized / target) * 100) : 0
                const clamped = Math.max(0, Math.min(100, rate))
                const tone = clamped >= 80 ? 'bg-emerald-400' : clamped >= 50 ? 'bg-cyan-500/80' : 'bg-amber-400'
                return (
                  <div key={`${r.key || r.label || r.name || idx}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{r.label || r.name || r.key || `Row ${idx + 1}`}</span>
                      <span className="tabular-nums text-slate-400">
                        {fmtMoney(realized)} / {fmtMoney(target)} · {clamped}%
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Ledger table */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search period or note..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">All types</option>
              <option value="target">Target</option>
              <option value="realized">Realized</option>
            </select>
          </div>
          <span className="text-xs text-slate-500">{filtered.length} of {entries.length}</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={entries.length === 0 ? 'No savings booked yet' : 'No matching entries'}
                description={
                  entries.length === 0
                    ? 'Book a target or realized savings entry to start tracking delivery.'
                    : 'Try adjusting your search or type filter.'
                }
                icon="💰"
                action={entries.length === 0 ? <Button onClick={() => setCreateOpen(true)}>+ Book Savings</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Type</TH>
                  <TH>Initiative</TH>
                  <TH className="text-right">Target</TH>
                  <TH className="text-right">Realized</TH>
                  <TH>Note</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-medium text-slate-200">{e.period || '—'}</TD>
                    <TD><Badge tone={e.type === 'realized' ? 'green' : 'cyan'}>{labelize(e.type)}</Badge></TD>
                    <TD>
                      {e.initiative_id ? (
                        <Link href={`/dashboard/initiatives/${e.initiative_id}`} className="text-cyan-300 hover:text-cyan-200">
                          {e.initiative_id.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-300">{fmtMoney(e.target_amount)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-emerald-300">{fmtMoney(e.realized_amount)}</TD>
                    <TD className="text-slate-500">{e.note || '—'}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(e)}>Edit</Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-rose-400 hover:text-rose-300"
                          disabled={deleting === e.id}
                          onClick={() => handleDelete(e.id)}
                        >
                          {deleting === e.id ? '...' : 'Delete'}
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="Book savings entry"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Saving...' : 'Book'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Period</label>
              <input
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="2026-Q1"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="target">Target</option>
                <option value="realized">Realized</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Target ($)</label>
              <input
                type="number"
                value={form.target_amount}
                onChange={(e) => setForm({ ...form, target_amount: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Realized ($)</label>
              <input
                type="number"
                value={form.realized_amount}
                onChange={(e) => setForm({ ...form, realized_amount: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Initiative ID (optional)</label>
            <input
              value={form.initiative_id}
              onChange={(e) => setForm({ ...form, initiative_id: e.target.value })}
              placeholder="Link to an initiative"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Note</label>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={editEntry != null}
        onClose={() => !savingEdit && setEditEntry(null)}
        title="Edit savings entry"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditEntry(null)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{editError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Period</label>
              <input
                value={editForm.period}
                onChange={(e) => setEditForm({ ...editForm, period: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Type</label>
              <select
                value={editForm.type}
                onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="target">Target</option>
                <option value="realized">Realized</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Target ($)</label>
              <input
                type="number"
                value={editForm.target_amount}
                onChange={(e) => setEditForm({ ...editForm, target_amount: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Realized ($)</label>
              <input
                type="number"
                value={editForm.realized_amount}
                onChange={(e) => setEditForm({ ...editForm, realized_amount: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Note</label>
            <input
              value={editForm.note}
              onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
