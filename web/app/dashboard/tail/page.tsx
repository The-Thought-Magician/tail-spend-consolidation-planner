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

interface TailSegment {
  id: string
  segment: string
  dimension: string
  supplier_count: number | null
  spend: number | string | null
  spend_share: number | string | null
  threshold_pct: number | string | null
  computed_at: string | null
}

interface Concentration {
  tail_supplier_count?: number
  tail_spend?: number | string
  tail_spend_pct?: number | string
  avg_spend_per_tail_supplier?: number | string
  total_spend?: number | string
  total_supplier_count?: number
  [k: string]: unknown
}

interface TrendPoint {
  period: string
  tail_supplier_count?: number
  tail_spend?: number | string
  tail_spend_pct?: number | string
  [k: string]: unknown
}

interface Supplier {
  id: string
  name: string
  spend?: number | string
  status?: string
  [k: string]: unknown
}

const WS_KEY = 'tscp_workspace_id'
const DIMENSIONS = ['supplier', 'category', 'cost_center']

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}
function money(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function pct(v: unknown): string {
  const n = num(v)
  const scaled = n > 0 && n <= 1 ? n * 100 : n
  return `${scaled.toFixed(1)}%`
}

function segTone(seg: string): 'cyan' | 'amber' | 'rose' | 'slate' {
  const s = seg.toLowerCase()
  if (s.includes('tail')) return 'rose'
  if (s.includes('mid') || s.includes('body')) return 'amber'
  if (s.includes('head') || s.includes('strategic') || s.includes('core')) return 'cyan'
  return 'slate'
}

export default function TailPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [dimension, setDimension] = useState('supplier')

  const [segments, setSegments] = useState<TailSegment[]>([])
  const [concentration, setConcentration] = useState<Concentration | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [computing, setComputing] = useState(false)

  const [threshold, setThreshold] = useState('80')

  const [drillSegment, setDrillSegment] = useState<string | null>(null)
  const [drillSuppliers, setDrillSuppliers] = useState<Supplier[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)

  useEffect(() => {
    try { setWsId(localStorage.getItem(WS_KEY)) } catch { setWsId(null) }
  }, [])

  const load = useCallback(async (ws: string, dim: string) => {
    setLoading(true)
    setError(null)
    try {
      const [segRes, concRes, trendRes] = await Promise.all([
        api.getTailSegments(ws, { dimension: dim }),
        api.getTailConcentration(ws),
        api.getTailTrend(ws),
      ])
      setSegments(Array.isArray(segRes) ? segRes : [])
      setConcentration(concRes && typeof concRes === 'object' ? concRes : null)
      const pts = (trendRes && Array.isArray(trendRes.points)) ? trendRes.points : Array.isArray(trendRes) ? trendRes : []
      setTrend(pts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tail analysis')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) load(wsId, dimension)
    else setLoading(false)
  }, [wsId, dimension, load])

  async function runCompute() {
    if (!wsId) return
    setComputing(true)
    setError(null)
    try {
      await api.computeTail({
        workspace_id: wsId,
        dimension,
        threshold_pct: num(threshold) || 80,
      })
      await load(wsId, dimension)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute tail segments')
    } finally {
      setComputing(false)
    }
  }

  async function openDrill(segment: string) {
    if (!wsId) return
    setDrillSegment(segment)
    setDrillSuppliers([])
    setDrillError(null)
    setDrillLoading(true)
    try {
      const res = await api.getTailSegmentSuppliers(segment, wsId)
      setDrillSuppliers(Array.isArray(res) ? res : [])
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to load suppliers')
    } finally {
      setDrillLoading(false)
    }
  }

  const totalSpend = useMemo(
    () => segments.reduce((acc, s) => acc + num(s.spend), 0),
    [segments],
  )

  const maxTrend = useMemo(
    () => Math.max(1, ...trend.map((p) => num(p.tail_spend) || num(p.tail_supplier_count))),
    [trend],
  )

  if (!wsId && !loading) {
    return (
      <div className="space-y-6">
        <Header dimension={dimension} setDimension={setDimension} disabled />
        <EmptyState title="No workspace selected" description="Select a workspace to analyze tail spend." />
      </div>
    )
  }

  if (loading) return <PageSpinner label="Loading tail analysis..." />

  return (
    <div className="space-y-6">
      <Header
        dimension={dimension}
        setDimension={setDimension}
        threshold={threshold}
        setThreshold={setThreshold}
        onCompute={runCompute}
        computing={computing}
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {/* Concentration stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tail Suppliers" value={(concentration?.tail_supplier_count ?? 0).toLocaleString()} tone="rose"
          hint={concentration?.total_supplier_count != null ? `of ${num(concentration.total_supplier_count).toLocaleString()} total` : undefined} />
        <Stat label="Tail Spend" value={money(concentration?.tail_spend)} tone="amber"
          hint={concentration?.total_spend != null ? `of ${money(concentration.total_spend)} total` : undefined} />
        <Stat label="Tail Spend %" value={pct(concentration?.tail_spend_pct)} tone="cyan" />
        <Stat label="Avg / Tail Supplier" value={money(concentration?.avg_spend_per_tail_supplier)} />
      </div>

      {/* Pareto segments */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Pareto Segments</h2>
            <p className="text-xs text-slate-500">Spend distribution by {dimension.replace('_', ' ')}</p>
          </div>
          {segments[0]?.computed_at && (
            <span className="text-xs text-slate-500">Computed {new Date(segments[0].computed_at).toLocaleString()}</span>
          )}
        </CardHeader>
        <CardBody>
          {segments.length === 0 ? (
            <EmptyState
              title="No segments computed"
              description="Run the Pareto classifier to split spend into head, mid, and tail bands."
              action={<Button onClick={runCompute} disabled={computing}>{computing ? 'Computing...' : 'Compute tail segments'}</Button>}
            />
          ) : (
            <div className="space-y-4">
              {/* Stacked Pareto bar */}
              <div className="space-y-2">
                <div className="flex h-8 w-full overflow-hidden rounded-lg border border-slate-800">
                  {segments.map((s) => {
                    const share = totalSpend > 0 ? (num(s.spend) / totalSpend) * 100 : 0
                    const tone = segTone(s.segment)
                    const bg = tone === 'rose' ? 'bg-rose-500/70' : tone === 'amber' ? 'bg-amber-500/70' : tone === 'cyan' ? 'bg-cyan-500/70' : 'bg-slate-600'
                    return (
                      <div key={s.id} className={`${bg} flex items-center justify-center`} style={{ width: `${Math.max(share, 0)}%` }} title={`${s.segment}: ${money(s.spend)} (${share.toFixed(1)}%)`}>
                        {share > 8 && <span className="px-1 text-[10px] font-semibold text-slate-950">{share.toFixed(0)}%</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              <Table>
                <THead>
                  <TR>
                    <TH>Segment</TH>
                    <TH className="text-right">Suppliers</TH>
                    <TH className="text-right">Spend</TH>
                    <TH className="text-right">Share</TH>
                    <TH>Distribution</TH>
                    <TH className="text-right">Drilldown</TH>
                  </TR>
                </THead>
                <TBody>
                  {segments.map((s) => {
                    const share = num(s.spend_share) || (totalSpend > 0 ? (num(s.spend) / totalSpend) * 100 : 0)
                    const scaledShare = share > 0 && share <= 1 ? share * 100 : share
                    return (
                      <TR key={s.id}>
                        <TD><Badge tone={segTone(s.segment)}>{s.segment}</Badge></TD>
                        <TD className="text-right tabular-nums">{(s.supplier_count ?? 0).toLocaleString()}</TD>
                        <TD className="text-right tabular-nums text-slate-100">{money(s.spend)}</TD>
                        <TD className="text-right tabular-nums">{scaledShare.toFixed(1)}%</TD>
                        <TD>
                          <div className="h-2 w-full max-w-[160px] overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full bg-cyan-500" style={{ width: `${Math.min(scaledShare, 100)}%` }} />
                          </div>
                        </TD>
                        <TD className="text-right">
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openDrill(s.segment)}>View suppliers</Button>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Tail Trend</h2>
          <p className="text-xs text-slate-500">Tail spend over time</p>
        </CardHeader>
        <CardBody>
          {trend.length === 0 ? (
            <EmptyState title="No trend data" description="Compute tail segments across multiple periods to build a trend." />
          ) : (
            <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
              {trend.map((p, i) => {
                const val = num(p.tail_spend) || num(p.tail_supplier_count)
                const h = maxTrend > 0 ? (val / maxTrend) * 150 : 0
                return (
                  <div key={`${p.period}-${i}`} className="flex min-w-[40px] flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] text-slate-500 tabular-nums">{num(p.tail_spend) ? money(p.tail_spend) : val}</span>
                    <div className="flex w-full items-end justify-center" style={{ height: 150 }}>
                      <div className="w-full rounded-t bg-gradient-to-t from-cyan-600 to-cyan-400" style={{ height: `${Math.max(h, 2)}px` }} title={`${p.period}: ${money(p.tail_spend)}`} />
                    </div>
                    <span className="max-w-full truncate text-[10px] text-slate-500" title={p.period}>{p.period}</span>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Drilldown modal */}
      <Modal
        open={drillSegment != null}
        onClose={() => setDrillSegment(null)}
        title={drillSegment ? `Suppliers in "${drillSegment}"` : 'Suppliers'}
        className="max-w-2xl"
      >
        {drillLoading ? (
          <div className="py-8"><PageSpinner label="Loading suppliers..." /></div>
        ) : drillError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{drillError}</div>
        ) : drillSuppliers.length === 0 ? (
          <EmptyState title="No suppliers in this segment" />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Supplier</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Spend</TH>
                </TR>
              </THead>
              <TBody>
                {drillSuppliers.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-slate-100">{s.name}</TD>
                    <TD>{s.status ? <Badge tone="slate">{s.status}</Badge> : <span className="text-slate-600">—</span>}</TD>
                    <TD className="text-right tabular-nums">{s.spend != null ? money(s.spend) : '—'}</TD>
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

function Header({
  dimension, setDimension, threshold, setThreshold, onCompute, computing, disabled,
}: {
  dimension: string
  setDimension: (d: string) => void
  threshold?: string
  setThreshold?: (t: string) => void
  onCompute?: () => void
  computing?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-white">Tail Spend Analysis</h1>
        <p className="mt-1 text-sm text-slate-500">Pareto classification, concentration metrics, and segment drilldown.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Dimension</span>
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
            disabled={disabled}
            className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            {DIMENSIONS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
          </select>
        </label>
        {setThreshold && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Head threshold %</span>
            <input
              type="number" min="1" max="99" value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-24 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </label>
        )}
        <Button onClick={onCompute} disabled={disabled || computing}>{computing ? 'Computing...' : 'Recompute'}</Button>
      </div>
    </div>
  )
}
