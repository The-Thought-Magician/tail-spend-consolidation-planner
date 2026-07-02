'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Scenario {
  id: string
  workspace_id: string
  name: string
  category_id?: string | null
  from_supplier_ids?: string[] | null
  to_supplier_ids?: string[] | null
  assumptions?: Record<string, number> | null
  results?: Record<string, unknown> | null
  modeled_savings?: number | string | null
  created_at?: string
  updated_at?: string
}

interface Supplier {
  id: string
  name: string
  status?: string
  category_id?: string | null
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

// Assumption sliders driving the business case.
const ASSUMPTIONS: { key: string; label: string; min: number; max: number; step: number; suffix: string; hint: string }[] = [
  { key: 'price_reduction_pct', label: 'Negotiated price reduction', min: 0, max: 40, step: 0.5, suffix: '%', hint: 'Unit-price discount from volume leverage' },
  { key: 'volume_rebate_pct', label: 'Volume rebate', min: 0, max: 15, step: 0.25, suffix: '%', hint: 'Back-end rebate on consolidated spend' },
  { key: 'maverick_recovery_pct', label: 'Maverick spend recovery', min: 0, max: 100, step: 1, suffix: '%', hint: 'Share of off-contract spend pulled on-contract' },
  { key: 'process_cost_per_supplier', label: 'Process cost / supplier removed', min: 0, max: 20000, step: 250, suffix: '$', hint: 'Annual transaction cost avoided per retired supplier' },
  { key: 'implementation_cost', label: 'One-time implementation cost', min: 0, max: 250000, step: 1000, suffix: '$', hint: 'Switching / onboarding cost' },
  { key: 'ramp_months', label: 'Ramp to full savings', min: 0, max: 24, step: 1, suffix: 'mo', hint: 'Months until savings fully realized' },
]

const DEFAULTS: Record<string, number> = {
  price_reduction_pct: 8,
  volume_rebate_pct: 2,
  maverick_recovery_pct: 60,
  process_cost_per_supplier: 4000,
  implementation_cost: 25000,
  ramp_months: 6,
}

export default function ScenarioBuilderPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [wsId, setWsId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [assumptions, setAssumptions] = useState<Record<string, number>>(DEFAULTS)
  const [fromIds, setFromIds] = useState<string[]>([])
  const [toIds, setToIds] = useState<string[]>([])

  const [supplierSearch, setSupplierSearch] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modeling, setModeling] = useState(false)
  const [modelResult, setModelResult] = useState<{ results?: Record<string, unknown>; modeled_savings?: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWsId(localStorage.getItem('tscp_workspace_id'))
    }
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const sc: Scenario = await api.getScenario(id)
      setScenario(sc)
      setName(sc.name || '')
      setAssumptions({ ...DEFAULTS, ...(sc.assumptions || {}) })
      setFromIds(Array.isArray(sc.from_supplier_ids) ? sc.from_supplier_ids : [])
      setToIds(Array.isArray(sc.to_supplier_ids) ? sc.to_supplier_ids : [])
      if (sc.results || sc.modeled_savings != null) {
        setModelResult({ results: sc.results || undefined, modeled_savings: num(sc.modeled_savings) })
      }
      const ws = sc.workspace_id || (typeof window !== 'undefined' ? localStorage.getItem('tscp_workspace_id') : null)
      if (ws) {
        const sup = await api.listSuppliers(ws)
        setSuppliers(Array.isArray(sup) ? sup : [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenario')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const supplierName = useMemo(() => {
    const m = new Map<string, string>()
    suppliers.forEach((s) => m.set(s.id, s.name))
    return m
  }, [suppliers])

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase()
    if (!q) return suppliers.slice(0, 60)
    return suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 60)
  }, [suppliers, supplierSearch])

  function setAssumption(key: string, value: number) {
    setAssumptions((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  function toggleFrom(sid: string) {
    setFromIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]))
    setToIds((prev) => prev.filter((x) => x !== sid))
    setDirty(true)
  }

  function toggleTo(sid: string) {
    setToIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]))
    setFromIds((prev) => prev.filter((x) => x !== sid))
    setDirty(true)
  }

  async function handleSave() {
    if (!id) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const updated: Scenario = await api.updateScenario(id, {
        name: name.trim() || scenario?.name,
        assumptions,
        from_supplier_ids: fromIds,
        to_supplier_ids: toIds,
      })
      setScenario(updated)
      setDirty(false)
      setNotice('Scenario saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save scenario')
    } finally {
      setSaving(false)
    }
  }

  async function handleModel() {
    if (!id) return
    setModeling(true)
    setError(null)
    setNotice(null)
    try {
      // Persist current edits first so the model runs against the latest inputs.
      if (dirty) {
        await api.updateScenario(id, {
          name: name.trim() || scenario?.name,
          assumptions,
          from_supplier_ids: fromIds,
          to_supplier_ids: toIds,
        })
        setDirty(false)
      }
      const res = await api.modelScenario(id, { assumptions, from_supplier_ids: fromIds, to_supplier_ids: toIds })
      setModelResult({
        results: res?.results,
        modeled_savings: num(res?.modeled_savings),
      })
      setNotice('Business case recomputed.')
      // Refresh stored scenario fields.
      const sc: Scenario = await api.getScenario(id)
      setScenario(sc)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to model scenario')
    } finally {
      setModeling(false)
    }
  }

  if (loading) return <PageSpinner label="Loading scenario..." />

  if (error && !scenario) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="Could not load scenario"
          description={error}
          icon="⚠️"
          action={
            <Link href="/dashboard/scenarios">
              <Button variant="secondary">Back to scenarios</Button>
            </Link>
          }
        />
      </div>
    )
  }

  if (!scenario) return null

  const modeledSavings = modelResult?.modeled_savings ?? num(scenario.modeled_savings)
  const impl = num(assumptions.implementation_cost)
  const netFirstYear = modeledSavings - impl
  const roi = impl > 0 ? (modeledSavings / impl) : 0
  const paybackMonths = modeledSavings > 0 ? Math.max(0, (impl / modeledSavings) * 12) : 0

  // Render a breakdown from results if backend supplied one, else derive a display set.
  const breakdown: { label: string; value: number }[] = (() => {
    const r = modelResult?.results || scenario.results || {}
    const entries = Object.entries(r).filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && isFinite(parseFloat(v))))
    if (entries.length > 0) {
      return entries.map(([k, v]) => ({
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
        value: num(v),
      }))
    }
    return []
  })()
  const breakdownMax = Math.max(1, ...breakdown.map((b) => Math.abs(b.value)))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/scenarios" className="text-xs text-stone-500 hover:text-stone-300">← All scenarios</Link>
          <h1 className="mt-1 text-2xl font-bold text-white">Business Case Builder</h1>
          <p className="mt-1 text-sm text-stone-400">Tune assumptions and supplier moves, then recompute the savings model.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
          </Button>
          <Button onClick={handleModel} disabled={modeling}>
            {modeling ? 'Modeling...' : 'Recompute model'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Modeled Savings (yr)" value={fmtMoney(modeledSavings)} tone="green" />
        <Stat label="Net First Year" value={fmtMoney(netFirstYear)} tone={netFirstYear >= 0 ? 'cyan' : 'rose'} />
        <Stat label="ROI" value={`${roi.toFixed(1)}x`} hint="Savings / implementation cost" tone="amber" />
        <Stat label="Payback" value={paybackMonths > 0 ? `${paybackMonths.toFixed(1)} mo` : '—'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Scenario name</h2>
            </CardHeader>
            <CardBody>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true) }}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Assumptions</h2>
              <p className="mt-1 text-xs text-stone-500">Drag sliders or type exact values. Drives the savings model.</p>
            </CardHeader>
            <CardBody className="space-y-5">
              {ASSUMPTIONS.map((a) => {
                const val = num(assumptions[a.key])
                return (
                  <div key={a.key}>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-stone-200">{a.label}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={val}
                          min={a.min}
                          max={a.max}
                          step={a.step}
                          onChange={(e) => setAssumption(a.key, num(e.target.value))}
                          className="w-24 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-right text-sm text-cyan-300 focus:border-cyan-500 focus:outline-none"
                        />
                        <span className="w-6 text-xs text-stone-500">{a.suffix}</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      value={val}
                      min={a.min}
                      max={a.max}
                      step={a.step}
                      onChange={(e) => setAssumption(a.key, num(e.target.value))}
                      className="mt-2 w-full accent-cyan-500"
                    />
                    <p className="mt-1 text-xs text-stone-600">{a.hint}</p>
                  </div>
                )
              })}
            </CardBody>
          </Card>

          {breakdown.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Savings breakdown</h2>
                <p className="mt-1 text-xs text-stone-500">Components computed by the model.</p>
              </CardHeader>
              <CardBody className="space-y-3">
                {breakdown.map((b) => (
                  <div key={b.label}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-stone-300">{b.label}</span>
                      <span className={`font-medium tabular-nums ${b.value < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {fmtMoney(b.value)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-stone-800">
                      <div
                        className={`h-full rounded-full ${b.value < 0 ? 'bg-rose-400' : 'bg-cyan-400'}`}
                        style={{ width: `${Math.round((Math.abs(b.value) / breakdownMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Supplier moves</h2>
              <p className="mt-1 text-xs text-stone-500">
                <span className="text-rose-300">{fromIds.length} retiring</span> →{' '}
                <span className="text-emerald-300">{toIds.length} consolidating to</span>
              </p>
            </CardHeader>
            <CardBody>
              <input
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                placeholder="Search suppliers..."
                className="mb-3 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-cyan-500 focus:outline-none"
              />
              {suppliers.length === 0 ? (
                <EmptyState title="No suppliers" description="Import or seed supplier data first." icon="🏷️" />
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-lg border border-stone-800">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Supplier</TH>
                        <TH className="text-center">From</TH>
                        <TH className="text-center">To</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {filteredSuppliers.map((s) => (
                        <TR key={s.id}>
                          <TD className="max-w-[160px] truncate" title={s.name}>{s.name}</TD>
                          <TD className="text-center">
                            <input
                              type="checkbox"
                              checked={fromIds.includes(s.id)}
                              onChange={() => toggleFrom(s.id)}
                              className="h-4 w-4 accent-rose-500"
                              aria-label={`Retire ${s.name}`}
                            />
                          </TD>
                          <TD className="text-center">
                            <input
                              type="checkbox"
                              checked={toIds.includes(s.id)}
                              onChange={() => toggleTo(s.id)}
                              className="h-4 w-4 accent-emerald-500"
                              aria-label={`Consolidate to ${s.name}`}
                            />
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Selected moves</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-rose-400">Retiring ({fromIds.length})</div>
                {fromIds.length === 0 ? (
                  <p className="text-xs text-stone-600">None selected.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {fromIds.map((sid) => (
                      <Badge key={sid} tone="rose">{supplierName.get(sid) || sid.slice(0, 8)}</Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-400">Consolidating to ({toIds.length})</div>
                {toIds.length === 0 ? (
                  <p className="text-xs text-stone-600">None selected.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {toIds.map((sid) => (
                      <Badge key={sid} tone="green">{supplierName.get(sid) || sid.slice(0, 8)}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
