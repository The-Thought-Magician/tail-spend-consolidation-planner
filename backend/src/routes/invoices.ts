import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { invoices, suppliers, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

/** Verify a supplier exists and belongs to the given workspace. */
async function supplierInWorkspace(supplierId: string, workspaceId: string): Promise<boolean> {
  const [s] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.workspace_id, workspaceId)))
  return !!s
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().min(1),
  invoice_number: z.string().min(1),
  po_number: z.string().optional().nullable(),
  amount: z.number().optional().default(0),
  status: z.string().optional().default('open'),
  invoice_date: z.string().datetime().optional().nullable(),
})

const updateSchema = z.object({
  supplier_id: z.string().min(1).optional(),
  invoice_number: z.string().min(1).optional(),
  po_number: z.string().optional().nullable(),
  amount: z.number().optional(),
  status: z.string().optional(),
  invoice_date: z.string().datetime().optional().nullable(),
})

// ---------------------------------------------------------------------------
// GET / — list invoices for a workspace (optionally filtered by supplier)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const supplierId = c.req.query('supplier_id')

  const conds = [eq(invoices.workspace_id, workspaceId)]
  if (supplierId) conds.push(eq(invoices.supplier_id, supplierId))

  const rows = await db
    .select()
    .from(invoices)
    .where(and(...conds))
    .orderBy(desc(invoices.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — invoice detail
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, c.req.param('id')))
  if (!inv) return c.json({ error: 'Not found' }, 404)
  return c.json(inv)
})

// ---------------------------------------------------------------------------
// POST / — create invoice
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (!(await supplierInWorkspace(body.supplier_id, body.workspace_id)))
    return c.json({ error: 'Supplier not found in workspace' }, 400)

  const [created] = await db
    .insert(invoices)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id,
      invoice_number: body.invoice_number,
      po_number: body.po_number ?? null,
      amount: body.amount ?? 0,
      status: body.status ?? 'open',
      invoice_date: body.invoice_date ? new Date(body.invoice_date) : null,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update invoice
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  if (body.supplier_id && !(await supplierInWorkspace(body.supplier_id, existing.workspace_id)))
    return c.json({ error: 'Supplier not found in workspace' }, 400)

  const patch: Record<string, unknown> = {}
  if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id
  if (body.invoice_number !== undefined) patch.invoice_number = body.invoice_number
  if (body.po_number !== undefined) patch.po_number = body.po_number
  if (body.amount !== undefined) patch.amount = body.amount
  if (body.status !== undefined) patch.status = body.status
  if (body.invoice_date !== undefined)
    patch.invoice_date = body.invoice_date ? new Date(body.invoice_date) : null

  const [updated] = await db.update(invoices).set(patch).where(eq(invoices.id, id)).returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete invoice
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await assertMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(invoices).where(eq(invoices.id, id))
  return c.json({ success: true })
})

export default router
