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

type Tab = 'pos' | 'invoices'

interface PurchaseOrder {
  id: string
  workspace_id: string
  supplier_id: string | null
  po_number: string
  total_amount: number | string | null
  line_count: number | null
  status: string | null
  issued_date: string | null
  created_at: string
}

interface Invoice {
  id: string
  workspace_id: string
  supplier_id: string | null
  invoice_number: string
  po_number: string | null
  amount: number | string | null
  status: string | null
  invoice_date: string | null
  created_at: string
}

interface Supplier {
  id: string
  name: string
}

const WS_KEY = 'tscp_workspace_id'

function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : 0
}

function money(v: number | string | null | undefined): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
}

function statusTone(status: string | null): 'cyan' | 'green' | 'amber' | 'rose' | 'slate' {
  const s = (status || '').toLowerCase()
  if (['paid', 'closed', 'received', 'completed', 'approved'].includes(s)) return 'green'
  if (['open', 'issued', 'sent', 'pending'].includes(s)) return 'cyan'
  if (['draft', 'partial', 'on_hold'].includes(s)) return 'amber'
  if (['cancelled', 'canceled', 'rejected', 'disputed', 'overdue'].includes(s)) return 'rose'
  return 'slate'
}

const PO_STATUSES = ['draft', 'issued', 'open', 'partial', 'received', 'closed', 'cancelled']
const INV_STATUSES = ['draft', 'pending', 'approved', 'paid', 'partial', 'disputed', 'overdue', 'cancelled']

export default function PurchasingPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('pos')

  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')

  const [showPoModal, setShowPoModal] = useState(false)
  const [showInvModal, setShowInvModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [poForm, setPoForm] = useState({
    po_number: '', supplier_id: '', total_amount: '', line_count: '', status: 'issued', issued_date: '',
  })
  const [invForm, setInvForm] = useState({
    invoice_number: '', supplier_id: '', po_number: '', amount: '', status: 'pending', invoice_date: '',
  })

  useEffect(() => {
    try {
      const id = localStorage.getItem(WS_KEY)
      setWsId(id)
    } catch {
      setWsId(null)
    }
  }, [])

  const load = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const [poRes, invRes, supRes] = await Promise.all([
        api.listPurchaseOrders(ws),
        api.listInvoices(ws),
        api.listSuppliers(ws),
      ])
      setPos(Array.isArray(poRes) ? poRes : [])
      setInvoices(Array.isArray(invRes) ? invRes : [])
      setSuppliers(Array.isArray(supRes) ? supRes : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load purchasing data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) load(wsId)
    else setLoading(false)
  }, [wsId, load])

  const supplierName = useCallback(
    (id: string | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? 'Unknown supplier' : 'Unassigned'),
    [suppliers],
  )

  const filteredPos = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pos.filter((p) => {
      if (statusFilter && (p.status || '') !== statusFilter) return false
      if (supplierFilter && p.supplier_id !== supplierFilter) return false
      if (q) {
        const hay = `${p.po_number} ${supplierName(p.supplier_id)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [pos, search, statusFilter, supplierFilter, supplierName])

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((iv) => {
      if (statusFilter && (iv.status || '') !== statusFilter) return false
      if (supplierFilter && iv.supplier_id !== supplierFilter) return false
      if (q) {
        const hay = `${iv.invoice_number} ${iv.po_number || ''} ${supplierName(iv.supplier_id)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [invoices, search, statusFilter, supplierFilter, supplierName])

  const poStats = useMemo(() => ({
    count: pos.length,
    total: pos.reduce((acc, p) => acc + num(p.total_amount), 0),
    open: pos.filter((p) => ['open', 'issued', 'partial'].includes((p.status || '').toLowerCase())).length,
  }), [pos])

  const invStats = useMemo(() => ({
    count: invoices.length,
    total: invoices.reduce((acc, iv) => acc + num(iv.amount), 0),
    unpaid: invoices.filter((iv) => !['paid', 'closed'].includes((iv.status || '').toLowerCase())).length,
  }), [invoices])

  async function submitPo(e: React.FormEvent) {
    e.preventDefault()
    if (!wsId) return
    setSaving(true)
    setFormError(null)
    try {
      await api.createPurchaseOrder({
        workspace_id: wsId,
        po_number: poForm.po_number.trim(),
        supplier_id: poForm.supplier_id || null,
        total_amount: poForm.total_amount ? num(poForm.total_amount) : 0,
        line_count: poForm.line_count ? parseInt(poForm.line_count, 10) : 0,
        status: poForm.status,
        issued_date: poForm.issued_date || null,
      })
      setShowPoModal(false)
      setPoForm({ po_number: '', supplier_id: '', total_amount: '', line_count: '', status: 'issued', issued_date: '' })
      await load(wsId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create purchase order')
    } finally {
      setSaving(false)
    }
  }

  async function submitInv(e: React.FormEvent) {
    e.preventDefault()
    if (!wsId) return
    setSaving(true)
    setFormError(null)
    try {
      await api.createInvoice({
        workspace_id: wsId,
        invoice_number: invForm.invoice_number.trim(),
        supplier_id: invForm.supplier_id || null,
        po_number: invForm.po_number.trim() || null,
        amount: invForm.amount ? num(invForm.amount) : 0,
        status: invForm.status,
        invoice_date: invForm.invoice_date || null,
      })
      setShowInvModal(false)
      setInvForm({ invoice_number: '', supplier_id: '', po_number: '', amount: '', status: 'pending', invoice_date: '' })
      await load(wsId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  async function removePo(id: string) {
    if (!wsId || !confirm('Delete this purchase order?')) return
    setBusyId(id)
    try {
      await api.deletePurchaseOrder(id)
      setPos((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete purchase order')
    } finally {
      setBusyId(null)
    }
  }

  async function removeInv(id: string) {
    if (!wsId || !confirm('Delete this invoice?')) return
    setBusyId(id)
    try {
      await api.deleteInvoice(id)
      setInvoices((prev) => prev.filter((iv) => iv.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete invoice')
    } finally {
      setBusyId(null)
    }
  }

  const statusOptions = tab === 'pos' ? PO_STATUSES : INV_STATUSES

  if (!wsId && !loading) {
    return (
      <div className="space-y-6">
        <Header tab={tab} setTab={setTab} onNew={() => {}} disabled />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace on the Workspaces page to manage purchase orders and invoices."
        />
      </div>
    )
  }

  if (loading) return <PageSpinner label="Loading purchasing data..." />

  return (
    <div className="space-y-6">
      <Header
        tab={tab}
        setTab={(t) => { setTab(t); setStatusFilter(''); setSupplierFilter(''); setSearch('') }}
        onNew={() => { setFormError(null); tab === 'pos' ? setShowPoModal(true) : setShowInvModal(true) }}
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tab === 'pos' ? (
          <>
            <Stat label="Purchase Orders" value={poStats.count} tone="cyan" />
            <Stat label="PO Value" value={money(poStats.total)} />
            <Stat label="Open POs" value={poStats.open} tone="amber" />
          </>
        ) : (
          <>
            <Stat label="Invoices" value={invStats.count} tone="cyan" />
            <Stat label="Invoiced Value" value={money(invStats.total)} />
            <Stat label="Unpaid" value={invStats.unpaid} tone="amber" />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'pos' ? 'Search PO # or supplier...' : 'Search invoice #, PO #, supplier...'}
              className="w-full max-w-xs rounded-lg border border-stone-700 bg-stone-950/60 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none"
            />
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-950/60 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-950/60 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <span className="text-xs text-stone-500">
            {tab === 'pos' ? `${filteredPos.length} of ${pos.length}` : `${filteredInvoices.length} of ${invoices.length}`}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {tab === 'pos' ? (
            filteredPos.length === 0 ? (
              <div className="px-5 py-8">
                <EmptyState
                  title={pos.length === 0 ? 'No purchase orders yet' : 'No matching purchase orders'}
                  description={pos.length === 0 ? 'Create a PO to start tracking committed spend.' : 'Adjust your filters or search.'}
                  action={pos.length === 0 ? <Button onClick={() => { setFormError(null); setShowPoModal(true) }}>New purchase order</Button> : undefined}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>PO #</TH>
                    <TH>Supplier</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Lines</TH>
                    <TH>Status</TH>
                    <TH>Issued</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredPos.map((p) => (
                    <TR key={p.id}>
                      <TD className="font-medium text-stone-100">{p.po_number}</TD>
                      <TD>{supplierName(p.supplier_id)}</TD>
                      <TD className="text-right tabular-nums text-stone-100">{money(p.total_amount)}</TD>
                      <TD className="text-right tabular-nums">{p.line_count ?? 0}</TD>
                      <TD><Badge tone={statusTone(p.status)}>{p.status || 'unknown'}</Badge></TD>
                      <TD>{fmtDate(p.issued_date)}</TD>
                      <TD className="text-right">
                        <Button variant="danger" className="px-2 py-1 text-xs" disabled={busyId === p.id} onClick={() => removePo(p.id)}>
                          {busyId === p.id ? '...' : 'Delete'}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )
          ) : (
            filteredInvoices.length === 0 ? (
              <div className="px-5 py-8">
                <EmptyState
                  title={invoices.length === 0 ? 'No invoices yet' : 'No matching invoices'}
                  description={invoices.length === 0 ? 'Create an invoice to start tracking billed spend.' : 'Adjust your filters or search.'}
                  action={invoices.length === 0 ? <Button onClick={() => { setFormError(null); setShowInvModal(true) }}>New invoice</Button> : undefined}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice #</TH>
                    <TH>Supplier</TH>
                    <TH>PO #</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Status</TH>
                    <TH>Date</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredInvoices.map((iv) => (
                    <TR key={iv.id}>
                      <TD className="font-medium text-stone-100">{iv.invoice_number}</TD>
                      <TD>{supplierName(iv.supplier_id)}</TD>
                      <TD className="text-stone-400">{iv.po_number || '—'}</TD>
                      <TD className="text-right tabular-nums text-stone-100">{money(iv.amount)}</TD>
                      <TD><Badge tone={statusTone(iv.status)}>{iv.status || 'unknown'}</Badge></TD>
                      <TD>{fmtDate(iv.invoice_date)}</TD>
                      <TD className="text-right">
                        <Button variant="danger" className="px-2 py-1 text-xs" disabled={busyId === iv.id} onClick={() => removeInv(iv.id)}>
                          {busyId === iv.id ? '...' : 'Delete'}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )
          )}
        </CardBody>
      </Card>

      <Modal
        open={showPoModal}
        onClose={() => setShowPoModal(false)}
        title="New purchase order"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPoModal(false)}>Cancel</Button>
            <Button type="submit" form="po-form" disabled={saving || !poForm.po_number.trim()}>
              {saving ? 'Creating...' : 'Create PO'}
            </Button>
          </>
        }
      >
        <form id="po-form" onSubmit={submitPo} className="space-y-4">
          {formError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>}
          <Field label="PO number" required>
            <input value={poForm.po_number} onChange={(e) => setPoForm({ ...poForm, po_number: e.target.value })} className={inputCls} placeholder="PO-1001" />
          </Field>
          <Field label="Supplier">
            <select value={poForm.supplier_id} onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })} className={inputCls}>
              <option value="">Unassigned</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total amount">
              <input type="number" step="0.01" min="0" value={poForm.total_amount} onChange={(e) => setPoForm({ ...poForm, total_amount: e.target.value })} className={inputCls} placeholder="0.00" />
            </Field>
            <Field label="Line count">
              <input type="number" min="0" value={poForm.line_count} onChange={(e) => setPoForm({ ...poForm, line_count: e.target.value })} className={inputCls} placeholder="0" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={poForm.status} onChange={(e) => setPoForm({ ...poForm, status: e.target.value })} className={inputCls}>
                {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Issued date">
              <input type="date" value={poForm.issued_date} onChange={(e) => setPoForm({ ...poForm, issued_date: e.target.value })} className={inputCls} />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={showInvModal}
        onClose={() => setShowInvModal(false)}
        title="New invoice"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowInvModal(false)}>Cancel</Button>
            <Button type="submit" form="inv-form" disabled={saving || !invForm.invoice_number.trim()}>
              {saving ? 'Creating...' : 'Create invoice'}
            </Button>
          </>
        }
      >
        <form id="inv-form" onSubmit={submitInv} className="space-y-4">
          {formError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>}
          <Field label="Invoice number" required>
            <input value={invForm.invoice_number} onChange={(e) => setInvForm({ ...invForm, invoice_number: e.target.value })} className={inputCls} placeholder="INV-2001" />
          </Field>
          <Field label="Supplier">
            <select value={invForm.supplier_id} onChange={(e) => setInvForm({ ...invForm, supplier_id: e.target.value })} className={inputCls}>
              <option value="">Unassigned</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PO number">
              <input value={invForm.po_number} onChange={(e) => setInvForm({ ...invForm, po_number: e.target.value })} className={inputCls} placeholder="PO-1001" />
            </Field>
            <Field label="Amount">
              <input type="number" step="0.01" min="0" value={invForm.amount} onChange={(e) => setInvForm({ ...invForm, amount: e.target.value })} className={inputCls} placeholder="0.00" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={invForm.status} onChange={(e) => setInvForm({ ...invForm, status: e.target.value })} className={inputCls}>
                {INV_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Invoice date">
              <input type="date" value={invForm.invoice_date} onChange={(e) => setInvForm({ ...invForm, invoice_date: e.target.value })} className={inputCls} />
            </Field>
          </div>
        </form>
      </Modal>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-stone-700 bg-stone-950/60 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}{required && <span className="text-cyan-400"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Header({ tab, setTab, onNew, disabled }: { tab: Tab; setTab: (t: Tab) => void; onNew: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-white">Purchasing</h1>
        <p className="mt-1 text-sm text-stone-500">Track purchase orders and supplier invoices feeding transaction-cost analysis.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-lg border border-stone-800 bg-stone-900/70 p-1">
          <button
            onClick={() => setTab('pos')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === 'pos' ? 'bg-cyan-500 text-stone-950' : 'text-stone-400 hover:text-white'}`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => setTab('invoices')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === 'invoices' ? 'bg-cyan-500 text-stone-950' : 'text-stone-400 hover:text-white'}`}
          >
            Invoices
          </button>
        </div>
        <Button onClick={onNew} disabled={disabled}>{tab === 'pos' ? '+ New PO' : '+ New Invoice'}</Button>
      </div>
    </div>
  )
}
