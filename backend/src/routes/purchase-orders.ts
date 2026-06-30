import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { purchase_orders, suppliers, workspace_members } from '../db/schema.js'
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
  po_number: z.string().min(1),
  total_amount: z.number().optional(),
  line_count: z.number().int().optional(),
  status: z.string().optional(),
  issued_date: z.string().optional().nullable(),
})

const updateSchema = createSchema.partial().omit({ workspace_id: true })

// Public: list POs scoped by workspace, optionally by supplier.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const conds = [eq(purchase_orders.workspace_id, workspaceId)]
  const supplierId = c.req.query('supplier_id')
  if (supplierId) conds.push(eq(purchase_orders.supplier_id, supplierId))
  const rows = await db
    .select()
    .from(purchase_orders)
    .where(and(...conds))
    .orderBy(desc(purchase_orders.created_at))
  return c.json(rows)
})

// Public: PO detail.
router.get('/:id', async (c) => {
  const [po] = await db.select().from(purchase_orders).where(eq(purchase_orders.id, c.req.param('id')))
  if (!po) return c.json({ error: 'Not found' }, 404)
  return c.json(po)
})

// Auth: create a PO.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, body.supplier_id))
  if (!sup || sup.workspace_id !== body.workspace_id) return c.json({ error: 'Supplier not in workspace' }, 400)

  let issuedDate: Date | null = null
  if (body.issued_date) {
    const d = new Date(body.issued_date)
    if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid issued_date' }, 400)
    issuedDate = d
  }

  const [row] = await db
    .insert(purchase_orders)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id,
      po_number: body.po_number,
      total_amount: body.total_amount ?? 0,
      line_count: body.line_count ?? 0,
      status: body.status ?? 'open',
      issued_date: issuedDate,
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update a PO.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(purchase_orders).where(eq(purchase_orders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  if (body.supplier_id !== undefined) {
    const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, body.supplier_id))
    if (!sup || sup.workspace_id !== existing.workspace_id) return c.json({ error: 'Supplier not in workspace' }, 400)
  }

  const patch: Record<string, unknown> = {}
  for (const k of ['supplier_id', 'po_number', 'total_amount', 'line_count', 'status'] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  if (body.issued_date !== undefined) {
    if (body.issued_date === null) {
      patch.issued_date = null
    } else {
      const d = new Date(body.issued_date)
      if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid issued_date' }, 400)
      patch.issued_date = d
    }
  }

  const [updated] = await db.update(purchase_orders).set(patch).where(eq(purchase_orders.id, id)).returning()
  return c.json(updated)
})

// Auth: delete a PO.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(purchase_orders).where(eq(purchase_orders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(purchase_orders).where(eq(purchase_orders.id, id))
  return c.json({ success: true })
})

export default router
