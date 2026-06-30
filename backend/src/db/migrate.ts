import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Idempotent, self-provisioning DDL. Column names/types match schema.ts exactly.
// Timestamps are timestamptz; floats are real; JSON columns are jsonb.
const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    base_currency text NOT NULL DEFAULT 'USD',
    fiscal_year_start text NOT NULL DEFAULT '01-01',
    tail_threshold_pct real NOT NULL DEFAULT 0.8,
    owner_id text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS categories (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    code text NOT NULL,
    name text NOT NULL,
    parent_id text,
    level integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, code)
  )`,

  `CREATE TABLE IF NOT EXISTS suppliers (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    normalized_name text NOT NULL,
    category_id text REFERENCES categories(id),
    parent_supplier_id text,
    status text NOT NULL DEFAULT 'active',
    country text,
    tax_id text,
    domain text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS supplier_aliases (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text NOT NULL REFERENCES suppliers(id),
    raw_name text NOT NULL,
    source text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS contracts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text NOT NULL REFERENCES suppliers(id),
    category_id text REFERENCES categories(id),
    name text NOT NULL,
    contracted_unit_price real,
    committed_volume real,
    currency text NOT NULL DEFAULT 'USD',
    start_date timestamptz,
    end_date timestamptz,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text NOT NULL REFERENCES suppliers(id),
    category_id text REFERENCES categories(id),
    contract_id text REFERENCES contracts(id),
    amount real NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    txn_date timestamptz NOT NULL,
    po_number text,
    invoice_number text,
    cost_center text,
    item_key text,
    uom text,
    quantity real,
    unit_price real,
    is_on_contract boolean NOT NULL DEFAULT false,
    import_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text NOT NULL REFERENCES suppliers(id),
    po_number text NOT NULL,
    total_amount real NOT NULL DEFAULT 0,
    line_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    issued_date timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text NOT NULL REFERENCES suppliers(id),
    invoice_number text NOT NULL,
    po_number text,
    amount real NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    invoice_date timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS data_imports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    source_type text NOT NULL,
    entity text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    row_count integer NOT NULL DEFAULT 0,
    accepted_count integer NOT NULL DEFAULT 0,
    rejected_count integer NOT NULL DEFAULT 0,
    mapping jsonb DEFAULT '{}'::jsonb,
    errors jsonb DEFAULT '[]'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tail_segments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    segment text NOT NULL,
    dimension text NOT NULL DEFAULT 'supplier',
    supplier_count integer NOT NULL DEFAULT 0,
    spend real NOT NULL DEFAULT 0,
    spend_share real NOT NULL DEFAULT 0,
    threshold_pct real,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS duplicate_groups (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    category_id text REFERENCES categories(id),
    member_supplier_ids jsonb DEFAULT '[]'::jsonb,
    recommended_canonical_id text,
    similarity real NOT NULL DEFAULT 0,
    combined_spend real NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS duplicate_candidates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    group_id text REFERENCES duplicate_groups(id),
    supplier_a_id text NOT NULL REFERENCES suppliers(id),
    supplier_b_id text NOT NULL REFERENCES suppliers(id),
    similarity real NOT NULL DEFAULT 0,
    signals jsonb DEFAULT '{}'::jsonb,
    decision text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS maverick_findings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    transaction_id text REFERENCES transactions(id),
    supplier_id text REFERENCES suppliers(id),
    category_id text REFERENCES categories(id),
    contract_id text REFERENCES contracts(id),
    expected_price real,
    paid_price real,
    leakage_amount real NOT NULL DEFAULT 0,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS price_dispersion (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    category_id text REFERENCES categories(id),
    item_key text NOT NULL,
    min_price real,
    max_price real,
    median_price real,
    p25_price real,
    p75_price real,
    dispersion_index real NOT NULL DEFAULT 0,
    total_quantity real NOT NULL DEFAULT 0,
    addressable_savings real NOT NULL DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS transaction_cost_models (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    cost_per_po real NOT NULL DEFAULT 100,
    cost_per_invoice real NOT NULL DEFAULT 50,
    cost_per_supplier real NOT NULL DEFAULT 500,
    is_default boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS transaction_cost_ledger (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    model_id text REFERENCES transaction_cost_models(id),
    supplier_id text REFERENCES suppliers(id),
    po_count integer NOT NULL DEFAULT 0,
    invoice_count integer NOT NULL DEFAULT 0,
    est_cost real NOT NULL DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS consolidation_scenarios (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    category_id text REFERENCES categories(id),
    from_supplier_ids jsonb DEFAULT '[]'::jsonb,
    to_supplier_ids jsonb DEFAULT '[]'::jsonb,
    assumptions jsonb DEFAULT '{}'::jsonb,
    results jsonb DEFAULT '{}'::jsonb,
    modeled_savings real NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS recommendations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    type text NOT NULL,
    category_id text REFERENCES categories(id),
    title text NOT NULL,
    rationale text NOT NULL DEFAULT '',
    impact real NOT NULL DEFAULT 0,
    effort real NOT NULL DEFAULT 0,
    priority text NOT NULL DEFAULT 'medium',
    supplier_ids jsonb DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS initiatives (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    category_id text REFERENCES categories(id),
    scenario_id text REFERENCES consolidation_scenarios(id),
    owner_id text NOT NULL,
    target_savings real NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'identified',
    start_date timestamptz,
    due_date timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS initiative_milestones (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    initiative_id text NOT NULL REFERENCES initiatives(id),
    title text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    due_date timestamptz,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS savings_ledger (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    initiative_id text NOT NULL REFERENCES initiatives(id),
    period text NOT NULL,
    type text NOT NULL DEFAULT 'realized',
    target_amount real NOT NULL DEFAULT 0,
    realized_amount real NOT NULL DEFAULT 0,
    note text NOT NULL DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    type text NOT NULL,
    name text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb,
    payload jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS comments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    user_id text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / workspace_id for query performance
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_workspace ON categories(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_suppliers_workspace ON suppliers(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_aliases_workspace ON supplier_aliases(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_aliases_supplier ON supplier_aliases(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_workspace ON contracts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contracts_supplier ON contracts(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_workspace ON transactions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_supplier ON transactions(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(txn_date)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_orders_workspace ON purchase_orders(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON invoices(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_data_imports_workspace ON data_imports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tail_segments_workspace ON tail_segments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_duplicate_groups_workspace ON duplicate_groups(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_workspace ON duplicate_candidates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_group ON duplicate_candidates(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_maverick_findings_workspace ON maverick_findings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_price_dispersion_workspace ON price_dispersion(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_cost_models_workspace ON transaction_cost_models(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_cost_ledger_workspace ON transaction_cost_ledger(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_workspace ON consolidation_scenarios(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recommendations_workspace ON recommendations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_initiatives_workspace ON initiatives(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_initiative_milestones_workspace ON initiative_milestones(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_initiative_milestones_initiative ON initiative_milestones(initiative_id)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_ledger_workspace ON savings_ledger(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_savings_ledger_initiative ON savings_ledger(initiative_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_workspace ON reports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_workspace ON comments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
]

export async function migrate(): Promise<void> {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Migrated ${statements.length} statements`)
}
