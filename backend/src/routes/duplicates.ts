import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  suppliers,
  supplier_aliases,
  transactions,
  duplicate_groups,
  duplicate_candidates,
  recommendations,
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
// Fuzzy string similarity (token-set Jaccard + normalized Levenshtein blend).
// ---------------------------------------------------------------------------
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|ag|plc|group|holdings|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

function tokenJaccard(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter(Boolean))
  const sb = new Set(b.split(' ').filter(Boolean))
  if (sa.size === 0 && sb.size === 0) return 1
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = sa.size + sb.size - inter
  return union > 0 ? inter / union : 0
}

function similarity(aRaw: string, bRaw: string): number {
  const a = normalize(aRaw)
  const b = normalize(bRaw)
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  const lev = maxLen > 0 ? 1 - levenshtein(a, b) / maxLen : 1
  const jac = tokenJaccard(a, b)
  return 0.5 * lev + 0.5 * jac
}

// ---------------------------------------------------------------------------
// GET /groups — duplicate groups  ?workspace_id=
// ---------------------------------------------------------------------------
router.get('/groups', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(duplicate_groups)
    .where(eq(duplicate_groups.workspace_id, workspaceId))
    .orderBy(desc(duplicate_groups.combined_spend))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /groups/:id — group detail + candidates + members
// ---------------------------------------------------------------------------
router.get('/groups/:id', async (c) => {
  const id = c.req.param('id')
  const [group] = await db.select().from(duplicate_groups).where(eq(duplicate_groups.id, id))
  if (!group) return c.json({ error: 'Not found' }, 404)

  const candidates = await db
    .select()
    .from(duplicate_candidates)
    .where(eq(duplicate_candidates.group_id, id))
    .orderBy(desc(duplicate_candidates.similarity))

  const memberIds = (group.member_supplier_ids ?? []) as string[]
  const allSuppliers = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, group.workspace_id))
  const members = allSuppliers.filter((s) => memberIds.includes(s.id))

  return c.json({ group, candidates, members })
})

// ---------------------------------------------------------------------------
// POST /detect — run fuzzy detection (writes groups + candidates)
// ---------------------------------------------------------------------------
const detectSchema = z.object({
  workspace_id: z.string().min(1),
  threshold: z.number().min(0).max(1).optional().default(0.7),
})

router.post('/detect', authMiddleware, zValidator('json', detectSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, threshold } = c.req.valid('json')
  if (!(await assertMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Clear prior open detection output for a clean recompute.
  await db.delete(duplicate_candidates).where(eq(duplicate_candidates.workspace_id, workspace_id))
  await db.delete(duplicate_groups).where(eq(duplicate_groups.workspace_id, workspace_id))

  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspace_id))

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.workspace_id, workspace_id))
  const spendBySupplier = new Map<string, number>()
  for (const t of txns) {
    spendBySupplier.set(t.supplier_id, (spendBySupplier.get(t.supplier_id) ?? 0) + (t.amount ?? 0))
  }

  // Union-find to cluster suppliers whose pairwise similarity clears threshold.
  const parent = new Map<string, string>()
  for (const s of supplierRows) parent.set(s.id, s.id)
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let cur = x
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  interface PairSig {
    a: typeof supplierRows[number]
    b: typeof supplierRows[number]
    sim: number
    signals: Record<string, number>
  }
  const pairs: PairSig[] = []
  for (let i = 0; i < supplierRows.length; i++) {
    for (let j = i + 1; j < supplierRows.length; j++) {
      const a = supplierRows[i]
      const b = supplierRows[j]
      const nameSim = similarity(a.name, b.name)
      const domainMatch = a.domain && b.domain && a.domain.toLowerCase() === b.domain.toLowerCase() ? 1 : 0
      const taxMatch = a.tax_id && b.tax_id && a.tax_id === b.tax_id ? 1 : 0
      const categoryMatch = a.category_id && b.category_id && a.category_id === b.category_id ? 1 : 0
      // Strong identity signals boost the blended score.
      const sim = Math.min(1, nameSim + 0.25 * domainMatch + 0.25 * taxMatch)
      const signals = {
        name_similarity: Number(nameSim.toFixed(4)),
        domain_match: domainMatch,
        tax_id_match: taxMatch,
        category_match: categoryMatch,
      }
      if (sim >= threshold || taxMatch === 1 || domainMatch === 1) {
        pairs.push({ a, b, sim, signals })
        union(a.id, b.id)
      }
    }
  }

  // Build clusters of size >= 2.
  const clusters = new Map<string, string[]>()
  for (const s of supplierRows) {
    const root = find(s.id)
    const arr = clusters.get(root) ?? []
    arr.push(s.id)
    clusters.set(root, arr)
  }

  const createdGroups: typeof duplicate_groups.$inferSelect[] = []
  const createdCandidates: typeof duplicate_candidates.$inferSelect[] = []

  for (const [, memberIds] of clusters) {
    if (memberIds.length < 2) continue
    const members = supplierRows.filter((s) => memberIds.includes(s.id))
    const combinedSpend = memberIds.reduce((sum, id) => sum + (spendBySupplier.get(id) ?? 0), 0)
    // Canonical recommendation: the member with the highest spend.
    const canonical = [...memberIds].sort(
      (x, y) => (spendBySupplier.get(y) ?? 0) - (spendBySupplier.get(x) ?? 0),
    )[0]
    const clusterPairs = pairs.filter((p) => memberIds.includes(p.a.id) && memberIds.includes(p.b.id))
    const avgSim =
      clusterPairs.length > 0 ? clusterPairs.reduce((s, p) => s + p.sim, 0) / clusterPairs.length : 0
    const categoryId = members.find((m) => m.category_id)?.category_id ?? null

    const [group] = await db
      .insert(duplicate_groups)
      .values({
        workspace_id,
        category_id: categoryId,
        member_supplier_ids: memberIds,
        recommended_canonical_id: canonical,
        similarity: Number(avgSim.toFixed(4)),
        combined_spend: combinedSpend,
        status: 'open',
      })
      .returning()
    createdGroups.push(group)

    for (const p of clusterPairs) {
      const [cand] = await db
        .insert(duplicate_candidates)
        .values({
          workspace_id,
          group_id: group.id,
          supplier_a_id: p.a.id,
          supplier_b_id: p.b.id,
          similarity: Number(p.sim.toFixed(4)),
          signals: p.signals,
          decision: 'pending',
        })
        .returning()
      createdCandidates.push(cand)
    }
  }

  return c.json({ groups: createdGroups, candidates: createdCandidates }, 201)
})

// ---------------------------------------------------------------------------
// POST /candidates/:id/decide — accept/reject a pair
// ---------------------------------------------------------------------------
const decideSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
})

router.post('/candidates/:id/decide', authMiddleware, zValidator('json', decideSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { decision } = c.req.valid('json')

  const [cand] = await db.select().from(duplicate_candidates).where(eq(duplicate_candidates.id, id))
  if (!cand) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(cand.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(duplicate_candidates)
    .set({ decision })
    .where(eq(duplicate_candidates.id, id))
    .returning()

  if (decision === 'accepted') {
    // Determine which side is canonical (prefer the group's recommended canonical).
    let canonicalId = cand.supplier_a_id
    let dupId = cand.supplier_b_id
    if (cand.group_id) {
      const [group] = await db.select().from(duplicate_groups).where(eq(duplicate_groups.id, cand.group_id))
      if (group?.recommended_canonical_id === cand.supplier_b_id) {
        canonicalId = cand.supplier_b_id
        dupId = cand.supplier_a_id
      }
    }
    const [dup] = await db.select().from(suppliers).where(eq(suppliers.id, dupId))
    if (dup) {
      // Record the duplicate's name as an alias of the canonical supplier.
      await db.insert(supplier_aliases).values({
        workspace_id: cand.workspace_id,
        supplier_id: canonicalId,
        raw_name: dup.name,
        source: 'duplicate_merge',
      })
      // Spawn a merge recommendation for review.
      await db.insert(recommendations).values({
        workspace_id: cand.workspace_id,
        type: 'merge_supplier',
        category_id: dup.category_id ?? null,
        title: `Merge "${dup.name}" into canonical supplier`,
        rationale: `Accepted duplicate pair (similarity ${cand.similarity.toFixed(2)}). Repoint transactions to the canonical supplier.`,
        impact: 0,
        effort: 1,
        priority: 'medium',
        supplier_ids: [canonicalId, dupId],
        status: 'open',
      })
    }
  }

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// PUT /groups/:id — set group status / recommended_canonical
// ---------------------------------------------------------------------------
const groupUpdateSchema = z
  .object({
    status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
    recommended_canonical_id: z.string().optional(),
  })
  .refine((v) => v.status !== undefined || v.recommended_canonical_id !== undefined, {
    message: 'Provide status or recommended_canonical_id',
  })

router.put('/groups/:id', authMiddleware, zValidator('json', groupUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [group] = await db.select().from(duplicate_groups).where(eq(duplicate_groups.id, id))
  if (!group) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(group.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // A recommended_canonical_id must be a member of the group.
  if (body.recommended_canonical_id) {
    const memberIds = (group.member_supplier_ids ?? []) as string[]
    if (!memberIds.includes(body.recommended_canonical_id)) {
      return c.json({ error: 'recommended_canonical_id must be a group member' }, 400)
    }
  }

  const [updated] = await db
    .update(duplicate_groups)
    .set(body)
    .where(eq(duplicate_groups.id, id))
    .returning()
  return c.json(updated)
})

export default router
