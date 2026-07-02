'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface Contract {
  id: string
  workspace_id: string
  supplier_id: string | null
  category_id: string | null
  name: string
  contracted_unit_price: number | string | null
  committed_volume: number | string | null
  currency: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
  created_at?: string
}

interface Supplier {
  id: string
  name: string
}

interface CoverageRow {
  category_id?: string
  category_name?: string
  category?: string
  on_contract?: number
  off_contract?: number
  coverage?: number
  coverage_pct?: number
  on_contract_spend?: number
  off_contract_spend?: number
  [k: string]: unknown
}

const fmtCurrency = (n: unknown) => {
  const v = Number(n)
  if (!isFinite(v) || v === 0) return n == null ? '—' : '$0'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtDate = (d: unknown) => {
  if (!d) return '—'
  const dt = new Date(String(d))
  if (isNaN(dt.getTime())) return String(d)
  return dt.toISOString().slice(0, 10)
}
const daysUntil = (d: unknown) => {
  if (!d) return null
  const dt = new Date(String(d))
  if (isNaN(dt.getTime())) return null
  return Math.ceil((dt.getTime() - Date.now()) / 86_400_000)
}
const statusTone = (s: string | null): 'green' | 'amber' | 'rose' | 'slate' => {
  switch ((s || '').toLowerCase()) {
    case 'active':
      return 'green'
    case 'expiring':
    case 'pending':
      return 'amber'
    case 'expired':
    case 'terminated':
      return 'rose'
    default:
      return 'slate'
  }
}

const emptyForm = {
  name: '',
  supplier_id: '',
  category_id: '',
  contracted_unit_price: '',
  committed_volume: '',
  currency: 'USD',
  start_date: '',
  end_date: '',
  status: 'active',
}

export default function ContractsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [contracts, setContracts] = useState<Contract[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [expiring, setExpiring] = useState<Contract[]>([])
  const [expiringDays, setExpiringDays] = useState(90)

  // filters
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [search, setSearch] = useState('')

  // form
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    try {
      setWs(localStorage.getItem('tscp_workspace_id'))
    } catch {
      setWs(null)
    }
  }, [])

  const supplierName = useCallback(
    (id: string | null) => suppliers.find((s) => s.id === id)?.name || '—',
    [suppliers],
  )

  const loadAll = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [c, s, cov, exp] = await Promise.all([
        api.listContracts(ws),
        api.listSuppliers(ws),
        api.getContractCoverage(ws).catch(() => null),
        api.getExpiringContracts(ws, { days: expiringDays }).catch(() => []),
      ])
      setContracts(Array.isArray(c) ? c : [])
      setSuppliers(Array.isArray(s) ? s : [])
      const covRows: CoverageRow[] = Array.isArray(cov)
        ? cov
        : Array.isArray(cov?.coverage)
          ? cov.coverage
          : []
      setCoverage(covRows)
      setExpiring(Array.isArray(exp) ? exp : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contracts')
    } finally {
      setLoading(false)
    }
  }, [ws, expiringDays])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // reload only the expiring widget when window changes (after initial load)
  const reloadExpiring = useCallback(
    async (days: number) => {
      if (!ws) return
      try {
        const exp = await api.getExpiringContracts(ws, { days })
        setExpiring(Array.isArray(exp) ? exp : [])
      } catch {
        /* ignore */
      }
    },
    [ws],
  )

  const filtered = useMemo(() => {
    return contracts.filter((c) => {
      if (statusFilter && (c.status || '').toLowerCase() !== statusFilter) return false
      if (supplierFilter && c.supplier_id !== supplierFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !c.name.toLowerCase().includes(q) &&
          !supplierName(c.supplier_id).toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [contracts, statusFilter, supplierFilter, search, supplierName])

  const activeCount = contracts.filter((c) => (c.status || '').toLowerCase() === 'active').length
  const avgCoverage = useMemo(() => {
    if (coverage.length === 0) return null
    const vals = coverage
      .map((r) => {
        const raw = r.coverage_pct ?? r.coverage
        const v = Number(raw)
        if (!isFinite(v)) return null
        return v <= 1 ? v * 100 : v
      })
      .filter((v): v is number => v != null)
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }, [coverage])

  const hasFilters = statusFilter || supplierFilter || search

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm })
    setFormError(null)
    setFormOpen(true)
  }
  const openEdit = (c: Contract) => {
    setEditing(c)
    setForm({
      name: c.name || '',
      supplier_id: c.supplier_id || '',
      category_id: c.category_id || '',
      contracted_unit_price: c.contracted_unit_price != null ? String(c.contracted_unit_price) : '',
      committed_volume: c.committed_volume != null ? String(c.committed_volume) : '',
      currency: c.currency || 'USD',
      start_date: c.start_date ? fmtDate(c.start_date) : '',
      end_date: c.end_date ? fmtDate(c.end_date) : '',
      status: c.status || 'active',
    })
    setFormError(null)
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!ws) return
    if (!form.name.trim()) {
      setFormError('Contract name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      supplier_id: form.supplier_id || null,
      category_id: form.category_id || null,
      contracted_unit_price: form.contracted_unit_price ? Number(form.contracted_unit_price) : null,
      committed_volume: form.committed_volume ? Number(form.committed_volume) : null,
      currency: form.currency || 'USD',
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status || 'active',
    }
    try {
      if (editing) {
        await api.updateContract(editing.id, body)
      } else {
        await api.createContract({ workspace_id: ws, ...body })
      }
      setFormOpen(false)
      await loadAll()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save contract')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Contract) => {
    if (!confirm(`Delete contract "${c.name}"?`)) return
    try {
      await api.deleteContract(c.id)
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete contract')
    }
  }

  if (!ws && !loading) {
    return (
      <div className="space-y-6">
        <Header onCreate={openCreate} disabled />
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace to manage contracts."
          icon="📄"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onCreate={openCreate} disabled={!ws} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading contracts..." />
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Contracts" value={contracts.length.toLocaleString()} tone="cyan" />
            <Stat label="Active" value={activeCount.toLocaleString()} tone="green" />
            <Stat
              label="Avg Coverage"
              value={avgCoverage != null ? `${avgCoverage.toFixed(1)}%` : '—'}
            />
            <Stat
              label={`Expiring (${expiringDays}d)`}
              value={expiring.length.toLocaleString()}
              tone={expiring.length > 0 ? 'amber' : 'default'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Coverage by category */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">On-Contract Coverage by Category</h2>
              </CardHeader>
              <CardBody>
                {coverage.length === 0 ? (
                  <p className="py-6 text-center text-sm text-stone-500">
                    No coverage data yet. Add contracts and transactions to compute coverage.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {coverage.map((r, i) => {
                      const raw = r.coverage_pct ?? r.coverage
                      const v = Number(raw)
                      const pct = !isFinite(v) ? 0 : v <= 1 ? v * 100 : v
                      const clamped = Math.max(0, Math.min(100, pct))
                      const label = r.category_name || r.category || r.category_id || 'Uncategorized'
                      return (
                        <li key={r.category_id || i}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-stone-300">{label}</span>
                            <span className="font-medium text-stone-200">{pct.toFixed(1)}%</span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-800">
                            <div
                              className={`h-full ${
                                clamped >= 70
                                  ? 'bg-emerald-400'
                                  : clamped >= 40
                                    ? 'bg-amber-400'
                                    : 'bg-rose-400'
                              }`}
                              style={{ width: `${clamped}%` }}
                            />
                          </div>
                          {(r.on_contract_spend != null || r.off_contract_spend != null) && (
                            <div className="mt-1 flex justify-between text-[11px] text-stone-500">
                              <span>On: {fmtCurrency(r.on_contract_spend)}</span>
                              <span>Off: {fmtCurrency(r.off_contract_spend)}</span>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>

            {/* Expiring */}
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Expiring Soon</h2>
                <select
                  value={expiringDays}
                  onChange={(e) => {
                    const d = Number(e.target.value)
                    setExpiringDays(d)
                    void reloadExpiring(d)
                  }}
                  className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                </select>
              </CardHeader>
              <CardBody>
                {expiring.length === 0 ? (
                  <p className="py-6 text-center text-sm text-stone-500">
                    No contracts expiring in the next {expiringDays} days.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {expiring.map((c) => {
                      const d = daysUntil(c.end_date)
                      return (
                        <li
                          key={c.id}
                          className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950/50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm text-stone-200">{c.name}</p>
                            <p className="truncate text-xs text-stone-500">
                              {supplierName(c.supplier_id)}
                            </p>
                          </div>
                          <Badge tone={d != null && d <= 30 ? 'rose' : 'amber'}>
                            {d != null ? `${d}d` : fmtDate(c.end_date)}
                          </Badge>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contracts..."
                className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-cyan-500 focus:outline-none"
              />
            </CardBody>
          </Card>

          {/* Registry */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Contract Registry</h2>
              <span className="text-xs text-stone-500">{filtered.length} shown</span>
            </CardHeader>
            <CardBody className="p-0">
              {contracts.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No contracts yet"
                    description="Register supplier contracts to track coverage and detect maverick spend."
                    icon="📄"
                    action={<Button onClick={openCreate}>Add contract</Button>}
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No matching contracts"
                    description="Adjust or clear your filters."
                    icon="🔍"
                    action={
                      hasFilters ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setStatusFilter('')
                            setSupplierFilter('')
                            setSearch('')
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Contract</TH>
                      <TH>Supplier</TH>
                      <TH className="text-right">Unit Price</TH>
                      <TH className="text-right">Committed Vol.</TH>
                      <TH>Term</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((c) => (
                      <TR key={c.id}>
                        <TD className="font-medium text-stone-100">{c.name}</TD>
                        <TD>{supplierName(c.supplier_id)}</TD>
                        <TD className="text-right text-stone-300">
                          {c.contracted_unit_price != null
                            ? Number(c.contracted_unit_price).toLocaleString('en-US', {
                                style: 'currency',
                                currency: c.currency || 'USD',
                              })
                            : '—'}
                        </TD>
                        <TD className="text-right text-stone-300">
                          {c.committed_volume != null
                            ? Number(c.committed_volume).toLocaleString()
                            : '—'}
                        </TD>
                        <TD className="whitespace-nowrap text-xs text-stone-400">
                          {fmtDate(c.start_date)} → {fmtDate(c.end_date)}
                        </TD>
                        <TD>
                          <Badge tone={statusTone(c.status)}>{c.status || 'unknown'}</Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEdit(c)}
                              className="rounded px-2 py-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-white"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => remove(c)}
                              className="rounded px-2 py-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-rose-300"
                            >
                              Delete
                            </button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Contract' : 'New Contract'}
        className="max-w-xl"
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
          <Field label="Contract Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Acme MSA 2026"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-cyan-500 focus:outline-none"
            />
          </Field>
          <Field label="Supplier">
            <select
              value={form.supplier_id}
              onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">— None —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contracted Unit Price">
              <input
                type="number"
                step="any"
                value={form.contracted_unit_price}
                onChange={(e) => setForm({ ...form, contracted_unit_price: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Committed Volume">
              <input
                type="number"
                step="any"
                value={form.committed_volume}
                onChange={(e) => setForm({ ...form, committed_volume: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Currency">
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
            </Field>
            <Field label="Start Date">
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="End Date">
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Header({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Contracts</h1>
        <p className="mt-1 text-sm text-stone-500">
          Registry, on-contract coverage, and expiring-contract alerts.
        </p>
      </div>
      <Button onClick={onCreate} disabled={disabled}>
        + New Contract
      </Button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </span>
      {children}
    </label>
  )
}
