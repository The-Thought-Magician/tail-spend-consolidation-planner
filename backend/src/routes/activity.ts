import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { activity_log, workspace_members } from '../db/schema.js'
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

// GET / — paginated audit trail for a workspace.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('page_size') ?? '50', 10) || 50))
  const offset = (page - 1) * pageSize

  const conds = [eq(activity_log.workspace_id, workspaceId)]
  const action = c.req.query('action')
  if (action) conds.push(eq(activity_log.action, action))
  const entityType = c.req.query('entity_type')
  if (entityType) conds.push(eq(activity_log.entity_type, entityType))
  const userIdFilter = c.req.query('user_id')
  if (userIdFilter) conds.push(eq(activity_log.user_id, userIdFilter))
  const where = and(...conds)

  const rows = await db
    .select()
    .from(activity_log)
    .where(where)
    .orderBy(desc(activity_log.created_at))
    .limit(pageSize)
    .offset(offset)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activity_log)
    .where(where)

  return c.json({ rows, total: count ?? 0, page, page_size: pageSize })
})

const entrySchema = z.object({
  workspace_id: z.string().min(1),
  action: z.string().min(1),
  entity_type: z.string().min(1).optional(),
  entity_id: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
})

// POST / — record an activity entry.
router.post('/', authMiddleware, zValidator('json', entrySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [entry] = await db
    .insert(activity_log)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      action: body.action,
      entity_type: body.entity_type ?? null,
      entity_id: body.entity_id ?? null,
      metadata: body.metadata ?? {},
    })
    .returning()

  return c.json(entry, 201)
})

export default router
