'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type CostModel = {
  id: string
  workspace_id: string
  name: string
  cost_per_po?: number | string | null
  cost_per_invoice?: number | string | null
  cost_per_supplier?: number | string | null
  is_default?: boolean | null
  created_at?: string | null
}

type LedgerRow = {
  id: string
  workspace_id: string
  model_id?: string | null
  supplier_id?: string | null
  supplier_name?: string | null
  po_count?: number | string | null
  invoice_count?: number | string | null
  est_cost?: number | string | null
  computed_at?: string | null
}

type Reduction = {
  n?: number | string | null
  removed_suppliers?: number | string | null
  current_cost?: number | string | null
  baseline_cost?: number | string | null
  projected_cost?: number | string | null
  reduced_cost?: number | string | null
  savings?: number | string | null
  cost_reduction?: number | string | null
  points?: Array<{ n?: number | string; savings?: number | string; cost?: number | string }>
}

function getWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('tscp_workspace_id') || localStorage.getItem('tscp_workspace') || null
  } catch {
    return null
  }
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function money(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function money2(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const emptyForm = { name: '', cost_per_po: '120', cost_per_invoice: '40', cost_per_supplier: '500', is_default: false }

export default function TransactionCostPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [models, setModels] = useState<CostModel[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [reduction, setReduction] = useState<Reduction | null>(null)
  const [reductionN, setReductionN] = useState(20)

  const [search, setSearch] = useState('')
  const [computing, setComputing] = useState(false)
  const [computeModelId, setComputeModelId] = useState<string>('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CostModel | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  async function loadAll(ws: string, n: number) {
    const [m, l, red] = await Promise.all([
      api.getCostModels(ws),
      api.getCostLedger(ws),
      api.getCostReduction(ws, { n }),
    ])
    const modelList: CostModel[] = Array.isArray(m) ? m : m?.rows ?? []
    setModels(modelList)
    setLedger(Array.isArray(l) ? l : l?.ledger ?? l?.rows ?? [])
    setReduction(red && typeof red === 'object' ? red : null)
    if (!computeModelId) {
      const def = modelList.find((x) => x.is_default) || modelList[0]
      if (def) setComputeModelId(def.id)
    }
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadAll(workspaceId, reductionN)
      .catch((e) => !cancelled && setError(e.message || 'Failed to load transaction cost data'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  async function refreshReduction(n: number) {
    if (!workspaceId) return
    try {
      const red = await api.getCostReduction(workspaceId, { n })
      setReduction(red && typeof red === 'object' ? red : null)
    } catch (e: any) {
      setError(e.message || 'Failed to recompute reduction')
    }
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setModalOpen(true)
  }

  function openEdit(m: CostModel) {
    setEditing(m)
    setForm({
      name: m.name || '',
      cost_per_po: String(num(m.cost_per_po)),
      cost_per_invoice: String(num(m.cost_per_invoice)),
      cost_per_supplier: String(num(m.cost_per_supplier)),
      is_default: !!m.is_default,
    })
    setModalOpen(true)
  }

  async function saveModel() {
    if (!workspaceId || !form.name.trim()) {
      setError('Model name is required')
      return
    }
    setSaving(true)
    setError(null)
    const body = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      cost_per_po: num(form.cost_per_po),
      cost_per_invoice: num(form.cost_per_invoice),
      cost_per_supplier: num(form.cost_per_supplier),
      is_default: form.is_default,
    }
    try {
      if (editing) await api.updateCostModel(editing.id, body)
      else await api.createCostModel(body)
      setModalOpen(false)
      await loadAll(workspaceId, reductionN)
    } catch (e: any) {
      setError(e.message || 'Failed to save model')
    } finally {
      setSaving(false)
    }
  }

  async function deleteModel(m: CostModel) {
    if (!workspaceId) return
    if (!confirm(`Delete cost model "${m.name}"?`)) return
    setError(null)
    try {
      await api.deleteCostModel(m.id)
      if (computeModelId === m.id) setComputeModelId('')
      await loadAll(workspaceId, reductionN)
    } catch (e: any) {
      setError(e.message || 'Failed to delete model')
    }
  }

  async function makeDefault(m: CostModel) {
    if (!workspaceId) return
    setError(null)
    try {
      await api.updateCostModel(m.id, { is_default: true })
      await loadAll(workspaceId, reductionN)
    } catch (e: any) {
      setError(e.message || 'Failed to set default')
    }
  }

  async function handleCompute() {
    if (!workspaceId) return
    const modelId = computeModelId || models.find((m) => m.is_default)?.id || models[0]?.id
    if (!modelId) {
      setError('Create a cost model first')
      return
    }
    setComputing(true)
    setError(null)
    try {
      await api.computeTransactionCost({ workspace_id: workspaceId, model_id: modelId })
      await loadAll(workspaceId, reductionN)
    } catch (e: any) {
      setError(e.message || 'Compute failed')
    } finally {
      setComputing(false)
    }
  }

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? ledger.filter((r) =>
          [r.supplier_name, r.supplier_id].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
        )
      : ledger
    return [...list].sort((a, b) => num(b.est_cost) - num(a.est_cost))
  }, [ledger, search])

  const ledgerTotals = useMemo(() => {
    const totalCost = ledger.reduce((s, r) => s + num(r.est_cost), 0)
    const totalPo = ledger.reduce((s, r) => s + num(r.po_count), 0)
    const totalInv = ledger.reduce((s, r) => s + num(r.invoice_count), 0)
    return { totalCost, totalPo, totalInv, suppliers: ledger.length }
  }, [ledger])

  const maxLedgerCost = Math.max(0.0001, ...ledger.map((r) => num(r.est_cost)))

  const redBaseline = num(reduction?.baseline_cost ?? reduction?.current_cost ?? ledgerTotals.totalCost)
  const redSavings = num(reduction?.savings ?? reduction?.cost_reduction)
  const redProjected = reduction?.projected_cost != null || reduction?.reduced_cost != null
    ? num(reduction?.projected_cost ?? reduction?.reduced_cost)
    : Math.max(0, redBaseline - redSavings)
  const redPct = redBaseline > 0 ? (redSavings / redBaseline) * 100 : 0

  if (!workspaceId && !loading) {
    return (
      <div className="space-y-6">
        <Header onCompute={handleCompute} onCreate={openCreate} computing={computing} disabled />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace to model transaction costs."
          action={
            <a href="/dashboard/workspaces">
              <Button>Go to workspaces</Button>
            </a>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onCompute={handleCompute} onCreate={openCreate} computing={computing} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading transaction cost models..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total process cost" value={money(ledgerTotals.totalCost)} tone="rose" hint={`${ledgerTotals.suppliers} suppliers`} />
            <Stat label="POs processed" value={ledgerTotals.totalPo.toLocaleString()} tone="cyan" />
            <Stat label="Invoices processed" value={ledgerTotals.totalInv.toLocaleString()} tone="cyan" />
            <Stat label="Cost models" value={models.length} hint={models.find((m) => m.is_default)?.name || 'no default'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Cost models</h2>
                  <p className="text-xs text-stone-500">Per-PO, per-invoice and per-supplier processing costs</p>
                </div>
                <Button variant="secondary" onClick={openCreate}>New model</Button>
              </CardHeader>
              <CardBody className="px-0 py-0">
                {models.length === 0 ? (
                  <div className="px-5 py-8">
                    <EmptyState
                      title="No cost models"
                      description="Create a model to estimate per-supplier transaction processing cost."
                      action={<Button onClick={openCreate}>Create model</Button>}
                    />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Model</TH>
                        <TH className="text-right">PO</TH>
                        <TH className="text-right">Invoice</TH>
                        <TH className="text-right">Supplier</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {models.map((m) => (
                        <TR key={m.id}>
                          <TD>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-stone-200">{m.name}</span>
                              {m.is_default && <Badge tone="cyan">default</Badge>}
                            </div>
                          </TD>
                          <TD className="text-right tabular-nums">{money2(m.cost_per_po)}</TD>
                          <TD className="text-right tabular-nums">{money2(m.cost_per_invoice)}</TD>
                          <TD className="text-right tabular-nums">{money2(m.cost_per_supplier)}</TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-1">
                              {!m.is_default && (
                                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => makeDefault(m)}>
                                  Default
                                </Button>
                              )}
                              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(m)}>
                                Edit
                              </Button>
                              <Button variant="ghost" className="px-2 py-1 text-xs text-rose-300" onClick={() => deleteModel(m)}>
                                Delete
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

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Tail reduction sensitivity</h2>
                <p className="text-xs text-stone-500">Modeled cost reduction from removing N tail suppliers</p>
              </CardHeader>
              <CardBody>
                <label className="mb-1 flex items-center justify-between text-xs text-stone-400">
                  <span>Suppliers to remove</span>
                  <span className="font-semibold text-cyan-300">{reductionN}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={reductionN}
                  onChange={(e) => setReductionN(Number(e.target.value))}
                  onMouseUp={(e) => refreshReduction(Number((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => refreshReduction(Number((e.target as HTMLInputElement).value))}
                  className="w-full accent-cyan-500"
                />
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Baseline</div>
                    <div className="mt-1 text-lg font-bold text-stone-200">{money(redBaseline)}</div>
                  </div>
                  <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Projected</div>
                    <div className="mt-1 text-lg font-bold text-cyan-300">{money(redProjected)}</div>
                  </div>
                  <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Savings</div>
                    <div className="mt-1 text-lg font-bold text-emerald-300">{money(redSavings)}</div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-stone-400">Reduction</span>
                    <span className="font-medium text-emerald-300">{redPct.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-stone-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                      style={{ width: `${Math.min(100, Math.max(0, redPct))}%` }}
                    />
                  </div>
                </div>
                {Array.isArray(reduction?.points) && reduction!.points!.length > 0 && (
                  <div className="mt-5">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Savings curve</div>
                    <div className="mt-2 flex h-24 items-end gap-1">
                      {reduction!.points!.map((p, i) => {
                        const maxS = Math.max(0.0001, ...reduction!.points!.map((x) => num(x.savings)))
                        const h = (num(p.savings) / maxS) * 100
                        return (
                          <div
                            key={i}
                            title={`n=${num(p.n)} · ${money(p.savings)}`}
                            className="flex-1 rounded-t bg-cyan-500/60 hover:bg-cyan-400"
                            style={{ height: `${Math.max(2, h)}%` }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Cost ledger</h2>
                <p className="text-xs text-stone-500">{filteredLedger.length} of {ledger.length} suppliers</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search suppliers..."
                  className="w-44 rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={computeModelId}
                  onChange={(e) => setComputeModelId(e.target.value)}
                  className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="">Model: default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <Button onClick={handleCompute} disabled={computing}>
                  {computing ? 'Computing...' : 'Compute ledger'}
                </Button>
              </div>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {filteredLedger.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title={ledger.length === 0 ? 'No ledger computed' : 'No suppliers match your search'}
                    description={
                      ledger.length === 0
                        ? 'Compute the ledger to estimate per-supplier processing cost from PO and invoice counts.'
                        : 'Try a different search term.'
                    }
                    action={
                      ledger.length === 0 ? (
                        <Button onClick={handleCompute} disabled={computing}>
                          {computing ? 'Computing...' : 'Compute ledger'}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Supplier</TH>
                      <TH className="text-right">POs</TH>
                      <TH className="text-right">Invoices</TH>
                      <TH className="text-right">Est. cost</TH>
                      <TH>Share</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredLedger.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <div className="text-stone-200">
                            {r.supplier_name || (r.supplier_id ? `Supplier ${String(r.supplier_id).slice(0, 8)}` : '—')}
                          </div>
                        </TD>
                        <TD className="text-right tabular-nums text-stone-400">{num(r.po_count).toLocaleString()}</TD>
                        <TD className="text-right tabular-nums text-stone-400">{num(r.invoice_count).toLocaleString()}</TD>
                        <TD className="text-right font-semibold tabular-nums text-rose-300">{money(r.est_cost)}</TD>
                        <TD>
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-stone-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-rose-500"
                              style={{ width: `${Math.min(100, (num(r.est_cost) / maxLedgerCost) * 100)}%` }}
                            />
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit cost model' : 'New cost model'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveModel} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create model'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Standard process cost"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Cost / PO">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.cost_per_po}
                onChange={(e) => setForm({ ...form, cost_per_po: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Cost / Invoice">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.cost_per_invoice}
                onChange={(e) => setForm({ ...form, cost_per_invoice: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
            <Field label="Cost / Supplier">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.cost_per_supplier}
                onChange={(e) => setForm({ ...form, cost_per_supplier: e.target.value })}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              className="accent-cyan-500"
            />
            Set as default model
          </label>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</label>
      {children}
    </div>
  )
}

function Header({
  onCompute,
  onCreate,
  computing,
  disabled,
}: {
  onCompute: () => void
  onCreate: () => void
  computing: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Transaction Cost</h1>
        <p className="text-sm text-stone-500">Process-cost models, per-supplier ledger, and tail-reduction sensitivity.</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCreate} disabled={disabled}>
          New model
        </Button>
        <Button onClick={onCompute} disabled={computing || disabled}>
          {computing ? 'Computing...' : 'Compute ledger'}
        </Button>
      </div>
    </div>
  )
}
