import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { transactions, suppliers, categories, contracts, workspace_members } from '../db/schema.js'
import { eq, and, desc, gte, lte, sql, count } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().min(1),
  category_id: z.string().optional().nullable(),
  contract_id: z.string().optional().nullable(),
  amount: z.number(),
  currency: z.string().optional(),
  txn_date: z.string().min(1),
  po_number: z.string().optional().nullable(),
  invoice_number: z.string().optional().nullable(),
  cost_center: z.string().optional().nullable(),
  item_key: z.string().optional().nullable(),
  uom: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  unit_price: z.number().optional().nullable(),
  is_on_contract: z.boolean().optional(),
  import_id: z.string().optional().nullable(),
})

const updateSchema = createSchema.partial().omit({ workspace_id: true })

// Public: paginated, filterable list. Returns { rows, total }.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const conds = [eq(transactions.workspace_id, workspaceId)]
  const supplierId = c.req.query('supplier_id')
  if (supplierId) conds.push(eq(transactions.supplier_id, supplierId))
  const categoryId = c.req.query('category_id')
  if (categoryId) conds.push(eq(transactions.category_id, categoryId))
  const costCenter = c.req.query('cost_center')
  if (costCenter) conds.push(eq(transactions.cost_center, costCenter))
  const onContract = c.req.query('on_contract')
  if (onContract === 'true' || onContract === 'false') {
    conds.push(eq(transactions.is_on_contract, onContract === 'true'))
  }
  const from = c.req.query('from')
  if (from) {
    const d = new Date(from)
    if (!Number.isNaN(d.getTime())) conds.push(gte(transactions.txn_date, d))
  }
  const to = c.req.query('to')
  if (to) {
    const d = new Date(to)
    if (!Number.isNaN(d.getTime())) conds.push(lte(transactions.txn_date, d))
  }

  const where = and(...conds)
  const pageRaw = parseInt(c.req.query('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  const pageSizeRaw = parseInt(c.req.query('page_size') ?? '50', 10)
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, 500) : 50
  const offset = (page - 1) * pageSize

  const rows = await db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.txn_date))
    .limit(pageSize)
    .offset(offset)

  const [totalRow] = await db.select({ value: count() }).from(transactions).where(where)
  const total = Number(totalRow?.value ?? 0)

  return c.json({ rows, total, page, page_size: pageSize })
})

// Public: aggregate summary. Defined before /:id to avoid param capture.
router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [agg] = await db
    .select({
      spend: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      txn_count: count(),
      supplier_count: sql<number>`count(distinct ${transactions.supplier_id})`,
      on_contract_spend: sql<number>`coalesce(sum(case when ${transactions.is_on_contract} then ${transactions.amount} else 0 end), 0)`,
      off_contract_spend: sql<number>`coalesce(sum(case when ${transactions.is_on_contract} then 0 else ${transactions.amount} end), 0)`,
      on_contract_count: sql<number>`count(*) filter (where ${transactions.is_on_contract})`,
      off_contract_count: sql<number>`count(*) filter (where not ${transactions.is_on_contract})`,
    })
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  const spend = Number(agg?.spend ?? 0)
  const txnCount = Number(agg?.txn_count ?? 0)
  return c.json({
    spend,
    txn_count: txnCount,
    supplier_count: Number(agg?.supplier_count ?? 0),
    avg: txnCount > 0 ? spend / txnCount : 0,
    on_contract_spend: Number(agg?.on_contract_spend ?? 0),
    off_contract_spend: Number(agg?.off_contract_spend ?? 0),
    on_contract_count: Number(agg?.on_contract_count ?? 0),
    off_contract_count: Number(agg?.off_contract_count ?? 0),
  })
})

// Public: one transaction.
router.get('/:id', async (c) => {
  const [t] = await db.select().from(transactions).where(eq(transactions.id, c.req.param('id')))
  if (!t) return c.json({ error: 'Not found' }, 404)
  return c.json(t)
})

// Auth: create a transaction.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, body.supplier_id))
  if (!sup || sup.workspace_id !== body.workspace_id) return c.json({ error: 'Supplier not in workspace' }, 400)
  if (body.category_id) {
    const [cat] = await db.select().from(categories).where(eq(categories.id, body.category_id))
    if (!cat || cat.workspace_id !== body.workspace_id) return c.json({ error: 'Category not in workspace' }, 400)
  }
  if (body.contract_id) {
    const [ct] = await db.select().from(contracts).where(eq(contracts.id, body.contract_id))
    if (!ct || ct.workspace_id !== body.workspace_id) return c.json({ error: 'Contract not in workspace' }, 400)
  }

  const txnDate = new Date(body.txn_date)
  if (Number.isNaN(txnDate.getTime())) return c.json({ error: 'Invalid txn_date' }, 400)

  const [row] = await db
    .insert(transactions)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id,
      category_id: body.category_id ?? null,
      contract_id: body.contract_id ?? null,
      amount: body.amount,
      currency: body.currency ?? 'USD',
      txn_date: txnDate,
      po_number: body.po_number ?? null,
      invoice_number: body.invoice_number ?? null,
      cost_center: body.cost_center ?? null,
      item_key: body.item_key ?? null,
      uom: body.uom ?? null,
      quantity: body.quantity ?? null,
      unit_price: body.unit_price ?? null,
      is_on_contract: body.is_on_contract ?? false,
      import_id: body.import_id ?? null,
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update a transaction.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(transactions).where(eq(transactions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  for (const k of [
    'supplier_id', 'category_id', 'contract_id', 'amount', 'currency', 'po_number',
    'invoice_number', 'cost_center', 'item_key', 'uom', 'quantity', 'unit_price',
    'is_on_contract', 'import_id',
  ] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  if (body.txn_date !== undefined && body.txn_date !== null) {
    const d = new Date(body.txn_date)
    if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid txn_date' }, 400)
    patch.txn_date = d
  }

  const [updated] = await db.update(transactions).set(patch).where(eq(transactions.id, id)).returning()
  return c.json(updated)
})

// Auth: delete a transaction.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(transactions).where(eq(transactions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(transactions).where(eq(transactions.id, id))
  return c.json({ success: true })
})

export default router
