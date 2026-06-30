import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Workspaces & membership
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  base_currency: text('base_currency').notNull().default('USD'),
  fiscal_year_start: text('fiscal_year_start').notNull().default('01-01'),
  tail_threshold_pct: real('tail_threshold_pct').notNull().default(0.8),
  owner_id: text('owner_id').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Spend taxonomy & supplier master
// ---------------------------------------------------------------------------

export const categories = pgTable('categories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  parent_id: text('parent_id'),
  level: integer('level').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.code)])

export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  normalized_name: text('normalized_name').notNull(),
  category_id: text('category_id').references(() => categories.id),
  parent_supplier_id: text('parent_supplier_id'),
  status: text('status').notNull().default('active'),
  country: text('country'),
  tax_id: text('tax_id'),
  domain: text('domain'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const supplier_aliases = pgTable('supplier_aliases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').notNull().references(() => suppliers.id),
  raw_name: text('raw_name').notNull(),
  source: text('source'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const contracts = pgTable('contracts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').notNull().references(() => suppliers.id),
  category_id: text('category_id').references(() => categories.id),
  name: text('name').notNull(),
  contracted_unit_price: real('contracted_unit_price'),
  committed_volume: real('committed_volume'),
  currency: text('currency').notNull().default('USD'),
  start_date: timestamp('start_date'),
  end_date: timestamp('end_date'),
  status: text('status').notNull().default('active'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Spend facts
// ---------------------------------------------------------------------------

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').notNull().references(() => suppliers.id),
  category_id: text('category_id').references(() => categories.id),
  contract_id: text('contract_id').references(() => contracts.id),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  txn_date: timestamp('txn_date').notNull(),
  po_number: text('po_number'),
  invoice_number: text('invoice_number'),
  cost_center: text('cost_center'),
  item_key: text('item_key'),
  uom: text('uom'),
  quantity: real('quantity'),
  unit_price: real('unit_price'),
  is_on_contract: boolean('is_on_contract').notNull().default(false),
  import_id: text('import_id'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const purchase_orders = pgTable('purchase_orders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').notNull().references(() => suppliers.id),
  po_number: text('po_number').notNull(),
  total_amount: real('total_amount').notNull().default(0),
  line_count: integer('line_count').notNull().default(0),
  status: text('status').notNull().default('open'),
  issued_date: timestamp('issued_date'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').notNull().references(() => suppliers.id),
  invoice_number: text('invoice_number').notNull(),
  po_number: text('po_number'),
  amount: real('amount').notNull().default(0),
  status: text('status').notNull().default('open'),
  invoice_date: timestamp('invoice_date'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export const data_imports = pgTable('data_imports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  source_type: text('source_type').notNull(),
  entity: text('entity').notNull(),
  status: text('status').notNull().default('pending'),
  row_count: integer('row_count').notNull().default(0),
  accepted_count: integer('accepted_count').notNull().default(0),
  rejected_count: integer('rejected_count').notNull().default(0),
  mapping: jsonb('mapping').$type<Record<string, string>>().default({}),
  errors: jsonb('errors').$type<Array<{ row: number; reason: string }>>().default([]),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Analysis outputs
// ---------------------------------------------------------------------------

export const tail_segments = pgTable('tail_segments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  segment: text('segment').notNull(),
  dimension: text('dimension').notNull().default('supplier'),
  supplier_count: integer('supplier_count').notNull().default(0),
  spend: real('spend').notNull().default(0),
  spend_share: real('spend_share').notNull().default(0),
  threshold_pct: real('threshold_pct'),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const duplicate_groups = pgTable('duplicate_groups', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  category_id: text('category_id').references(() => categories.id),
  member_supplier_ids: jsonb('member_supplier_ids').$type<string[]>().default([]),
  recommended_canonical_id: text('recommended_canonical_id'),
  similarity: real('similarity').notNull().default(0),
  combined_spend: real('combined_spend').notNull().default(0),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const duplicate_candidates = pgTable('duplicate_candidates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  group_id: text('group_id').references(() => duplicate_groups.id),
  supplier_a_id: text('supplier_a_id').notNull().references(() => suppliers.id),
  supplier_b_id: text('supplier_b_id').notNull().references(() => suppliers.id),
  similarity: real('similarity').notNull().default(0),
  signals: jsonb('signals').$type<Record<string, number>>().default({}),
  decision: text('decision').notNull().default('pending'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const maverick_findings = pgTable('maverick_findings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  transaction_id: text('transaction_id').references(() => transactions.id),
  supplier_id: text('supplier_id').references(() => suppliers.id),
  category_id: text('category_id').references(() => categories.id),
  contract_id: text('contract_id').references(() => contracts.id),
  expected_price: real('expected_price'),
  paid_price: real('paid_price'),
  leakage_amount: real('leakage_amount').notNull().default(0),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const price_dispersion = pgTable('price_dispersion', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  category_id: text('category_id').references(() => categories.id),
  item_key: text('item_key').notNull(),
  min_price: real('min_price'),
  max_price: real('max_price'),
  median_price: real('median_price'),
  p25_price: real('p25_price'),
  p75_price: real('p75_price'),
  dispersion_index: real('dispersion_index').notNull().default(0),
  total_quantity: real('total_quantity').notNull().default(0),
  addressable_savings: real('addressable_savings').notNull().default(0),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const transaction_cost_models = pgTable('transaction_cost_models', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  cost_per_po: real('cost_per_po').notNull().default(100),
  cost_per_invoice: real('cost_per_invoice').notNull().default(50),
  cost_per_supplier: real('cost_per_supplier').notNull().default(500),
  is_default: boolean('is_default').notNull().default(false),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const transaction_cost_ledger = pgTable('transaction_cost_ledger', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  model_id: text('model_id').references(() => transaction_cost_models.id),
  supplier_id: text('supplier_id').references(() => suppliers.id),
  po_count: integer('po_count').notNull().default(0),
  invoice_count: integer('invoice_count').notNull().default(0),
  est_cost: real('est_cost').notNull().default(0),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Business case, recommendations, initiatives, savings
// ---------------------------------------------------------------------------

export const consolidation_scenarios = pgTable('consolidation_scenarios', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  category_id: text('category_id').references(() => categories.id),
  from_supplier_ids: jsonb('from_supplier_ids').$type<string[]>().default([]),
  to_supplier_ids: jsonb('to_supplier_ids').$type<string[]>().default([]),
  assumptions: jsonb('assumptions').$type<Record<string, number>>().default({}),
  results: jsonb('results').$type<Record<string, number>>().default({}),
  modeled_savings: real('modeled_savings').notNull().default(0),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const recommendations = pgTable('recommendations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  type: text('type').notNull(),
  category_id: text('category_id').references(() => categories.id),
  title: text('title').notNull(),
  rationale: text('rationale').notNull().default(''),
  impact: real('impact').notNull().default(0),
  effort: real('effort').notNull().default(0),
  priority: text('priority').notNull().default('medium'),
  supplier_ids: jsonb('supplier_ids').$type<string[]>().default([]),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const initiatives = pgTable('initiatives', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category_id: text('category_id').references(() => categories.id),
  scenario_id: text('scenario_id').references(() => consolidation_scenarios.id),
  owner_id: text('owner_id').notNull(),
  target_savings: real('target_savings').notNull().default(0),
  status: text('status').notNull().default('identified'),
  start_date: timestamp('start_date'),
  due_date: timestamp('due_date'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const initiative_milestones = pgTable('initiative_milestones', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  initiative_id: text('initiative_id').notNull().references(() => initiatives.id),
  title: text('title').notNull(),
  status: text('status').notNull().default('pending'),
  due_date: timestamp('due_date'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const savings_ledger = pgTable('savings_ledger', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  initiative_id: text('initiative_id').notNull().references(() => initiatives.id),
  period: text('period').notNull(),
  type: text('type').notNull().default('realized'),
  target_amount: real('target_amount').notNull().default(0),
  realized_amount: real('realized_amount').notNull().default(0),
  note: text('note').notNull().default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Reporting & collaboration
// ---------------------------------------------------------------------------

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  type: text('type').notNull(),
  name: text('name').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const comments = pgTable('comments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  user_id: text('user_id').notNull(),
  body: text('body').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing (Stripe-optional; plan_id text 'free'/'pro')
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
