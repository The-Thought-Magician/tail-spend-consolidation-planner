'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
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

interface Milestone {
  id: string
  initiative_id: string
  title: string
  status?: string | null
  due_date?: string | null
  sort_order?: number
  created_at?: string
}

interface SavingsEntry {
  id: string
  initiative_id?: string | null
  period?: string | null
  type?: string | null
  target_amount?: number | string | null
  realized_amount?: number | string | null
  note?: string | null
  created_at?: string
}

interface Comment {
  id: string
  entity_type?: string
  entity_id?: string
  user_id?: string
  body: string
  created_at?: string
}

const STATUSES = ['proposed', 'approved', 'in_progress', 'completed', 'on_hold', 'cancelled']
const MILESTONE_STATUSES = ['pending', 'in_progress', 'done', 'blocked']

const statusTone: Record<string, 'default' | 'cyan' | 'green' | 'amber' | 'rose' | 'slate' | 'violet'> = {
  proposed: 'slate',
  approved: 'cyan',
  in_progress: 'violet',
  completed: 'green',
  on_hold: 'amber',
  cancelled: 'rose',
  pending: 'slate',
  done: 'green',
  blocked: 'rose',
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

export default function InitiativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [wsId, setWsId] = useState<string | null>(null)
  const [initiative, setInitiative] = useState<Initiative | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [savings, setSavings] = useState<SavingsEntry[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // edit initiative
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState({ title: '', description: '', status: 'proposed', target_savings: '', start_date: '', due_date: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // milestone add
  const [msOpen, setMsOpen] = useState(false)
  const [msForm, setMsForm] = useState({ title: '', due_date: '', status: 'pending' })
  const [savingMs, setSavingMs] = useState(false)
  const [msError, setMsError] = useState<string | null>(null)
  const [updatingMs, setUpdatingMs] = useState<string | null>(null)

  // savings add
  const [svOpen, setSvOpen] = useState(false)
  const [svForm, setSvForm] = useState({ period: '', type: 'target', target_amount: '', realized_amount: '', note: '' })
  const [savingSv, setSavingSv] = useState(false)
  const [svError, setSvError] = useState<string | null>(null)

  // comment add
  const [commentBody, setCommentBody] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWsId(localStorage.getItem('tscp_workspace_id'))
    }
  }, [])

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const detail = await api.getInitiative(id)
      const init: Initiative | null = detail?.initiative ?? (detail && detail.id ? detail : null)
      const ms: Milestone[] = Array.isArray(detail?.milestones) ? detail.milestones : []
      const sv: SavingsEntry[] = Array.isArray(detail?.savings) ? detail.savings : []
      setInitiative(init)
      // prefer dedicated endpoints for the live lists
      const [savingsList, commentList] = await Promise.all([
        api.listSavings(ws, { initiative_id: id }).catch(() => sv),
        api.listComments(ws, { entity_type: 'initiative', entity_id: id }).catch(() => []),
      ])
      setMilestones(ms.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      setSavings(Array.isArray(savingsList) && savingsList.length ? savingsList : sv)
      setComments(Array.isArray(commentList) ? commentList : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load initiative')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (wsId) load(wsId)
    else setLoading(false)
  }, [wsId, load])

  const totals = useMemo(() => {
    let target = 0
    let realized = 0
    for (const s of savings) {
      target += num(s.target_amount)
      realized += num(s.realized_amount)
    }
    const rate = target > 0 ? Math.round((realized / target) * 100) : 0
    return { target, realized, rate }
  }, [savings])

  const msProgress = useMemo(() => {
    if (milestones.length === 0) return 0
    const done = milestones.filter((m) => m.status === 'done').length
    return Math.round((done / milestones.length) * 100)
  }, [milestones])

  function openEdit() {
    if (!initiative) return
    setEdit({
      title: initiative.title || '',
      description: initiative.description || '',
      status: initiative.status || 'proposed',
      target_savings: initiative.target_savings != null ? String(num(initiative.target_savings)) : '',
      start_date: initiative.start_date ? initiative.start_date.slice(0, 10) : '',
      due_date: initiative.due_date ? initiative.due_date.slice(0, 10) : '',
    })
    setEditError(null)
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!wsId || !initiative) return
    if (!edit.title.trim()) {
      setEditError('Title is required')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      await api.updateInitiative(initiative.id, {
        title: edit.title.trim(),
        description: edit.description.trim() || null,
        status: edit.status,
        target_savings: edit.target_savings ? num(edit.target_savings) : 0,
        start_date: edit.start_date || null,
        due_date: edit.due_date || null,
      })
      setEditOpen(false)
      await load(wsId)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to update initiative')
    } finally {
      setSavingEdit(false)
    }
  }

  async function addMilestone() {
    if (!wsId || !initiative) return
    if (!msForm.title.trim()) {
      setMsError('Title is required')
      return
    }
    setSavingMs(true)
    setMsError(null)
    try {
      await api.addMilestone(initiative.id, {
        workspace_id: wsId,
        title: msForm.title.trim(),
        status: msForm.status,
        due_date: msForm.due_date || null,
        sort_order: milestones.length,
      })
      setMsOpen(false)
      setMsForm({ title: '', due_date: '', status: 'pending' })
      await load(wsId)
    } catch (e) {
      setMsError(e instanceof Error ? e.message : 'Failed to add milestone')
    } finally {
      setSavingMs(false)
    }
  }

  async function cycleMilestone(m: Milestone) {
    if (!wsId || !initiative) return
    const order = MILESTONE_STATUSES
    const cur = order.indexOf(m.status || 'pending')
    const next = order[(cur + 1) % order.length]
    setUpdatingMs(m.id)
    try {
      await api.updateMilestone(initiative.id, m.id, { status: next })
      setMilestones((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: next } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update milestone')
    } finally {
      setUpdatingMs(null)
    }
  }

  async function addSavings() {
    if (!wsId || !initiative) return
    if (!svForm.period.trim()) {
      setSvError('Period is required (e.g. 2026-Q1)')
      return
    }
    setSavingSv(true)
    setSvError(null)
    try {
      await api.createSavingsEntry({
        workspace_id: wsId,
        initiative_id: initiative.id,
        period: svForm.period.trim(),
        type: svForm.type,
        target_amount: svForm.target_amount ? num(svForm.target_amount) : 0,
        realized_amount: svForm.realized_amount ? num(svForm.realized_amount) : 0,
        note: svForm.note.trim() || null,
      })
      setSvOpen(false)
      setSvForm({ period: '', type: 'target', target_amount: '', realized_amount: '', note: '' })
      await load(wsId)
    } catch (e) {
      setSvError(e instanceof Error ? e.message : 'Failed to book savings entry')
    } finally {
      setSavingSv(false)
    }
  }

  async function postComment() {
    if (!wsId || !initiative) return
    const body = commentBody.trim()
    if (!body) return
    setPostingComment(true)
    setCommentError(null)
    try {
      await api.createComment({
        workspace_id: wsId,
        entity_type: 'initiative',
        entity_id: initiative.id,
        body,
      })
      setCommentBody('')
      const list = await api.listComments(wsId, { entity_type: 'initiative', entity_id: initiative.id })
      setComments(Array.isArray(list) ? list : [])
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPostingComment(false)
    }
  }

  if (loading) return <PageSpinner label="Loading initiative..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace first."
          icon="🗂️"
          action={<Link href="/dashboard/workspaces"><Button>Go to Workspaces</Button></Link>}
        />
      </div>
    )
  }

  if (error && !initiative) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/initiatives" className="text-sm text-cyan-300 hover:text-cyan-200">← Back to initiatives</Link>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      </div>
    )
  }

  if (!initiative) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/initiatives" className="text-sm text-cyan-300 hover:text-cyan-200">← Back to initiatives</Link>
        <EmptyState title="Initiative not found" description="It may have been deleted." icon="🎯" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/initiatives" className="text-sm text-cyan-300 hover:text-cyan-200">← Back to initiatives</Link>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{initiative.title}</h1>
            <Badge tone={statusTone[initiative.status || 'proposed'] || 'slate'}>{labelize(initiative.status)}</Badge>
          </div>
          {initiative.description && (
            <p className="mt-2 max-w-2xl text-sm text-stone-400">{initiative.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-stone-500">
            <span>Start: {initiative.start_date ? new Date(initiative.start_date).toLocaleDateString() : '—'}</span>
            <span>Due: {initiative.due_date ? new Date(initiative.due_date).toLocaleDateString() : '—'}</span>
            {initiative.scenario_id && (
              <Link href={`/dashboard/scenarios/${initiative.scenario_id}`} className="text-cyan-400 hover:text-cyan-300">
                Linked scenario →
              </Link>
            )}
          </div>
        </div>
        <Button variant="secondary" onClick={openEdit}>Edit</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Target Savings" value={fmtMoney(initiative.target_savings)} tone="cyan" />
        <Stat label="Booked Target" value={fmtMoney(totals.target)} tone="default" hint="Across ledger entries" />
        <Stat label="Realized" value={fmtMoney(totals.realized)} tone="green" />
        <Stat label="Realization" value={`${totals.rate}%`} tone="amber" hint={`${msProgress}% milestones done`} />
      </div>

      {/* Milestones */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Milestones</h2>
            <p className="text-xs text-stone-500">{msProgress}% complete · {milestones.length} total</p>
          </div>
          <Button variant="secondary" onClick={() => { setMsForm({ title: '', due_date: '', status: 'pending' }); setMsError(null); setMsOpen(true) }}>
            + Milestone
          </Button>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-stone-800">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${msProgress}%` }} />
          </div>
          {milestones.length === 0 ? (
            <EmptyState title="No milestones yet" description="Break the initiative into trackable steps." icon="🪜" />
          ) : (
            <ul className="divide-y divide-stone-800/70">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm ${m.status === 'done' ? 'text-stone-500 line-through' : 'text-stone-200'}`}>
                      {m.title}
                    </span>
                    {m.due_date && (
                      <span className="text-xs text-stone-600">due {new Date(m.due_date).toLocaleDateString()}</span>
                    )}
                  </div>
                  <button
                    onClick={() => cycleMilestone(m)}
                    disabled={updatingMs === m.id}
                    className="disabled:opacity-50"
                    title="Click to advance status"
                  >
                    <Badge tone={statusTone[m.status || 'pending'] || 'slate'}>
                      {updatingMs === m.id ? '...' : labelize(m.status)}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Savings */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Savings ledger</h2>
            <p className="text-xs text-stone-500">Target vs realized by period</p>
          </div>
          <Button variant="secondary" onClick={() => { setSvForm({ period: '', type: 'target', target_amount: '', realized_amount: '', note: '' }); setSvError(null); setSvOpen(true) }}>
            + Book savings
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {savings.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No savings booked yet" description="Record target and realized savings per period to track delivery." icon="💰" />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Target</TH>
                  <TH className="text-right">Realized</TH>
                  <TH>Note</TH>
                </TR>
              </THead>
              <TBody>
                {savings.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-stone-200">{s.period || '—'}</TD>
                    <TD><Badge tone={s.type === 'realized' ? 'green' : 'cyan'}>{labelize(s.type)}</Badge></TD>
                    <TD className="text-right tabular-nums text-stone-300">{fmtMoney(s.target_amount)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-emerald-300">{fmtMoney(s.realized_amount)}</TD>
                    <TD className="text-stone-500">{s.note || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Discussion</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex gap-2">
            <input
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment() } }}
              placeholder="Add a comment..."
              className="flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-cyan-500 focus:outline-none"
            />
            <Button onClick={postComment} disabled={postingComment || !commentBody.trim()}>
              {postingComment ? 'Posting...' : 'Post'}
            </Button>
          </div>
          {commentError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{commentError}</div>
          )}
          {comments.length === 0 ? (
            <p className="text-sm text-stone-500">No comments yet. Start the conversation.</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span className="font-medium text-stone-400">{c.user_id ? c.user_id.slice(0, 8) : 'User'}</span>
                    <span>{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-stone-200">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => !savingEdit && setEditOpen(false)}
        title="Edit initiative"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{editError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Title</label>
            <input
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Description</label>
            <textarea
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Status</label>
              <select
                value={edit.status}
                onChange={(e) => setEdit({ ...edit, status: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Target ($)</label>
              <input
                type="number"
                value={edit.target_savings}
                onChange={(e) => setEdit({ ...edit, target_savings: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Start</label>
              <input
                type="date"
                value={edit.start_date}
                onChange={(e) => setEdit({ ...edit, start_date: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Due</label>
              <input
                type="date"
                value={edit.due_date}
                onChange={(e) => setEdit({ ...edit, due_date: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Milestone modal */}
      <Modal
        open={msOpen}
        onClose={() => !savingMs && setMsOpen(false)}
        title="Add milestone"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMsOpen(false)} disabled={savingMs}>Cancel</Button>
            <Button onClick={addMilestone} disabled={savingMs}>{savingMs ? 'Adding...' : 'Add'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {msError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{msError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Title</label>
            <input
              value={msForm.title}
              onChange={(e) => setMsForm({ ...msForm, title: e.target.value })}
              placeholder="e.g. Sign master agreement"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Status</label>
              <select
                value={msForm.status}
                onChange={(e) => setMsForm({ ...msForm, status: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              >
                {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Due</label>
              <input
                type="date"
                value={msForm.due_date}
                onChange={(e) => setMsForm({ ...msForm, due_date: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Savings modal */}
      <Modal
        open={svOpen}
        onClose={() => !savingSv && setSvOpen(false)}
        title="Book savings entry"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSvOpen(false)} disabled={savingSv}>Cancel</Button>
            <Button onClick={addSavings} disabled={savingSv}>{savingSv ? 'Saving...' : 'Book'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {svError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{svError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Period</label>
              <input
                value={svForm.period}
                onChange={(e) => setSvForm({ ...svForm, period: e.target.value })}
                placeholder="2026-Q1"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Type</label>
              <select
                value={svForm.type}
                onChange={(e) => setSvForm({ ...svForm, type: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="target">Target</option>
                <option value="realized">Realized</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Target ($)</label>
              <input
                type="number"
                value={svForm.target_amount}
                onChange={(e) => setSvForm({ ...svForm, target_amount: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Realized ($)</label>
              <input
                type="number"
                value={svForm.realized_amount}
                onChange={(e) => setSvForm({ ...svForm, realized_amount: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Note</label>
            <input
              value={svForm.note}
              onChange={(e) => setSvForm({ ...svForm, note: e.target.value })}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
