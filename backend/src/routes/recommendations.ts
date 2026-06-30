import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  recommendations,
  consolidation_scenarios,
  initiatives,
  tail_segments,
  duplicate_groups,
  price_dispersion,
  suppliers,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// --- helpers -------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [row] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!row
}

function priorityFor(impact: number, effort: number): string {
  if (impact <= 0) return 'low'
  const ratio = effort > 0 ? impact / effort : impact
  if (impact >= 50000 && ratio >= 100) return 'high'
  if (impact >= 10000 || ratio >= 50) return 'medium'
  return 'low'
}

// --- schemas -------------------------------------------------------------

const updateSchema = z.object({
  status: z.enum(['open', 'accepted', 'dismissed', 'snoozed', 'converted']).optional(),
  title: z.string().min(1).optional(),
  rationale: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

const generateSchema = z.object({
  workspace_id: z.string().min(1),
})

const toScenarioSchema = z.object({
  name: z.string().min(1).optional(),
})

const toInitiativeSchema = z.object({
  title: z.string().min(1).optional(),
  owner_id: z.string().optional(),
  target_savings: z.number().optional(),
})

// --- GET / : list recommendations ---------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const status = c.req.query('status')
  const conds = [eq(recommendations.workspace_id, workspaceId)]
  if (status) conds.push(eq(recommendations.status, status))
  const rows = await db
    .select()
    .from(recommendations)
    .where(and(...conds))
    .orderBy(desc(recommendations.impact), desc(recommendations.created_at))
  return c.json(rows)
})

// --- POST /generate : derive recs from analysis outputs -------------------

router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const created: Array<typeof recommendations.$inferInsert> = []

  // 1. Tail consolidation: from the latest tail segments, recommend reducing the long tail.
  const segments = await db
    .select()
    .from(tail_segments)
    .where(eq(tail_segments.workspace_id, workspace_id))
    .orderBy(desc(tail_segments.computed_at))
  const tailSeg = segments.find((s) => s.segment === 'tail')
  if (tailSeg && tailSeg.supplier_count > 0) {
    // Estimated impact: a conservative 8% of tail spend is addressable via consolidation.
    const impact = Math.round(tailSeg.spend * 0.08)
    created.push({
      workspace_id,
      type: 'tail_consolidation',
      title: `Consolidate ${tailSeg.supplier_count} tail suppliers`,
      rationale: `${tailSeg.supplier_count} suppliers account for only ${(tailSeg.spend_share * 100).toFixed(1)}% of spend ($${Math.round(tailSeg.spend).toLocaleString()}). Rationalizing this long tail reduces transaction cost and unlocks volume leverage.`,
      impact,
      effort: tailSeg.supplier_count > 100 ? 80 : 40,
      priority: priorityFor(impact, tailSeg.supplier_count > 100 ? 80 : 40),
      supplier_ids: [],
      status: 'open',
    })
  }

  // 2. Duplicate-supplier merges: one rec per open duplicate group with material spend.
  const groups = await db
    .select()
    .from(duplicate_groups)
    .where(and(eq(duplicate_groups.workspace_id, workspace_id), eq(duplicate_groups.status, 'open')))
    .orderBy(desc(duplicate_groups.combined_spend))
  for (const g of groups.slice(0, 25)) {
    const members = (g.member_supplier_ids ?? []) as string[]
    if (members.length < 2) continue
    // Merging duplicates: estimated 5% of combined spend recovered + reduced overhead.
    const impact = Math.round(g.combined_spend * 0.05)
    created.push({
      workspace_id,
      type: 'duplicate_merge',
      category_id: g.category_id ?? null,
      title: `Merge ${members.length} duplicate supplier records`,
      rationale: `These ${members.length} supplier records share ${(g.similarity * 100).toFixed(0)}% name/profile similarity and total $${Math.round(g.combined_spend).toLocaleString()} in spend. Merging consolidates leverage and cleans the supplier master.`,
      impact,
      effort: 20,
      priority: priorityFor(impact, 20),
      supplier_ids: members,
      status: 'open',
    })
  }

  // 3. Price dispersion: items with high dispersion and addressable savings.
  const dispersion = await db
    .select()
    .from(price_dispersion)
    .where(eq(price_dispersion.workspace_id, workspace_id))
    .orderBy(desc(price_dispersion.addressable_savings))
  for (const d of dispersion.slice(0, 25)) {
    if (d.addressable_savings <= 0) continue
    const impact = Math.round(d.addressable_savings)
    created.push({
      workspace_id,
      type: 'price_harmonization',
      category_id: d.category_id ?? null,
      title: `Harmonize pricing for "${d.item_key}"`,
      rationale: `Item "${d.item_key}" shows a price dispersion index of ${d.dispersion_index.toFixed(2)} (min $${(d.min_price ?? 0).toFixed(2)} / max $${(d.max_price ?? 0).toFixed(2)}). Standardizing to the median unlocks ~$${impact.toLocaleString()} in addressable savings.`,
      impact,
      effort: 30,
      priority: priorityFor(impact, 30),
      supplier_ids: [],
      status: 'open',
    })
  }

  if (created.length === 0) {
    return c.json({ recommendations: [], message: 'No findings available. Run tail, duplicate, and dispersion analysis first.' }, 201)
  }

  const inserted = await db.insert(recommendations).values(created).returning()
  return c.json({ recommendations: inserted }, 201)
})

// --- PUT /:id : update status / fields -----------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(recommendations).where(eq(recommendations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(recommendations).set(body).where(eq(recommendations.id, id)).returning()
  return c.json(updated)
})

// --- POST /:id/to-scenario : spawn a consolidation scenario ---------------

router.post('/:id/to-scenario', authMiddleware, zValidator('json', toScenarioSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, id))
  if (!rec) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(rec.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const recSuppliers = (rec.supplier_ids ?? []) as string[]
  // Default consolidation target: the highest-spend supplier in the group.
  let toIds: string[] = []
  if (recSuppliers.length > 0) {
    const supRows = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.workspace_id, rec.workspace_id), inArray(suppliers.id, recSuppliers)))
    if (supRows.length > 0) {
      toIds = [supRows[0].id]
    }
  }
  const fromIds = recSuppliers.filter((s) => !toIds.includes(s))

  const [scenario] = await db
    .insert(consolidation_scenarios)
    .values({
      workspace_id: rec.workspace_id,
      name: body.name ?? `Scenario: ${rec.title}`,
      category_id: rec.category_id ?? null,
      from_supplier_ids: fromIds,
      to_supplier_ids: toIds,
      assumptions: { price_reduction_pct: 5, transaction_cost_saving: rec.impact },
      results: {},
      modeled_savings: rec.impact,
      created_by: userId,
    })
    .returning()

  await db.update(recommendations).set({ status: 'converted' }).where(eq(recommendations.id, id))
  return c.json(scenario, 201)
})

// --- POST /:id/to-initiative : spawn a tracked initiative -----------------

router.post('/:id/to-initiative', authMiddleware, zValidator('json', toInitiativeSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, id))
  if (!rec) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(rec.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const [initiative] = await db
    .insert(initiatives)
    .values({
      workspace_id: rec.workspace_id,
      title: body.title ?? rec.title,
      description: rec.rationale,
      category_id: rec.category_id ?? null,
      owner_id: body.owner_id ?? userId,
      target_savings: body.target_savings ?? rec.impact,
      status: 'identified',
    })
    .returning()

  await db.update(recommendations).set({ status: 'converted' }).where(eq(recommendations.id, id))
  return c.json(initiative, 201)
})

export default router
