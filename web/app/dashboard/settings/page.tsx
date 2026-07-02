'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type Workspace = {
  id: string
  name?: string | null
  base_currency?: string | null
  fiscal_year_start?: string | null
  tail_threshold_pct?: number | string | null
  owner_id?: string | null
  settings?: Record<string, any> | null
  created_at?: string | null
  updated_at?: string | null
}

type Plan = { id?: string; name?: string | null; price_cents?: number | null }
type Subscription = {
  plan_id?: string | null
  status?: string | null
  current_period_end?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
}
type BillingInfo = { subscription?: Subscription | null; plan?: Plan | null; stripeEnabled?: boolean }

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR', 'SGD', 'CNY']

const FY_MONTHS = [
  { value: '01-01', label: 'January (calendar year)' },
  { value: '02-01', label: 'February' },
  { value: '03-01', label: 'March' },
  { value: '04-01', label: 'April' },
  { value: '05-01', label: 'May' },
  { value: '06-01', label: 'June' },
  { value: '07-01', label: 'July' },
  { value: '08-01', label: 'August' },
  { value: '09-01', label: 'September' },
  { value: '10-01', label: 'October' },
  { value: '11-01', label: 'November' },
  { value: '12-01', label: 'December' },
]

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

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function planTone(status?: string | null): 'green' | 'amber' | 'rose' | 'slate' {
  switch ((status || '').toLowerCase()) {
    case 'active':
    case 'trialing':
      return 'green'
    case 'past_due':
    case 'incomplete':
      return 'amber'
    case 'canceled':
    case 'unpaid':
      return 'rose'
    default:
      return 'slate'
  }
}

export default function SettingsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [billing, setBilling] = useState<BillingInfo | null>(null)

  // form state
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fyStart, setFyStart] = useState('01-01')
  const [tailThreshold, setTailThreshold] = useState('80')

  const [saving, setSaving] = useState(false)
  const [billingBusy, setBillingBusy] = useState<'checkout' | 'portal' | null>(null)

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  function hydrateForm(ws: Workspace) {
    setName(ws.name || '')
    setCurrency((ws.base_currency || 'USD').toUpperCase())
    setFyStart(normalizeFy(ws.fiscal_year_start))
    const t = num(ws.tail_threshold_pct)
    setTailThreshold(t > 0 ? String(t <= 1 ? Math.round(t * 100) : t) : '80')
  }

  async function loadAll(ws: string) {
    const [w, b] = await Promise.all([api.getWorkspace(ws), api.getBillingPlan().catch(() => null)])
    setWorkspace(w)
    hydrateForm(w)
    setBilling(b)
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadAll(workspaceId)
      .catch((e) => !cancelled && setError(e.message || 'Failed to load settings'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const dirty = useMemo(() => {
    if (!workspace) return false
    const t = num(workspace.tail_threshold_pct)
    const wsThreshold = t > 0 ? String(t <= 1 ? Math.round(t * 100) : t) : '80'
    return (
      name !== (workspace.name || '') ||
      currency !== (workspace.base_currency || 'USD').toUpperCase() ||
      fyStart !== normalizeFy(workspace.fiscal_year_start) ||
      tailThreshold !== wsThreshold
    )
  }, [workspace, name, currency, fyStart, tailThreshold])

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!workspaceId || !workspace) return
    const thr = num(tailThreshold)
    if (thr <= 0 || thr > 100) {
      setError('Tail threshold must be between 1 and 100 percent.')
      return
    }
    if (!name.trim()) {
      setError('Workspace name is required.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await api.updateWorkspace(workspaceId, {
        name: name.trim(),
        base_currency: currency,
        fiscal_year_start: fyStart,
        tail_threshold_pct: thr / 100,
      })
      const ws: Workspace = updated && updated.id ? updated : { ...workspace, name: name.trim(), base_currency: currency, fiscal_year_start: fyStart, tail_threshold_pct: thr / 100 }
      setWorkspace(ws)
      hydrateForm(ws)
      setNotice('Workspace settings saved.')
    } catch (err: any) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    if (workspace) hydrateForm(workspace)
    setError(null)
    setNotice(null)
  }

  async function handleCheckout() {
    setBillingBusy('checkout')
    setError(null)
    try {
      const res = await api.startCheckout({ workspace_id: workspaceId })
      if (res?.url) window.location.href = res.url
      else setNotice('Checkout is not available right now.')
    } catch (err: any) {
      setError(err.message || 'Billing is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(null)
    }
  }

  async function handlePortal() {
    setBillingBusy('portal')
    setError(null)
    try {
      const res = await api.openBillingPortal({ workspace_id: workspaceId })
      if (res?.url) window.location.href = res.url
      else setNotice('Billing portal is not available right now.')
    } catch (err: any) {
      setError(err.message || 'Billing portal is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(null)
    }
  }

  if (!workspaceId && !loading) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace to configure its settings."
          action={
            <a href="/dashboard/workspaces">
              <Button>Go to workspaces</Button>
            </a>
          }
        />
      </div>
    )
  }

  const stripeEnabled = !!billing?.stripeEnabled
  const sub = billing?.subscription
  const currentPlanId = sub?.plan_id || 'free'
  const isPro = currentPlanId === 'pro'

  return (
    <div className="space-y-6">
      <Header />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading settings..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Base currency" value={currency} tone="cyan" />
            <Stat label="Tail threshold" value={`${num(tailThreshold)}%`} tone="cyan" hint="Pareto cutoff" />
            <Stat label="Plan" value={isPro ? 'Pro' : 'Free'} tone={isPro ? 'green' : 'amber'} />
            <Stat label="Created" value={fmtDate(workspace?.created_at)} />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Workspace configuration</h2>
              <p className="text-xs text-stone-500">
                Currency, fiscal year and the tail-spend threshold used across all analyses.
              </p>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSave} className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                      Workspace name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Acme Procurement"
                      className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                      Base currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-stone-500">All spend is reported in this currency.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                      Fiscal year start
                    </label>
                    <select
                      value={fyStart}
                      onChange={(e) => setFyStart(e.target.value)}
                      className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
                    >
                      {FY_MONTHS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-stone-500">Anchors period rollups and trend charts.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                      Tail spend threshold ({num(tailThreshold)}%)
                    </label>
                    <input
                      type="range"
                      min={50}
                      max={99}
                      step={1}
                      value={num(tailThreshold)}
                      onChange={(e) => setTailThreshold(e.target.value)}
                      className="w-full accent-cyan-500"
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-xs text-stone-500">
                        Suppliers below the top {num(tailThreshold)}% of spend are tail.
                      </p>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={tailThreshold}
                        onChange={(e) => setTailThreshold(e.target.value)}
                        className="w-16 rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-right text-xs text-stone-200 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-stone-800 pt-4">
                  <Button type="button" variant="ghost" onClick={resetForm} disabled={!dirty || saving}>
                    Reset
                  </Button>
                  <Button type="submit" disabled={!dirty || saving}>
                    {saving ? 'Saving...' : 'Save changes'}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Billing</h2>
                <p className="text-xs text-stone-500">All features are free. Pro is optional support for the project.</p>
              </div>
              <Badge tone={sub?.status ? planTone(sub.status) : isPro ? 'green' : 'slate'}>
                {sub?.status ? sub.status.replace('_', ' ') : isPro ? 'pro' : 'free'}
              </Badge>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={`rounded-xl border p-4 ${!isPro ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-stone-800 bg-stone-900/50'}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">Free</h3>
                    {!isPro && <Badge tone="cyan">Current</Badge>}
                  </div>
                  <p className="mt-1 text-2xl font-bold text-white">
                    $0<span className="text-sm font-normal text-stone-500">/mo</span>
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm text-stone-400">
                    <li>· All analysis modules</li>
                    <li>· Unlimited suppliers & transactions</li>
                    <li>· Board-ready reports</li>
                  </ul>
                </div>
                <div className={`rounded-xl border p-4 ${isPro ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-stone-800 bg-stone-900/50'}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">Pro</h3>
                    {isPro && <Badge tone="green">Current</Badge>}
                  </div>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {billing?.plan?.price_cents != null
                      ? `$${(num(billing.plan.price_cents) / 100).toFixed(0)}`
                      : '$49'}
                    <span className="text-sm font-normal text-stone-500">/mo</span>
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm text-stone-400">
                    <li>· Everything in Free</li>
                    <li>· Priority support</li>
                    <li>· Support continued development</li>
                  </ul>
                </div>
              </div>

              {sub && (sub.current_period_end || sub.stripe_customer_id) && (
                <div className="rounded-lg border border-stone-800 bg-stone-900/50 px-4 py-3 text-sm text-stone-400">
                  {sub.current_period_end && (
                    <span>
                      Current period ends <span className="text-stone-200">{fmtDate(sub.current_period_end)}</span>.{' '}
                    </span>
                  )}
                  {sub.stripe_customer_id && <span>Customer {String(sub.stripe_customer_id).slice(0, 14)}.</span>}
                </div>
              )}

              {!stripeEnabled && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  Stripe is not configured for this deployment, so billing is disabled. Every feature remains free.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!isPro ? (
                  <Button onClick={handleCheckout} disabled={!stripeEnabled || billingBusy === 'checkout'}>
                    {billingBusy === 'checkout' ? 'Redirecting...' : 'Upgrade to Pro'}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={handlePortal} disabled={!stripeEnabled || billingBusy === 'portal'}>
                    {billingBusy === 'portal' ? 'Opening...' : 'Manage subscription'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={handlePortal}
                  disabled={!stripeEnabled || billingBusy === 'portal'}
                >
                  {billingBusy === 'portal' ? 'Opening...' : 'Billing portal'}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Workspace details</h2>
            </CardHeader>
            <CardBody>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <DetailRow label="Workspace ID" value={<code className="text-xs text-stone-300">{workspace?.id}</code>} />
                <DetailRow label="Owner" value={workspace?.owner_id ? String(workspace.owner_id).slice(0, 16) : '—'} />
                <DetailRow label="Created" value={fmtDate(workspace?.created_at)} />
                <DetailRow label="Last updated" value={fmtDate(workspace?.updated_at)} />
              </dl>
              <p className="mt-4 text-xs text-stone-600">
                To rename members or delete this workspace, head to{' '}
                <a href="/dashboard/workspaces" className="text-cyan-400 hover:text-cyan-300">
                  Workspaces
                </a>
                .
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function normalizeFy(v?: string | null): string {
  if (!v) return '01-01'
  // accept full date, MM-DD, or month index
  const s = String(v)
  const m = s.match(/(\d{2})-(\d{2})/)
  if (m) {
    const mm = m[1]
    return `${mm}-01`
  }
  const n = parseInt(s, 10)
  if (Number.isFinite(n) && n >= 1 && n <= 12) return `${String(n).padStart(2, '0')}-01`
  return '01-01'
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-stone-800/60 pb-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-stone-200">{value}</dd>
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-stone-500">Workspace configuration, currency, tail threshold and billing.</p>
      </div>
    </div>
  )
}
