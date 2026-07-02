'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
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
  parent_supplier_id?: string | null
  status?: string | null
  country?: string | null
  domain?: string | null
  tax_id?: string | null
}
interface Stats {
  spend?: number
  txn_count?: number
  po_count?: number
  invoice_count?: number
  contract_coverage?: number
  categories?: { id: string; name: string; spend?: number }[]
  [k: string]: unknown
}
interface Alias {
  id: string
  raw_name: string
  source?: string | null
  created_at?: string
}
interface Comment {
  id: string
  body: string
  user_id?: string
  created_at?: string
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
function pct(n: unknown) {
  const v = Number(n || 0)
  return `${(v <= 1 ? v * 100 : v).toFixed(0)}%`
}
function statusTone(s?: string | null): 'green' | 'amber' | 'slate' {
  if (s === 'active') return 'green'
  if (s === 'inactive' || s === 'blocked') return 'amber'
  return 'slate'
}
function fmtDate(s?: string) {
  if (!s) return ''
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

export default function SupplierDetailPage() {
  const ws = useWorkspaceId()
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [stats, setStats] = useState<Stats>({})
  const [aliases, setAliases] = useState<Alias[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // edit
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState({ name: '', status: 'active', country: '', domain: '', tax_id: '' })
  const [savingEdit, setSavingEdit] = useState(false)

  // alias
  const [aliasInput, setAliasInput] = useState('')
  const [addingAlias, setAddingAlias] = useState(false)

  // merge
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeIds, setMergeIds] = useState<string[]>([])
  const [merging, setMerging] = useState(false)

  // comment
  const [commentInput, setCommentInput] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  useEffect(() => {
    authClient.getSession().then((s) => setUserId(s?.data?.user?.id ?? null)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const sup = await api.getSupplier(id)
      // shape: {supplier, stats} or a flat supplier
      const s: Supplier = sup?.supplier ?? sup
      setSupplier(s)
      setStats(sup?.stats ?? {})
      setEdit({
        name: s?.name ?? '',
        status: s?.status ?? 'active',
        country: s?.country ?? '',
        domain: s?.domain ?? '',
        tax_id: s?.tax_id ?? '',
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to load supplier')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadAliases = useCallback(async () => {
    if (!ws || !id) return
    try {
      const rows = await api.listAliases(ws, { supplier_id: id })
      setAliases(Array.isArray(rows) ? rows : rows?.rows || [])
    } catch {
      /* ignore */
    }
  }, [ws, id])

  const loadComments = useCallback(async () => {
    if (!ws || !id) return
    try {
      const rows = await api.listComments(ws, { entity_type: 'supplier', entity_id: id })
      setComments(Array.isArray(rows) ? rows : rows?.rows || [])
    } catch {
      /* ignore */
    }
  }, [ws, id])

  const loadAllSuppliers = useCallback(async () => {
    if (!ws) return
    try {
      const rows = await api.listSuppliers(ws, {})
      setAllSuppliers(Array.isArray(rows) ? rows : rows?.rows || [])
    } catch {
      /* ignore */
    }
  }, [ws])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (ws) {
      loadAliases()
      loadComments()
      loadAllSuppliers()
    }
  }, [ws, loadAliases, loadComments, loadAllSuppliers])

  const saveEdit = async () => {
    if (!id) return
    setSavingEdit(true)
    setError('')
    try {
      await api.updateSupplier(id, {
        name: edit.name.trim(),
        status: edit.status,
        country: edit.country.trim() || null,
        domain: edit.domain.trim() || null,
        tax_id: edit.tax_id.trim() || null,
      })
      setEditOpen(false)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to update supplier')
    } finally {
      setSavingEdit(false)
    }
  }

  const addAlias = async () => {
    if (!ws || !id || !aliasInput.trim()) return
    setAddingAlias(true)
    setError('')
    try {
      await api.createAlias({ workspace_id: ws, supplier_id: id, raw_name: aliasInput.trim(), source: 'manual' })
      setAliasInput('')
      await loadAliases()
    } catch (e: any) {
      setError(e?.message || 'Failed to add alias')
    } finally {
      setAddingAlias(false)
    }
  }

  const removeAlias = async (aliasId: string) => {
    setError('')
    try {
      await api.deleteAlias(aliasId)
      await loadAliases()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete alias')
    }
  }

  const doMerge = async () => {
    if (!id || mergeIds.length === 0) return
    if (!confirm(`Merge ${mergeIds.length} supplier(s) into "${supplier?.name}"? Their transactions and aliases will be repointed here.`)) return
    setMerging(true)
    setError('')
    try {
      await api.mergeSuppliers(id, { supplier_ids: mergeIds })
      setMergeOpen(false)
      setMergeIds([])
      await Promise.all([load(), loadAliases(), loadAllSuppliers()])
    } catch (e: any) {
      setError(e?.message || 'Failed to merge suppliers')
    } finally {
      setMerging(false)
    }
  }

  const postComment = async () => {
    if (!ws || !id || !commentInput.trim()) return
    setPostingComment(true)
    setError('')
    try {
      await api.createComment({
        workspace_id: ws,
        entity_type: 'supplier',
        entity_id: id,
        body: commentInput.trim(),
      })
      setCommentInput('')
      await loadComments()
    } catch (e: any) {
      setError(e?.message || 'Failed to post comment')
    } finally {
      setPostingComment(false)
    }
  }

  const mergeCandidates = useMemo(
    () => allSuppliers.filter((s) => s.id !== id),
    [allSuppliers, id],
  )

  const toggleMergeId = (sid: string) => {
    setMergeIds((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]))
  }

  if (loading) return <PageSpinner label="Loading supplier..." />

  if (error && !supplier) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/suppliers" className="text-sm text-cyan-400 hover:text-cyan-300">
          ← Back to suppliers
        </Link>
        <EmptyState title="Could not load supplier" description={error} />
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/suppliers" className="text-sm text-cyan-400 hover:text-cyan-300">
          ← Back to suppliers
        </Link>
        <EmptyState title="Supplier not found" />
      </div>
    )
  }

  const catList = (stats.categories || []) as { id: string; name: string; spend?: number }[]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/suppliers" className="text-sm text-cyan-400 hover:text-cyan-300">
          ← Back to suppliers
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{supplier.name}</h1>
            <Badge tone={statusTone(supplier.status)}>{supplier.status ?? 'active'}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-400">
            {supplier.normalized_name && <span>norm: {supplier.normalized_name}</span>}
            {supplier.country && <span>{supplier.country}</span>}
            {supplier.domain && <span>{supplier.domain}</span>}
            {supplier.tax_id && <span>Tax ID: {supplier.tax_id}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button onClick={() => setMergeOpen(true)} disabled={!ws}>
            Merge duplicates
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-700 bg-rose-900/30 p-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Spend" value={money(stats.spend)} tone="cyan" />
        <Stat label="Transactions" value={Number(stats.txn_count || 0).toLocaleString()} />
        <Stat label="Purchase Orders" value={Number(stats.po_count || 0).toLocaleString()} />
        <Stat label="Invoices" value={Number(stats.invoice_count || 0).toLocaleString()} />
        <Stat
          label="Contract Coverage"
          value={pct(stats.contract_coverage)}
          tone={Number(stats.contract_coverage || 0) > 0.5 || Number(stats.contract_coverage || 0) > 50 ? 'green' : 'amber'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Categories */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Spend by category</h2>
          </CardHeader>
          <CardBody>
            {catList.length === 0 ? (
              <p className="text-sm text-stone-500">No category breakdown available.</p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const max = Math.max(...catList.map((c) => Number(c.spend || 0)), 1)
                  return catList.map((c) => {
                    const v = Number(c.spend || 0)
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <div className="w-36 shrink-0 truncate text-sm text-stone-400">{c.name}</div>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-800">
                          <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max((v / max) * 100, 3)}%` }} />
                        </div>
                        <div className="w-24 shrink-0 text-right text-sm text-stone-300">{money(v)}</div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Aliases */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Aliases</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex gap-2">
              <input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAlias()}
                placeholder="Add raw vendor name..."
                className="flex-1 rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-500 focus:border-cyan-500 focus:outline-none"
              />
              <Button onClick={addAlias} disabled={addingAlias || !aliasInput.trim()}>
                {addingAlias ? <Spinner /> : 'Add'}
              </Button>
            </div>
            {aliases.length === 0 ? (
              <p className="text-sm text-stone-500">
                No aliases yet. Aliases map raw vendor-name variants (from imports) to this supplier.
              </p>
            ) : (
              <ul className="divide-y divide-stone-800/70">
                {aliases.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="text-sm text-stone-200">{a.raw_name}</span>
                      {a.source && (
                        <Badge tone="slate" className="ml-2">
                          {a.source}
                        </Badge>
                      )}
                    </div>
                    <button
                      onClick={() => removeAlias(a.id)}
                      className="text-xs text-rose-400 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Comments */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Comments</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex gap-2">
            <input
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && postComment()}
              placeholder="Add a note about this supplier..."
              className="flex-1 rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-500 focus:border-cyan-500 focus:outline-none"
            />
            <Button onClick={postComment} disabled={postingComment || !commentInput.trim()}>
              {postingComment ? <Spinner /> : 'Post'}
            </Button>
          </div>
          {comments.length === 0 ? (
            <p className="text-sm text-stone-500">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-stone-800 bg-stone-900/50 p-3">
                  <div>
                    <p className="text-sm text-stone-200">{c.body}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {c.user_id ? `${c.user_id === userId ? 'You' : c.user_id}` : 'Unknown'} · {fmtDate(c.created_at)}
                    </p>
                  </div>
                  {c.user_id && c.user_id === userId && (
                    <button
                      onClick={async () => {
                        try {
                          await api.deleteComment(c.id)
                          await loadComments()
                        } catch (e: any) {
                          setError(e?.message || 'Failed to delete comment')
                        }
                      }}
                      className="shrink-0 text-xs text-rose-400 hover:text-rose-300"
                    >
                      Delete
                    </button>
                  )}
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
        title="Edit supplier"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit || !edit.name.trim()}>
              {savingEdit ? <Spinner /> : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Name</label>
            <input
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Status</label>
            <select
              value={edit.status}
              onChange={(e) => setEdit({ ...edit, status: e.target.value })}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="blocked">blocked</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-300">Country</label>
              <input
                value={edit.country}
                onChange={(e) => setEdit({ ...edit, country: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-300">Domain</label>
              <input
                value={edit.domain}
                onChange={(e) => setEdit({ ...edit, domain: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Tax ID</label>
            <input
              value={edit.tax_id}
              onChange={(e) => setEdit({ ...edit, tax_id: e.target.value })}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Merge modal */}
      <Modal
        open={mergeOpen}
        onClose={() => !merging && setMergeOpen(false)}
        title={`Merge into ${supplier.name}`}
        className="max-w-xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMergeOpen(false)} disabled={merging}>
              Cancel
            </Button>
            <Button onClick={doMerge} disabled={merging || mergeIds.length === 0}>
              {merging ? <Spinner /> : `Merge ${mergeIds.length || ''}`}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-stone-400">
          Select duplicate suppliers to fold into <span className="text-stone-200">{supplier.name}</span>. Their
          transactions are repointed and their names are recorded as aliases.
        </p>
        {mergeCandidates.length === 0 ? (
          <p className="text-sm text-stone-500">No other suppliers available to merge.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-stone-800">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10"></TH>
                  <TH>Supplier</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {mergeCandidates.map((s) => (
                  <TR key={s.id} className="cursor-pointer" onClick={() => toggleMergeId(s.id)}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={mergeIds.includes(s.id)}
                        onChange={() => toggleMergeId(s.id)}
                        className="h-4 w-4 accent-cyan-500"
                      />
                    </TD>
                    <TD className="text-stone-200">{s.name}</TD>
                    <TD>
                      <Badge tone={statusTone(s.status)}>{s.status ?? 'active'}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Modal>
    </div>
  )
}
