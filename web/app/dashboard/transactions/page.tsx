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

interface Transaction {
  id: string
  workspace_id: string
  supplier_id: string | null
  category_id: string | null
  contract_id: string | null
  amount: number | string
  currency: string | null
  txn_date: string | null
  po_number: string | null
  invoice_number: string | null
  cost_center: string | null
  item_key: string | null
  uom: string | null
  quantity: number | string | null
  unit_price: number | string | null
  is_on_contract: boolean | null
  created_at?: string
}

interface Supplier {
  id: string
  name: string
}
interface Category {
  id: string
  name: string
  code: string
}

interface Summary {
  spend?: number
  txn_count?: number
  supplier_count?: number
  avg?: number
  on_contract_spend?: number
  off_contract_spend?: number
  on_contract_count?: number
  off_contract_count?: number
  [k: string]: unknown
}

const fmtCurrency = (n: unknown) => {
  const v = Number(n)
  if (!isFinite(v)) return '$0'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtCurrencyExact = (n: unknown) => {
  const v = Number(n)
  if (!isFinite(v)) return '$0.00'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}
const fmtDate = (d: unknown) => {
  if (!d) return '—'
  const dt = new Date(String(d))
  if (isNaN(dt.getTime())) return String(d)
  return dt.toISOString().slice(0, 10)
}

const PAGE_SIZE = 25

const emptyForm = {
  supplier_id: '',
  category_id: '',
  amount: '',
  currency: 'USD',
  txn_date: '',
  po_number: '',
  invoice_number: '',
  cost_center: '',
  item_key: '',
  uom: '',
  quantity: '',
  unit_price: '',
  is_on_contract: false,
}

export default function TransactionsPage() {
  const [ws, setWs] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [rows, setRows] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  // filters
  const [page, setPage] = useState(1)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [costCenter, setCostCenter] = useState('')
  const [onContract, setOnContract] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')

  // bulk
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // form
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
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
  const categoryName = useCallback(
    (id: string | null) => categories.find((c) => c.id === id)?.name || '—',
    [categories],
  )

  const loadRefData = useCallback(async () => {
    if (!ws) return
    try {
      const [sup, cat] = await Promise.all([api.listSuppliers(ws), api.listCategories(ws)])
      setSuppliers(Array.isArray(sup) ? sup : [])
      setCategories(Array.isArray(cat) ? cat : [])
    } catch {
      /* non-fatal: filters still work without labels */
    }
  }, [ws])

  const loadTransactions = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setTableLoading(true)
    setError(null)
    try {
      const params: Record<string, unknown> = { page }
      if (supplierFilter) params.supplier_id = supplierFilter
      if (categoryFilter) params.category_id = categoryFilter
      if (costCenter) params.cost_center = costCenter
      if (onContract) params.on_contract = onContract
      if (from) params.from = from
      if (to) params.to = to
      const res = await api.listTransactions(ws, params)
      const list: Transaction[] = Array.isArray(res) ? res : (res?.rows ?? [])
      setRows(list)
      setTotal(typeof res?.total === 'number' ? res.total : list.length)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions')
    } finally {
      setTableLoading(false)
      setLoading(false)
    }
  }, [ws, page, supplierFilter, categoryFilter, costCenter, onContract, from, to])

  const loadSummary = useCallback(async () => {
    if (!ws) return
    try {
      const s = await api.getTransactionSummary(ws)
      setSummary(s || {})
    } catch {
      setSummary(null)
    }
  }, [ws])

  useEffect(() => {
    if (!ws) {
      setLoading(false)
      return
    }
    void loadRefData()
    void loadSummary()
  }, [ws, loadRefData, loadSummary])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  // reset to page 1 when filters change
  useEffect(() => {
    setPage(1)
  }, [supplierFilter, categoryFilter, costCenter, onContract, from, to])

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((r) =>
      [
        r.po_number,
        r.invoice_number,
        r.cost_center,
        r.item_key,
        supplierName(r.supplier_id),
        categoryName(r.category_id),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search, supplierName, categoryName])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const onContractCount =
    Number(summary?.on_contract_count ?? 0) || 0
  const offContractCount = Number(summary?.off_contract_count ?? 0) || 0
  const contractSplitTotal = onContractCount + offContractCount
  const onContractPct = contractSplitTotal > 0 ? (onContractCount / contractSplitTotal) * 100 : 0

  const clearFilters = () => {
    setSupplierFilter('')
    setCategoryFilter('')
    setCostCenter('')
    setOnContract('')
    setFrom('')
    setTo('')
    setSearch('')
  }
  const hasFilters =
    supplierFilter || categoryFilter || costCenter || onContract || from || to || search

  const toggleAll = () => {
    if (selected.size === visibleRows.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visibleRows.map((r) => r.id)))
    }
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, txn_date: new Date().toISOString().slice(0, 10) })
    setFormError(null)
    setFormOpen(true)
  }
  const openEdit = (t: Transaction) => {
    setEditing(t)
    setForm({
      supplier_id: t.supplier_id || '',
      category_id: t.category_id || '',
      amount: String(t.amount ?? ''),
      currency: t.currency || 'USD',
      txn_date: t.txn_date ? fmtDate(t.txn_date) : '',
      po_number: t.po_number || '',
      invoice_number: t.invoice_number || '',
      cost_center: t.cost_center || '',
      item_key: t.item_key || '',
      uom: t.uom || '',
      quantity: t.quantity != null ? String(t.quantity) : '',
      unit_price: t.unit_price != null ? String(t.unit_price) : '',
      is_on_contract: !!t.is_on_contract,
    })
    setFormError(null)
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!ws) return
    if (!form.amount || isNaN(Number(form.amount))) {
      setFormError('A numeric amount is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const body: Record<string, unknown> = {
      supplier_id: form.supplier_id || null,
      category_id: form.category_id || null,
      amount: Number(form.amount),
      currency: form.currency || 'USD',
      txn_date: form.txn_date || null,
      po_number: form.po_number || null,
      invoice_number: form.invoice_number || null,
      cost_center: form.cost_center || null,
      item_key: form.item_key || null,
      uom: form.uom || null,
      quantity: form.quantity ? Number(form.quantity) : null,
      unit_price: form.unit_price ? Number(form.unit_price) : null,
      is_on_contract: form.is_on_contract,
    }
    try {
      if (editing) {
        await api.updateTransaction(editing.id, body)
      } else {
        await api.createTransaction({ workspace_id: ws, ...body })
      }
      setFormOpen(false)
      await Promise.all([loadTransactions(), loadSummary()])
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save transaction')
    } finally {
      setSaving(false)
    }
  }

  const removeOne = async (t: Transaction) => {
    if (!confirm('Delete this transaction?')) return
    try {
      await api.deleteTransaction(t.id)
      await Promise.all([loadTransactions(), loadSummary()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete transaction')
    }
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} selected transaction(s)?`)) return
    setBulkBusy(true)
    setError(null)
    try {
      await Promise.all([...selected].map((id) => api.deleteTransaction(id)))
      setSelected(new Set())
      await Promise.all([loadTransactions(), loadSummary()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  if (!ws && !loading) {
    return (
      <div className="space-y-6">
        <Header onCreate={openCreate} disabled />
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace to view spend transactions."
          icon="💳"
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
        <PageSpinner label="Loading transactions..." />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total Spend" value={fmtCurrency(summary?.spend)} tone="cyan" />
            <Stat
              label="Transactions"
              value={Number(summary?.txn_count ?? total).toLocaleString()}
            />
            <Stat
              label="Suppliers"
              value={Number(summary?.supplier_count ?? 0).toLocaleString()}
            />
            <Stat label="Avg Txn" value={fmtCurrency(summary?.avg)} />
          </div>

          {/* On/Off contract split bar */}
          {contractSplitTotal > 0 && (
            <Card>
              <CardBody>
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    On-contract spend:{' '}
                    <span className="text-emerald-300">
                      {fmtCurrency(summary?.on_contract_spend)}
                    </span>
                  </span>
                  <span>
                    Off-contract (maverick):{' '}
                    <span className="text-rose-300">
                      {fmtCurrency(summary?.off_contract_spend)}
                    </span>
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-emerald-400"
                    style={{ width: `${onContractPct}%` }}
                    title={`On-contract ${onContractPct.toFixed(1)}%`}
                  />
                  <div
                    className="h-full bg-rose-400"
                    style={{ width: `${100 - onContractPct}%` }}
                    title={`Off-contract ${(100 - onContractPct).toFixed(1)}%`}
                  />
                </div>
                <div className="mt-1 text-right text-xs text-slate-500">
                  {onContractPct.toFixed(1)}% on contract
                </div>
              </CardBody>
            </Card>
          )}

          {/* Filters */}
          <Card>
            <CardBody className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                value={costCenter}
                onChange={(e) => setCostCenter(e.target.value)}
                placeholder="Cost center"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
              <select
                value={onContract}
                onChange={(e) => setOnContract(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">On/off contract</option>
                <option value="true">On contract</option>
                <option value="false">Off contract</option>
              </select>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PO / item..."
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </CardBody>
            {hasFilters && (
              <div className="flex items-center justify-between border-t border-slate-800 px-5 py-2">
                <span className="text-xs text-slate-500">Filters active</span>
                <button
                  onClick={clearFilters}
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  Clear all
                </button>
              </div>
            )}
          </Card>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm">
              <span className="text-cyan-200">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button variant="danger" onClick={bulkDelete} disabled={bulkBusy}>
                  {bulkBusy ? 'Deleting...' : `Delete ${selected.size}`}
                </Button>
              </div>
            </div>
          )}

          {/* Table */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Spend Transactions</h2>
              <span className="text-xs text-slate-500">
                {total.toLocaleString()} total {tableLoading && '· loading...'}
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {visibleRows.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={hasFilters ? 'No matching transactions' : 'No transactions yet'}
                    description={
                      hasFilters
                        ? 'Adjust or clear your filters to see results.'
                        : 'Add a transaction or import spend data to get started.'
                    }
                    icon="💳"
                    action={
                      hasFilters ? (
                        <Button variant="secondary" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : (
                        <Button onClick={openCreate}>Add transaction</Button>
                      )
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-8">
                        <input
                          type="checkbox"
                          checked={selected.size === visibleRows.length && visibleRows.length > 0}
                          onChange={toggleAll}
                          className="accent-cyan-500"
                        />
                      </TH>
                      <TH>Date</TH>
                      <TH>Supplier</TH>
                      <TH>Category</TH>
                      <TH>PO / Invoice</TH>
                      <TH>Cost Center</TH>
                      <TH className="text-right">Amount</TH>
                      <TH>Contract</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visibleRows.map((t) => (
                      <TR key={t.id}>
                        <TD>
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => toggleOne(t.id)}
                            className="accent-cyan-500"
                          />
                        </TD>
                        <TD className="whitespace-nowrap text-slate-400">{fmtDate(t.txn_date)}</TD>
                        <TD className="text-slate-200">{supplierName(t.supplier_id)}</TD>
                        <TD>{categoryName(t.category_id)}</TD>
                        <TD className="text-slate-400">
                          {t.po_number || t.invoice_number || '—'}
                        </TD>
                        <TD className="text-slate-400">{t.cost_center || '—'}</TD>
                        <TD className="text-right font-medium text-slate-100">
                          {fmtCurrencyExact(t.amount)}
                        </TD>
                        <TD>
                          {t.is_on_contract ? (
                            <Badge tone="green">On contract</Badge>
                          ) : (
                            <Badge tone="rose">Off contract</Badge>
                          )}
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEdit(t)}
                              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeOne(t)}
                              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-rose-300"
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
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 text-sm">
                <span className="text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || tableLoading}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || tableLoading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Transaction' : 'New Transaction'}
        className="max-w-2xl"
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier">
              <select
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">— Unassigned —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">— Uncategorized —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Currency">
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Transaction Date">
              <input
                type="date"
                value={form.txn_date}
                onChange={(e) => setForm({ ...form, txn_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Cost Center">
              <input
                value={form.cost_center}
                onChange={(e) => setForm({ ...form, cost_center: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="PO Number">
              <input
                value={form.po_number}
                onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Invoice Number">
              <input
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Item Key">
              <input
                value={form.item_key}
                onChange={(e) => setForm({ ...form, item_key: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="UoM">
              <input
                value={form.uom}
                onChange={(e) => setForm({ ...form, uom: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                step="any"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Unit Price">
              <input
                type="number"
                step="any"
                value={form.unit_price}
                onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_on_contract}
              onChange={(e) => setForm({ ...form, is_on_contract: e.target.checked })}
              className="accent-cyan-500"
            />
            This transaction is covered by a contract
          </label>
        </div>
      </Modal>
    </div>
  )
}

function Header({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Transactions</h1>
        <p className="mt-1 text-sm text-slate-500">
          Line-level spend with filters, contract coverage, and summary metrics.
        </p>
      </div>
      <Button onClick={onCreate} disabled={disabled}>
        + New Transaction
      </Button>
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
