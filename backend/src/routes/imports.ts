import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  data_imports,
  transactions,
  suppliers,
  invoices,
  purchase_orders,
  contracts,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let i = 0
  const n = text.length

  const pushField = () => {
    record.push(field)
    field = ''
  }
  const pushRecord = () => {
    pushField()
    records.push(record)
    record = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      pushRecord()
      i++
      continue
    }
    if (ch === '\n') {
      pushRecord()
      i++
      continue
    }
    field += ch
    i++
  }
  // Flush trailing field/record if any content remains.
  if (field.length > 0 || record.length > 0) pushRecord()

  // Drop fully-empty trailing records.
  const cleaned = records.filter((r) => !(r.length === 1 && r[0].trim() === ''))
  if (cleaned.length === 0) return { headers: [], rows: [] }

  const headers = cleaned[0].map((h) => h.trim())
  const rows: Record<string, string>[] = []
  for (let r = 1; r < cleaned.length; r++) {
    const obj: Record<string, string> = {}
    for (let c2 = 0; c2 < headers.length; c2++) obj[headers[c2]] = (cleaned[r][c2] ?? '').trim()
    rows.push(obj)
  }
  return { headers, rows }
}

type Entity = 'transactions' | 'suppliers' | 'invoices' | 'purchase_orders' | 'contracts'

interface ColumnSpec {
  /** Logical field name (used as the mapping key). */
  field: string
  required: boolean
  type: 'string' | 'number' | 'date' | 'boolean'
}

/** Per-entity logical schema used for dry-run validation + commit shaping. */
const ENTITY_SPEC: Record<Entity, ColumnSpec[]> = {
  suppliers: [
    { field: 'name', required: true, type: 'string' },
    { field: 'country', required: false, type: 'string' },
    { field: 'tax_id', required: false, type: 'string' },
    { field: 'domain', required: false, type: 'string' },
    { field: 'status', required: false, type: 'string' },
  ],
  transactions: [
    { field: 'supplier_id', required: true, type: 'string' },
    { field: 'amount', required: true, type: 'number' },
    { field: 'txn_date', required: true, type: 'date' },
    { field: 'currency', required: false, type: 'string' },
    { field: 'category_id', required: false, type: 'string' },
    { field: 'po_number', required: false, type: 'string' },
    { field: 'invoice_number', required: false, type: 'string' },
    { field: 'cost_center', required: false, type: 'string' },
    { field: 'item_key', required: false, type: 'string' },
    { field: 'uom', required: false, type: 'string' },
    { field: 'quantity', required: false, type: 'number' },
    { field: 'unit_price', required: false, type: 'number' },
    { field: 'is_on_contract', required: false, type: 'boolean' },
  ],
  invoices: [
    { field: 'supplier_id', required: true, type: 'string' },
    { field: 'invoice_number', required: true, type: 'string' },
    { field: 'amount', required: false, type: 'number' },
    { field: 'po_number', required: false, type: 'string' },
    { field: 'status', required: false, type: 'string' },
    { field: 'invoice_date', required: false, type: 'date' },
  ],
  purchase_orders: [
    { field: 'supplier_id', required: true, type: 'string' },
    { field: 'po_number', required: true, type: 'string' },
    { field: 'total_amount', required: false, type: 'number' },
    { field: 'line_count', required: false, type: 'number' },
    { field: 'status', required: false, type: 'string' },
    { field: 'issued_date', required: false, type: 'date' },
  ],
  contracts: [
    { field: 'supplier_id', required: true, type: 'string' },
    { field: 'name', required: true, type: 'string' },
    { field: 'category_id', required: false, type: 'string' },
    { field: 'contracted_unit_price', required: false, type: 'number' },
    { field: 'committed_volume', required: false, type: 'number' },
    { field: 'currency', required: false, type: 'string' },
    { field: 'start_date', required: false, type: 'date' },
    { field: 'end_date', required: false, type: 'date' },
    { field: 'status', required: false, type: 'string' },
  ],
}

const ENTITY_TABLE = {
  transactions,
  suppliers,
  invoices,
  purchase_orders: purchase_orders,
  contracts,
} as const

interface CoercedRow {
  ok: boolean
  values?: Record<string, unknown>
  reason?: string
}

function coerce(spec: ColumnSpec, raw: string): { ok: boolean; value?: unknown; reason?: string } {
  const v = (raw ?? '').trim()
  if (v === '') {
    if (spec.required) return { ok: false, reason: `Missing required field "${spec.field}"` }
    return { ok: true, value: undefined }
  }
  if (spec.type === 'number') {
    const num = Number(v.replace(/[$,]/g, ''))
    if (!Number.isFinite(num)) return { ok: false, reason: `Field "${spec.field}" is not a number: "${v}"` }
    return { ok: true, value: num }
  }
  if (spec.type === 'date') {
    const t = Date.parse(v)
    if (Number.isNaN(t)) return { ok: false, reason: `Field "${spec.field}" is not a valid date: "${v}"` }
    return { ok: true, value: new Date(t) }
  }
  if (spec.type === 'boolean') {
    const low = v.toLowerCase()
    if (['true', '1', 'yes', 'y', 't'].includes(low)) return { ok: true, value: true }
    if (['false', '0', 'no', 'n', 'f'].includes(low)) return { ok: true, value: false }
    return { ok: false, reason: `Field "${spec.field}" is not a boolean: "${v}"` }
  }
  return { ok: true, value: v }
}

/**
 * Validate + coerce all parsed rows against the entity spec given a column
 * mapping (logical field -> CSV header). Returns accepted/rejected splits.
 */
function buildRows(
  entity: Entity,
  workspaceId: string,
  parsedRows: Record<string, string>[],
  mapping: Record<string, string>,
): {
  accepted: Record<string, unknown>[]
  rejected: { row: number; reason: string }[]
} {
  const spec = ENTITY_SPEC[entity]
  const accepted: Record<string, unknown>[] = []
  const rejected: { row: number; reason: string }[] = []

  parsedRows.forEach((parsed, idx) => {
    const out: Record<string, unknown> = { workspace_id: workspaceId }
    let failure: string | null = null
    for (const col of spec) {
      const header = mapping[col.field] ?? col.field
      const raw = parsed[header] ?? ''
      const res = coerce(col, raw)
      if (!res.ok) {
        failure = res.reason ?? `Invalid field "${col.field}"`
        break
      }
      if (res.value !== undefined) out[col.field] = res.value
    }
    if (failure) {
      rejected.push({ row: idx + 1, reason: failure })
    } else {
      accepted.push(out)
    }
  })

  return { accepted, rejected }
}

const ENTITIES = ['transactions', 'suppliers', 'invoices', 'purchase_orders', 'contracts'] as const

const previewSchema = z.object({
  workspace_id: z.string().min(1),
  entity: z.enum(ENTITIES),
  csv: z.string().min(1),
  mapping: z.record(z.string()).optional().default({}),
  source_type: z.string().optional().default('csv'),
})

const commitSchema = previewSchema

// ---------------------------------------------------------------------------
// GET /connectors — available connector stubs + status
// (declared before /:id so the literal path wins)
// ---------------------------------------------------------------------------

router.get('/connectors', (c) => {
  const connectors = [
    {
      id: 'csv',
      name: 'CSV Upload',
      description: 'Upload a CSV file of suppliers, transactions, invoices, POs, or contracts.',
      status: 'available',
      entities: ENTITIES,
    },
    {
      id: 'sap_ariba',
      name: 'SAP Ariba',
      description: 'Pull spend and supplier records directly from SAP Ariba.',
      status: 'coming_soon',
      entities: ['transactions', 'suppliers', 'contracts'],
    },
    {
      id: 'coupa',
      name: 'Coupa',
      description: 'Sync POs, invoices, and supplier master from Coupa.',
      status: 'coming_soon',
      entities: ['purchase_orders', 'invoices', 'suppliers'],
    },
    {
      id: 'netsuite',
      name: 'NetSuite',
      description: 'Import AP transactions and vendor records from NetSuite.',
      status: 'coming_soon',
      entities: ['transactions', 'invoices', 'suppliers'],
    },
    {
      id: 'quickbooks',
      name: 'QuickBooks',
      description: 'Import bills and vendors from QuickBooks Online.',
      status: 'coming_soon',
      entities: ['invoices', 'suppliers'],
    },
  ]
  return c.json(connectors)
})

// ---------------------------------------------------------------------------
// POST /preview — dry-run: parse rows + mapping, return accepted/rejected (no write)
// ---------------------------------------------------------------------------

router.post('/preview', authMiddleware, zValidator('json', previewSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const { headers, rows } = parseCsv(body.csv)
  if (rows.length === 0) return c.json({ error: 'CSV has no data rows' }, 400)

  const { accepted, rejected } = buildRows(
    body.entity as Entity,
    body.workspace_id,
    rows,
    body.mapping ?? {},
  )

  return c.json({
    entity: body.entity,
    headers,
    row_count: rows.length,
    accepted_count: accepted.length,
    rejected_count: rejected.length,
    accepted: accepted.slice(0, 20),
    rejected: rejected.slice(0, 50),
    sample: rows.slice(0, 5),
  })
})

// ---------------------------------------------------------------------------
// GET / — import history for a workspace
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(data_imports)
    .where(eq(data_imports.workspace_id, workspaceId))
    .orderBy(desc(data_imports.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — import detail (incl. errors)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const [imp] = await db.select().from(data_imports).where(eq(data_imports.id, c.req.param('id')))
  if (!imp) return c.json({ error: 'Not found' }, 404)
  return c.json(imp)
})

// ---------------------------------------------------------------------------
// POST / — commit import: insert rows for entity, record import batch
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', commitSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const entity = body.entity as Entity
  const { rows } = parseCsv(body.csv)
  if (rows.length === 0) return c.json({ error: 'CSV has no data rows' }, 400)

  const { accepted, rejected } = buildRows(entity, body.workspace_id, rows, body.mapping ?? {})

  // Record the import batch first so accepted rows can carry its id.
  const [batch] = await db
    .insert(data_imports)
    .values({
      workspace_id: body.workspace_id,
      source_type: body.source_type ?? 'csv',
      entity,
      status: 'processing',
      row_count: rows.length,
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      mapping: body.mapping ?? {},
      errors: rejected,
      created_by: userId,
    })
    .returning()

  // Insert accepted rows. Transactions are stamped with import_id so the batch
  // can be rolled back precisely.
  if (accepted.length > 0) {
    if (entity === 'transactions') {
      const values = accepted.map((r) => ({ ...r, import_id: batch.id }))
      await db.insert(transactions).values(values as any)
    } else {
      const table = ENTITY_TABLE[entity]
      // suppliers requires normalized_name (computed from name).
      const values =
        entity === 'suppliers'
          ? accepted.map((r) => ({
              ...r,
              normalized_name: String(r.name ?? '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .trim(),
            }))
          : accepted
      await db.insert(table as any).values(values as any)
    }
  }

  const [finalized] = await db
    .update(data_imports)
    .set({ status: 'completed' })
    .where(eq(data_imports.id, batch.id))
    .returning()

  return c.json(finalized, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/rollback — delete rows created by this import batch
// ---------------------------------------------------------------------------

router.post('/:id/rollback', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [batch] = await db.select().from(data_imports).where(eq(data_imports.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(batch.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (batch.status === 'rolled_back') return c.json({ error: 'Import already rolled back' }, 400)

  let deleted = 0
  // Only transactions carry an import_id, so only they can be precisely rolled
  // back. Other entities are not stamped per-batch; we mark the batch rolled
  // back without deleting (no reliable provenance link).
  if (batch.entity === 'transactions') {
    const removed = await db
      .delete(transactions)
      .where(and(eq(transactions.workspace_id, batch.workspace_id), eq(transactions.import_id, id)))
      .returning()
    deleted = removed.length
  }

  await db.update(data_imports).set({ status: 'rolled_back' }).where(eq(data_imports.id, id))

  return c.json({ success: true, deleted, entity: batch.entity })
})

export default router
