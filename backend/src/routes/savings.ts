import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  savings_ledger,
  initiatives,
} from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
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

// --- schemas -------------------------------------------------------------

const createSchema = z.object({
  workspace_id: z.string().min(1),
  initiative_id: z.string().min(1),
  period: z.string().min(1),
  type: z.enum(['identified', 'approved', 'realized', 'target']).optional(),
  target_amount: z.number().optional().default(0),
  realized_amount: z.number().optional().default(0),
  note: z.string().optional().default(''),
})

const updateSchema = z.object({
  period: z.string().min(1).optional(),
  type: z.enum(['identified', 'approved', 'realized', 'target']).optional(),
  target_amount: z.number().optional(),
  realized_amount: z.number().optional(),
  note: z.string().optional(),
})

// --- GET /waterfall : identified -> approved -> realized -----------------

router.get('/waterfall', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const rows = await db
    .select()
    .from(savings_ledger)
    .where(eq(savings_ledger.workspace_id, workspaceId))

  // Identified/approved targets come from typed target entries; realized from realized_amount.
  let identified = 0
  let approved = 0
  let realized = 0
  for (const r of rows) {
    if (r.type === 'identified') identified += r.target_amount
    else if (r.type === 'approved') approved += r.target_amount
    else if (r.type === 'target') identified += r.target_amount
    realized += r.realized_amount
  }

  // Fall back to initiative targets for the identified stage when no typed ledger rows exist.
  if (identified === 0 && approved === 0) {
    const inits = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.workspace_id, workspaceId))
    for (const i of inits) {
      identified += i.target_savings
      if (i.status === 'approved' || i.status === 'in_progress' || i.status === 'realized') {
        approved += i.target_savings
      }
    }
  }

  const stages = [
    { stage: 'identified', amount: identified },
    { stage: 'approved', amount: approved },
    { stage: 'realized', amount: realized },
  ]
  return c.json({ stages })
})

// --- GET /realization : realization rate by dimension --------------------

router.get('/realization', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const by = c.req.query('by') ?? 'initiative'

  const ledger = await db
    .select()
    .from(savings_ledger)
    .where(eq(savings_ledger.workspace_id, workspaceId))

  const inits = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.workspace_id, workspaceId))
  const initById = new Map(inits.map((i) => [i.id, i]))

  // Aggregate target & realized by the chosen key.
  const agg = new Map<string, { key: string; label: string; target: number; realized: number }>()

  function bump(key: string, label: string, target: number, realized: number) {
    const cur = agg.get(key) ?? { key, label, target: 0, realized: 0 }
    cur.target += target
    cur.realized += realized
    agg.set(key, cur)
  }

  for (const r of ledger) {
    const init = initById.get(r.initiative_id)
    if (by === 'category') {
      const key = init?.category_id ?? 'uncategorized'
      bump(key, key, r.target_amount, r.realized_amount)
    } else if (by === 'owner') {
      const key = init?.owner_id ?? 'unassigned'
      bump(key, key, r.target_amount, r.realized_amount)
    } else {
      const key = r.initiative_id
      bump(key, init?.title ?? r.initiative_id, r.target_amount, r.realized_amount)
    }
  }

  const rows = [...agg.values()].map((a) => ({
    ...a,
    realization_rate: a.target > 0 ? a.realized / a.target : 0,
  }))
  rows.sort((a, b) => b.realized - a.realized)
  return c.json({ by, rows })
})

// --- GET / : list ledger entries -----------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const initiativeId = c.req.query('initiative_id')
  const conds = [eq(savings_ledger.workspace_id, workspaceId)]
  if (initiativeId) conds.push(eq(savings_ledger.initiative_id, initiativeId))
  const rows = await db
    .select()
    .from(savings_ledger)
    .where(and(...conds))
    .orderBy(asc(savings_ledger.period))
  return c.json(rows)
})

// --- POST / : book an entry ----------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Ensure the initiative belongs to the same workspace.
  const [init] = await db.select().from(initiatives).where(eq(initiatives.id, body.initiative_id))
  if (!init || init.workspace_id !== body.workspace_id) {
    return c.json({ error: 'Initiative not found in workspace' }, 400)
  }

  const [created] = await db
    .insert(savings_ledger)
    .values({
      workspace_id: body.workspace_id,
      initiative_id: body.initiative_id,
      period: body.period,
      type: body.type ?? 'realized',
      target_amount: body.target_amount ?? 0,
      realized_amount: body.realized_amount ?? 0,
      note: body.note ?? '',
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// --- PUT /:id : update entry ---------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(savings_ledger).where(eq(savings_ledger.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const patch: Record<string, unknown> = {}
  if (body.period !== undefined) patch.period = body.period
  if (body.type !== undefined) patch.type = body.type
  if (body.target_amount !== undefined) patch.target_amount = body.target_amount
  if (body.realized_amount !== undefined) patch.realized_amount = body.realized_amount
  if (body.note !== undefined) patch.note = body.note

  const [updated] = await db.update(savings_ledger).set(patch).where(eq(savings_ledger.id, id)).returning()
  return c.json(updated)
})

// --- DELETE /:id : delete entry ------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(savings_ledger).where(eq(savings_ledger.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(savings_ledger).where(eq(savings_ledger.id, id))
  return c.json({ success: true })
})

export default router
