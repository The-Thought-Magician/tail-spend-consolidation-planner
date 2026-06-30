import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reports,
  workspaces,
  workspace_members,
  transactions,
  suppliers,
  tail_segments,
  duplicate_groups,
  maverick_findings,
  price_dispersion,
  recommendations,
  savings_ledger,
  consolidation_scenarios,
  initiatives,
} from '../db/schema.js'
import { eq, and, desc, sql } from 'drizzle-orm'
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

// Assemble a board-ready payload from the current state of the workspace analysis.
async function buildReportPayload(workspaceId: string): Promise<Record<string, unknown>> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))

  const [txnAgg] = await db
    .select({
      totalSpend: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      txnCount: sql<number>`count(*)::int`,
      supplierCount: sql<number>`count(distinct ${transactions.supplier_id})::int`,
      onContractSpend: sql<number>`coalesce(sum(case when ${transactions.is_on_contract} then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  const [{ supplierMaster }] = await db
    .select({ supplierMaster: sql<number>`count(*)::int` })
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspaceId))

  const segments = await db
    .select()
    .from(tail_segments)
    .where(eq(tail_segments.workspace_id, workspaceId))
    .orderBy(desc(tail_segments.computed_at))

  // Keep the most recent segment per (dimension, segment).
  const latestSegments: Record<string, (typeof segments)[number]> = {}
  for (const s of segments) {
    const key = `${s.dimension}:${s.segment}`
    if (!latestSegments[key]) latestSegments[key] = s
  }
  const tailRow = latestSegments['supplier:tail']

  const [{ dupGroups, dupSpend }] = await db
    .select({
      dupGroups: sql<number>`count(*)::int`,
      dupSpend: sql<number>`coalesce(sum(${duplicate_groups.combined_spend}), 0)`,
    })
    .from(duplicate_groups)
    .where(and(eq(duplicate_groups.workspace_id, workspaceId), eq(duplicate_groups.status, 'open')))

  const [{ mavLeakage, mavCount }] = await db
    .select({
      mavLeakage: sql<number>`coalesce(sum(${maverick_findings.leakage_amount}), 0)`,
      mavCount: sql<number>`count(*)::int`,
    })
    .from(maverick_findings)
    .where(and(eq(maverick_findings.workspace_id, workspaceId), eq(maverick_findings.status, 'open')))

  const [{ dispSavings }] = await db
    .select({ dispSavings: sql<number>`coalesce(sum(${price_dispersion.addressable_savings}), 0)` })
    .from(price_dispersion)
    .where(eq(price_dispersion.workspace_id, workspaceId))

  const [{ modeled }] = await db
    .select({ modeled: sql<number>`coalesce(sum(${consolidation_scenarios.modeled_savings}), 0)` })
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.workspace_id, workspaceId))

  const [savingsAgg] = await db
    .select({
      committed: sql<number>`coalesce(sum(${savings_ledger.target_amount}), 0)`,
      realized: sql<number>`coalesce(sum(${savings_ledger.realized_amount}), 0)`,
    })
    .from(savings_ledger)
    .where(eq(savings_ledger.workspace_id, workspaceId))

  const topRecs = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.workspace_id, workspaceId), eq(recommendations.status, 'open')))
    .orderBy(desc(recommendations.impact))
    .limit(10)

  const activeInitiatives = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.workspace_id, workspaceId))
    .orderBy(desc(initiatives.target_savings))
    .limit(10)

  const totalSpend = Number(txnAgg?.totalSpend ?? 0)
  const onContractSpend = Number(txnAgg?.onContractSpend ?? 0)
  const recImpact = topRecs.reduce((acc, r) => acc + Number(r.impact ?? 0), 0)
  const identified = recImpact + Number(dispSavings ?? 0) + Number(mavLeakage ?? 0)

  return {
    generated_at: new Date().toISOString(),
    workspace: ws
      ? { id: ws.id, name: ws.name, base_currency: ws.base_currency, tail_threshold_pct: ws.tail_threshold_pct }
      : { id: workspaceId },
    executive_summary: {
      total_spend: totalSpend,
      supplier_count: Number(supplierMaster ?? 0),
      transacting_supplier_count: Number(txnAgg?.supplierCount ?? 0),
      transaction_count: Number(txnAgg?.txnCount ?? 0),
      tail_spend: Number(tailRow?.spend ?? 0),
      tail_spend_pct: Number(tailRow?.spend_share ?? 0),
      tail_supplier_count: Number(tailRow?.supplier_count ?? 0),
      on_contract_spend: onContractSpend,
      on_contract_pct: totalSpend > 0 ? onContractSpend / totalSpend : 0,
      total_identified_savings: identified,
    },
    findings: {
      duplicate_groups: Number(dupGroups ?? 0),
      duplicate_combined_spend: Number(dupSpend ?? 0),
      maverick_findings: Number(mavCount ?? 0),
      maverick_leakage: Number(mavLeakage ?? 0),
      dispersion_addressable_savings: Number(dispSavings ?? 0),
    },
    savings_funnel: [
      { stage: 'identified', amount: identified },
      { stage: 'modeled', amount: Number(modeled ?? 0) },
      { stage: 'committed', amount: Number(savingsAgg?.committed ?? 0) },
      { stage: 'realized', amount: Number(savingsAgg?.realized ?? 0) },
    ],
    tail_segments: Object.values(latestSegments),
    top_recommendations: topRecs,
    active_initiatives: activeInitiatives,
  }
}

// GET / — saved reports for a workspace (public read).
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.workspace_id, workspaceId))
    .orderBy(desc(reports.created_at))

  return c.json(rows)
})

// GET /:id — report detail incl. payload (public read).
router.get('/:id', async (c) => {
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  return c.json(r)
})

const generateSchema = z.object({
  workspace_id: z.string().min(1),
  type: z.string().min(1).optional().default('board'),
  name: z.string().min(1).optional(),
  params: z.record(z.unknown()).optional().default({}),
})

// POST /generate — build a board-ready report payload and save it.
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const payload = await buildReportPayload(body.workspace_id)
  const name = body.name ?? `Board Report ${new Date().toISOString().slice(0, 10)}`

  const [report] = await db
    .insert(reports)
    .values({
      workspace_id: body.workspace_id,
      type: body.type,
      name,
      params: body.params,
      payload,
      created_by: userId,
    })
    .returning()

  return c.json(report, 201)
})

// GET /stream — server-sent progress while assembling a report payload.
// (?workspace_id= required; public read, mirrors the generate aggregation.)
router.get('/stream', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  return streamSSE(c, async (stream) => {
    const steps = [
      'Collecting spend baseline',
      'Classifying tail segments',
      'Aggregating duplicate and maverick findings',
      'Rolling up savings funnel',
      'Assembling board-ready payload',
    ]
    for (let i = 0; i < steps.length; i++) {
      await stream.writeSSE({
        event: 'progress',
        data: JSON.stringify({ step: steps[i], index: i + 1, total: steps.length }),
        id: String(i + 1),
      })
    }
    const payload = await buildReportPayload(workspaceId)
    await stream.writeSSE({ event: 'complete', data: JSON.stringify(payload) })
  })
})

// DELETE /:id — delete a report (member of its workspace).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(reports).where(eq(reports.id, id))
  return c.json({ success: true })
})

export default router
