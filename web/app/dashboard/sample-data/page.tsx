'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type Counts = Record<string, number>
interface StatusResp {
  seeded?: boolean
  counts?: Counts
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

const COUNT_LABELS: Record<string, string> = {
  categories: 'Categories',
  suppliers: 'Suppliers',
  transactions: 'Transactions',
  purchase_orders: 'Purchase Orders',
  purchaseOrders: 'Purchase Orders',
  invoices: 'Invoices',
  contracts: 'Contracts',
  aliases: 'Aliases',
}

function prettyLabel(key: string) {
  return (
    COUNT_LABELS[key] ||
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

export default function SampleDataPage() {
  const ws = useWorkspaceId()
  const [status, setStatus] = useState<StatusResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'seed' | 'reset' | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const s = await api.getSampleDataStatus(ws)
      setStatus(s || {})
    } catch (e: any) {
      setError(e?.message || 'Failed to load sample-data status')
    } finally {
      setLoading(false)
    }
  }, [ws])

  useEffect(() => {
    if (ws !== null) load()
    else setLoading(false)
  }, [ws, load])

  const seed = async () => {
    if (!ws) return
    setBusy('seed')
    setError('')
    setNotice('')
    try {
      const res = await api.seedSampleData({ workspace_id: ws })
      const counts: Counts | undefined = res?.counts
      setNotice(
        counts
          ? `Seeded ${Object.values(counts).reduce((a, b) => a + Number(b || 0), 0)} demo records.`
          : 'Sample data seeded.',
      )
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to seed sample data')
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    if (!ws) return
    if (!confirm('Wipe all data in this workspace and regenerate fresh sample data? This cannot be undone.')) return
    setBusy('reset')
    setError('')
    setNotice('')
    try {
      await api.resetSampleData({ workspace_id: ws })
      setNotice('Workspace reset and regenerated with fresh sample data.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to reset sample data')
    } finally {
      setBusy(null)
    }
  }

  const counts = status?.counts || {}
  const countEntries = Object.entries(counts)
  const totalRecords = countEntries.reduce((a, [, v]) => a + Number(v || 0), 0)
  const seeded = Boolean(status?.seeded) || totalRecords > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Sample Data</h1>
          <p className="mt-1 text-sm text-slate-400">
            Seed a complete demo procurement dataset, including duplicate suppliers, tail spend, and off-contract transactions, to explore every analysis tool instantly.
          </p>
        </div>
        {seeded ? (
          <Badge tone="green">Seeded</Badge>
        ) : (
          <Badge tone="slate">Empty</Badge>
        )}
      </div>

      {!ws && (
        <EmptyState
          title="No workspace selected"
          description={
            <>
              Pick or create a workspace first, then return here to seed demo data.
            </>
          }
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to Workspaces</Button>
            </Link>
          }
        />
      )}

      {ws && (
        <>
          {error && (
            <div className="rounded-lg border border-rose-700 bg-rose-900/30 p-3 text-sm text-rose-300">{error}</div>
          )}
          {notice && (
            <div className="rounded-lg border border-emerald-700 bg-emerald-900/20 p-3 text-sm text-emerald-300">{notice}</div>
          )}

          {loading ? (
            <PageSpinner label="Loading sample-data status..." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <Stat
                  label="Status"
                  value={seeded ? 'Seeded' : 'Empty'}
                  tone={seeded ? 'green' : 'default'}
                  hint={seeded ? 'Demo dataset present' : 'No demo data yet'}
                />
                <Stat label="Total Records" value={totalRecords.toLocaleString()} tone="cyan" />
                {countEntries.slice(0, 6).map(([k, v]) => (
                  <Stat key={k} label={prettyLabel(k)} value={Number(v || 0).toLocaleString()} />
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <h2 className="text-base font-semibold text-white">One-click demo seeding</h2>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <p className="text-sm text-slate-400">
                      Generates a realistic spend dataset in this workspace: a category tree, suppliers (with intentional duplicates and aliases), thousands of transactions across the long tail, purchase orders, invoices, and contracts.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={seed} disabled={busy !== null}>
                        {busy === 'seed' ? <Spinner /> : seeded ? 'Add More Sample Data' : 'Seed Sample Data'}
                      </Button>
                      <Button variant="secondary" onClick={load} disabled={busy !== null}>
                        Refresh Status
                      </Button>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <h2 className="text-base font-semibold text-white">Reset workspace</h2>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <p className="text-sm text-slate-400">
                      Wipes all spend data in this workspace and regenerates a fresh sample dataset. Use this to start from a clean slate.
                    </p>
                    <Button variant="danger" onClick={reset} disabled={busy !== null}>
                      {busy === 'reset' ? <Spinner /> : 'Reset & Regenerate'}
                    </Button>
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <h2 className="text-base font-semibold text-white">Dataset breakdown</h2>
                </CardHeader>
                <CardBody>
                  {countEntries.length === 0 ? (
                    <EmptyState
                      title="No sample data yet"
                      description="Seed the demo dataset to populate every dashboard."
                      action={
                        <Button onClick={seed} disabled={busy !== null}>
                          {busy === 'seed' ? <Spinner /> : 'Seed Sample Data'}
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {(() => {
                        const max = Math.max(...countEntries.map(([, v]) => Number(v || 0)), 1)
                        return countEntries.map(([k, v]) => {
                          const n = Number(v || 0)
                          return (
                            <div key={k} className="flex items-center gap-3">
                              <div className="w-36 shrink-0 text-sm text-slate-400">{prettyLabel(k)}</div>
                              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                                <div
                                  className="h-full rounded-full bg-cyan-500"
                                  style={{ width: `${Math.max((n / max) * 100, n > 0 ? 4 : 0)}%` }}
                                />
                              </div>
                              <div className="w-20 shrink-0 text-right text-sm font-medium text-slate-200">
                                {n.toLocaleString()}
                              </div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}
                </CardBody>
              </Card>

              <p className="text-xs text-slate-500">
                After seeding, explore the{' '}
                <Link href="/dashboard/tail" className="text-cyan-400 hover:text-cyan-300">Tail Spend</Link>,{' '}
                <Link href="/dashboard/duplicates" className="text-cyan-400 hover:text-cyan-300">Duplicates</Link>, and{' '}
                <Link href="/dashboard/recommendations" className="text-cyan-400 hover:text-cyan-300">Recommendations</Link>{' '}
                tools to see the consolidation engine in action.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
