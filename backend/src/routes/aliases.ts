import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { supplier_aliases, suppliers, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
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

const createSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().min(1),
  raw_name: z.string().min(1),
  source: z.string().optional(),
})

// Public: list aliases for a workspace, optionally filtered by supplier.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const supplierId = c.req.query('supplier_id')
  const conds = [eq(supplier_aliases.workspace_id, workspaceId)]
  if (supplierId) conds.push(eq(supplier_aliases.supplier_id, supplierId))
  const rows = await db
    .select()
    .from(supplier_aliases)
    .where(and(...conds))
    .orderBy(desc(supplier_aliases.created_at))
  return c.json(rows)
})

// Auth: add a raw_name -> supplier alias.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Supplier must exist and belong to the same workspace.
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, body.supplier_id))
  if (!sup) return c.json({ error: 'Supplier not found' }, 404)
  if (sup.workspace_id !== body.workspace_id) return c.json({ error: 'Supplier not in workspace' }, 400)
  const [alias] = await db
    .insert(supplier_aliases)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id,
      raw_name: body.raw_name,
      source: body.source ?? null,
    })
    .returning()
  return c.json(alias, 201)
})

// Auth: remove an alias (must be a member of its workspace).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(supplier_aliases).where(eq(supplier_aliases.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(supplier_aliases).where(eq(supplier_aliases.id, id))
  return c.json({ success: true })
})

export default router
