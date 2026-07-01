import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  transactions,
  contracts,
  maverick_findings,
  suppliers,
  categories,
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
// GET / — maverick findings  ?workspace_id=&status=
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const status = c.req.query('status')

  const conditions = [eq(maverick_findings.workspace_id, workspaceId)]
  if (status) conditions.push(eq(maverick_findings.status, status))

  const rows = await db
    .select()
    .from(maverick_findings)
    .where(and(...conditions))
    .orderBy(desc(maverick_findings.leakage_amount))

  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspaceId))
  const supplierNameById = new Map(supplierRows.map((s) => [s.id, s.name]))

  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.workspace_id, workspaceId))
  const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]))

  const out = rows.map((r) => ({
    ...r,
    supplier_name: r.supplier_id ? supplierNameById.get(r.supplier_id) ?? null : null,
    category_name: r.category_id ? categoryNameById.get(r.category_id) ?? null : null,
  }))
  return c.json(out)
})

// ---------------------------------------------------------------------------
// POST /detect — match txns to contracts, compute leakage (writes findings)
// ---------------------------------------------------------------------------
const detectSchema = z.object({
  workspace_id: z.string().min(1),
})

router.post('/detect', authMiddleware, zValidator('json', detectSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await assertMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Fresh recompute: clear prior findings.
  await db.delete(maverick_findings).where(eq(maverick_findings.workspace_id, workspace_id))

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspace_id))

  const contractRows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.workspace_id, workspace_id))

  // Index active contracts by supplier+category for off-contract matching.
  const contractsBySupplierCategory = new Map<string, typeof contractRows>()
  for (const ct of contractRows) {
    if (ct.status !== 'active') continue
    const key = `${ct.supplier_id}::${ct.category_id ?? ''}`
    const arr = contractsBySupplierCategory.get(key) ?? []
    arr.push(ct)
    contractsBySupplierCategory.set(key, arr)
  }
  // Also index by supplier alone (any category) for a looser coverage check.
  const contractsBySupplier = new Map<string, typeof contractRows>()
  for (const ct of contractRows) {
    if (ct.status !== 'active') continue
    const arr = contractsBySupplier.get(ct.supplier_id) ?? []
    arr.push(ct)
    contractsBySupplier.set(ct.supplier_id, arr)
  }

  const findings: Array<typeof maverick_findings.$inferInsert> = []

  for (const t of txns) {
    let matchedContract: typeof contractRows[number] | undefined
    if (t.category_id) {
      matchedContract = contractsBySupplierCategory.get(`${t.supplier_id}::${t.category_id}`)?.[0]
    }
    if (!matchedContract) matchedContract = contractsBySupplier.get(t.supplier_id)?.[0]

    if (!matchedContract) {
      // No covering contract for this supplier/category — full amount is off-contract leakage.
      if (!t.is_on_contract) {
        findings.push({
          workspace_id,
          transaction_id: t.id,
          supplier_id: t.supplier_id,
          category_id: t.category_id ?? null,
          contract_id: null,
          expected_price: null,
          paid_price: t.unit_price ?? null,
          leakage_amount: t.amount ?? 0,
          reason: 'off_contract',
          status: 'open',
        })
      }
      continue
    }

    // Contract exists. Check price compliance when both prices are known.
    const expected = matchedContract.contracted_unit_price
    const paid = t.unit_price
    if (expected != null && paid != null && paid > expected) {
      const qty = t.quantity ?? 1
      const leakage = (paid - expected) * qty
      if (leakage > 0) {
        findings.push({
          workspace_id,
          transaction_id: t.id,
          supplier_id: t.supplier_id,
          category_id: t.category_id ?? null,
          contract_id: matchedContract.id,
          expected_price: expected,
          paid_price: paid,
          leakage_amount: leakage,
          reason: 'price_above_contract',
          status: 'open',
        })
      }
    } else if (!t.is_on_contract) {
      // A covering contract exists but the transaction was not booked against it.
      findings.push({
        workspace_id,
        transaction_id: t.id,
        supplier_id: t.supplier_id,
        category_id: t.category_id ?? null,
        contract_id: matchedContract.id,
        expected_price: expected,
        paid_price: paid ?? null,
        leakage_amount: t.amount ?? 0,
        reason: 'not_booked_to_contract',
        status: 'open',
      })
    }
  }

  const inserted = findings.length > 0 ? await db.insert(maverick_findings).values(findings).returning() : []
  return c.json({ findings: inserted }, 201)
})

// ---------------------------------------------------------------------------
// GET /rate — maverick rate by category/cost_center  ?workspace_id=&by=
// ---------------------------------------------------------------------------
router.get('/rate', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const by = c.req.query('by') === 'cost_center' ? 'cost_center' : 'category'

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  const findingRows = await db
    .select()
    .from(maverick_findings)
    .where(eq(maverick_findings.workspace_id, workspaceId))

  // Map transaction_id -> leakage so a finding's dimension is taken from its txn.
  const leakageByTxn = new Map<string, number>()
  for (const f of findingRows) {
    if (f.transaction_id) leakageByTxn.set(f.transaction_id, (leakageByTxn.get(f.transaction_id) ?? 0) + (f.leakage_amount ?? 0))
  }

  // Aggregate total spend and off-contract/leaked spend per dimension key.
  const agg = new Map<string, { total_spend: number; maverick_spend: number; leakage: number; txn_count: number; maverick_txn_count: number }>()
  for (const t of txns) {
    const key = by === 'cost_center' ? (t.cost_center ?? 'unassigned') : (t.category_id ?? 'uncategorized')
    let a = agg.get(key)
    if (!a) {
      a = { total_spend: 0, maverick_spend: 0, leakage: 0, txn_count: 0, maverick_txn_count: 0 }
      agg.set(key, a)
    }
    a.total_spend += t.amount ?? 0
    a.txn_count += 1
    const leak = leakageByTxn.get(t.id)
    if (leak !== undefined) {
      a.leakage += leak
      a.maverick_spend += t.amount ?? 0
      a.maverick_txn_count += 1
    }
  }

  let categoryNameById = new Map<string, string>()
  if (by === 'category') {
    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.workspace_id, workspaceId))
    categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]))
  }

  const rows = [...agg.entries()]
    .map(([key, a]) => ({
      key,
      label:
        by === 'category'
          ? (key === 'uncategorized' ? 'Uncategorized' : categoryNameById.get(key) ?? key)
          : key,
      dimension: by,
      total_spend: a.total_spend,
      maverick_spend: a.maverick_spend,
      leakage: a.leakage,
      txn_count: a.txn_count,
      maverick_txn_count: a.maverick_txn_count,
      maverick_rate: a.total_spend > 0 ? a.maverick_spend / a.total_spend : 0,
    }))
    .sort((x, y) => y.leakage - x.leakage)

  return c.json({ rows })
})

// ---------------------------------------------------------------------------
// PUT /:id — update finding status
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  status: z.enum(['open', 'reviewing', 'remediated', 'accepted', 'dismissed']),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { status } = c.req.valid('json')

  const [finding] = await db.select().from(maverick_findings).where(eq(maverick_findings.id, id))
  if (!finding) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(finding.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(maverick_findings)
    .set({ status })
    .where(eq(maverick_findings.id, id))
    .returning()
  return c.json(updated)
})

export default router
