import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  transaction_cost_models,
  transaction_cost_ledger,
  purchase_orders,
  invoices,
  suppliers,
  transactions,
  workspace_members,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [row] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!row
}

const modelSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  cost_per_po: z.number().nonnegative().optional().default(100),
  cost_per_invoice: z.number().nonnegative().optional().default(50),
  cost_per_supplier: z.number().nonnegative().optional().default(500),
  is_default: z.boolean().optional().default(false),
})

const modelUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  cost_per_po: z.number().nonnegative().optional(),
  cost_per_invoice: z.number().nonnegative().optional(),
  cost_per_supplier: z.number().nonnegative().optional(),
  is_default: z.boolean().optional(),
})

const computeSchema = z.object({
  workspace_id: z.string().min(1),
  model_id: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET /models — cost models ?workspace_id=
// ---------------------------------------------------------------------------

router.get('/models', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(transaction_cost_models)
    .where(eq(transaction_cost_models.workspace_id, workspaceId))
    .orderBy(desc(transaction_cost_models.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /models — create cost model
// ---------------------------------------------------------------------------

router.post('/models', authMiddleware, zValidator('json', modelSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // If this model is the default, clear any other defaults first.
  if (body.is_default) {
    await db
      .update(transaction_cost_models)
      .set({ is_default: false })
      .where(eq(transaction_cost_models.workspace_id, body.workspace_id))
  }

  const [model] = await db
    .insert(transaction_cost_models)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      cost_per_po: body.cost_per_po,
      cost_per_invoice: body.cost_per_invoice,
      cost_per_supplier: body.cost_per_supplier,
      is_default: body.is_default,
      created_by: userId,
    })
    .returning()
  return c.json(model, 201)
})

// ---------------------------------------------------------------------------
// PUT /models/:id — update cost model (set default)
// ---------------------------------------------------------------------------

router.put('/models/:id', authMiddleware, zValidator('json', modelUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(transaction_cost_models)
    .where(eq(transaction_cost_models.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (body.is_default) {
    await db
      .update(transaction_cost_models)
      .set({ is_default: false })
      .where(eq(transaction_cost_models.workspace_id, existing.workspace_id))
  }

  const [updated] = await db
    .update(transaction_cost_models)
    .set(body)
    .where(eq(transaction_cost_models.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /models/:id — delete model
// ---------------------------------------------------------------------------

router.delete('/models/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(transaction_cost_models)
    .where(eq(transaction_cost_models.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Drop derived ledger rows for this model, then the model.
  await db.delete(transaction_cost_ledger).where(eq(transaction_cost_ledger.model_id, id))
  await db.delete(transaction_cost_models).where(eq(transaction_cost_models.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /compute — compute ledger per supplier from PO/invoice counts
// ---------------------------------------------------------------------------

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, model_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [model] = await db
    .select()
    .from(transaction_cost_models)
    .where(eq(transaction_cost_models.id, model_id))
  if (!model) return c.json({ error: 'Model not found' }, 404)
  if (model.workspace_id !== workspace_id) {
    return c.json({ error: 'Model does not belong to workspace' }, 403)
  }

  const sups = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspace_id))

  const pos = await db
    .select()
    .from(purchase_orders)
    .where(eq(purchase_orders.workspace_id, workspace_id))
  const invs = await db
    .select()
    .from(invoices)
    .where(eq(invoices.workspace_id, workspace_id))

  const poBySupplier = new Map<string, number>()
  for (const po of pos) {
    poBySupplier.set(po.supplier_id, (poBySupplier.get(po.supplier_id) ?? 0) + 1)
  }
  const invBySupplier = new Map<string, number>()
  for (const inv of invs) {
    invBySupplier.set(inv.supplier_id, (invBySupplier.get(inv.supplier_id) ?? 0) + 1)
  }

  // Recompute: wipe prior ledger for this model in this workspace.
  await db
    .delete(transaction_cost_ledger)
    .where(
      and(
        eq(transaction_cost_ledger.workspace_id, workspace_id),
        eq(transaction_cost_ledger.model_id, model_id),
      ),
    )

  const now = new Date()
  const ledger: typeof transaction_cost_ledger.$inferSelect[] = []

  for (const s of sups) {
    const poCount = poBySupplier.get(s.id) ?? 0
    const invCount = invBySupplier.get(s.id) ?? 0
    // Per-supplier cost = fixed onboarding/management cost + per-PO + per-invoice.
    const estCost =
      model.cost_per_supplier +
      poCount * model.cost_per_po +
      invCount * model.cost_per_invoice

    const [row] = await db
      .insert(transaction_cost_ledger)
      .values({
        workspace_id,
        model_id,
        supplier_id: s.id,
        po_count: poCount,
        invoice_count: invCount,
        est_cost: estCost,
        computed_at: now,
      })
      .returning()
    ledger.push(row)
  }

  ledger.sort((a, z) => z.est_cost - a.est_cost)
  return c.json({ ledger }, 201)
})

// ---------------------------------------------------------------------------
// GET /ledger — computed ledger ?workspace_id=
// ---------------------------------------------------------------------------

router.get('/ledger', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const modelId = c.req.query('model_id')

  const conds = [eq(transaction_cost_ledger.workspace_id, workspaceId)]
  if (modelId) conds.push(eq(transaction_cost_ledger.model_id, modelId))

  const rows = await db
    .select()
    .from(transaction_cost_ledger)
    .where(and(...conds))
    .orderBy(desc(transaction_cost_ledger.est_cost))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /reduction — model cost reduction from removing N tail suppliers
//   ?workspace_id=&n=
// ---------------------------------------------------------------------------

router.get('/reduction', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const nRaw = parseInt(c.req.query('n') ?? '10', 10)
  const n = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 10
  const modelId = c.req.query('model_id')

  // Use the requested model's ledger, or all ledger rows for the workspace.
  const conds = [eq(transaction_cost_ledger.workspace_id, workspaceId)]
  if (modelId) conds.push(eq(transaction_cost_ledger.model_id, modelId))
  const ledger = await db
    .select()
    .from(transaction_cost_ledger)
    .where(and(...conds))

  // Spend per supplier to rank "tail" by lowest spend (consolidation candidates).
  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))
  const spendBySupplier = new Map<string, number>()
  for (const t of txns) {
    spendBySupplier.set(t.supplier_id, (spendBySupplier.get(t.supplier_id) ?? 0) + t.amount)
  }

  const sups = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspaceId))
  const supName = new Map(sups.map((s) => [s.id, s.name]))

  const totalCost = ledger.reduce((acc, r) => acc + r.est_cost, 0)

  // Rank candidate suppliers by lowest annual spend (the long tail) — those are
  // the cheapest to cut / consolidate. Tie-break by highest est_cost (most
  // transaction overhead per dollar of spend).
  const ranked = ledger
    .map((r) => ({
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_id ? supName.get(r.supplier_id) ?? 'Unknown' : 'Unknown',
      est_cost: r.est_cost,
      po_count: r.po_count,
      invoice_count: r.invoice_count,
      spend: r.supplier_id ? spendBySupplier.get(r.supplier_id) ?? 0 : 0,
    }))
    .sort((a, z) => {
      if (a.spend !== z.spend) return a.spend - z.spend
      return z.est_cost - a.est_cost
    })

  const removed = ranked.slice(0, n)
  const reduction = removed.reduce((acc, r) => acc + r.est_cost, 0)
  const remainingCost = totalCost - reduction

  return c.json({
    n,
    supplier_count: ledger.length,
    total_cost: totalCost,
    reduction,
    remaining_cost: remainingCost,
    reduction_pct: totalCost > 0 ? reduction / totalCost : 0,
    removed_suppliers: removed,
  })
})

export default router
