import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  categories,
  suppliers,
  supplier_aliases,
  contracts,
  transactions,
  purchase_orders,
  invoices,
  tail_segments,
  duplicate_groups,
  duplicate_candidates,
  maverick_findings,
  price_dispersion,
  transaction_cost_models,
  transaction_cost_ledger,
  consolidation_scenarios,
  recommendations,
  initiatives,
  initiative_milestones,
  savings_ledger,
  reports,
  comments,
  data_imports,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  if (member) return true
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|gmbh|sa|plc|group|holdings)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Deterministic-ish pseudo random so repeated seeds look plausible but vary.
function rand(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100
}
function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// The full demo blueprint. Suppliers include intentional near-duplicates so
// the duplicate-detection feature has something to find.
const CATEGORY_BLUEPRINT: Array<{ code: string; name: string }> = [
  { code: 'IT-SW', name: 'IT Software & SaaS' },
  { code: 'IT-HW', name: 'IT Hardware' },
  { code: 'MRO', name: 'Maintenance, Repair & Operations' },
  { code: 'PROF', name: 'Professional Services' },
  { code: 'MKTG', name: 'Marketing & Advertising' },
  { code: 'FAC', name: 'Facilities & Office' },
  { code: 'TRAVEL', name: 'Travel & Expense' },
  { code: 'LOG', name: 'Logistics & Freight' },
]

// supplier display names grouped so some collapse to the same normalized name.
const SUPPLIER_BLUEPRINT: Array<{ names: string[]; categoryCode: string; itemKeys: string[]; tier: 'head' | 'tail' }> = [
  { names: ['Acme Corp', 'Acme Corporation', 'ACME Corp.'], categoryCode: 'MRO', itemKeys: ['bolt-m6', 'bolt-m8', 'washer-std'], tier: 'tail' },
  { names: ['Globex LLC', 'Globex'], categoryCode: 'IT-SW', itemKeys: ['saas-seat', 'api-call-pack'], tier: 'head' },
  { names: ['Initech Inc', 'Initech Incorporated'], categoryCode: 'PROF', itemKeys: ['consult-hr', 'audit-day'], tier: 'tail' },
  { names: ['Umbrella Co', 'Umbrella Company'], categoryCode: 'FAC', itemKeys: ['cleaning-mo', 'coffee-kg'], tier: 'tail' },
  { names: ['Stark Industries'], categoryCode: 'IT-HW', itemKeys: ['laptop-14', 'monitor-27'], tier: 'head' },
  { names: ['Wayne Enterprises'], categoryCode: 'MKTG', itemKeys: ['ad-impression', 'creative-hr'], tier: 'head' },
  { names: ['Wonka Logistics', 'Wonka Freight'], categoryCode: 'LOG', itemKeys: ['pallet-ship', 'parcel-ship'], tier: 'tail' },
  { names: ['Cyberdyne Systems', 'Cyberdyne Sys'], categoryCode: 'IT-SW', itemKeys: ['saas-seat', 'support-tier'], tier: 'tail' },
  { names: ['Soylent Foods'], categoryCode: 'FAC', itemKeys: ['snacks-box', 'coffee-kg'], tier: 'tail' },
  { names: ['Hooli Travel', 'Hooli Travel Group'], categoryCode: 'TRAVEL', itemKeys: ['flight-dom', 'hotel-night'], tier: 'tail' },
  { names: ['Pied Piper Consulting'], categoryCode: 'PROF', itemKeys: ['consult-hr', 'dev-day'], tier: 'tail' },
  { names: ['Vehement Capital'], categoryCode: 'PROF', itemKeys: ['advisory-day'], tier: 'tail' },
  { names: ['Massive Dynamic'], categoryCode: 'IT-HW', itemKeys: ['server-1u', 'switch-48p'], tier: 'tail' },
  { names: ['Nakatomi Trading'], categoryCode: 'LOG', itemKeys: ['parcel-ship', 'customs-fee'], tier: 'tail' },
  { names: ['Tyrell Office', 'Tyrell Office Supplies'], categoryCode: 'FAC', itemKeys: ['paper-ream', 'toner-cart'], tier: 'tail' },
]

interface SeedCounts {
  categories: number
  suppliers: number
  aliases: number
  contracts: number
  transactions: number
  purchase_orders: number
  invoices: number
}

// Generate the full demo dataset inside a single workspace.
async function generateSampleData(workspaceId: string, userId: string): Promise<SeedCounts> {
  const counts: SeedCounts = {
    categories: 0,
    suppliers: 0,
    aliases: 0,
    contracts: 0,
    transactions: 0,
    purchase_orders: 0,
    invoices: 0,
  }

  // 1) Categories.
  const categoryIdByCode = new Map<string, string>()
  for (const cat of CATEGORY_BLUEPRINT) {
    const [row] = await db
      .insert(categories)
      .values({ workspace_id: workspaceId, code: cat.code, name: cat.name, level: 0 })
      .returning()
    categoryIdByCode.set(cat.code, row.id)
    counts.categories++
  }

  // 2) Suppliers (+ aliases for the extra spelling variants).
  interface SeededSupplier {
    id: string
    name: string
    categoryId: string
    itemKeys: string[]
    tier: 'head' | 'tail'
  }
  const seeded: SeededSupplier[] = []
  const countries = ['US', 'US', 'US', 'GB', 'DE', 'FR', 'CA']

  for (const blueprint of SUPPLIER_BLUEPRINT) {
    const categoryId = categoryIdByCode.get(blueprint.categoryCode)!
    const canonicalName = blueprint.names[0]
    const [supplier] = await db
      .insert(suppliers)
      .values({
        workspace_id: workspaceId,
        name: canonicalName,
        normalized_name: normalizeName(canonicalName),
        category_id: categoryId,
        status: 'active',
        country: pick(countries),
        domain: normalizeName(canonicalName).replace(/\s+/g, '') + '.com',
      })
      .returning()
    counts.suppliers++
    seeded.push({ id: supplier.id, name: canonicalName, categoryId, itemKeys: blueprint.itemKeys, tier: blueprint.tier })

    // Extra spelling variants become aliases on the canonical supplier.
    for (const alias of blueprint.names.slice(1)) {
      await db.insert(supplier_aliases).values({
        workspace_id: workspaceId,
        supplier_id: supplier.id,
        raw_name: alias,
        source: 'sample-data',
      })
      counts.aliases++
    }
  }

  // 3) Contracts — give roughly half the suppliers an active contract so
  //    maverick/coverage analysis has both on- and off-contract spend.
  const contractBySupplier = new Map<string, { id: string; unitPrice: number; itemKey: string }>()
  const now = Date.now()
  for (const sup of seeded) {
    if (Math.random() < 0.55) {
      const itemKey = pick(sup.itemKeys)
      const unitPrice = rand(20, 400)
      const [contract] = await db
        .insert(contracts)
        .values({
          workspace_id: workspaceId,
          supplier_id: sup.id,
          category_id: sup.categoryId,
          name: `${sup.name} Master Agreement`,
          contracted_unit_price: unitPrice,
          committed_volume: rand(100, 5000),
          currency: 'USD',
          start_date: new Date(now - randInt(60, 400) * 86_400_000),
          end_date: new Date(now + randInt(20, 365) * 86_400_000),
          status: 'active',
        })
        .returning()
      contractBySupplier.set(sup.id, { id: contract.id, unitPrice, itemKey })
      counts.contracts++
    }
  }

  // 4) Transactions, POs, and invoices.
  const costCenters = ['CC-100', 'CC-200', 'CC-300', 'CC-400']
  for (const sup of seeded) {
    // Head suppliers get many transactions; tail suppliers get few.
    const txnCount = sup.tier === 'head' ? randInt(40, 90) : randInt(2, 12)
    const contract = contractBySupplier.get(sup.id)

    // Group transactions under a handful of POs/invoices per supplier.
    const poCount = Math.max(1, Math.round(txnCount / randInt(3, 6)))
    const poRecords: Array<{ poNumber: string; total: number; lines: number }> = []
    for (let p = 0; p < poCount; p++) {
      poRecords.push({ poNumber: `PO-${sup.id.slice(0, 6)}-${p + 1}`, total: 0, lines: 0 })
    }

    for (let t = 0; t < txnCount; t++) {
      const itemKey = pick(sup.itemKeys)
      const quantity = randInt(1, 50)

      // Off-contract transactions are priced above the contracted rate to
      // create maverick leakage and price dispersion.
      let unitPrice: number
      let onContract = false
      let contractId: string | null = null
      if (contract && Math.random() < 0.6 && itemKey === contract.itemKey) {
        unitPrice = contract.unitPrice * rand(0.98, 1.02)
        onContract = true
        contractId = contract.id
      } else if (contract) {
        unitPrice = contract.unitPrice * rand(1.1, 1.8)
      } else {
        unitPrice = rand(15, 500)
      }

      const amount = Math.round(unitPrice * quantity * 100) / 100
      const po = pick(poRecords)
      po.total += amount
      po.lines += 1
      const invoiceNumber = `INV-${sup.id.slice(0, 6)}-${t + 1}`
      const txnDate = new Date(now - randInt(0, 365) * 86_400_000)

      await db.insert(transactions).values({
        workspace_id: workspaceId,
        supplier_id: sup.id,
        category_id: sup.categoryId,
        contract_id: contractId,
        amount,
        currency: 'USD',
        txn_date: txnDate,
        po_number: po.poNumber,
        invoice_number: invoiceNumber,
        cost_center: pick(costCenters),
        item_key: itemKey,
        uom: 'each',
        quantity,
        unit_price: Math.round(unitPrice * 100) / 100,
        is_on_contract: onContract,
      })
      counts.transactions++

      await db.insert(invoices).values({
        workspace_id: workspaceId,
        supplier_id: sup.id,
        invoice_number: invoiceNumber,
        po_number: po.poNumber,
        amount,
        status: pick(['paid', 'paid', 'open', 'approved']),
        invoice_date: txnDate,
      })
      counts.invoices++
    }

    for (const po of poRecords) {
      await db.insert(purchase_orders).values({
        workspace_id: workspaceId,
        supplier_id: sup.id,
        po_number: po.poNumber,
        total_amount: Math.round(po.total * 100) / 100,
        line_count: po.lines,
        status: pick(['open', 'closed', 'received']),
        issued_date: new Date(now - randInt(0, 365) * 86_400_000),
      })
      counts.purchase_orders++
    }
  }

  return counts
}

// Delete every workspace-scoped analytical + transactional row, in FK-safe order.
// Categories, suppliers, contracts and transactions are wiped too so a fresh
// demo dataset can be regenerated cleanly. (Workspace + membership rows stay.)
async function wipeWorkspace(workspaceId: string): Promise<void> {
  // Children / analysis outputs first.
  await db.delete(transaction_cost_ledger).where(eq(transaction_cost_ledger.workspace_id, workspaceId))
  await db.delete(transaction_cost_models).where(eq(transaction_cost_models.workspace_id, workspaceId))
  await db.delete(duplicate_candidates).where(eq(duplicate_candidates.workspace_id, workspaceId))
  await db.delete(duplicate_groups).where(eq(duplicate_groups.workspace_id, workspaceId))
  await db.delete(maverick_findings).where(eq(maverick_findings.workspace_id, workspaceId))
  await db.delete(price_dispersion).where(eq(price_dispersion.workspace_id, workspaceId))
  await db.delete(tail_segments).where(eq(tail_segments.workspace_id, workspaceId))
  await db.delete(savings_ledger).where(eq(savings_ledger.workspace_id, workspaceId))
  await db.delete(initiative_milestones).where(eq(initiative_milestones.workspace_id, workspaceId))
  await db.delete(initiatives).where(eq(initiatives.workspace_id, workspaceId))
  await db.delete(recommendations).where(eq(recommendations.workspace_id, workspaceId))
  await db.delete(consolidation_scenarios).where(eq(consolidation_scenarios.workspace_id, workspaceId))
  await db.delete(reports).where(eq(reports.workspace_id, workspaceId))
  await db.delete(comments).where(eq(comments.workspace_id, workspaceId))
  // Transactional facts (transactions reference contracts/suppliers/categories).
  await db.delete(transactions).where(eq(transactions.workspace_id, workspaceId))
  await db.delete(invoices).where(eq(invoices.workspace_id, workspaceId))
  await db.delete(purchase_orders).where(eq(purchase_orders.workspace_id, workspaceId))
  await db.delete(contracts).where(eq(contracts.workspace_id, workspaceId))
  await db.delete(supplier_aliases).where(eq(supplier_aliases.workspace_id, workspaceId))
  await db.delete(suppliers).where(eq(suppliers.workspace_id, workspaceId))
  await db.delete(categories).where(eq(categories.workspace_id, workspaceId))
  await db.delete(data_imports).where(eq(data_imports.workspace_id, workspaceId))
}

// Count current rows for a workspace (used by /status and after reset).
async function countWorkspace(workspaceId: string): Promise<SeedCounts> {
  const [cats, sups, als, cons, txns, pos, invs] = await Promise.all([
    db.select().from(categories).where(eq(categories.workspace_id, workspaceId)),
    db.select().from(suppliers).where(eq(suppliers.workspace_id, workspaceId)),
    db.select().from(supplier_aliases).where(eq(supplier_aliases.workspace_id, workspaceId)),
    db.select().from(contracts).where(eq(contracts.workspace_id, workspaceId)),
    db.select().from(transactions).where(eq(transactions.workspace_id, workspaceId)),
    db.select().from(purchase_orders).where(eq(purchase_orders.workspace_id, workspaceId)),
    db.select().from(invoices).where(eq(invoices.workspace_id, workspaceId)),
  ])
  return {
    categories: cats.length,
    suppliers: sups.length,
    aliases: als.length,
    contracts: cons.length,
    transactions: txns.length,
    purchase_orders: pos.length,
    invoices: invs.length,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const seedSchema = z.object({
  workspace_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
})

// POST /seed — generate a full demo workspace. If no workspace_id is given,
// a brand-new "Demo Procurement" workspace is created and owned by the caller.
router.post('/seed', authMiddleware, zValidator('json', seedSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let workspaceId = body.workspace_id

  if (workspaceId) {
    const isMember = await assertMember(workspaceId, userId)
    if (!isMember) return c.json({ error: 'Forbidden' }, 403)
  } else {
    const [ws] = await db
      .insert(workspaces)
      .values({
        name: body.name ?? 'Demo Procurement',
        base_currency: 'USD',
        owner_id: userId,
        settings: { demo: true },
      })
      .returning()
    workspaceId = ws.id
    await db
      .insert(workspace_members)
      .values({ workspace_id: workspaceId, user_id: userId, role: 'owner' })
      .onConflictDoNothing()
  }

  const counts = await generateSampleData(workspaceId, userId)
  return c.json({ workspace_id: workspaceId, counts }, 201)
})

const resetSchema = z.object({
  workspace_id: z.string().min(1),
})

// POST /reset — wipe and regenerate sample data for an existing workspace.
router.post('/reset', authMiddleware, zValidator('json', resetSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')

  const isMember = await assertMember(workspace_id, userId)
  if (!isMember) return c.json({ error: 'Forbidden' }, 403)

  await wipeWorkspace(workspace_id)
  const counts = await generateSampleData(workspace_id, userId)
  return c.json({ counts })
})

// GET /status — whether a workspace already holds sample data (public read).
// ?workspace_id=
router.get('/status', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const counts = await countWorkspace(workspaceId)
  const seeded = counts.suppliers > 0 && counts.transactions > 0
  return c.json({ seeded, counts })
})

export default router
