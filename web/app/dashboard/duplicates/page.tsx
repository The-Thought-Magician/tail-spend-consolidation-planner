'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface DuplicateGroup {
  id: string
  category_id: string | null
  member_supplier_ids: string[] | null
  recommended_canonical_id: string | null
  similarity: number | string | null
  combined_spend: number | string | null
  status: string | null
  created_at: string
}

interface DuplicateCandidate {
  id: string
  group_id: string
  supplier_a_id: string
  supplier_b_id: string
  similarity: number | string | null
  signals: Record<string, unknown> | null
  decision: string | null
}

interface Supplier { id: string; name: string }

interface GroupDetail {
  group: DuplicateGroup
  candidates: DuplicateCandidate[]
  members: Supplier[]
}

const WS_KEY = 'tscp_workspace_id'
const GROUP_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed']

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}
function money(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function simPct(v: unknown): string {
  const n = num(v)
  const scaled = n > 0 && n <= 1 ? n * 100 : n
  return `${scaled.toFixed(0)}%`
}
function simTone(v: unknown): 'rose' | 'amber' | 'cyan' {
  const n = num(v)
  const scaled = n > 0 && n <= 1 ? n * 100 : n
  if (scaled >= 90) return 'rose'
  if (scaled >= 75) return 'amber'
  return 'cyan'
}
function statusTone(s: string | null): 'cyan' | 'green' | 'amber' | 'slate' {
  const v = (s || '').toLowerCase()
  if (v === 'resolved') return 'green'
  if (v === 'reviewing') return 'amber'
  if (v === 'open') return 'cyan'
  return 'slate'
}

export default function DuplicatesPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  useEffect(() => {
    try { setWsId(localStorage.getItem(WS_KEY)) } catch { setWsId(null) }
  }, [])

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getDuplicateGroups(ws)
      setGroups(Array.isArray(res) ? res : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load duplicate groups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) load(wsId)
    else setLoading(false)
  }, [wsId, load])

  async function runDetect() {
    if (!wsId) return
    setDetecting(true)
    setError(null)
    try {
      await api.detectDuplicates({ workspace_id: wsId })
      await load(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run detection')
    } finally {
      setDetecting(false)
    }
  }

  const loadDetail = useCallback(async (groupId: string) => {
    setOpenGroupId(groupId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const res = await api.getDuplicateGroup(groupId)
      setDetail(res as GroupDetail)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load group detail')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  function memberName(id: string): string {
    return detail?.members.find((m) => m.id === id)?.name ?? id.slice(0, 8)
  }

  async function decide(candidateId: string, decision: 'accept' | 'reject') {
    if (!openGroupId) return
    setBusyCandidate(candidateId)
    setDetailError(null)
    try {
      await api.decideDuplicateCandidate(candidateId, { decision })
      await loadDetail(openGroupId)
      if (wsId) load(wsId)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to record decision')
    } finally {
      setBusyCandidate(null)
    }
  }

  async function setGroupStatus(status: string) {
    if (!detail) return
    setUpdatingStatus(true)
    setDetailError(null)
    try {
      const updated = await api.updateDuplicateGroup(detail.group.id, { status })
      setDetail({ ...detail, group: { ...detail.group, ...(updated && typeof updated === 'object' ? updated : { status }) } })
      setGroups((prev) => prev.map((g) => (g.id === detail.group.id ? { ...g, status } : g)))
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to update group')
    } finally {
      setUpdatingStatus(false)
    }
  }

  async function setCanonical(supplierId: string) {
    if (!detail) return
    setUpdatingStatus(true)
    setDetailError(null)
    try {
      await api.updateDuplicateGroup(detail.group.id, { recommended_canonical_id: supplierId })
      setDetail({ ...detail, group: { ...detail.group, recommended_canonical_id: supplierId } })
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to set canonical supplier')
    } finally {
      setUpdatingStatus(false)
    }
  }

  const filtered = useMemo(
    () => groups.filter((g) => !statusFilter || (g.status || '') === statusFilter),
    [groups, statusFilter],
  )

  const stats = useMemo(() => ({
    total: groups.length,
    open: groups.filter((g) => (g.status || '').toLowerCase() === 'open').length,
    combinedSpend: groups.reduce((acc, g) => acc + num(g.combined_spend), 0),
    duplicateSuppliers: groups.reduce((acc, g) => acc + (g.member_supplier_ids?.length ?? 0), 0),
  }), [groups])

  if (!wsId && !loading) {
    return (
      <div className="space-y-6">
        <Header onDetect={() => {}} detecting={false} disabled />
        <EmptyState title="No workspace selected" description="Select a workspace to find duplicate suppliers." />
      </div>
    )
  }

  if (loading) return <PageSpinner label="Loading duplicate groups..." />

  return (
    <div className="space-y-6">
      <Header onDetect={runDetect} detecting={detecting} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duplicate Groups" value={stats.total} tone="cyan" />
        <Stat label="Open Groups" value={stats.open} tone="amber" />
        <Stat label="Suppliers Flagged" value={stats.duplicateSuppliers} tone="rose" />
        <Stat label="Combined Spend" value={money(stats.combinedSpend)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-white">Duplicate Groups</h2>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">All statuses</option>
              {GROUP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-slate-500">{filtered.length} of {groups.length}</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={groups.length === 0 ? 'No duplicate groups' : 'No matching groups'}
                description={groups.length === 0 ? 'Run fuzzy detection to find likely-duplicate suppliers across your master.' : 'Adjust the status filter.'}
                action={groups.length === 0 ? <Button onClick={runDetect} disabled={detecting}>{detecting ? 'Detecting...' : 'Run detection'}</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Members</TH>
                  <TH className="text-right">Suppliers</TH>
                  <TH className="text-right">Similarity</TH>
                  <TH className="text-right">Combined Spend</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Review</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((g) => (
                  <TR key={g.id}>
                    <TD className="font-mono text-xs text-slate-400">{g.id.slice(0, 8)}</TD>
                    <TD className="text-right tabular-nums">{g.member_supplier_ids?.length ?? 0}</TD>
                    <TD className="text-right"><Badge tone={simTone(g.similarity)}>{simPct(g.similarity)}</Badge></TD>
                    <TD className="text-right tabular-nums text-slate-100">{money(g.combined_spend)}</TD>
                    <TD><Badge tone={statusTone(g.status)}>{g.status || 'open'}</Badge></TD>
                    <TD className="text-right">
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => loadDetail(g.id)}>Review</Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={openGroupId != null}
        onClose={() => { setOpenGroupId(null); setDetail(null) }}
        title="Duplicate group review"
        className="max-w-3xl"
      >
        {detailLoading ? (
          <div className="py-8"><PageSpinner label="Loading group..." /></div>
        ) : detailError && !detail ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{detailError}</div>
        ) : detail ? (
          <div className="space-y-5">
            {detailError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{detailError}</div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={simTone(detail.group.similarity)}>Similarity {simPct(detail.group.similarity)}</Badge>
              <span className="text-sm text-slate-400">Combined spend {money(detail.group.combined_spend)}</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500">Status</span>
                <select
                  value={detail.group.status || 'open'}
                  onChange={(e) => setGroupStatus(e.target.value)}
                  disabled={updatingStatus}
                  className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  {GROUP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Members</h3>
              <div className="flex flex-wrap gap-2">
                {detail.members.length === 0 && <span className="text-sm text-slate-600">No members</span>}
                {detail.members.map((m) => {
                  const isCanonical = detail.group.recommended_canonical_id === m.id
                  return (
                    <button
                      key={m.id}
                      onClick={() => setCanonical(m.id)}
                      disabled={updatingStatus}
                      title={isCanonical ? 'Recommended canonical supplier' : 'Set as canonical supplier'}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        isCanonical
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {isCanonical && <span aria-hidden>★</span>}
                      {m.name}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-slate-600">Click a member to set it as the recommended canonical supplier.</p>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Candidate pairs</h3>
              {detail.candidates.length === 0 ? (
                <EmptyState title="No candidate pairs" />
              ) : (
                <div className="max-h-[40vh] overflow-y-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Pair</TH>
                        <TH className="text-right">Similarity</TH>
                        <TH>Decision</TH>
                        <TH className="text-right">Action</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {detail.candidates.map((c) => (
                        <TR key={c.id}>
                          <TD className="text-slate-200">
                            {memberName(c.supplier_a_id)} <span className="text-slate-600">↔</span> {memberName(c.supplier_b_id)}
                          </TD>
                          <TD className="text-right"><Badge tone={simTone(c.similarity)}>{simPct(c.similarity)}</Badge></TD>
                          <TD>
                            {c.decision
                              ? <Badge tone={c.decision === 'accept' ? 'green' : 'rose'}>{c.decision}</Badge>
                              : <span className="text-slate-600">pending</span>}
                          </TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="primary"
                                className="px-2 py-1 text-xs"
                                disabled={busyCandidate === c.id || c.decision === 'accept'}
                                onClick={() => decide(c.id, 'accept')}
                              >
                                {busyCandidate === c.id ? '...' : 'Accept'}
                              </Button>
                              <Button
                                variant="danger"
                                className="px-2 py-1 text-xs"
                                disabled={busyCandidate === c.id || c.decision === 'reject'}
                                onClick={() => decide(c.id, 'reject')}
                              >
                                Reject
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-600">Accepting a pair records an alias and a merge recommendation toward the canonical supplier.</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function Header({ onDetect, detecting, disabled }: { onDetect: () => void; detecting: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-white">Duplicate Suppliers</h1>
        <p className="mt-1 text-sm text-slate-500">Fuzzy-matched supplier groups. Accept or reject pairs to consolidate your master.</p>
      </div>
      <Button onClick={onDetect} disabled={disabled || detecting}>{detecting ? 'Detecting...' : 'Run detection'}</Button>
    </div>
  )
}
