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

type Report = {
  id: string
  workspace_id: string
  type?: string | null
  name?: string | null
  params?: Record<string, unknown> | null
  payload?: any
  created_by?: string | null
  created_at?: string | null
}

const REPORT_TYPES: { value: string; label: string; description: string }[] = [
  { value: 'board_summary', label: 'Board Summary', description: 'Headline KPIs, savings funnel and top opportunities for the board.' },
  { value: 'tail_spend', label: 'Tail Spend Analysis', description: 'Pareto concentration, tail supplier count and addressable spend.' },
  { value: 'savings_pipeline', label: 'Savings Pipeline', description: 'Identified, approved and realized savings across initiatives.' },
  { value: 'supplier_consolidation', label: 'Supplier Consolidation', description: 'Duplicate groups, merge candidates and consolidation scenarios.' },
  { value: 'maverick_leakage', label: 'Maverick & Leakage', description: 'Off-contract spend, price dispersion and contract-price leakage.' },
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

function money(v: unknown): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function typeLabel(t?: string | null): string {
  const found = REPORT_TYPES.find((r) => r.value === t)
  return found ? found.label : (t || 'Report').replace(/_/g, ' ')
}

function typeTone(t?: string | null): 'cyan' | 'green' | 'amber' | 'violet' | 'rose' | 'slate' {
  switch (t) {
    case 'board_summary':
      return 'cyan'
    case 'tail_spend':
      return 'violet'
    case 'savings_pipeline':
      return 'green'
    case 'supplier_consolidation':
      return 'amber'
    case 'maverick_leakage':
      return 'rose'
    default:
      return 'slate'
  }
}

function looksLikeMoney(key: string): boolean {
  const k = key.toLowerCase()
  return /spend|savings|amount|leakage|cost|value|addressable|realized|target|identified/.test(k)
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtVal(key: string, v: unknown): string {
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim() !== '')) {
    if (looksLikeMoney(key)) return money(v)
    const n = num(v)
    if (/rate|share|pct|percent/.test(key.toLowerCase())) {
      const p = n > 0 && n <= 1 ? n * 100 : n
      return `${p.toFixed(1)}%`
    }
    return n.toLocaleString()
  }
  return String(v)
}

export default function ReportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [reports, setReports] = useState<Report[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const [genOpen, setGenOpen] = useState(false)
  const [genType, setGenType] = useState<string>('board_summary')
  const [genName, setGenName] = useState('')
  const [genPeriod, setGenPeriod] = useState('')
  const [generating, setGenerating] = useState(false)

  const [viewing, setViewing] = useState<Report | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  async function loadReports(ws: string) {
    const r = await api.listReports(ws)
    setReports(Array.isArray(r) ? r : r?.rows ?? [])
  }

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadReports(workspaceId)
      .catch((e) => !cancelled && setError(e.message || 'Failed to load reports'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  function openGenerate() {
    const t = REPORT_TYPES.find((r) => r.value === genType)
    setGenName(`${t ? t.label : 'Report'} — ${new Date().toLocaleDateString()}`)
    setGenPeriod('')
    setGenOpen(true)
  }

  async function handleGenerate() {
    if (!workspaceId) return
    setGenerating(true)
    setError(null)
    try {
      const params: Record<string, unknown> = {}
      if (genPeriod.trim()) params.period = genPeriod.trim()
      const created = await api.generateReport({
        workspace_id: workspaceId,
        type: genType,
        name: genName.trim() || typeLabel(genType),
        params,
      })
      const row: Report | null = created && created.id ? created : null
      if (row) setReports((prev) => [row, ...prev])
      else await loadReports(workspaceId)
      setGenOpen(false)
      if (row) void openReport(row.id)
    } catch (e: any) {
      setError(e.message || 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  async function openReport(id: string) {
    setViewLoading(true)
    setError(null)
    try {
      const full = await api.getReport(id)
      setViewing(full)
    } catch (e: any) {
      setError(e.message || 'Failed to load report')
    } finally {
      setViewLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this report? This cannot be undone.')) return
    setDeletingId(id)
    setError(null)
    try {
      await api.deleteReport(id)
      setReports((prev) => prev.filter((r) => r.id !== id))
      if (viewing?.id === id) setViewing(null)
    } catch (e: any) {
      setError(e.message || 'Failed to delete report')
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (!q) return true
      return [r.name, r.type, r.created_by].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    })
  }, [reports, search, typeFilter])

  const byType = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of reports) map.set(r.type || 'other', (map.get(r.type || 'other') || 0) + 1)
    return map
  }, [reports])

  const latest = useMemo(() => {
    return reports.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null
  }, [reports])

  if (!workspaceId && !loading) {
    return (
      <div className="space-y-6">
        <Header onGenerate={() => {}} disabled />
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace before generating board-ready reports."
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
      <Header onGenerate={openGenerate} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="py-20">
          <Spinner label="Loading reports..." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Saved reports" value={reports.length} tone="cyan" />
            <Stat label="Report types" value={byType.size} tone="cyan" hint="distinct templates used" />
            <Stat
              label="Most recent"
              value={latest ? typeLabel(latest.type) : '—'}
              tone="green"
              hint={latest ? fmtDate(latest.created_at) : 'none yet'}
            />
            <Stat label="Templates available" value={REPORT_TYPES.length} tone="amber" />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            {REPORT_TYPES.map((t) => (
              <Card key={t.value} className="flex flex-col">
                <CardBody className="flex flex-1 flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={typeTone(t.value)}>{t.label}</Badge>
                    <span className="text-xs text-stone-600">{byType.get(t.value) || 0}</span>
                  </div>
                  <p className="mt-3 flex-1 text-xs leading-relaxed text-stone-500">{t.description}</p>
                  <Button
                    variant="secondary"
                    className="mt-4 w-full"
                    onClick={() => {
                      setGenType(t.value)
                      setGenName(`${t.label} — ${new Date().toLocaleDateString()}`)
                      setGenPeriod('')
                      setGenOpen(true)
                    }}
                  >
                    Generate
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Saved reports</h2>
                <p className="text-xs text-stone-500">
                  {filtered.length} of {reports.length} shown
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reports..."
                  className="w-44 rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="all">All types</option>
                  {REPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardBody className="px-0 py-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title={reports.length === 0 ? 'No reports yet' : 'No reports match your filters'}
                    description={
                      reports.length === 0
                        ? 'Generate a board-ready report from your current spend analysis.'
                        : 'Try clearing the search or type filter.'
                    }
                    action={
                      reports.length === 0 ? <Button onClick={openGenerate}>Generate report</Button> : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Type</TH>
                      <TH>Created</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <button onClick={() => openReport(r.id)} className="text-left font-medium text-stone-100 hover:text-cyan-300">
                            {r.name || typeLabel(r.type)}
                          </button>
                          <div className="text-[11px] text-stone-600">{r.id.slice(0, 8)}</div>
                        </TD>
                        <TD>
                          <Badge tone={typeTone(r.type)}>{typeLabel(r.type)}</Badge>
                        </TD>
                        <TD className="text-stone-400">{fmtDate(r.created_at)}</TD>
                        <TD className="text-right">
                          <div className="inline-flex gap-2">
                            <Button variant="ghost" onClick={() => openReport(r.id)}>
                              View
                            </Button>
                            <Button variant="danger" onClick={() => handleDelete(r.id)} disabled={deletingId === r.id}>
                              {deletingId === r.id ? '...' : 'Delete'}
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
        </>
      )}

      <Modal
        open={genOpen}
        onClose={() => !generating && setGenOpen(false)}
        title="Generate board-ready report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Report type</label>
            <select
              value={genType}
              onChange={(e) => {
                const t = e.target.value
                setGenType(t)
                setGenName(`${typeLabel(t)} — ${new Date().toLocaleDateString()}`)
              }}
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-cyan-500 focus:outline-none"
            >
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-stone-500">
              {REPORT_TYPES.find((t) => t.value === genType)?.description}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Report name</label>
            <input
              value={genName}
              onChange={(e) => setGenName(e.target.value)}
              placeholder="Q3 FY26 procurement review"
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Period (optional)</label>
            <input
              value={genPeriod}
              onChange={(e) => setGenPeriod(e.target.value)}
              placeholder="e.g. 2026-Q3 or FY2026"
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? viewing.name || typeLabel(viewing.type) : 'Report'}
        className="max-w-3xl"
        footer={
          viewing ? (
            <>
              <Button variant="danger" onClick={() => handleDelete(viewing.id)} disabled={deletingId === viewing.id}>
                {deletingId === viewing.id ? '...' : 'Delete'}
              </Button>
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Close
              </Button>
            </>
          ) : undefined
        }
      >
        {viewLoading && !viewing ? (
          <div className="py-8">
            <Spinner label="Loading report..." />
          </div>
        ) : viewing ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={typeTone(viewing.type)}>{typeLabel(viewing.type)}</Badge>
              <span className="text-xs text-stone-500">Generated {fmtDate(viewing.created_at)}</span>
            </div>
            <ReportPayload payload={viewing.payload} />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function ReportPayload({ payload }: { payload: any }) {
  if (payload == null) {
    return <p className="text-sm text-stone-500">This report has no payload data.</p>
  }

  const sections: { title: string; node: any }[] = []
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [k, v] of Object.entries(payload)) sections.push({ title: humanizeKey(k), node: v })
  } else {
    sections.push({ title: 'Data', node: payload })
  }

  return (
    <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
      {sections.map((s, i) => (
        <div key={i}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-300">{s.title}</h3>
          <PayloadNode keyName={s.title} value={s.node} />
        </div>
      ))}
    </div>
  )
}

function PayloadNode({ keyName, value }: { keyName: string; value: any }) {
  if (value == null) return <p className="text-sm text-stone-600">—</p>

  // Array of objects -> table
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-sm text-stone-600">No rows.</p>
    if (typeof value[0] === 'object' && value[0] !== null) {
      const cols = Array.from(
        value.reduce((set: Set<string>, row: any) => {
          Object.keys(row || {}).forEach((c) => set.add(c))
          return set
        }, new Set<string>()),
      ).slice(0, 8)
      return (
        <div className="overflow-x-auto rounded-lg border border-stone-800">
          <Table>
            <THead>
              <TR>
                {cols.map((c) => (
                  <TH key={c}>{humanizeKey(c)}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {value.map((row: any, i: number) => (
                <TR key={i}>
                  {cols.map((c) => (
                    <TD key={c} className="tabular-nums">
                      {row[c] == null ? '—' : fmtVal(c, row[c])}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )
    }
    return (
      <ul className="list-inside list-disc space-y-1 text-sm text-stone-300">
        {value.map((v: any, i: number) => (
          <li key={i}>{fmtVal(keyName, v)}</li>
        ))}
      </ul>
    )
  }

  // Object of scalars -> stat grid; nested objects/arrays recurse
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    const scalars = entries.filter(([, v]) => v == null || typeof v !== 'object')
    const complex = entries.filter(([, v]) => v != null && typeof v === 'object')
    return (
      <div className="space-y-3">
        {scalars.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {scalars.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-stone-500">{humanizeKey(k)}</div>
                <div className="mt-0.5 text-sm font-semibold text-stone-100 tabular-nums">{fmtVal(k, v)}</div>
              </div>
            ))}
          </div>
        )}
        {complex.map(([k, v]) => (
          <div key={k}>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{humanizeKey(k)}</h4>
            <PayloadNode keyName={k} value={v} />
          </div>
        ))}
      </div>
    )
  }

  // Scalar
  return <p className="text-sm font-semibold text-stone-100">{fmtVal(keyName, value)}</p>
}

function Header({ onGenerate, disabled }: { onGenerate: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-white">Reports</h1>
        <p className="text-sm text-stone-500">Generate board-ready reports from your spend analysis and revisit saved ones.</p>
      </div>
      <Button onClick={onGenerate} disabled={disabled}>
        Generate report
      </Button>
    </div>
  )
}
