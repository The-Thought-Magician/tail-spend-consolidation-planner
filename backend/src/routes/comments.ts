import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  comments,
  workspaces,
  workspace_members,
  suppliers,
  consolidation_scenarios,
  initiatives,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Entity types that comments may be threaded onto.
const ENTITY_TYPES = ['supplier', 'scenario', 'initiative'] as const
type EntityType = (typeof ENTITY_TYPES)[number]

// Verify the user is a member of the given workspace.
async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  if (member) return true
  // Fall back to the workspace owner (creator is always implicitly a member).
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

// Verify that the referenced entity exists and belongs to the workspace.
async function entityBelongsToWorkspace(
  entityType: EntityType,
  entityId: string,
  workspaceId: string,
): Promise<boolean> {
  if (entityType === 'supplier') {
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, entityId))
    return !!row && row.workspace_id === workspaceId
  }
  if (entityType === 'scenario') {
    const [row] = await db
      .select()
      .from(consolidation_scenarios)
      .where(eq(consolidation_scenarios.id, entityId))
    return !!row && row.workspace_id === workspaceId
  }
  if (entityType === 'initiative') {
    const [row] = await db.select().from(initiatives).where(eq(initiatives.id, entityId))
    return !!row && row.workspace_id === workspaceId
  }
  return false
}

// GET / — list comments for an entity thread (public read).
// ?workspace_id=&entity_type=&entity_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const conds = [eq(comments.workspace_id, workspaceId)]
  if (entityType) conds.push(eq(comments.entity_type, entityType))
  if (entityId) conds.push(eq(comments.entity_id, entityId))

  const rows = await db
    .select()
    .from(comments)
    .where(and(...conds))
    .orderBy(desc(comments.created_at))

  return c.json(rows)
})

const createSchema = z.object({
  workspace_id: z.string().min(1),
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().min(1),
  body: z.string().min(1),
})

// POST / — add a comment (auth-gated, workspace member, entity ownership check).
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const isMember = await assertMember(body.workspace_id, userId)
  if (!isMember) return c.json({ error: 'Forbidden' }, 403)

  const belongs = await entityBelongsToWorkspace(body.entity_type, body.entity_id, body.workspace_id)
  if (!belongs) return c.json({ error: 'Entity not found in workspace' }, 404)

  const [created] = await db
    .insert(comments)
    .values({
      workspace_id: body.workspace_id,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      user_id: userId,
      body: body.body,
    })
    .returning()

  return c.json(created, 201)
})

// DELETE /:id — delete own comment (auth-gated; only author or workspace owner).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(comments).where(eq(comments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (existing.user_id !== userId) {
    // Allow workspace owners to moderate comments too.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, existing.workspace_id))
    if (!ws || ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(comments).where(eq(comments.id, id))
  return c.json({ success: true })
})

export default router
