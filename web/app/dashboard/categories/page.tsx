'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'

interface Category {
  id: string
  workspace_id: string
  code: string
  name: string
  parent_id: string | null
  level: number | null
  created_at?: string
}

interface CategoryAnalytics {
  spend?: number
  supplier_count?: number
  fragmentation_index?: number
  maverick_rate?: number
  contract_coverage?: number
  [k: string]: unknown
}

interface TreeNode extends Category {
  children: TreeNode[]
}

const fmtCurrency = (n: unknown) => {
  const v = Number(n)
  if (!isFinite(v)) return '$0'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtPct = (n: unknown) => {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  // accept either 0..1 or 0..100
  const pct = v <= 1 ? v * 100 : v
  return `${pct.toFixed(1)}%`
}

function buildTree(cats: Category[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  cats.forEach((c) => byId.set(c.id, { ...c, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

export default function CategoriesPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<CategoryAnalytics | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  // form modal
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState({ code: '', name: '', parent_id: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const id = localStorage.getItem('tscp_workspace_id')
      setWs(id)
    } catch {
      setWs(null)
    }
  }, [])

  const load = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await api.listCategories(ws)
      setCategories(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories')
    } finally {
      setLoading(false)
    }
  }, [ws])

  useEffect(() => {
    void load()
  }, [load])

  const loadAnalytics = useCallback(async (id: string) => {
    setSelectedId(id)
    setAnalyticsLoading(true)
    setAnalyticsError(null)
    setAnalytics(null)
    try {
      const a = await api.getCategoryAnalytics(id)
      setAnalytics(a || {})
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setAnalyticsLoading(false)
    }
  }, [])

  const tree = useMemo(() => buildTree(categories), [categories])

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories
    const q = search.toLowerCase()
    return categories.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    )
  }, [categories, search])

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree
    // flat filtered view when searching
    return buildTree(filteredCategories)
  }, [tree, search, filteredCategories])

  const selected = useMemo(
    () => categories.find((c) => c.id === selectedId) || null,
    [categories, selectedId],
  )

  const openCreate = (parentId?: string) => {
    setEditing(null)
    setForm({ code: '', name: '', parent_id: parentId || '' })
    setFormError(null)
    setFormOpen(true)
  }
  const openEdit = (c: Category) => {
    setEditing(c)
    setForm({ code: c.code, name: c.name, parent_id: c.parent_id || '' })
    setFormError(null)
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!ws) return
    if (!form.name.trim() || !form.code.trim()) {
      setFormError('Code and name are required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.updateCategory(editing.id, {
          name: form.name.trim(),
          code: form.code.trim(),
          parent_id: form.parent_id || null,
        })
      } else {
        await api.createCategory({
          workspace_id: ws,
          name: form.name.trim(),
          code: form.code.trim(),
          parent_id: form.parent_id || null,
        })
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Category) => {
    if (!confirm(`Delete category "${c.name}"? Child categories must be reassigned first.`)) return
    setDeletingId(c.id)
    try {
      await api.deleteCategory(c.id)
      if (selectedId === c.id) {
        setSelectedId(null)
        setAnalytics(null)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete category')
    } finally {
      setDeletingId(null)
    }
  }

  if (!ws && !loading) {
    return (
      <div className="space-y-6">
        <PageHeader onCreate={() => openCreate()} disabled />
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace to manage spend categories."
          icon="🗂️"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader onCreate={() => openCreate()} disabled={!ws} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading categories..." />
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Build a category taxonomy to organize and analyze your tail spend."
          icon="🗂️"
          action={<Button onClick={() => openCreate()}>Create category</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Tree */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Category Tree</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search categories..."
                  className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                />
              </CardHeader>
              <CardBody className="p-2">
                {filteredTree.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-500">
                    No categories match &ldquo;{search}&rdquo;.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {filteredTree.map((node) => (
                      <TreeRow
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedId={selectedId}
                        deletingId={deletingId}
                        onSelect={loadAnalytics}
                        onAddChild={openCreate}
                        onEdit={openEdit}
                        onDelete={remove}
                      />
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Analytics panel */}
          <div className="lg:col-span-2">
            <Card className="sticky top-4">
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">
                  {selected ? selected.name : 'Category Analytics'}
                </h2>
                {selected && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    <span className="font-mono">{selected.code}</span>
                  </p>
                )}
              </CardHeader>
              <CardBody>
                {!selectedId ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Select a category to view spend analytics.
                  </p>
                ) : analyticsLoading ? (
                  <Spinner className="py-8" label="Computing analytics..." />
                ) : analyticsError ? (
                  <p className="py-6 text-center text-sm text-rose-300">{analyticsError}</p>
                ) : analytics ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Stat label="Spend" value={fmtCurrency(analytics.spend)} tone="cyan" />
                      <Stat
                        label="Suppliers"
                        value={Number(analytics.supplier_count ?? 0).toLocaleString()}
                      />
                    </div>
                    <Stat
                      label="Fragmentation Index"
                      value={
                        analytics.fragmentation_index != null
                          ? Number(analytics.fragmentation_index).toFixed(2)
                          : '—'
                      }
                      hint="Higher = spend split across more suppliers"
                      tone="amber"
                    />
                    <div className="space-y-3">
                      <CoverageBar
                        label="Contract Coverage"
                        value={Number(analytics.contract_coverage ?? 0)}
                        tone="green"
                      />
                      <CoverageBar
                        label="Maverick Rate"
                        value={Number(analytics.maverick_rate ?? 0)}
                        tone="rose"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500">No analytics available.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Category' : 'New Category'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <Field label="Code">
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. IT-SOFTWARE"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </Field>
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Software & SaaS"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </Field>
          <Field label="Parent Category">
            <select
              value={form.parent_id}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">— None (top level) —</option>
              {categories
                .filter((c) => !editing || c.id !== editing.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function PageHeader({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Categories</h1>
        <p className="mt-1 text-sm text-slate-500">
          Spend taxonomy and per-category fragmentation analytics.
        </p>
      </div>
      <Button onClick={onCreate} disabled={disabled}>
        + New Category
      </Button>
    </div>
  )
}

function TreeRow({
  node,
  depth,
  selectedId,
  deletingId,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: TreeNode
  depth: number
  selectedId: string | null
  deletingId: string | null
  onSelect: (id: string) => void
  onAddChild: (parentId: string) => void
  onEdit: (c: Category) => void
  onDelete: (c: Category) => void
}) {
  const active = selectedId === node.id
  return (
    <li>
      <div
        className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${
          active ? 'bg-cyan-500/10 ring-1 ring-cyan-500/30' : 'hover:bg-slate-800/50'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          onClick={() => onSelect(node.id)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="text-slate-600">{node.children.length > 0 ? '▸' : '·'}</span>
          <span className={`text-sm ${active ? 'text-cyan-200' : 'text-slate-200'}`}>
            {node.name}
          </span>
          <Badge tone="slate" className="font-mono">
            {node.code}
          </Badge>
        </button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onAddChild(node.id)}
            title="Add sub-category"
            className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-cyan-300"
          >
            +
          </button>
          <button
            onClick={() => onEdit(node)}
            title="Edit"
            className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            ✎
          </button>
          <button
            onClick={() => onDelete(node)}
            disabled={deletingId === node.id}
            title="Delete"
            className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-300 disabled:opacity-40"
          >
            {deletingId === node.id ? '…' : '🗑'}
          </button>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              deletingId={deletingId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function CoverageBar({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'green' | 'rose'
}) {
  const pct = value <= 1 ? value * 100 : value
  const clamped = Math.max(0, Math.min(100, pct))
  const barColor = tone === 'green' ? 'bg-emerald-400' : 'bg-rose-400'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium text-slate-200">{fmtPct(value)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${barColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  )
}
