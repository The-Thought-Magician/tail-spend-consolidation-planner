import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspace_members,
  initiatives,
  initiative_milestones,
  savings_ledger,
} from '../db/schema.js'
import { eq, and, asc, desc } from 'drizzle-orm'
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

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// --- schemas -------------------------------------------------------------

const createSchema = z.object({
  workspace_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  category_id: z.string().nullable().optional(),
  scenario_id: z.string().nullable().optional(),
  owner_id: z.string().optional(),
  target_savings: z.number().optional().default(0),
  status: z.enum(['identified', 'approved', 'in_progress', 'realized', 'on_hold', 'cancelled']).optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
})

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category_id: z.string().nullable().optional(),
  scenario_id: z.string().nullable().optional(),
  owner_id: z.string().optional(),
  target_savings: z.number().optional(),
  status: z.enum(['identified', 'approved', 'in_progress', 'realized', 'on_hold', 'cancelled']).optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
})

const milestoneCreateSchema = z.object({
  title: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
  due_date: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
})

const milestoneUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
  due_date: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
})

// --- GET /portfolio : aggregate (declared before /:id) -------------------

router.get('/portfolio', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const rows = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.workspace_id, workspaceId))

  const byStatus: Record<string, { count: number; target_savings: number }> = {}
  let totalTarget = 0
  for (const r of rows) {
    totalTarget += r.target_savings
    const s = r.status
    if (!byStatus[s]) byStatus[s] = { count: 0, target_savings: 0 }
    byStatus[s].count += 1
    byStatus[s].target_savings += r.target_savings
  }

  // Realized to date across all initiatives in the workspace.
  const ledger = await db
    .select()
    .from(savings_ledger)
    .where(eq(savings_ledger.workspace_id, workspaceId))
  let totalRealized = 0
  for (const l of ledger) totalRealized += l.realized_amount

  return c.json({
    total_initiatives: rows.length,
    total_target_savings: totalTarget,
    total_realized_savings: totalRealized,
    realization_rate: totalTarget > 0 ? totalRealized / totalTarget : 0,
    by_status: byStatus,
  })
})

// --- GET / : list initiatives --------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const status = c.req.query('status')
  const conds = [eq(initiatives.workspace_id, workspaceId)]
  if (status) conds.push(eq(initiatives.status, status))
  const rows = await db
    .select()
    .from(initiatives)
    .where(and(...conds))
    .orderBy(desc(initiatives.created_at))
  return c.json(rows)
})

// --- GET /:id : detail incl. milestones + savings ------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [initiative] = await db.select().from(initiatives).where(eq(initiatives.id, id))
  if (!initiative) return c.json({ error: 'Not found' }, 404)

  const milestones = await db
    .select()
    .from(initiative_milestones)
    .where(eq(initiative_milestones.initiative_id, id))
    .orderBy(asc(initiative_milestones.sort_order), asc(initiative_milestones.created_at))

  const savings = await db
    .select()
    .from(savings_ledger)
    .where(eq(savings_ledger.initiative_id, id))
    .orderBy(asc(savings_ledger.period))

  return c.json({ initiative, milestones, savings })
})

// --- POST / : create initiative ------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [created] = await db
    .insert(initiatives)
    .values({
      workspace_id: body.workspace_id,
      title: body.title,
      description: body.description ?? '',
      category_id: body.category_id ?? null,
      scenario_id: body.scenario_id ?? null,
      owner_id: body.owner_id ?? userId,
      target_savings: body.target_savings ?? 0,
      status: body.status ?? 'identified',
      start_date: toDate(body.start_date) ?? null,
      due_date: toDate(body.due_date) ?? null,
    })
    .returning()
  return c.json(created, 201)
})

// --- PUT /:id : update ---------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(initiatives).where(eq(initiatives.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.title !== undefined) patch.title = body.title
  if (body.description !== undefined) patch.description = body.description
  if (body.category_id !== undefined) patch.category_id = body.category_id
  if (body.scenario_id !== undefined) patch.scenario_id = body.scenario_id
  if (body.owner_id !== undefined) patch.owner_id = body.owner_id
  if (body.target_savings !== undefined) patch.target_savings = body.target_savings
  if (body.status !== undefined) patch.status = body.status
  if (body.start_date !== undefined) patch.start_date = toDate(body.start_date)
  if (body.due_date !== undefined) patch.due_date = toDate(body.due_date)

  const [updated] = await db.update(initiatives).set(patch).where(eq(initiatives.id, id)).returning()
  return c.json(updated)
})

// --- DELETE /:id : delete (cascades milestones + savings) ----------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(initiatives).where(eq(initiatives.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(savings_ledger).where(eq(savings_ledger.initiative_id, id))
  await db.delete(initiative_milestones).where(eq(initiative_milestones.initiative_id, id))
  await db.delete(initiatives).where(eq(initiatives.id, id))
  return c.json({ success: true })
})

// --- POST /:id/milestones : add milestone --------------------------------

router.post('/:id/milestones', authMiddleware, zValidator('json', milestoneCreateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [initiative] = await db.select().from(initiatives).where(eq(initiatives.id, id))
  if (!initiative) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(initiative.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const [created] = await db
    .insert(initiative_milestones)
    .values({
      workspace_id: initiative.workspace_id,
      initiative_id: id,
      title: body.title,
      status: body.status ?? 'pending',
      due_date: toDate(body.due_date) ?? null,
      sort_order: body.sort_order ?? 0,
    })
    .returning()
  return c.json(created, 201)
})

// --- PUT /:id/milestones/:mid : update milestone -------------------------

router.put('/:id/milestones/:mid', authMiddleware, zValidator('json', milestoneUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const mid = c.req.param('mid')
  const [milestone] = await db.select().from(initiative_milestones).where(eq(initiative_milestones.id, mid))
  if (!milestone || milestone.initiative_id !== id) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(milestone.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const patch: Record<string, unknown> = {}
  if (body.title !== undefined) patch.title = body.title
  if (body.status !== undefined) patch.status = body.status
  if (body.due_date !== undefined) patch.due_date = toDate(body.due_date)
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order

  const [updated] = await db
    .update(initiative_milestones)
    .set(patch)
    .where(eq(initiative_milestones.id, mid))
    .returning()
  return c.json(updated)
})

export default router
