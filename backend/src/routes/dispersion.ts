import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  price_dispersion,
  transactions,
  categories,
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const frac = idx - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

const computeSchema = z.object({
  workspace_id: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET / — price-dispersion rows ?workspace_id=&category_id=
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const categoryId = c.req.query('category_id')

  const conds = [eq(price_dispersion.workspace_id, workspaceId)]
  if (categoryId) conds.push(eq(price_dispersion.category_id, categoryId))

  const rows = await db
    .select()
    .from(price_dispersion)
    .where(and(...conds))
    .orderBy(desc(price_dispersion.addressable_savings))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /compute — compute per-item price stats + addressable savings
// ---------------------------------------------------------------------------

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Pull all transactions that carry a unit price + item key (price-bearing lines).
  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspace_id))

  // Group by (category_id, item_key). Only price lines with positive unit_price.
  interface Bucket {
    category_id: string | null
    prices: number[]
    quantities: number[]
    totalQty: number
  }
  const buckets = new Map<string, Bucket>()

  for (const t of txns) {
    const itemKey = t.item_key
    const unitPrice = t.unit_price
    if (!itemKey || unitPrice == null || unitPrice <= 0) continue
    const qty = t.quantity != null && t.quantity > 0 ? t.quantity : 1
    const key = `${t.category_id ?? ''}::${itemKey}`
    let b = buckets.get(key)
    if (!b) {
      b = { category_id: t.category_id ?? null, prices: [], quantities: [], totalQty: 0 }
      buckets.set(key, b)
    }
    b.prices.push(unitPrice)
    b.quantities.push(qty)
    b.totalQty += qty
  }

  // Replace previously computed rows for this workspace.
  await db.delete(price_dispersion).where(eq(price_dispersion.workspace_id, workspace_id))

  const now = new Date()
  const inserted: typeof price_dispersion.$inferSelect[] = []

  for (const [key, b] of buckets) {
    // Need at least 2 distinct observations for dispersion to be meaningful.
    if (b.prices.length < 2) continue
    const itemKey = key.slice(key.indexOf('::') + 2)
    const sorted = [...b.prices].sort((a, z) => a - z)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const median = percentile(sorted, 0.5)
    const p25 = percentile(sorted, 0.25)
    const p75 = percentile(sorted, 0.75)
    // Dispersion index = (max - min) / median (coefficient of range vs median).
    const dispersionIndex = median > 0 ? (max - min) / median : 0
    // Addressable savings = sum over lines of (paid_unit_price - median) * qty
    // capped at >= 0 (the gap above the achievable median price).
    let addressable = 0
    for (let i = 0; i < b.prices.length; i++) {
      const gap = b.prices[i] - median
      if (gap > 0) addressable += gap * b.quantities[i]
    }

    const [row] = await db
      .insert(price_dispersion)
      .values({
        workspace_id,
        category_id: b.category_id,
        item_key: itemKey,
        min_price: min,
        max_price: max,
        median_price: median,
        p25_price: p25,
        p75_price: p75,
        dispersion_index: dispersionIndex,
        total_quantity: b.totalQty,
        addressable_savings: addressable,
        computed_at: now,
      })
      .returning()
    inserted.push(row)
  }

  inserted.sort((a, z) => z.addressable_savings - a.addressable_savings)
  return c.json({ rows: inserted }, 201)
})

// ---------------------------------------------------------------------------
// GET /cost-of-fragmentation — rollup of addressable savings across categories
// ---------------------------------------------------------------------------

router.get('/cost-of-fragmentation', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(price_dispersion)
    .where(eq(price_dispersion.workspace_id, workspaceId))

  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.workspace_id, workspaceId))
  const catName = new Map(cats.map((cat) => [cat.id, cat.name]))

  interface Roll {
    category_id: string | null
    category_name: string
    addressable_savings: number
    item_count: number
    avg_dispersion_index: number
    _dispSum: number
  }
  const byCat = new Map<string, Roll>()
  let total = 0

  for (const r of rows) {
    total += r.addressable_savings
    const key = r.category_id ?? 'uncategorized'
    let roll = byCat.get(key)
    if (!roll) {
      roll = {
        category_id: r.category_id ?? null,
        category_name: r.category_id ? catName.get(r.category_id) ?? 'Unknown' : 'Uncategorized',
        addressable_savings: 0,
        item_count: 0,
        avg_dispersion_index: 0,
        _dispSum: 0,
      }
      byCat.set(key, roll)
    }
    roll.addressable_savings += r.addressable_savings
    roll.item_count += 1
    roll._dispSum += r.dispersion_index
  }

  const byCategory = [...byCat.values()].map((roll) => ({
    category_id: roll.category_id,
    category_name: roll.category_name,
    addressable_savings: roll.addressable_savings,
    item_count: roll.item_count,
    avg_dispersion_index: roll.item_count > 0 ? roll._dispSum / roll.item_count : 0,
  }))
  byCategory.sort((a, z) => z.addressable_savings - a.addressable_savings)

  return c.json({ total, byCategory })
})

export default router
