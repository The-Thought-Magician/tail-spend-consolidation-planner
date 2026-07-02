'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type ImportRow = {
  id: string
  source_type?: string
  entity?: string
  status?: string
  row_count?: number
  accepted_count?: number
  rejected_count?: number
  mapping?: Record<string, string>
  errors?: unknown
  created_at?: string
}

type Connector = {
  id?: string
  name?: string
  key?: string
  status?: string
  description?: string
}

type PreviewResult = {
  accepted?: unknown[]
  rejected?: Array<{ row?: number; reason?: string; [k: string]: unknown }>
  sample?: Record<string, unknown>[]
  accepted_count?: number
  rejected_count?: number
}

const ENTITIES = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'suppliers', label: 'Suppliers' },
  { value: 'purchase_orders', label: 'Purchase Orders' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'contracts', label: 'Contracts' },
]

// Target fields per entity for column mapping.
const TARGET_FIELDS: Record<string, string[]> = {
  transactions: [
    'supplier_name',
    'category_code',
    'amount',
    'currency',
    'txn_date',
    'po_number',
    'invoice_number',
    'cost_center',
    'item_key',
    'uom',
    'quantity',
    'unit_price',
  ],
  suppliers: ['name', 'category_code', 'country', 'tax_id', 'domain', 'status'],
  purchase_orders: ['supplier_name', 'po_number', 'total_amount', 'line_count', 'status', 'issued_date'],
  invoices: ['supplier_name', 'invoice_number', 'po_number', 'amount', 'status', 'invoice_date'],
  contracts: ['supplier_name', 'category_code', 'name', 'contracted_unit_price', 'committed_volume', 'currency', 'start_date', 'end_date', 'status'],
}

function getWorkspaceId(): string | null {
  try {
    return localStorage.getItem('tscp_workspace_id')
  } catch {
    return null
  }
}

// Minimal CSV parser handling quoted fields.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '') || row.length > 1) lines.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) lines.push(row)
  }
  const headers = lines.length > 0 ? lines[0].map((h) => h.trim()) : []
  const rows = lines.slice(1)
  return { headers, rows }
}

function autoMap(headers: string[], fields: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const f of fields) {
    const norm = f.replace(/_/g, '').toLowerCase()
    const match = headers.find((h) => {
      const hn = h.replace(/[\s_-]/g, '').toLowerCase()
      return hn === norm || hn.includes(norm) || norm.includes(hn)
    })
    if (match) map[f] = match
  }
  return map
}

function statusTone(status?: string): 'green' | 'amber' | 'rose' | 'slate' {
  switch ((status ?? '').toLowerCase()) {
    case 'committed':
    case 'completed':
    case 'success':
      return 'green'
    case 'pending':
    case 'processing':
      return 'amber'
    case 'failed':
    case 'rolled_back':
      return 'rose'
    default:
      return 'slate'
  }
}

export default function ImportsPage() {
  const [wsId, setWsId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<ImportRow[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // Upload / mapping state
  const [fileName, setFileName] = useState('')
  const [entity, setEntity] = useState('transactions')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [parseError, setParseError] = useState('')

  // Preview state
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [committing, setCommitting] = useState(false)

  // Detail modal
  const [detail, setDetail] = useState<ImportRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Rollback
  const [rollbackBusy, setRollbackBusy] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError('')
    try {
      const [h, c] = await Promise.all([api.listImports(id), api.listConnectors()])
      setHistory(Array.isArray(h) ? h : h?.imports ?? [])
      setConnectors(Array.isArray(c) ? c : c?.connectors ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load imports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = getWorkspaceId()
    setWsId(id)
    if (id) load(id)
    else setLoading(false)
  }, [load])

  const resetUpload = () => {
    setFileName('')
    setHeaders([])
    setRows([])
    setMapping({})
    setPreview(null)
    setPreviewError('')
    setParseError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setPreview(null)
    setPreviewError('')
    try {
      const text = await file.text()
      const { headers: hs, rows: rs } = parseCsv(text)
      if (hs.length === 0) {
        setParseError('Could not read any columns from this file.')
        return
      }
      setFileName(file.name)
      setHeaders(hs)
      setRows(rs)
      setMapping(autoMap(hs, TARGET_FIELDS[entity] ?? []))
    } catch {
      setParseError('Failed to read file.')
    }
  }

  const onEntityChange = (val: string) => {
    setEntity(val)
    setPreview(null)
    setPreviewError('')
    if (headers.length > 0) setMapping(autoMap(headers, TARGET_FIELDS[val] ?? []))
  }

  // Build the array of mapped row objects from CSV using the current mapping.
  const buildMappedRows = useCallback(() => {
    const colIndex: Record<string, number> = {}
    headers.forEach((h, i) => (colIndex[h] = i))
    return rows.map((r) => {
      const obj: Record<string, string> = {}
      for (const [field, header] of Object.entries(mapping)) {
        if (!header) continue
        const idx = colIndex[header]
        obj[field] = idx != null ? (r[idx] ?? '') : ''
      }
      return obj
    })
  }, [headers, rows, mapping])

  const runPreview = async () => {
    if (!wsId) return
    setPreviewing(true)
    setPreviewError('')
    setPreview(null)
    try {
      const result: PreviewResult = await api.previewImport({
        workspace_id: wsId,
        entity,
        source_type: 'csv',
        mapping,
        rows: buildMappedRows(),
      })
      setPreview(result || {})
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const commit = async () => {
    if (!wsId) return
    setCommitting(true)
    setPreviewError('')
    try {
      const created: ImportRow = await api.commitImport({
        workspace_id: wsId,
        entity,
        source_type: 'csv',
        mapping,
        rows: buildMappedRows(),
      })
      setHistory((prev) => [created, ...prev])
      resetUpload()
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  const openDetail = async (row: ImportRow) => {
    setDetail(row)
    setDetailLoading(true)
    try {
      const full = await api.getImport(row.id)
      setDetail(full || row)
    } catch {
      /* keep summary row */
    } finally {
      setDetailLoading(false)
    }
  }

  const doRollback = async (row: ImportRow) => {
    setRollbackBusy(row.id)
    try {
      await api.rollbackImport(row.id)
      setHistory((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: 'rolled_back' } : r)),
      )
      if (detail?.id === row.id) setDetail({ ...detail, status: 'rolled_back' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed')
    } finally {
      setRollbackBusy(null)
    }
  }

  if (loading) return <PageSpinner label="Loading imports..." />

  if (!wsId) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon="↥"
          title="No workspace selected"
          description="Select a workspace before importing data."
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to Workspaces</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const targetFields = TARGET_FIELDS[entity] ?? []
  const acceptedCount = preview?.accepted_count ?? preview?.accepted?.length ?? 0
  const rejectedCount = preview?.rejected_count ?? preview?.rejected?.length ?? 0
  const sampleRows = preview?.sample ?? (Array.isArray(preview?.accepted) ? (preview?.accepted as Record<string, unknown>[]) : [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Imports</h1>
        <p className="mt-1 text-sm text-stone-500">
          Upload spend data, map columns, dry-run a preview, then commit. Roll back any batch.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-5 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Upload + mapping */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">New CSV import</h2>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">Entity</label>
              <select
                value={entity}
                onChange={(e) => onEntityChange(e.target.value)}
                className="rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                {ENTITIES.map((en) => (
                  <option key={en.value} value={en.value}>
                    {en.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-stone-400">CSV file</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="block w-full text-sm text-stone-400 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-cyan-300 hover:file:bg-stone-700"
              />
            </div>
            {fileName && (
              <Button variant="ghost" onClick={resetUpload}>
                Clear
              </Button>
            )}
          </div>

          {parseError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {parseError}
            </div>
          )}

          {headers.length > 0 && (
            <>
              <div className="text-xs text-stone-500">
                <span className="font-medium text-stone-400">{fileName}</span> · {headers.length} columns ·{' '}
                {rows.length} data rows
              </div>

              {/* Column mapping */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Column mapping
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {targetFields.map((field) => (
                    <div key={field}>
                      <label className="mb-1 block text-xs font-medium text-stone-400">{field}</label>
                      <select
                        value={mapping[field] ?? ''}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [field]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="">— ignore —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Raw preview of first rows */}
              {rows.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    File preview (first 5 rows)
                  </h3>
                  <Table>
                    <THead>
                      <TR>
                        {headers.map((h) => (
                          <TH key={h}>{h}</TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {rows.slice(0, 5).map((r, ri) => (
                        <TR key={ri}>
                          {headers.map((_, ci) => (
                            <TD key={ci} className="whitespace-nowrap text-xs">
                              {r[ci] ?? ''}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={runPreview} disabled={previewing}>
                  {previewing ? 'Running dry-run...' : 'Dry-run preview'}
                </Button>
                {preview && (
                  <Button variant="primary" onClick={commit} disabled={committing || acceptedCount === 0}>
                    {committing ? 'Committing...' : `Commit ${acceptedCount} rows`}
                  </Button>
                )}
              </div>

              {previewError && (
                <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                  {previewError}
                </div>
              )}

              {/* Preview result */}
              {preview && (
                <div className="space-y-4 rounded-lg border border-stone-800 bg-stone-900/50 p-4">
                  <div className="flex flex-wrap gap-3">
                    <Badge tone="green">{acceptedCount} accepted</Badge>
                    <Badge tone={rejectedCount > 0 ? 'rose' : 'slate'}>{rejectedCount} rejected</Badge>
                  </div>

                  {sampleRows.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-stone-400">Accepted sample</div>
                      <Table>
                        <THead>
                          <TR>
                            {Object.keys(sampleRows[0]).slice(0, 8).map((c) => (
                              <TH key={c}>{c}</TH>
                            ))}
                          </TR>
                        </THead>
                        <TBody>
                          {sampleRows.slice(0, 5).map((r, i) => (
                            <TR key={i}>
                              {Object.keys(sampleRows[0]).slice(0, 8).map((c) => (
                                <TD key={c} className="whitespace-nowrap text-xs">
                                  {String((r as Record<string, unknown>)[c] ?? '')}
                                </TD>
                              ))}
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  )}

                  {Array.isArray(preview.rejected) && preview.rejected.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-rose-300">Rejected rows</div>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-stone-400">
                        {preview.rejected.slice(0, 50).map((rej, i) => (
                          <li key={i} className="rounded bg-rose-950/30 px-2 py-1">
                            {rej.row != null && <span className="font-mono text-rose-400">row {rej.row}: </span>}
                            {rej.reason ?? JSON.stringify(rej)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* Connectors */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Connectors</h2>
        </CardHeader>
        <CardBody>
          {connectors.length === 0 ? (
            <EmptyState title="No connectors available" description="CSV upload is available above." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {connectors.map((c, i) => (
                <div
                  key={c.id ?? c.key ?? i}
                  className="rounded-lg border border-stone-800 bg-stone-900/50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-200">{c.name ?? c.key ?? c.id}</span>
                    <Badge tone={statusTone(c.status)} className="capitalize">
                      {c.status ?? 'available'}
                    </Badge>
                  </div>
                  {c.description && <p className="mt-1 text-xs text-stone-500">{c.description}</p>}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Import history</h2>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => wsId && load(wsId)}>
            Refresh
          </Button>
        </CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <EmptyState title="No imports yet" description="Your committed import batches will appear here." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entity</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">Rejected</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((row) => (
                  <TR key={row.id}>
                    <TD className="capitalize text-stone-200">
                      {String(row.entity ?? '—').replace(/_/g, ' ')}
                    </TD>
                    <TD className="text-xs text-stone-500">{row.source_type ?? 'csv'}</TD>
                    <TD>
                      <Badge tone={statusTone(row.status)} className="capitalize">
                        {String(row.status ?? 'unknown').replace(/_/g, ' ')}
                      </Badge>
                    </TD>
                    <TD className="text-right">{row.row_count ?? '—'}</TD>
                    <TD className="text-right text-emerald-300">{row.accepted_count ?? '—'}</TD>
                    <TD className="text-right text-rose-300">{row.rejected_count ?? '—'}</TD>
                    <TD className="text-xs text-stone-500">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openDetail(row)}>
                          Details
                        </Button>
                        {row.status !== 'rolled_back' && (
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/30"
                            disabled={rollbackBusy === row.id}
                            onClick={() => doRollback(row)}
                          >
                            {rollbackBusy === row.id ? 'Rolling back...' : 'Rollback'}
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Import detail"
        className="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <Spinner label="Loading detail..." className="py-6" />
        ) : detail ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-stone-500">Entity</div>
                <div className="capitalize text-stone-200">
                  {String(detail.entity ?? '—').replace(/_/g, ' ')}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500">Status</div>
                <Badge tone={statusTone(detail.status)} className="capitalize">
                  {String(detail.status ?? 'unknown').replace(/_/g, ' ')}
                </Badge>
              </div>
              <div>
                <div className="text-xs text-stone-500">Rows</div>
                <div className="text-stone-200">{detail.row_count ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-stone-500">Accepted / Rejected</div>
                <div className="text-stone-200">
                  <span className="text-emerald-300">{detail.accepted_count ?? 0}</span> /{' '}
                  <span className="text-rose-300">{detail.rejected_count ?? 0}</span>
                </div>
              </div>
            </div>

            {detail.mapping && Object.keys(detail.mapping).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-stone-400">Column mapping</div>
                <div className="rounded-lg border border-stone-800 bg-stone-950/50 p-3">
                  {Object.entries(detail.mapping).map(([field, header]) => (
                    <div key={field} className="flex justify-between py-0.5 text-xs">
                      <span className="text-stone-400">{field}</span>
                      <span className="font-mono text-stone-300">{String(header)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.errors != null &&
              (Array.isArray(detail.errors) ? detail.errors.length > 0 : true) && (
                <div>
                  <div className="mb-1 text-xs font-medium text-rose-300">Errors</div>
                  <pre className="max-h-48 overflow-auto rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-200">
                    {JSON.stringify(detail.errors, null, 2)}
                  </pre>
                </div>
              )}

            {detail.status !== 'rolled_back' && (
              <div className="pt-2">
                <Button
                  variant="danger"
                  disabled={rollbackBusy === detail.id}
                  onClick={() => doRollback(detail)}
                >
                  {rollbackBusy === detail.id ? 'Rolling back...' : 'Rollback this import'}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
