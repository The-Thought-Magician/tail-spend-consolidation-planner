import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  categories,
  workspace_members,
  workspaces,
  suppliers,
  transactions,
  maverick_findings,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

async function getCategory(id: string) {
  const [cat] = await db.select().from(categories).where(eq(categories.id, id))
  return cat ?? null
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  workspace_id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  parent_id: z.string().min(1).nullable().optional(),
  level: z.number().int().min(0).optional(),
})

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  parent_id: z.string().min(1).nullable().optional(),
  level: z.number().int().min(0).optional(),
})

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Public: list categories for a workspace (tree-ready, ordered by level then code)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.workspace_id, workspaceId))
  rows.sort((a, b) => (a.level - b.level) || a.code.localeCompare(b.code))
  return c.json(rows)
})

// Public: category detail
router.get('/:id', async (c) => {
  const cat = await getCategory(c.req.param('id'))
  if (!cat) return c.json({ error: 'Not found' }, 404)
  return c.json(cat)
})

// Create category
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  let level = body.level ?? 0
  if (body.parent_id) {
    const parent = await getCategory(body.parent_id)
    if (!parent || parent.workspace_id !== body.workspace_id) {
      return c.json({ error: 'Invalid parent_id' }, 400)
    }
    if (body.level === undefined) level = parent.level + 1
  }

  const [cat] = await db
    .insert(categories)
    .values({
      workspace_id: body.workspace_id,
      code: body.code,
      name: body.name,
      parent_id: body.parent_id ?? null,
      level,
    })
    .returning()
  return c.json(cat, 201)
})

// Rename / reparent
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const cat = await getCategory(id)
  if (!cat) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(cat.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  if (body.parent_id) {
    if (body.parent_id === id) return c.json({ error: 'Category cannot be its own parent' }, 400)
    const parent = await getCategory(body.parent_id)
    if (!parent || parent.workspace_id !== cat.workspace_id) {
      return c.json({ error: 'Invalid parent_id' }, 400)
    }
  }

  const [updated] = await db.update(categories).set(body).where(eq(categories.id, id)).returning()
  return c.json(updated)
})

// Delete category
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const cat = await getCategory(id)
  if (!cat) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(cat.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(categories).where(eq(categories.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Per-category analytics: spend, supplier_count, fragmentation_index,
// maverick_rate, contract_coverage
// ---------------------------------------------------------------------------

router.get('/:id/analytics', async (c) => {
  const id = c.req.param('id')
  const cat = await getCategory(id)
  if (!cat) return c.json({ error: 'Not found' }, 404)

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.category_id, id))

  const spend = txns.reduce((acc, t) => acc + (t.amount ?? 0), 0)
  const txnCount = txns.length

  // Distinct suppliers transacting in this category.
  const supplierSpend = new Map<string, number>()
  for (const t of txns) {
    if (!t.supplier_id) continue
    supplierSpend.set(t.supplier_id, (supplierSpend.get(t.supplier_id) ?? 0) + (t.amount ?? 0))
  }
  const supplierCount = supplierSpend.size

  // Also count suppliers classified into this category (master), for context.
  const classifiedSuppliers = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.category_id, id))

  // Fragmentation index: Herfindahl-based. HHI = sum(share^2). A more
  // fragmented category (many small suppliers) yields a HIGHER fragmentation
  // index → fragmentation_index = 1 - HHI, in [0, 1).
  let hhi = 0
  if (spend > 0) {
    for (const amt of supplierSpend.values()) {
      const share = amt / spend
      hhi += share * share
    }
  }
  const fragmentationIndex = spend > 0 ? Math.max(0, 1 - hhi) : 0

  // Maverick rate: share of off-contract spend within the category.
  const offContractSpend = txns
    .filter((t) => !t.is_on_contract)
    .reduce((acc, t) => acc + (t.amount ?? 0), 0)
  const maverickRate = spend > 0 ? offContractSpend / spend : 0

  // Contract coverage: share of on-contract spend.
  const onContractSpend = spend - offContractSpend
  const coverage = spend > 0 ? onContractSpend / spend : 0

  // Recorded maverick leakage findings tied to this category.
  const findings = await db
    .select()
    .from(maverick_findings)
    .where(eq(maverick_findings.category_id, id))
  const maverickLeakage = findings.reduce((acc, f) => acc + (f.leakage_amount ?? 0), 0)

  return c.json({
    category: cat,
    spend,
    txn_count: txnCount,
    supplier_count: supplierCount,
    classified_supplier_count: classifiedSuppliers.length,
    fragmentation_index: fragmentationIndex,
    hhi,
    maverick_rate: maverickRate,
    off_contract_spend: offContractSpend,
    on_contract_spend: onContractSpend,
    contract_coverage: coverage,
    coverage,
    maverick_leakage: maverickLeakage,
    maverick_finding_count: findings.length,
  })
})

export default router
