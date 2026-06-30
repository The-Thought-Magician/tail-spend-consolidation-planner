# Tail Spend Consolidation Planner

## Overview

Tail Spend Consolidation Planner is a buy-side procurement analytics platform that exposes the long-tail, maverick, and duplicate-supplier spend hiding inside an enterprise's purchasing data, and builds a defensible, dollar-quantified business case to consolidate that spend onto fewer contracts and fewer suppliers.

In most large enterprises roughly 20% of total spend is spread across 80% of suppliers as fragmented one-off purchases, redundant vendors serving the same category, and off-contract "maverick" buys. This fragmentation leaks pricing leverage (no volume to negotiate with), inflates transaction cost (every PO, invoice, and supplier onboarding has a fixed processing cost), and creates compliance and risk blind spots. There is rarely a clean, analyst-ready business case that says: "collapse these N suppliers into these M, and you save $X in unit price, $Y in transaction cost, and $Z in working capital."

The platform ingests purchase, invoice, PO, supplier, and contract data (uploaded as CSV, connected via API, or generated from a built-in sample dataset for instant demoability), runs deterministic analyses (Pareto tail segmentation, fuzzy supplier de-duplication, contract-coverage matching for maverick detection, price-dispersion statistics, transaction-cost modeling), and turns the findings into trackable consolidation initiatives with target-versus-realized savings reporting. It is the analytical and project-management spine for a procurement cost-takeout program.

## Problem

- **Spend is fragmented and invisible.** Tail spend sits below category-manager attention thresholds, so nobody owns it, nobody negotiates it, and it regrows every year. Procurement teams cannot even produce a ranked list of where the fragmentation is worst.
- **Duplicate suppliers proliferate.** The same category (e.g. office supplies, lab consumables, MRO) is served by dozens of overlapping suppliers because of decentralized buying, M&A, and ERP migrations. Each duplicate dilutes volume leverage.
- **Maverick / off-contract spend leaks savings.** Buyers purchase outside negotiated contracts, paying list price when a contracted rate existed, with no systematic way to surface it.
- **No business case.** Even when fragmentation is suspected, there is no tool that models the savings of collapsing N suppliers into M, accounting for unit-price improvement, transaction-cost reduction, and switching cost, in a format an FP&A partner and a CFO will accept.
- **Transaction cost is ignored.** The fully-loaded cost of processing a PO and an invoice (AP labor, system cost, supplier onboarding) is real money that fragmentation multiplies, but it is almost never quantified.
- **Programs are not tracked.** Once a consolidation initiative is approved, target savings are rarely reconciled against realized savings, so the program loses credibility.

## Target Users

- **Chief Procurement Officers (CPO)** and **VPs of Procurement** who own cost-takeout targets and need board-ready savings narratives.
- **Sourcing / procurement analysts** who do the hands-on spend cube analysis, supplier de-duplication, and business-case modeling.
- **Category managers** who own a category's supplier base and run consolidation events.
- **FP&A partners** who validate and book the savings against budget.
- **AP / P2P operations leads** who care about transaction-cost reduction and supplier-master hygiene.

Primary buyer: CPO / VP Procurement, with sourcing analysts as daily users and FP&A as the validating partner, typically triggered by a CFO cost-takeout mandate, an ERP migration, or an annual sourcing cycle.

## Why This Is NOT an Existing Project

This is buy-side procurement spend rationalization. It is explicitly distinct from these near-neighbors:

- **saas-spend-tracker** — inventories *subscription/SaaS* spend (seats, renewals, shadow IT). It is a narrow software-spend inventory, not a general indirect/direct procurement spend cube with supplier de-duplication and a consolidation business case.
- **vendor-management** — a vendor CRM / relationship and onboarding system (contacts, documents, risk scores). It manages the supplier *records*; it does not analyze transaction-level spend fragmentation or model consolidation savings.
- **vendor-price-increase-defense-desk** — a workflow to *defend against* supplier price increases (rebuttal evidence, should-cost). It reacts to price increases; it does not rationalize the supplier base.
- **payment-terms-working-capital-optimizer** — optimizes *payment terms / DPO* for working capital. It works on the cash-timing axis, not the supplier-count / unit-price axis.
- **General sell-side FinOps / cloud cost tools** — those optimize the seller's own cloud or COGS. This is buy-side: the money the enterprise pays its external suppliers.

The unique core is: **transaction-level spend ingestion → tail/Pareto segmentation → fuzzy duplicate-supplier detection → contract-coverage maverick detection → price-dispersion quantification → consolidation business-case modeling (N→M) → trackable initiatives with target vs realized savings.** No neighbor combines spend analytics with a consolidation savings case and initiative tracking.

## Data Model (Tables)

App-domain tables (every one owned/scoped by `workspace_id`, all writes ownership-checked):

1. `workspaces` — the analysis tenant (an org's spend-analysis workspace).
2. `workspace_members` — user membership + role in a workspace.
3. `suppliers` — normalized supplier master (name, normalized_name, category, parent_supplier_id for dedup grouping, status, country, tax_id).
4. `supplier_aliases` — alternate raw names mapped to a canonical supplier (dedup evidence).
5. `categories` — spend taxonomy nodes (code, name, parent_id, level).
6. `transactions` — line-level spend facts (supplier_id, category_id, amount, currency, txn_date, po_number, invoice_number, is_on_contract, contract_id, cost_center, uom, quantity, unit_price).
7. `purchase_orders` — PO header rollups (po_number, supplier_id, total_amount, line_count, status, issued_date).
8. `invoices` — invoice header rollups (invoice_number, supplier_id, amount, status, invoice_date, po_number).
9. `contracts` — negotiated contracts (supplier_id, category_id, start/end, contracted_unit_price, committed_volume, status).
10. `data_imports` — ingestion runs (source type, row counts, status, mapping, errors).
11. `tail_segments` — output of the tail classifier (segment label head/mid/tail, thresholds, supplier_count, spend, share).
12. `duplicate_groups` — detected near-duplicate supplier clusters (category, member supplier_ids, similarity, recommended_canonical).
13. `duplicate_candidates` — pairwise candidate matches with similarity score + signals (name/tax/domain).
14. `maverick_findings` — off-contract purchase findings (transaction_id, contract_id, expected_price, paid_price, leakage_amount, reason).
15. `price_dispersion` — per-category/per-item price dispersion stats (item_key, min/max/median/p25/p75, dispersion_index, addressable_savings).
16. `transaction_cost_models` — configurable cost-per-PO / cost-per-invoice / cost-per-supplier assumptions.
17. `transaction_cost_ledger` — computed transaction-cost rows (supplier_id, po_count, invoice_count, est_cost).
18. `consolidation_scenarios` — business-case scenarios (category, from_supplier_ids[], to_supplier_ids[], assumptions, modeled savings breakdown).
19. `initiatives` — tracked consolidation initiatives (title, owner, category, target_savings, status, scenario_id, dates).
20. `initiative_milestones` — milestones / stage gates per initiative.
21. `savings_ledger` — target vs realized savings entries booked against an initiative (period, target, realized, type).
22. `recommendations` — generated, prioritized consolidation recommendations (type, category, impact, effort, rationale, status).
23. `reports` — saved/exported analysis reports (type, params snapshot, generated payload).
24. `activity_log` — audit trail of user actions in a workspace.
25. `comments` — threaded comments attached to suppliers/initiatives/scenarios.

Billing tables: `plans`, `subscriptions`.

## API Surface (high level)

`/api/v1` mounts domain routers: `workspaces`, `suppliers`, `aliases`, `categories`, `transactions`, `purchase-orders`, `invoices`, `contracts`, `imports`, `tail`, `duplicates`, `maverick`, `dispersion`, `transaction-cost`, `scenarios`, `initiatives`, `savings`, `recommendations`, `reports`, `dashboard`, `activity`, `comments`, `sample-data`, `billing`. Public reads where it makes sense for demo; auth-gated writes with zod validation + workspace ownership checks.

---

## Major Features

### 1. Spend Data Ingestion
- CSV upload for transactions, suppliers, POs, invoices, contracts with column-mapping.
- Connector stub endpoints (ERP/AP feed) returning structured "connect" status.
- Import validation: row counts, rejected rows with reasons, dry-run preview.
- Import history with re-run and rollback of an import batch.
- Currency normalization to a workspace base currency.
- Built-in sample-data seeder that fabricates a realistic multi-category, multi-supplier spend cube for instant demos.

### 2. Tail-Spend Classifier
- Pareto (80/20) segmentation of suppliers by cumulative spend into head / mid / tail bands.
- Configurable thresholds (spend %, supplier %, frequency).
- Segmentation by supplier, by category, and by purchase frequency (one-off vs recurring).
- Tail concentration metrics: supplier count in tail, $ in tail, % of total, average spend per tail supplier.
- Drill-down from a segment to its suppliers and transactions.
- Trend of tail size over time periods.

### 3. Supplier Master & Normalization
- Canonical supplier records with normalized names.
- Alias mapping (raw name -> canonical).
- Merge/split suppliers with audit.
- Supplier profile: spend, categories, PO/invoice counts, contract coverage.
- Manual reclassification of a supplier's category.

### 4. Duplicate & Near-Duplicate Supplier Detection
- Fuzzy name matching (normalized token + similarity score) within the same category.
- Multi-signal scoring: name similarity, tax id match, domain match, address proximity.
- Clustered duplicate groups with a recommended canonical supplier.
- Accept/reject a candidate pair; accepting records an alias + merge recommendation.
- Estimated consolidation value per duplicate group (spend that could be combined).

### 5. Maverick-Spend Finder
- Match transactions to active contracts by supplier + category.
- Flag off-contract purchases (no contract, or contract exists but bought elsewhere/at higher price).
- Compute leakage = paid_price - contracted_price for covered items bought off-rate.
- Maverick rate per category / cost center / buyer.
- Remediation suggestions (route to contract, add to existing agreement).

### 6. Price-Dispersion Analysis
- Per item/category price statistics: min, max, median, p25, p75, stddev.
- Dispersion index quantifying spread; addressable savings = volume * (paid - target).
- Identify same item bought at widely different prices across suppliers/units.
- "Best achievable price" benchmark per item.
- Cost-of-fragmentation rollup across categories.

### 7. Transaction-Cost Ledger
- Configurable cost-per-PO, cost-per-invoice, cost-per-supplier-onboarding assumptions.
- Compute fully-loaded transaction cost per supplier and per category.
- Model transaction-cost reduction from removing N tail suppliers.
- Sensitivity table over cost assumptions.

### 8. Consolidation Business-Case Builder
- Select a category and a set of "from" suppliers to collapse into "to" suppliers (N -> M).
- Model savings: unit-price improvement %, transaction-cost reduction, working-capital effect, minus switching cost.
- Multiple named scenarios per category with side-by-side comparison.
- Assumption sliders (price-improvement %, transaction-cost rates, ramp period).
- Net savings, ROI, payback period outputs.

### 9. Recommendation Engine
- Auto-generate prioritized consolidation recommendations from tail + duplicate + dispersion findings.
- Impact (savings) vs effort (suppliers affected, switching cost) scoring; priority quadrant.
- Convert a recommendation directly into a scenario or an initiative.
- Dismiss / snooze recommendations with reason.

### 10. Initiative Tracker
- Create consolidation initiatives from scenarios or recommendations.
- Owner, category, target savings, status pipeline (identified -> approved -> in-progress -> realized -> closed).
- Milestones / stage gates per initiative with due dates.
- Portfolio view of all initiatives and aggregate target savings.

### 11. Savings Reporting (Target vs Realized)
- Book target and realized savings entries per period against an initiative.
- Savings waterfall: identified -> approved -> realized.
- Realization rate (realized / target) by initiative, category, owner.
- Cumulative savings over time.

### 12. Category Analytics
- Spend by category, supplier count by category, fragmentation index per category.
- Category drill-down to suppliers, contracts, maverick rate, dispersion.
- Category taxonomy management (create/rename/reparent nodes).

### 13. Supplier Analytics
- Top suppliers by spend, by transaction count, by category breadth.
- Single-supplier vs multi-supplier category identification.
- Supplier contract-coverage ratio.

### 14. Contracts & Coverage
- Contract registry (supplier, category, contracted price, committed volume, term).
- Coverage analysis: % of category spend under contract vs off-contract.
- Expiring-contract alerts feeding consolidation timing.

### 15. Dashboard & KPIs
- Headline KPIs: total spend, supplier count, tail spend $/%, duplicate groups, maverick leakage, identified savings, realized savings.
- Savings opportunity funnel.
- Top opportunities widget linking to recommendations.

### 16. Reports & Exports
- Generate a board-ready consolidation report (per category or workspace).
- Saved report definitions with parameter snapshots.
- Export report payload (JSON/CSV-shaped) for download.

### 17. Scenario Comparison & What-If
- Compare multiple consolidation scenarios across savings, ROI, supplier reduction.
- What-if sliders re-computing savings live.

### 18. Workspaces & Multi-Tenancy
- Multiple analysis workspaces per user; switch active workspace.
- Workspace-scoped data and base currency.

### 19. Collaboration
- Comments on suppliers, scenarios, and initiatives.
- Activity log / audit trail of changes.

### 20. Sample Data & Demo Mode
- One-click sample-data generation populating a full demo workspace (suppliers, transactions, contracts) so every analysis is immediately populated.
- Reset / regenerate sample data.

### 21. Search & Filtering
- Cross-entity filtering by category, period, cost center, supplier, on/off-contract.
- Saved filter presets.

### 22. Settings & Configuration
- Workspace base currency, fiscal period, tail thresholds, transaction-cost assumptions.
- Member management and roles.
- Billing / plan view (all features free; Stripe optional, 503 when unconfigured).

---

## Frontend Pages (target ~22-26)

Public: landing, pricing, sign-in, sign-up.
Dashboard (auth): overview dashboard, imports, suppliers, supplier detail, duplicates, categories, transactions, contracts, tail analysis, maverick, price dispersion, transaction cost, scenarios, scenario detail/builder, recommendations, initiatives, initiative detail, savings, reports, activity, settings, sample data.
