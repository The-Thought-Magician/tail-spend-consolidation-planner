import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  transactions,
  suppliers,
  tail_segments,
  duplicate_groups,
  maverick_findings,
  price_dispersion,
  recommendations,
  savings_ledger,
  consolidation_scenarios,
} from '../db/schema.js'
import { eq, and, desc, sql } from 'drizzle-orm'

const router = new Hono()

// GET /kpis — headline KPIs for a workspace.
router.get('/kpis', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

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

  // Latest computed tail segment for the 'tail' bucket on the supplier dimension.
  const [tailRow] = await db
    .select()
    .from(tail_segments)
    .where(and(eq(tail_segments.workspace_id, workspaceId), eq(tail_segments.segment, 'tail')))
    .orderBy(desc(tail_segments.computed_at))
    .limit(1)

  const [{ dupGroups }] = await db
    .select({ dupGroups: sql<number>`count(*)::int` })
    .from(duplicate_groups)
    .where(and(eq(duplicate_groups.workspace_id, workspaceId), eq(duplicate_groups.status, 'open')))

  const [{ maverickLeakage, maverickCount }] = await db
    .select({
      maverickLeakage: sql<number>`coalesce(sum(${maverick_findings.leakage_amount}), 0)`,
      maverickCount: sql<number>`count(*)::int`,
    })
    .from(maverick_findings)
    .where(and(eq(maverick_findings.workspace_id, workspaceId), eq(maverick_findings.status, 'open')))

  const [{ dispersionSavings }] = await db
    .select({ dispersionSavings: sql<number>`coalesce(sum(${price_dispersion.addressable_savings}), 0)` })
    .from(price_dispersion)
    .where(eq(price_dispersion.workspace_id, workspaceId))

  const [{ identifiedSavings }] = await db
    .select({ identifiedSavings: sql<number>`coalesce(sum(${recommendations.impact}), 0)` })
    .from(recommendations)
    .where(and(eq(recommendations.workspace_id, workspaceId), eq(recommendations.status, 'open')))

  const [savingsAgg] = await db
    .select({
      realizedSavings: sql<number>`coalesce(sum(${savings_ledger.realized_amount}), 0)`,
      targetSavings: sql<number>`coalesce(sum(${savings_ledger.target_amount}), 0)`,
    })
    .from(savings_ledger)
    .where(eq(savings_ledger.workspace_id, workspaceId))

  const totalSpend = Number(txnAgg?.totalSpend ?? 0)
  const tailSpend = Number(tailRow?.spend ?? 0)
  const tailSpendShare = Number(tailRow?.spend_share ?? (totalSpend > 0 ? 0 : 0))
  const onContractSpend = Number(txnAgg?.onContractSpend ?? 0)

  return c.json({
    total_spend: totalSpend,
    transaction_count: Number(txnAgg?.txnCount ?? 0),
    supplier_count: Number(supplierMaster ?? 0),
    transacting_supplier_count: Number(txnAgg?.supplierCount ?? 0),
    tail_spend: tailSpend,
    tail_supplier_count: Number(tailRow?.supplier_count ?? 0),
    tail_spend_pct: tailSpendShare,
    duplicate_groups: Number(dupGroups ?? 0),
    maverick_leakage: Number(maverickLeakage ?? 0),
    maverick_finding_count: Number(maverickCount ?? 0),
    dispersion_addressable_savings: Number(dispersionSavings ?? 0),
    on_contract_spend: onContractSpend,
    on_contract_pct: totalSpend > 0 ? onContractSpend / totalSpend : 0,
    identified_savings: Number(identifiedSavings ?? 0),
    target_savings: Number(savingsAgg?.targetSavings ?? 0),
    realized_savings: Number(savingsAgg?.realizedSavings ?? 0),
  })
})

// GET /funnel — savings opportunity funnel (identified → modeled → committed → realized).
router.get('/funnel', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  // Identified: open recommendation impact + addressable dispersion savings + open maverick leakage.
  const [{ recImpact }] = await db
    .select({ recImpact: sql<number>`coalesce(sum(${recommendations.impact}), 0)` })
    .from(recommendations)
    .where(and(eq(recommendations.workspace_id, workspaceId), eq(recommendations.status, 'open')))

  const [{ dispSavings }] = await db
    .select({ dispSavings: sql<number>`coalesce(sum(${price_dispersion.addressable_savings}), 0)` })
    .from(price_dispersion)
    .where(eq(price_dispersion.workspace_id, workspaceId))

  const [{ mavLeakage }] = await db
    .select({ mavLeakage: sql<number>`coalesce(sum(${maverick_findings.leakage_amount}), 0)` })
    .from(maverick_findings)
    .where(and(eq(maverick_findings.workspace_id, workspaceId), eq(maverick_findings.status, 'open')))

  // Modeled: sum of scenario modeled_savings.
  const [{ modeled }] = await db
    .select({ modeled: sql<number>`coalesce(sum(${consolidation_scenarios.modeled_savings}), 0)` })
    .from(consolidation_scenarios)
    .where(eq(consolidation_scenarios.workspace_id, workspaceId))

  // Committed: savings_ledger target amounts. Realized: realized amounts.
  const [savingsAgg] = await db
    .select({
      committed: sql<number>`coalesce(sum(${savings_ledger.target_amount}), 0)`,
      realized: sql<number>`coalesce(sum(${savings_ledger.realized_amount}), 0)`,
    })
    .from(savings_ledger)
    .where(eq(savings_ledger.workspace_id, workspaceId))

  const identified = Number(recImpact ?? 0) + Number(dispSavings ?? 0) + Number(mavLeakage ?? 0)
  const modeledV = Number(modeled ?? 0)
  const committed = Number(savingsAgg?.committed ?? 0)
  const realized = Number(savingsAgg?.realized ?? 0)

  return c.json({
    stages: [
      { stage: 'identified', label: 'Identified', amount: identified },
      { stage: 'modeled', label: 'Modeled', amount: modeledV },
      { stage: 'committed', label: 'Committed', amount: committed },
      { stage: 'realized', label: 'Realized', amount: realized },
    ],
  })
})

// GET /top-opportunities — top open recommendations by impact.
router.get('/top-opportunities', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '5', 10) || 5))

  const rows = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.workspace_id, workspaceId), eq(recommendations.status, 'open')))
    .orderBy(desc(recommendations.impact))
    .limit(limit)

  return c.json(rows)
})

export default router
