import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  consolidation_scenarios,
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

/**
 * Model the savings breakdown for a scenario from its from/to suppliers and
 * assumptions. Pure over the supplied baseline spend + assumption knobs.
 *
 * Assumptions (all optional, sensible defaults):
 *   price_reduction_pct   — negotiated unit-price reduction on consolidated spend
 *   process_cost_per_supplier — admin cost saved per supplier eliminated
 *   compliance_uplift_pct — extra capture from moving maverick spend on-contract
 *   one_time_cost         — switching / implementation cost (subtracted)
 *   rebate_pct            — volume rebate on consolidated spend
 */
function modelSavings(
  baselineSpend: number,
  suppliersEliminated: number,
  assumptions: Record<string, number>,
) {
  const priceReductionPct = assumptions.price_reduction_pct ?? 0.08
  const processCostPerSupplier = assumptions.process_cost_per_supplier ?? 500
  const complianceUpliftPct = assumptions.compliance_uplift_pct ?? 0.02
  const rebatePct = assumptions.rebate_pct ?? 0
  const oneTimeCost = assumptions.one_time_cost ?? 0

  const priceSavings = baselineSpend * priceReductionPct
  const processSavings = suppliersEliminated * processCostPerSupplier
  const complianceSavings = baselineSpend * complianceUpliftPct
  const rebateSavings = baselineSpend * rebatePct

  const grossSavings = priceSavings + processSavings + complianceSavings + rebateSavings
  const netSavings = grossSavings - oneTimeCost

  const results: Record<string, number> = {
    baseline_spend: baselineSpend,
    suppliers_eliminated: suppliersEliminated,
    price_savings: priceSavings,
    process_savings: processSavings,
    compliance_savings: complianceSavings,
    rebate_savings: rebateSavings,
    gross_savings: grossSavings,
    one_time_cost: oneTimeCost,
    net_savings: netSavings,
    savings_pct: baselineSpend > 0 ? netSavings / baselineSpend : 0,
  }
  return { results, modeled_savings: netSavings }
}

/** Sum of transaction spend across a set of supplier ids in a workspace. */
async function baselineSpendForSuppliers(
  workspaceId: string,
  supplierIds: string[],
): Promise<number> {
  if (supplierIds.length === 0) return 0
  const set = new Set(supplierIds)
  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))
  let total = 0
  for (const t of txns) if (set.has(t.supplier_id)) total += t.amount
  return total
}

const scenarioSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().optional().nullable(),
  from_supplier_ids: z.array(z.string()).optional().default([]),
  to_supplier_ids: z.array(z.string()).optional().default([]),
  assumptions: z.record(z.string(), z.number()).optional().default({}),
})

const scenarioUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category_id: z.string().optional().nullable(),
  from_supplier_ids: z.array(z.string()).optional(),
  to_supplier_ids: z.array(z.string()).optional(),
  assumptions: z.record(z.string(), z.number()).optional(),
})

// ---------------------------------------------------------------------------
// GET / — scenarios ?workspace_id=
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.workspace_id, workspaceId))
    .orderBy(desc(consolidation_scenarios.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /compare — side-by-side compare ?workspace_id=&ids=a,b,c
//   (declared before /:id so "compare" is not captured as an id)
// ---------------------------------------------------------------------------

router.get('/compare', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const idsParam = c.req.query('ids') ?? ''
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)

  const all = await db
    .select()
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.workspace_id, workspaceId))

  const selected = ids.length > 0 ? all.filter((s) => ids.includes(s.id)) : all

  const scenarios = selected.map((s) => {
    const results = (s.results ?? {}) as Record<string, number>
    return {
      id: s.id,
      name: s.name,
      category_id: s.category_id,
      from_supplier_count: (s.from_supplier_ids ?? []).length,
      to_supplier_count: (s.to_supplier_ids ?? []).length,
      modeled_savings: s.modeled_savings,
      baseline_spend: results.baseline_spend ?? 0,
      gross_savings: results.gross_savings ?? 0,
      net_savings: results.net_savings ?? s.modeled_savings,
      savings_pct: results.savings_pct ?? 0,
      one_time_cost: results.one_time_cost ?? 0,
      assumptions: s.assumptions ?? {},
      results,
    }
  })

  // Preserve requested order when ids were supplied.
  if (ids.length > 0) {
    scenarios.sort((a, z) => ids.indexOf(a.id) - ids.indexOf(z.id))
  } else {
    scenarios.sort((a, z) => z.modeled_savings - a.modeled_savings)
  }

  return c.json({ scenarios })
})

// ---------------------------------------------------------------------------
// GET /:id — scenario detail
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const [s] = await db
    .select()
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.id, c.req.param('id')))
  if (!s) return c.json({ error: 'Not found' }, 404)
  return c.json(s)
})

// ---------------------------------------------------------------------------
// POST / — create scenario
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', scenarioSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Initialize a modeled result from the from-suppliers baseline + assumptions.
  const fromIds = body.from_supplier_ids
  const toIds = body.to_supplier_ids
  const baseline = await baselineSpendForSuppliers(body.workspace_id, fromIds)
  const eliminated = Math.max(0, fromIds.length - toIds.length)
  const { results, modeled_savings } = modelSavings(baseline, eliminated, body.assumptions)

  const [s] = await db
    .insert(consolidation_scenarios)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      category_id: body.category_id ?? null,
      from_supplier_ids: fromIds,
      to_supplier_ids: toIds,
      assumptions: body.assumptions,
      results,
      modeled_savings,
      created_by: userId,
    })
    .returning()
  return c.json(s, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update scenario (assumptions/suppliers)
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', scenarioUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const set: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) set.name = body.name
  if (body.category_id !== undefined) set.category_id = body.category_id
  if (body.from_supplier_ids !== undefined) set.from_supplier_ids = body.from_supplier_ids
  if (body.to_supplier_ids !== undefined) set.to_supplier_ids = body.to_supplier_ids
  if (body.assumptions !== undefined) set.assumptions = body.assumptions

  // Re-model from the merged state so results stay consistent.
  const fromIds = body.from_supplier_ids ?? existing.from_supplier_ids ?? []
  const toIds = body.to_supplier_ids ?? existing.to_supplier_ids ?? []
  const assumptions = body.assumptions ?? existing.assumptions ?? {}
  const baseline = await baselineSpendForSuppliers(existing.workspace_id, fromIds)
  const eliminated = Math.max(0, fromIds.length - toIds.length)
  const { results, modeled_savings } = modelSavings(baseline, eliminated, assumptions)
  set.results = results
  set.modeled_savings = modeled_savings

  const [updated] = await db
    .update(consolidation_scenarios)
    .set(set)
    .where(eq(consolidation_scenarios.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete scenario
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(consolidation_scenarios).where(eq(consolidation_scenarios.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /:id/model — recompute savings breakdown from assumptions
// ---------------------------------------------------------------------------

const modelBodySchema = z.object({
  assumptions: z.record(z.string(), z.number()).optional(),
})

router.post('/:id/model', authMiddleware, zValidator('json', modelBodySchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const assumptions = body.assumptions ?? existing.assumptions ?? {}
  const fromIds = existing.from_supplier_ids ?? []
  const toIds = existing.to_supplier_ids ?? []
  const baseline = await baselineSpendForSuppliers(existing.workspace_id, fromIds)
  const eliminated = Math.max(0, fromIds.length - toIds.length)
  const { results, modeled_savings } = modelSavings(baseline, eliminated, assumptions)

  await db
    .update(consolidation_scenarios)
    .set({ assumptions, results, modeled_savings, updated_at: new Date() })
    .where(eq(consolidation_scenarios.id, id))

  return c.json({ results, modeled_savings })
})

export default router
