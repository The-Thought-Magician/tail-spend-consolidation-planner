import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  categories,
  suppliers,
  transactions,
} from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import categoriesRoutes from './routes/categories.js'
import suppliersRoutes from './routes/suppliers.js'
import aliasesRoutes from './routes/aliases.js'
import transactionsRoutes from './routes/transactions.js'
import purchaseOrdersRoutes from './routes/purchase-orders.js'
import invoicesRoutes from './routes/invoices.js'
import contractsRoutes from './routes/contracts.js'
import importsRoutes from './routes/imports.js'
import tailRoutes from './routes/tail.js'
import duplicatesRoutes from './routes/duplicates.js'
import maverickRoutes from './routes/maverick.js'
import dispersionRoutes from './routes/dispersion.js'
import transactionCostRoutes from './routes/transaction-cost.js'
import scenariosRoutes from './routes/scenarios.js'
import recommendationsRoutes from './routes/recommendations.js'
import initiativesRoutes from './routes/initiatives.js'
import savingsRoutes from './routes/savings.js'
import reportsRoutes from './routes/reports.js'
import dashboardRoutes from './routes/dashboard.js'
import activityRoutes from './routes/activity.js'
import commentsRoutes from './routes/comments.js'
import sampleDataRoutes from './routes/sample-data.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://tail-spend-consolidation-planner.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/categories', categoriesRoutes)
api.route('/suppliers', suppliersRoutes)
api.route('/aliases', aliasesRoutes)
api.route('/transactions', transactionsRoutes)
api.route('/purchase-orders', purchaseOrdersRoutes)
api.route('/invoices', invoicesRoutes)
api.route('/contracts', contractsRoutes)
api.route('/imports', importsRoutes)
api.route('/tail', tailRoutes)
api.route('/duplicates', duplicatesRoutes)
api.route('/maverick', maverickRoutes)
api.route('/dispersion', dispersionRoutes)
api.route('/transaction-cost', transactionCostRoutes)
api.route('/scenarios', scenariosRoutes)
api.route('/recommendations', recommendationsRoutes)
api.route('/initiatives', initiativesRoutes)
api.route('/savings', savingsRoutes)
api.route('/reports', reportsRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/activity', activityRoutes)
api.route('/comments', commentsRoutes)
api.route('/sample-data', sampleDataRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Idempotent seed (count-then-insert). Seeds the two billing plans plus a
// minimal demo workspace so a fresh deploy renders something. Safe to run on
// every boot.
// ---------------------------------------------------------------------------
async function seedIfEmpty(): Promise<void> {
  // Plans (free / pro)
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ]).onConflictDoNothing()
    console.log('Seeded plans')
  }

  // Demo workspace + a couple of starter rows.
  const existingWorkspaces = await db.select().from(workspaces).limit(1)
  if (existingWorkspaces.length === 0) {
    const demoOwner = 'demo-user'
    const [ws] = await db.insert(workspaces).values({
      name: 'Demo Workspace',
      base_currency: 'USD',
      owner_id: demoOwner,
    }).returning()

    await db.insert(workspace_members).values({
      workspace_id: ws.id,
      user_id: demoOwner,
      role: 'owner',
    }).onConflictDoNothing()

    const [catIt] = await db.insert(categories).values({
      workspace_id: ws.id,
      code: 'IT',
      name: 'IT & Software',
      level: 0,
    }).returning()

    const [catFac] = await db.insert(categories).values({
      workspace_id: ws.id,
      code: 'FAC',
      name: 'Facilities',
      level: 0,
    }).returning()

    const [supA] = await db.insert(suppliers).values({
      workspace_id: ws.id,
      name: 'Acme Office Supplies',
      normalized_name: 'acme office supplies',
      category_id: catFac.id,
      status: 'active',
    }).returning()

    const [supB] = await db.insert(suppliers).values({
      workspace_id: ws.id,
      name: 'CloudHost Inc',
      normalized_name: 'cloudhost inc',
      category_id: catIt.id,
      status: 'active',
    }).returning()

    await db.insert(transactions).values([
      {
        workspace_id: ws.id,
        supplier_id: supA.id,
        category_id: catFac.id,
        amount: 1200,
        currency: 'USD',
        txn_date: new Date(),
        cost_center: 'OPS',
        item_key: 'paper-a4',
        quantity: 100,
        unit_price: 12,
      },
      {
        workspace_id: ws.id,
        supplier_id: supB.id,
        category_id: catIt.id,
        amount: 8400,
        currency: 'USD',
        txn_date: new Date(),
        cost_center: 'ENG',
        item_key: 'cloud-compute',
        quantity: 12,
        unit_price: 700,
      },
    ])

    console.log('Seeded demo workspace')
  }
}

// ---------------------------------------------------------------------------
// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() and seedIfEmpty() (both
// idempotent), each wrapped in its own try/catch so a slow/cold DB never blocks
// the port binding or crashes the process.
// ---------------------------------------------------------------------------
const port = parseInt(process.env.PORT ?? '3001')
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
