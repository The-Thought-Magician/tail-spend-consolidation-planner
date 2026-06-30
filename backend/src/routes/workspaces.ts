import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMembership(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return m ?? null
}

async function getWorkspace(id: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  return w ?? null
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1),
  base_currency: z.string().min(1).optional(),
  fiscal_year_start: z.string().min(1).optional(),
  tail_threshold_pct: z.number().min(0).max(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  base_currency: z.string().min(1).optional(),
  fiscal_year_start: z.string().min(1).optional(),
  tail_threshold_pct: z.number().min(0).max(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).optional().default('member'),
})

// ---------------------------------------------------------------------------
// Workspace CRUD
// ---------------------------------------------------------------------------

// List workspaces the user is a member of
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const ids = memberships.map((m) => m.workspace_id)
  if (ids.length === 0) return c.json([])
  const all = await db.select().from(workspaces)
  const mine = all.filter((w) => ids.includes(w.id))
  mine.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  return c.json(mine)
})

// Get one workspace (member only)
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  const member = await getMembership(id, userId)
  if (!member) return c.json({ error: 'Forbidden' }, 403)
  return c.json(w)
})

// Create workspace; creator becomes owner + member
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [w] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      base_currency: body.base_currency ?? 'USD',
      fiscal_year_start: body.fiscal_year_start ?? '01-01',
      tail_threshold_pct: body.tail_threshold_pct ?? 0.8,
      owner_id: userId,
      settings: body.settings ?? {},
    })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: w.id,
    user_id: userId,
    role: 'owner',
  })
  return c.json(w, 201)
})

// Update workspace (owner only)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// Delete workspace (owner only)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, id))
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// List members (member only)
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  const member = await getMembership(id, userId)
  if (!member) return c.json({ error: 'Forbidden' }, 403)
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(workspace_members.created_at)
  return c.json(members)
})

// Add member by user_id + role (owner only)
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const existing = await getMembership(id, body.user_id)
  if (existing) return c.json({ error: 'Already a member' }, 409)
  const [m] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role })
    .returning()
  return c.json(m, 201)
})

// Remove member (owner only)
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [target] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!target) return c.json({ error: 'Not found' }, 404)
  if (target.user_id === w.owner_id) return c.json({ error: 'Cannot remove the owner' }, 400)
  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  return c.json({ success: true })
})

export default router
