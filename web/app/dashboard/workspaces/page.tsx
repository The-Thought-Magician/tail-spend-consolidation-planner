'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Workspace = {
  id: string
  name: string
  base_currency?: string
  fiscal_year_start?: string
  tail_threshold_pct?: number
  owner_id?: string
  created_at?: string
}

type Member = {
  id: string
  workspace_id?: string
  user_id: string
  role?: string
  created_at?: string
}

const WS_ID_KEY = 'tscp_workspace_id'
const WS_NAME_KEY = 'tscp_workspace_name'

function readActiveId(): string | null {
  try {
    return localStorage.getItem(WS_ID_KEY)
  } catch {
    return null
  }
}

function setActive(ws: Workspace) {
  try {
    localStorage.setItem(WS_ID_KEY, ws.id)
    localStorage.setItem(WS_NAME_KEY, ws.name)
  } catch {
    /* ignore */
  }
}

export default function WorkspacesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Create / edit modal
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [tailThreshold, setTailThreshold] = useState('80')
  const [fyStart, setFyStart] = useState('01-01')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirm
  const [deleting, setDeleting] = useState<Workspace | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Members panel
  const [membersFor, setMembersFor] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [newMemberId, setNewMemberId] = useState('')
  const [newMemberRole, setNewMemberRole] = useState('member')
  const [memberBusy, setMemberBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.listWorkspaces()
      const rows: Workspace[] = Array.isArray(list) ? list : list?.workspaces ?? []
      setWorkspaces(rows)
      let current = readActiveId()
      // Auto-select first workspace if none active or active no longer exists.
      if (!current || !rows.some((w) => w.id === current)) {
        if (rows.length > 0) {
          setActive(rows[0])
          current = rows[0].id
        } else {
          current = null
        }
      }
      setActiveId(current)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setCurrency('USD')
    setTailThreshold('80')
    setFyStart('01-01')
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (ws: Workspace) => {
    setEditing(ws)
    setName(ws.name ?? '')
    setCurrency(ws.base_currency ?? 'USD')
    setTailThreshold(String(ws.tail_threshold_pct ?? 80))
    setFyStart(ws.fiscal_year_start ?? '01-01')
    setFormError('')
    setFormOpen(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError('')
    const body = {
      name: name.trim(),
      base_currency: currency.trim() || 'USD',
      tail_threshold_pct: Number(tailThreshold) || 80,
      fiscal_year_start: fyStart.trim() || '01-01',
    }
    try {
      if (editing) {
        const updated = await api.updateWorkspace(editing.id, body)
        if (activeId === editing.id) setActive({ ...editing, ...body, id: editing.id })
        setWorkspaces((prev) =>
          prev.map((w) => (w.id === editing.id ? { ...w, ...(updated || body) } : w)),
        )
      } else {
        const created: Workspace = await api.createWorkspace(body)
        setWorkspaces((prev) => [...prev, created])
        // First workspace becomes active automatically.
        if (!activeId) {
          setActive(created)
          setActiveId(created.id)
        }
      }
      setFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save workspace')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteWorkspace(deleting.id)
      const remaining = workspaces.filter((w) => w.id !== deleting.id)
      setWorkspaces(remaining)
      if (activeId === deleting.id) {
        if (remaining.length > 0) {
          setActive(remaining[0])
          setActiveId(remaining[0].id)
        } else {
          try {
            localStorage.removeItem(WS_ID_KEY)
            localStorage.removeItem(WS_NAME_KEY)
          } catch {
            /* ignore */
          }
          setActiveId(null)
        }
      }
      if (membersFor?.id === deleting.id) setMembersFor(null)
      setDeleting(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace')
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  const makeActive = (ws: Workspace) => {
    setActive(ws)
    setActiveId(ws.id)
  }

  const openMembers = async (ws: Workspace) => {
    setMembersFor(ws)
    setMembers([])
    setMembersError('')
    setNewMemberId('')
    setNewMemberRole('member')
    setMembersLoading(true)
    try {
      const list = await api.listMembers(ws.id)
      setMembers(Array.isArray(list) ? list : list?.members ?? [])
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load members')
    } finally {
      setMembersLoading(false)
    }
  }

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!membersFor || !newMemberId.trim()) return
    setMemberBusy(true)
    setMembersError('')
    try {
      const created: Member = await api.addMember(membersFor.id, {
        user_id: newMemberId.trim(),
        role: newMemberRole,
      })
      setMembers((prev) => [...prev, created])
      setNewMemberId('')
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setMemberBusy(false)
    }
  }

  const removeMember = async (m: Member) => {
    if (!membersFor) return
    try {
      await api.removeMember(membersFor.id, m.id)
      setMembers((prev) => prev.filter((x) => x.id !== m.id))
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  if (loading) return <PageSpinner label="Loading workspaces..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-500">
            Switch the active workspace and manage its members.
          </p>
        </div>
        <Button onClick={openCreate}>+ New workspace</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-5 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {workspaces.length === 0 ? (
        <EmptyState
          icon="▣"
          title="No workspaces yet"
          description="Create your first workspace to start consolidating tail spend."
          action={<Button onClick={openCreate}>Create workspace</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeId
            return (
              <Card
                key={ws.id}
                className={isActive ? 'border-cyan-500/50 ring-1 ring-cyan-500/30' : ''}
              >
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-white">{ws.name}</h3>
                        {isActive && <Badge tone="cyan">Active</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {ws.base_currency ?? 'USD'} · Tail threshold {ws.tail_threshold_pct ?? 80}%
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Fiscal year start</dt>
                      <dd className="text-slate-300">{ws.fiscal_year_start ?? '01-01'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Created</dt>
                      <dd className="text-slate-300">
                        {ws.created_at ? new Date(ws.created_at).toLocaleDateString() : '—'}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {!isActive && (
                      <Button variant="primary" className="px-3 py-1.5 text-xs" onClick={() => makeActive(ws)}>
                        Switch to
                      </Button>
                    )}
                    <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => openMembers(ws)}>
                      Members
                    </Button>
                    <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => openEdit(ws)}>
                      Edit
                    </Button>
                    <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => setDeleting(ws)}>
                      Delete
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {/* Members panel */}
      {membersFor && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Members · <span className="text-cyan-300">{membersFor.name}</span>
            </h2>
            <button
              className="text-slate-500 hover:text-white"
              onClick={() => setMembersFor(null)}
              aria-label="Close members"
            >
              ✕
            </button>
          </CardHeader>
          <CardBody className="space-y-4">
            <form onSubmit={addMember} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-400">User ID</label>
                <input
                  value={newMemberId}
                  onChange={(e) => setNewMemberId(e.target.value)}
                  placeholder="user_..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Role</label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                  <option value="viewer">viewer</option>
                </select>
              </div>
              <Button type="submit" disabled={memberBusy || !newMemberId.trim()}>
                {memberBusy ? 'Adding...' : 'Add member'}
              </Button>
            </form>

            {membersError && (
              <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
                {membersError}
              </div>
            )}

            {membersLoading ? (
              <Spinner label="Loading members..." className="py-6" />
            ) : members.length === 0 ? (
              <EmptyState title="No members" description="Add teammates by their user ID." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>User ID</TH>
                    <TH>Role</TH>
                    <TH>Added</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {members.map((m) => (
                    <TR key={m.id}>
                      <TD className="font-mono text-xs text-slate-200">{m.user_id}</TD>
                      <TD>
                        <Badge tone={m.role === 'owner' ? 'cyan' : 'slate'} className="capitalize">
                          {m.role ?? 'member'}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-slate-500">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                      </TD>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/30"
                          onClick={() => removeMember(m)}
                        >
                          Remove
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit workspace' : 'New workspace'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="ws-form" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <form id="ws-form" onSubmit={submitForm} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ACME Procurement"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Base currency</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder="USD"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Tail threshold %</label>
              <input
                type="number"
                min={1}
                max={99}
                value={tailThreshold}
                onChange={(e) => setTailThreshold(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Fiscal year start (MM-DD)</label>
            <input
              value={fyStart}
              onChange={(e) => setFyStart(e.target.value)}
              placeholder="01-01"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete workspace"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-white">{deleting?.name}</span> and all of its data?
          This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
