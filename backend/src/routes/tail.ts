import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  suppliers,
  transactions,
  tail_segments,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ---------------------------------------------------------------------------
// GET / — latest computed tail segments  ?workspace_id=&dimension=
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const dimension = c.req.query('dimension')

  const rows = await db
    .select()
    .from(tail_segments)
    .where(eq(tail_segments.workspace_id, workspaceId))
    .orderBy(desc(tail_segments.computed_at))

  // Keep only rows from the most recent compute (optionally filtered by dimension).
  const filtered = dimension ? rows.filter((r) => r.dimension === dimension) : rows
  if (filtered.length === 0) return c.json([])
  const latest = filtered[0].computed_at
  const latestKey = latest instanceof Date ? latest.getTime() : new Date(latest as unknown as string).getTime()
  const result = filtered.filter((r) => {
    const t = r.computed_at instanceof Date ? r.computed_at.getTime() : new Date(r.computed_at as unknown as string).getTime()
    return t === latestKey
  })
  return c.json(result)
})

// ---------------------------------------------------------------------------
// POST /compute — run Pareto classifier (writes tail_segments)
// ---------------------------------------------------------------------------
const computeSchema = z.object({
  workspace_id: z.string().min(1),
  dimension: z.enum(['supplier', 'category']).optional().default('supplier'),
  threshold_pct: z.number().min(0).max(1).optional(),
})

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, dimension, threshold_pct } = c.req.valid('json')
  if (!(await assertMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const threshold = threshold_pct ?? 0.8

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspace_id))

  // Roll spend up to the entity (supplier or category).
  const spendByEntity = new Map<string, number>()
  for (const t of txns) {
    const key = dimension === 'category' ? (t.category_id ?? 'uncategorized') : t.supplier_id
    spendByEntity.set(key, (spendByEntity.get(key) ?? 0) + (t.amount ?? 0))
  }

  const entities = [...spendByEntity.entries()]
    .map(([id, spend]) => ({ id, spend }))
    .sort((a, b) => b.spend - a.spend)

  const totalSpend = entities.reduce((s, e) => s + e.spend, 0)

  // Walk descending; the head accumulates spend until it crosses the threshold
  // share of total. Everything after the crossing point is the tail.
  let cumulative = 0
  let headCount = 0
  let headSpend = 0
  for (const e of entities) {
    if (totalSpend > 0 && cumulative / totalSpend >= threshold) break
    cumulative += e.spend
    headSpend += e.spend
    headCount++
  }
  const tailEntities = entities.slice(headCount)
  const tailCount = tailEntities.length
  const tailSpend = tailEntities.reduce((s, e) => s + e.spend, 0)

  const now = new Date()
  const segmentRows = [
    {
      workspace_id,
      segment: 'head',
      dimension,
      supplier_count: headCount,
      spend: headSpend,
      spend_share: totalSpend > 0 ? headSpend / totalSpend : 0,
      threshold_pct: threshold,
      computed_at: now,
    },
    {
      workspace_id,
      segment: 'tail',
      dimension,
      supplier_count: tailCount,
      spend: tailSpend,
      spend_share: totalSpend > 0 ? tailSpend / totalSpend : 0,
      threshold_pct: threshold,
      computed_at: now,
    },
  ]

  const inserted = await db.insert(tail_segments).values(segmentRows).returning()
  return c.json({ segments: inserted }, 201)
})

// ---------------------------------------------------------------------------
// GET /concentration — tail metrics  ?workspace_id=
// ---------------------------------------------------------------------------
router.get('/concentration', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  const spendBySupplier = new Map<string, number>()
  for (const t of txns) {
    spendBySupplier.set(t.supplier_id, (spendBySupplier.get(t.supplier_id) ?? 0) + (t.amount ?? 0))
  }

  // Read the latest tail segments to anchor the metrics on the computed threshold.
  const segRows = await db
    .select()
    .from(tail_segments)
    .where(and(eq(tail_segments.workspace_id, workspaceId), eq(tail_segments.dimension, 'supplier')))
    .orderBy(desc(tail_segments.computed_at))

  const totalSpend = [...spendBySupplier.values()].reduce((s, v) => s + v, 0)
  const totalSuppliers = spendBySupplier.size

  let tailSeg = segRows.find((r) => r.segment === 'tail')
  // If no segments computed yet, derive the tail on-the-fly with default 0.8.
  if (!tailSeg) {
    const sorted = [...spendBySupplier.values()].sort((a, b) => b - a)
    let cumulative = 0
    let headCount = 0
    for (const v of sorted) {
      if (totalSpend > 0 && cumulative / totalSpend >= 0.8) break
      cumulative += v
      headCount++
    }
    const tailSpend = sorted.slice(headCount).reduce((s, v) => s + v, 0)
    const tailCount = sorted.length - headCount
    return c.json({
      tail_supplier_count: tailCount,
      tail_spend: tailSpend,
      tail_spend_pct: totalSpend > 0 ? tailSpend / totalSpend : 0,
      avg_spend_per_tail_supplier: tailCount > 0 ? tailSpend / tailCount : 0,
      total_suppliers: totalSuppliers,
      total_spend: totalSpend,
      threshold_pct: 0.8,
      computed: false,
    })
  }

  return c.json({
    tail_supplier_count: tailSeg.supplier_count,
    tail_spend: tailSeg.spend,
    tail_spend_pct: tailSeg.spend_share,
    avg_spend_per_tail_supplier: tailSeg.supplier_count > 0 ? tailSeg.spend / tailSeg.supplier_count : 0,
    total_suppliers: totalSuppliers,
    total_spend: totalSpend,
    threshold_pct: tailSeg.threshold_pct ?? 0.8,
    computed: true,
  })
})

// ---------------------------------------------------------------------------
// GET /trend — tail size by period  ?workspace_id=
// ---------------------------------------------------------------------------
router.get('/trend', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const threshold = 0.8

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  // Group transactions by YYYY-MM, then run the Pareto split within each period.
  const byPeriod = new Map<string, Map<string, number>>()
  for (const t of txns) {
    const d = t.txn_date instanceof Date ? t.txn_date : new Date(t.txn_date as unknown as string)
    if (Number.isNaN(d.getTime())) continue
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    let m = byPeriod.get(period)
    if (!m) {
      m = new Map()
      byPeriod.set(period, m)
    }
    m.set(t.supplier_id, (m.get(t.supplier_id) ?? 0) + (t.amount ?? 0))
  }

  const points = [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, m]) => {
      const sorted = [...m.values()].sort((a, b) => b - a)
      const total = sorted.reduce((s, v) => s + v, 0)
      let cumulative = 0
      let headCount = 0
      for (const v of sorted) {
        if (total > 0 && cumulative / total >= threshold) break
        cumulative += v
        headCount++
      }
      const tailCount = sorted.length - headCount
      const tailSpend = sorted.slice(headCount).reduce((s, v) => s + v, 0)
      return {
        period,
        total_suppliers: sorted.length,
        tail_supplier_count: tailCount,
        tail_spend: tailSpend,
        total_spend: total,
        tail_spend_pct: total > 0 ? tailSpend / total : 0,
      }
    })

  return c.json({ points })
})

// ---------------------------------------------------------------------------
// GET /segment/:segment/suppliers — suppliers in a segment  ?workspace_id=
// ---------------------------------------------------------------------------
router.get('/segment/:segment/suppliers', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const segment = c.req.param('segment')
  if (segment !== 'head' && segment !== 'tail') return c.json({ error: 'segment must be head or tail' }, 400)
  const threshold = 0.8

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  const spendBySupplier = new Map<string, number>()
  for (const t of txns) {
    spendBySupplier.set(t.supplier_id, (spendBySupplier.get(t.supplier_id) ?? 0) + (t.amount ?? 0))
  }

  const ranked = [...spendBySupplier.entries()]
    .map(([id, spend]) => ({ id, spend }))
    .sort((a, b) => b.spend - a.spend)
  const total = ranked.reduce((s, e) => s + e.spend, 0)

  let cumulative = 0
  let headCount = 0
  for (const e of ranked) {
    if (total > 0 && cumulative / total >= threshold) break
    cumulative += e.spend
    headCount++
  }
  const selected = segment === 'head' ? ranked.slice(0, headCount) : ranked.slice(headCount)
  const selectedIds = new Set(selected.map((e) => e.id))

  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspaceId))

  const out = supplierRows
    .filter((s) => selectedIds.has(s.id))
    .map((s) => ({ ...s, spend: spendBySupplier.get(s.id) ?? 0 }))
    .sort((a, b) => b.spend - a.spend)

  return c.json(out)
})

export default router
