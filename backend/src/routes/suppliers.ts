import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  suppliers,
  supplier_aliases,
  workspace_members,
  transactions,
  purchase_orders,
  invoices,
  contracts,
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

async function getSupplier(id: string) {
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  return s ?? null
}

/**
 * Normalize a supplier name for matching: lowercase, strip common corporate
 * suffixes and punctuation, collapse whitespace. Deterministic + pure.
 */
function normalizeName(name: string): string {
  let n = name.toLowerCase().trim()
  // Strip punctuation to spaces.
  n = n.replace(/[.,/#!$%^&*;:{}=\-_`~()'"]/g, ' ')
  // Remove common legal/corporate suffix tokens.
  const suffixes = new Set([
    'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
    'co', 'company', 'gmbh', 'sa', 'sas', 'plc', 'lp', 'llp', 'pvt', 'pte',
    'ag', 'bv', 'nv', 'srl', 'spa', 'oy', 'ab', 'as',
  ])
  const tokens = n.split(/\s+/).filter((t) => t.length > 0 && !suffixes.has(t))
  return tokens.join(' ').trim()
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().min(1).nullable().optional(),
  parent_supplier_id: z.string().min(1).nullable().optional(),
  status: z.string().min(1).optional(),
  country: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category_id: z.string().min(1).nullable().optional(),
  parent_supplier_id: z.string().min(1).nullable().optional(),
  status: z.string().min(1).optional(),
  country: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
})

const mergeSchema = z.object({
  source_supplier_ids: z.array(z.string().min(1)).min(1),
})

// ---------------------------------------------------------------------------
// Top suppliers — declared BEFORE '/:id' so '/top' is not captured as an id.
// ---------------------------------------------------------------------------

router.get('/top', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const by = c.req.query('by') === 'txn-count' || c.req.query('by') === 'txn_count' ? 'txn_count' : 'spend'
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20))

  const sups = await db.select().from(suppliers).where(eq(suppliers.workspace_id, workspaceId))
  const txns = await db.select().from(transactions).where(eq(transactions.workspace_id, workspaceId))

  const spendBy = new Map<string, number>()
  const countBy = new Map<string, number>()
  for (const t of txns) {
    if (!t.supplier_id) continue
    spendBy.set(t.supplier_id, (spendBy.get(t.supplier_id) ?? 0) + (t.amount ?? 0))
    countBy.set(t.supplier_id, (countBy.get(t.supplier_id) ?? 0) + 1)
  }

  const enriched = sups.map((s) => ({
    ...s,
    spend: spendBy.get(s.id) ?? 0,
    txn_count: countBy.get(s.id) ?? 0,
  }))
  enriched.sort((a, b) => (by === 'txn_count' ? b.txn_count - a.txn_count : b.spend - a.spend))
  return c.json(enriched.slice(0, limit))
})

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

// Public: list suppliers with optional filters
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const categoryId = c.req.query('category_id')
  const q = c.req.query('q')

  let rows = await db.select().from(suppliers).where(eq(suppliers.workspace_id, workspaceId))
  if (categoryId) rows = rows.filter((s) => s.category_id === categoryId)
  if (q) {
    const needle = normalizeName(q)
    rows = rows.filter(
      (s) => s.normalized_name.includes(needle) || s.name.toLowerCase().includes(q.toLowerCase()),
    )
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return c.json(rows)
})

// Public: supplier profile with stats
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const s = await getSupplier(id)
  if (!s) return c.json({ error: 'Not found' }, 404)

  const txns = await db.select().from(transactions).where(eq(transactions.supplier_id, id))
  const pos = await db.select().from(purchase_orders).where(eq(purchase_orders.supplier_id, id))
  const invs = await db.select().from(invoices).where(eq(invoices.supplier_id, id))
  const cons = await db.select().from(contracts).where(eq(contracts.supplier_id, id))
  const aliases = await db.select().from(supplier_aliases).where(eq(supplier_aliases.supplier_id, id))

  const spend = txns.reduce((acc, t) => acc + (t.amount ?? 0), 0)
  const onContractSpend = txns
    .filter((t) => t.is_on_contract)
    .reduce((acc, t) => acc + (t.amount ?? 0), 0)
  const contractCoverage = spend > 0 ? onContractSpend / spend : 0

  // Categories this supplier transacts across.
  const categorySpend = new Map<string, number>()
  for (const t of txns) {
    if (!t.category_id) continue
    categorySpend.set(t.category_id, (categorySpend.get(t.category_id) ?? 0) + (t.amount ?? 0))
  }
  const categories = [...categorySpend.entries()]
    .map(([category_id, amt]) => ({ category_id, spend: amt }))
    .sort((a, b) => b.spend - a.spend)

  return c.json({
    supplier: s,
    stats: {
      spend,
      txn_count: txns.length,
      po_count: pos.length,
      invoice_count: invs.length,
      contract_count: cons.length,
      active_contract_count: cons.filter((k) => k.status === 'active').length,
      alias_count: aliases.length,
      on_contract_spend: onContractSpend,
      off_contract_spend: spend - onContractSpend,
      contract_coverage: contractCoverage,
      categories,
      category_count: categories.length,
    },
  })
})

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [s] = await db
    .insert(suppliers)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      normalized_name: normalizeName(body.name),
      category_id: body.category_id ?? null,
      parent_supplier_id: body.parent_supplier_id ?? null,
      status: body.status ?? 'active',
      country: body.country ?? null,
      tax_id: body.tax_id ?? null,
      domain: body.domain ?? null,
    })
    .returning()
  return c.json(s, 201)
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const s = await getSupplier(id)
  if (!s) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(s.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  if (body.parent_supplier_id === id) {
    return c.json({ error: 'Supplier cannot be its own parent' }, 400)
  }
  const patch: Record<string, unknown> = { ...body }
  if (body.name !== undefined) patch.normalized_name = normalizeName(body.name)
  const [updated] = await db.update(suppliers).set(patch).where(eq(suppliers.id, id)).returning()
  return c.json(updated)
})

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const s = await getSupplier(id)
  if (!s) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(s.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(suppliers).where(eq(suppliers.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Merge: fold source suppliers into this canonical supplier.
//   - records each source name (and its existing aliases) as aliases of canonical
//   - repoints transactions, POs, invoices, contracts to canonical
//   - deletes the source supplier rows
// ---------------------------------------------------------------------------

router.post('/:id/merge', authMiddleware, zValidator('json', mergeSchema), async (c) => {
  const userId = getUserId(c)
  const canonicalId = c.req.param('id')
  const canonical = await getSupplier(canonicalId)
  if (!canonical) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(canonical.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const { source_supplier_ids } = c.req.valid('json')
  const mergedIds: string[] = []
  let repointedTxns = 0
  let repointedPos = 0
  let repointedInvoices = 0
  let repointedContracts = 0
  let recordedAliases = 0

  for (const srcId of source_supplier_ids) {
    if (srcId === canonicalId) continue
    const src = await getSupplier(srcId)
    if (!src) continue
    if (src.workspace_id !== canonical.workspace_id) continue

    // Record the source's display name as an alias of the canonical supplier.
    await db.insert(supplier_aliases).values({
      workspace_id: canonical.workspace_id,
      supplier_id: canonicalId,
      raw_name: src.name,
      source: 'merge',
    })
    recordedAliases++

    // Carry over the source's existing aliases.
    const srcAliases = await db
      .select()
      .from(supplier_aliases)
      .where(eq(supplier_aliases.supplier_id, srcId))
    for (const a of srcAliases) {
      await db
        .update(supplier_aliases)
        .set({ supplier_id: canonicalId })
        .where(eq(supplier_aliases.id, a.id))
      recordedAliases++
    }

    // Repoint spend facts and documents.
    const txnRes = await db
      .update(transactions)
      .set({ supplier_id: canonicalId })
      .where(eq(transactions.supplier_id, srcId))
      .returning({ id: transactions.id })
    repointedTxns += txnRes.length

    const poRes = await db
      .update(purchase_orders)
      .set({ supplier_id: canonicalId })
      .where(eq(purchase_orders.supplier_id, srcId))
      .returning({ id: purchase_orders.id })
    repointedPos += poRes.length

    const invRes = await db
      .update(invoices)
      .set({ supplier_id: canonicalId })
      .where(eq(invoices.supplier_id, srcId))
      .returning({ id: invoices.id })
    repointedInvoices += invRes.length

    const conRes = await db
      .update(contracts)
      .set({ supplier_id: canonicalId })
      .where(eq(contracts.supplier_id, srcId))
      .returning({ id: contracts.id })
    repointedContracts += conRes.length

    // Remove the now-empty source supplier.
    await db.delete(suppliers).where(eq(suppliers.id, srcId))
    mergedIds.push(srcId)
  }

  return c.json({
    merged: {
      canonical_id: canonicalId,
      merged_supplier_ids: mergedIds,
      recorded_aliases: recordedAliases,
      repointed: {
        transactions: repointedTxns,
        purchase_orders: repointedPos,
        invoices: repointedInvoices,
        contracts: repointedContracts,
      },
    },
  })
})

export default router
