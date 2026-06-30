import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { contracts, suppliers, categories, transactions, workspace_members } from '../db/schema.js'
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

async function supplierInWorkspace(supplierId: string, workspaceId: string): Promise<boolean> {
  const [s] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.workspace_id, workspaceId)))
  return !!s
}

async function categoryInWorkspace(categoryId: string, workspaceId: string): Promise<boolean> {
  const [cat] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.workspace_id, workspaceId)))
  return !!cat
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().min(1),
  category_id: z.string().optional().nullable(),
  name: z.string().min(1),
  contracted_unit_price: z.number().optional().nullable(),
  committed_volume: z.number().optional().nullable(),
  currency: z.string().optional().default('USD'),
  start_date: z.string().datetime().optional().nullable(),
  end_date: z.string().datetime().optional().nullable(),
  status: z.string().optional().default('active'),
})

const updateSchema = z.object({
  supplier_id: z.string().min(1).optional(),
  category_id: z.string().optional().nullable(),
  name: z.string().min(1).optional(),
  contracted_unit_price: z.number().optional().nullable(),
  committed_volume: z.number().optional().nullable(),
  currency: z.string().optional(),
  start_date: z.string().datetime().optional().nullable(),
  end_date: z.string().datetime().optional().nullable(),
  status: z.string().optional(),
})

// ---------------------------------------------------------------------------
// GET /coverage — per-category on/off-contract coverage %
// (declared before /:id so the literal path wins)
// ---------------------------------------------------------------------------

router.get('/coverage', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  // Aggregate spend per category, splitting on/off contract.
  const byCat = new Map<string, { onSpend: number; offSpend: number }>()
  for (const t of txns) {
    const key = t.category_id ?? '__uncategorized__'
    const agg = byCat.get(key) ?? { onSpend: 0, offSpend: 0 }
    if (t.is_on_contract) agg.onSpend += t.amount
    else agg.offSpend += t.amount
    byCat.set(key, agg)
  }

  const cats = await db.select().from(categories).where(eq(categories.workspace_id, workspaceId))
  const catName = new Map(cats.map((cat) => [cat.id, cat.name]))

  const coverage = [...byCat.entries()].map(([categoryId, agg]) => {
    const totalSpend = agg.onSpend + agg.offSpend
    const coveragePct = totalSpend > 0 ? agg.onSpend / totalSpend : 0
    return {
      category_id: categoryId === '__uncategorized__' ? null : categoryId,
      category_name: categoryId === '__uncategorized__' ? 'Uncategorized' : catName.get(categoryId) ?? categoryId,
      on_contract_spend: agg.onSpend,
      off_contract_spend: agg.offSpend,
      total_spend: totalSpend,
      coverage_pct: coveragePct,
    }
  })

  coverage.sort((a, b) => b.total_spend - a.total_spend)
  return c.json({ coverage })
})

// ---------------------------------------------------------------------------
// GET /expiring — contracts expiring within N days
// ---------------------------------------------------------------------------

router.get('/expiring', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const days = Math.max(1, parseInt(c.req.query('days') ?? '90', 10) || 90)

  const now = Date.now()
  const cutoff = now + days * 86_400_000

  const rows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.workspace_id, workspaceId))

  const expiring = rows
    .filter((r) => {
      if (!r.end_date) return false
      const end = new Date(r.end_date).getTime()
      return end >= now && end <= cutoff
    })
    .sort((a, b) => new Date(a.end_date as Date).getTime() - new Date(b.end_date as Date).getTime())

  return c.json(expiring)
})

// ---------------------------------------------------------------------------
// GET / — list contracts for a workspace
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const supplierId = c.req.query('supplier_id')
  const categoryId = c.req.query('category_id')

  const conds = [eq(contracts.workspace_id, workspaceId)]
  if (supplierId) conds.push(eq(contracts.supplier_id, supplierId))
  if (categoryId) conds.push(eq(contracts.category_id, categoryId))

  const rows = await db
    .select()
    .from(contracts)
    .where(and(...conds))
    .orderBy(desc(contracts.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — contract detail
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const [ct] = await db.select().from(contracts).where(eq(contracts.id, c.req.param('id')))
  if (!ct) return c.json({ error: 'Not found' }, 404)
  return c.json(ct)
})

// ---------------------------------------------------------------------------
// POST / — create contract
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (!(await supplierInWorkspace(body.supplier_id, body.workspace_id)))
    return c.json({ error: 'Supplier not found in workspace' }, 400)
  if (body.category_id && !(await categoryInWorkspace(body.category_id, body.workspace_id)))
    return c.json({ error: 'Category not found in workspace' }, 400)

  const [created] = await db
    .insert(contracts)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id,
      category_id: body.category_id ?? null,
      name: body.name,
      contracted_unit_price: body.contracted_unit_price ?? null,
      committed_volume: body.committed_volume ?? null,
      currency: body.currency ?? 'USD',
      start_date: body.start_date ? new Date(body.start_date) : null,
      end_date: body.end_date ? new Date(body.end_date) : null,
      status: body.status ?? 'active',
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update contract
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  if (body.supplier_id && !(await supplierInWorkspace(body.supplier_id, existing.workspace_id)))
    return c.json({ error: 'Supplier not found in workspace' }, 400)
  if (body.category_id && !(await categoryInWorkspace(body.category_id, existing.workspace_id)))
    return c.json({ error: 'Category not found in workspace' }, 400)

  const patch: Record<string, unknown> = {}
  if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id
  if (body.category_id !== undefined) patch.category_id = body.category_id
  if (body.name !== undefined) patch.name = body.name
  if (body.contracted_unit_price !== undefined) patch.contracted_unit_price = body.contracted_unit_price
  if (body.committed_volume !== undefined) patch.committed_volume = body.committed_volume
  if (body.currency !== undefined) patch.currency = body.currency
  if (body.start_date !== undefined) patch.start_date = body.start_date ? new Date(body.start_date) : null
  if (body.end_date !== undefined) patch.end_date = body.end_date ? new Date(body.end_date) : null
  if (body.status !== undefined) patch.status = body.status

  const [updated] = await db.update(contracts).set(patch).where(eq(contracts.id, id)).returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete contract
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(contracts).where(eq(contracts.id, id))
  return c.json({ success: true })
})

export default router
