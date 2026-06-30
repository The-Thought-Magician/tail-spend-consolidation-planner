# Build Plan — Tail Spend Consolidation Planner

Authoritative build contract. Filenames, mount paths, api method names, and page files declared here are binding. Stack per `_template-report.md`: Hono backend mounted under `/api/v1` via a child `api` router; `@neondatabase/auth@0.4.2-beta`; `web/proxy.ts` only; backend trusts `X-User-Id` via `getUserId(c)`; public reads / auth-gated writes with zod + workspace ownership checks; frontend uses relative `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

All features are FREE for signed-in users. Stripe is optional and returns 503 when unconfigured.

---

## (a) Tables

(Full column defs live in `backend/src/db/schema.ts` and `backend/src/db/migrate.ts`.)

| Table | Key columns |
|---|---|
| `workspaces` | id, name, base_currency, fiscal_year_start, tail_threshold_pct, owner_id, settings(jsonb), created_at, updated_at |
| `workspace_members` | id, workspace_id→workspaces, user_id, role, created_at; UNIQUE(workspace_id,user_id) |
| `categories` | id, workspace_id→workspaces, code, name, parent_id, level, created_at; UNIQUE(workspace_id,code) |
| `suppliers` | id, workspace_id→workspaces, name, normalized_name, category_id→categories, parent_supplier_id, status, country, tax_id, domain, created_at |
| `supplier_aliases` | id, workspace_id→workspaces, supplier_id→suppliers, raw_name, source, created_at |
| `contracts` | id, workspace_id→workspaces, supplier_id→suppliers, category_id→categories, name, contracted_unit_price, committed_volume, currency, start_date, end_date, status, created_at |
| `transactions` | id, workspace_id→workspaces, supplier_id→suppliers, category_id→categories, contract_id→contracts, amount, currency, txn_date, po_number, invoice_number, cost_center, item_key, uom, quantity, unit_price, is_on_contract, import_id, created_at |
| `purchase_orders` | id, workspace_id→workspaces, supplier_id→suppliers, po_number, total_amount, line_count, status, issued_date, created_at |
| `invoices` | id, workspace_id→workspaces, supplier_id→suppliers, invoice_number, po_number, amount, status, invoice_date, created_at |
| `data_imports` | id, workspace_id→workspaces, source_type, entity, status, row_count, accepted_count, rejected_count, mapping(jsonb), errors(jsonb), created_by, created_at |
| `tail_segments` | id, workspace_id→workspaces, segment, dimension, supplier_count, spend, spend_share, threshold_pct, computed_at, created_at |
| `duplicate_groups` | id, workspace_id→workspaces, category_id→categories, member_supplier_ids(jsonb), recommended_canonical_id, similarity, combined_spend, status, created_at |
| `duplicate_candidates` | id, workspace_id→workspaces, group_id→duplicate_groups, supplier_a_id→suppliers, supplier_b_id→suppliers, similarity, signals(jsonb), decision, created_at |
| `maverick_findings` | id, workspace_id→workspaces, transaction_id→transactions, supplier_id→suppliers, category_id→categories, contract_id→contracts, expected_price, paid_price, leakage_amount, reason, status, created_at |
| `price_dispersion` | id, workspace_id→workspaces, category_id→categories, item_key, min_price, max_price, median_price, p25_price, p75_price, dispersion_index, total_quantity, addressable_savings, computed_at, created_at |
| `transaction_cost_models` | id, workspace_id→workspaces, name, cost_per_po, cost_per_invoice, cost_per_supplier, is_default, created_by, created_at |
| `transaction_cost_ledger` | id, workspace_id→workspaces, model_id→transaction_cost_models, supplier_id→suppliers, po_count, invoice_count, est_cost, computed_at, created_at |
| `consolidation_scenarios` | id, workspace_id→workspaces, name, category_id→categories, from_supplier_ids(jsonb), to_supplier_ids(jsonb), assumptions(jsonb), results(jsonb), modeled_savings, created_by, created_at, updated_at |
| `recommendations` | id, workspace_id→workspaces, type, category_id→categories, title, rationale, impact, effort, priority, supplier_ids(jsonb), status, created_at |
| `initiatives` | id, workspace_id→workspaces, title, description, category_id→categories, scenario_id→consolidation_scenarios, owner_id, target_savings, status, start_date, due_date, created_at, updated_at |
| `initiative_milestones` | id, workspace_id→workspaces, initiative_id→initiatives, title, status, due_date, sort_order, created_at |
| `savings_ledger` | id, workspace_id→workspaces, initiative_id→initiatives, period, type, target_amount, realized_amount, note, created_by, created_at |
| `reports` | id, workspace_id→workspaces, type, name, params(jsonb), payload(jsonb), created_by, created_at |
| `comments` | id, workspace_id→workspaces, entity_type, entity_id, user_id, body, created_at |
| `activity_log` | id, workspace_id→workspaces, user_id, action, entity_type, entity_id, metadata(jsonb), created_at |
| `plans` | id (text 'free'/'pro'), name, price_cents |
| `subscriptions` | id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at |

Seeded on boot via `seedIfEmpty()`: `plans` ('free' $0, 'pro' $4900).

---

## Conventions for all route files

- `import { Hono } from 'hono'`; `const router = new Hono()`; `export default router`.
- `authMiddleware` + `getUserId(c)` from `../lib/auth.js` on writes; reads may be public.
- Validate bodies with `@hono/zod-validator` + zod.
- Ownership: every workspace-scoped write/read verifies the user is a member of the `workspace_id` (helper `assertMember(workspaceId, userId)`); cross-entity rows verified via their parent's `workspace_id`.
- `?workspace_id=` query param on list/read endpoints; body `workspace_id` on creates.
- Response shapes are JSON objects/arrays of the corresponding table rows unless noted.

---

## (b) Backend route files

All mounted in `index.ts` on the child `api` router, then `app.route('/api/v1', api)`.

### `workspaces.ts` — mount `workspaces`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | yes | list workspaces the user is a member of | `Workspace[]` |
| GET `/:id` | yes | get one workspace (member) | `Workspace` |
| POST `/` | yes | create workspace (creator becomes owner+member) | `Workspace` 201 |
| PUT `/:id` | yes | update settings/currency/thresholds (owner) | `Workspace` |
| DELETE `/:id` | yes | delete workspace (owner) | `{success}` |
| GET `/:id/members` | yes | list members | `Member[]` |
| POST `/:id/members` | yes | add member by user_id+role (owner) | `Member` 201 |
| DELETE `/:id/members/:memberId` | yes | remove member (owner) | `{success}` |

### `categories.ts` — mount `categories`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | list categories for `?workspace_id=` (tree-ready) | `Category[]` |
| GET `/:id` | no | category detail | `Category` |
| POST `/` | yes | create category | `Category` 201 |
| PUT `/:id` | yes | rename/reparent | `Category` |
| DELETE `/:id` | yes | delete category | `{success}` |
| GET `/:id/analytics` | no | spend, supplier_count, fragmentation_index, maverick_rate, contract_coverage | `{...}` |

### `suppliers.ts` — mount `suppliers`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | list suppliers `?workspace_id=&category_id=&q=` | `Supplier[]` |
| GET `/:id` | no | supplier profile: spend, po/invoice counts, categories, contract coverage | `{supplier, stats}` |
| POST `/` | yes | create supplier (computes normalized_name) | `Supplier` 201 |
| PUT `/:id` | yes | update (reclassify category, status, parent) | `Supplier` |
| DELETE `/:id` | yes | delete supplier | `{success}` |
| POST `/:id/merge` | yes | merge other supplier_ids into this canonical (records aliases, repoints txns) | `{merged}` |
| GET `/top` | no | top suppliers by spend/txn-count `?workspace_id=&by=` | `Supplier[]` |

### `aliases.ts` — mount `aliases`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | list aliases `?workspace_id=&supplier_id=` | `Alias[]` |
| POST `/` | yes | add raw_name→supplier alias | `Alias` 201 |
| DELETE `/:id` | yes | remove alias | `{success}` |

### `transactions.ts` — mount `transactions`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | paginated list `?workspace_id=&supplier_id=&category_id=&cost_center=&on_contract=&from=&to=&page=` | `{rows, total}` |
| GET `/:id` | no | one transaction | `Transaction` |
| POST `/` | yes | create transaction | `Transaction` 201 |
| PUT `/:id` | yes | update transaction | `Transaction` |
| DELETE `/:id` | yes | delete transaction | `{success}` |
| GET `/summary` | no | totals: spend, txn_count, supplier_count, avg, on/off-contract split `?workspace_id=` | `{...}` |

### `purchase-orders.ts` — mount `purchase-orders`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | list POs `?workspace_id=&supplier_id=` | `PO[]` |
| GET `/:id` | no | PO detail | `PO` |
| POST `/` | yes | create PO | `PO` 201 |
| PUT `/:id` | yes | update PO | `PO` |
| DELETE `/:id` | yes | delete PO | `{success}` |

### `invoices.ts` — mount `invoices`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | list invoices `?workspace_id=&supplier_id=` | `Invoice[]` |
| GET `/:id` | no | invoice detail | `Invoice` |
| POST `/` | yes | create invoice | `Invoice` 201 |
| PUT `/:id` | yes | update invoice | `Invoice` |
| DELETE `/:id` | yes | delete invoice | `{success}` |

### `contracts.ts` — mount `contracts`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | list contracts `?workspace_id=&supplier_id=&category_id=` | `Contract[]` |
| GET `/:id` | no | contract detail | `Contract` |
| POST `/` | yes | create contract | `Contract` 201 |
| PUT `/:id` | yes | update contract | `Contract` |
| DELETE `/:id` | yes | delete contract | `{success}` |
| GET `/coverage` | no | per-category on/off-contract coverage % `?workspace_id=` | `{coverage[]}` |
| GET `/expiring` | no | contracts expiring within N days `?workspace_id=&days=` | `Contract[]` |

### `imports.ts` — mount `imports`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | import history `?workspace_id=` | `Import[]` |
| GET `/:id` | no | import detail incl. errors | `Import` |
| POST `/preview` | yes | dry-run: parse rows + mapping, return accepted/rejected preview (no write) | `{accepted, rejected, sample}` |
| POST `/` | yes | commit import: insert rows for entity, record import batch | `Import` 201 |
| POST `/:id/rollback` | yes | delete rows created by this import batch | `{success}` |
| GET `/connectors` | no | available connector stubs + status | `Connector[]` |

### `tail.ts` — mount `tail`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | latest computed tail segments `?workspace_id=&dimension=` | `TailSegment[]` |
| POST `/compute` | yes | run Pareto classifier (writes tail_segments) `{workspace_id, dimension, threshold_pct}` | `{segments}` 201 |
| GET `/concentration` | no | tail metrics: count, $, %, avg-per-tail-supplier `?workspace_id=` | `{...}` |
| GET `/trend` | no | tail size by period `?workspace_id=` | `{points[]}` |
| GET `/segment/:segment/suppliers` | no | suppliers in a segment `?workspace_id=` | `Supplier[]` |

### `duplicates.ts` — mount `duplicates`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/groups` | no | duplicate groups `?workspace_id=` | `DuplicateGroup[]` |
| GET `/groups/:id` | no | group detail + candidates + members | `{group, candidates, members}` |
| POST `/detect` | yes | run fuzzy detection (writes groups+candidates) `{workspace_id}` | `{groups, candidates}` 201 |
| POST `/candidates/:id/decide` | yes | accept/reject a pair (accept records alias + merge rec) `{decision}` | `Candidate` |
| PUT `/groups/:id` | yes | set group status / recommended_canonical | `DuplicateGroup` |

### `maverick.ts` — mount `maverick`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | maverick findings `?workspace_id=&status=` | `Finding[]` |
| POST `/detect` | yes | match txns to contracts, compute leakage (writes findings) `{workspace_id}` | `{findings}` 201 |
| GET `/rate` | no | maverick rate by category/cost_center `?workspace_id=&by=` | `{rows[]}` |
| PUT `/:id` | yes | update finding status (e.g. remediated) | `Finding` |

### `dispersion.ts` — mount `dispersion`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | price-dispersion rows `?workspace_id=&category_id=` | `Dispersion[]` |
| POST `/compute` | yes | compute per-item price stats + addressable savings `{workspace_id}` | `{rows}` 201 |
| GET `/cost-of-fragmentation` | no | rollup of addressable savings across categories `?workspace_id=` | `{total, byCategory[]}` |

### `transaction-cost.ts` — mount `transaction-cost`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/models` | no | cost models `?workspace_id=` | `Model[]` |
| POST `/models` | yes | create cost model | `Model` 201 |
| PUT `/models/:id` | yes | update cost model (set default) | `Model` |
| DELETE `/models/:id` | yes | delete model | `{success}` |
| POST `/compute` | yes | compute ledger per supplier from PO/invoice counts `{workspace_id, model_id}` | `{ledger}` 201 |
| GET `/ledger` | no | computed ledger `?workspace_id=` | `LedgerRow[]` |
| GET `/reduction` | no | model cost reduction from removing N tail suppliers `?workspace_id=&n=` | `{...}` |

### `scenarios.ts` — mount `scenarios`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | scenarios `?workspace_id=` | `Scenario[]` |
| GET `/:id` | no | scenario detail | `Scenario` |
| POST `/` | yes | create scenario | `Scenario` 201 |
| PUT `/:id` | yes | update scenario (assumptions/suppliers) | `Scenario` |
| DELETE `/:id` | yes | delete scenario | `{success}` |
| POST `/:id/model` | yes | recompute savings breakdown from assumptions (writes results) | `{results, modeled_savings}` |
| GET `/compare` | no | side-by-side compare `?workspace_id=&ids=a,b,c` | `{scenarios[]}` |

### `recommendations.ts` — mount `recommendations`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | recommendations `?workspace_id=&status=` | `Recommendation[]` |
| POST `/generate` | yes | generate from tail+duplicate+dispersion findings (writes recs) `{workspace_id}` | `{recommendations}` 201 |
| PUT `/:id` | yes | update status (dismiss/snooze) | `Recommendation` |
| POST `/:id/to-scenario` | yes | spawn a scenario from a recommendation | `Scenario` 201 |
| POST `/:id/to-initiative` | yes | spawn an initiative from a recommendation | `Initiative` 201 |

### `initiatives.ts` — mount `initiatives`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | initiatives `?workspace_id=&status=` | `Initiative[]` |
| GET `/:id` | no | initiative detail + milestones + savings entries | `{initiative, milestones, savings}` |
| POST `/` | yes | create initiative | `Initiative` 201 |
| PUT `/:id` | yes | update (status, target, owner, dates) | `Initiative` |
| DELETE `/:id` | yes | delete initiative | `{success}` |
| POST `/:id/milestones` | yes | add milestone | `Milestone` 201 |
| PUT `/:id/milestones/:mid` | yes | update milestone status | `Milestone` |
| GET `/portfolio` | no | aggregate target savings + counts by status `?workspace_id=` | `{...}` |

### `savings.ts` — mount `savings`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | savings ledger entries `?workspace_id=&initiative_id=` | `Entry[]` |
| POST `/` | yes | book a target/realized savings entry | `Entry` 201 |
| PUT `/:id` | yes | update entry | `Entry` |
| DELETE `/:id` | yes | delete entry | `{success}` |
| GET `/waterfall` | no | identified→approved→realized waterfall `?workspace_id=` | `{stages[]}` |
| GET `/realization` | no | realization rate by initiative/category/owner `?workspace_id=&by=` | `{rows[]}` |

### `reports.ts` — mount `reports`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | saved reports `?workspace_id=` | `Report[]` |
| GET `/:id` | no | report detail (payload) | `Report` |
| POST `/generate` | yes | build a board-ready report payload from current analysis + save `{workspace_id, type, params}` | `Report` 201 |
| DELETE `/:id` | yes | delete report | `{success}` |

### `dashboard.ts` — mount `dashboard`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/kpis` | no | headline KPIs (total spend, suppliers, tail $/%, duplicate groups, maverick leakage, identified savings, realized savings) `?workspace_id=` | `{...}` |
| GET `/funnel` | no | savings opportunity funnel `?workspace_id=` | `{stages[]}` |
| GET `/top-opportunities` | no | top recommendations linked widget `?workspace_id=` | `Recommendation[]` |

### `activity.ts` — mount `activity`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | activity log `?workspace_id=&page=` | `{rows, total}` |
| POST `/` | yes | record an activity entry | `Entry` 201 |

### `comments.ts` — mount `comments`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/` | no | comments `?workspace_id=&entity_type=&entity_id=` | `Comment[]` |
| POST `/` | yes | add comment | `Comment` 201 |
| DELETE `/:id` | yes | delete own comment | `{success}` |

### `sample-data.ts` — mount `sample-data`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| POST `/seed` | yes | generate a full demo workspace (categories, suppliers w/ dups, transactions, POs, invoices, contracts) `{workspace_id?}` | `{workspace_id, counts}` 201 |
| POST `/reset` | yes | wipe + regenerate sample data for a workspace `{workspace_id}` | `{counts}` |
| GET `/status` | no | whether a workspace has sample data `?workspace_id=` | `{seeded, counts}` |

### `billing.ts` — mount `billing` (Stripe-optional 503; webhook-inspector pattern)
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET `/plan` | no (reads x-user-id) | current subscription + plan + stripeEnabled | `{subscription, plan, stripeEnabled}` |
| POST `/checkout` | no (reads x-user-id) | create Stripe checkout session or 503 | `{url}` / 503 |
| POST `/portal` | no (reads x-user-id) | billing portal session or 503 | `{url}` / 503 |
| POST `/webhook` | no | Stripe webhook handler or 503 | `{received}` / 503 |

---

## (c) `web/lib/api.ts` methods

Each is `fetch('/api/proxy/<path>')`; path maps 1:1 to `/api/v1/<path>`. JSON + `JSON.stringify` on mutations. `export default api`.

| method | verb | proxy path |
|---|---|---|
| listWorkspaces | GET | `/api/proxy/workspaces` |
| getWorkspace | GET | `/api/proxy/workspaces/${id}` |
| createWorkspace | POST | `/api/proxy/workspaces` |
| updateWorkspace | PUT | `/api/proxy/workspaces/${id}` |
| deleteWorkspace | DELETE | `/api/proxy/workspaces/${id}` |
| listMembers | GET | `/api/proxy/workspaces/${id}/members` |
| addMember | POST | `/api/proxy/workspaces/${id}/members` |
| removeMember | DELETE | `/api/proxy/workspaces/${id}/members/${memberId}` |
| listCategories | GET | `/api/proxy/categories?workspace_id=${ws}` |
| getCategory | GET | `/api/proxy/categories/${id}` |
| createCategory | POST | `/api/proxy/categories` |
| updateCategory | PUT | `/api/proxy/categories/${id}` |
| deleteCategory | DELETE | `/api/proxy/categories/${id}` |
| getCategoryAnalytics | GET | `/api/proxy/categories/${id}/analytics` |
| listSuppliers | GET | `/api/proxy/suppliers?workspace_id=${ws}` |
| getSupplier | GET | `/api/proxy/suppliers/${id}` |
| createSupplier | POST | `/api/proxy/suppliers` |
| updateSupplier | PUT | `/api/proxy/suppliers/${id}` |
| deleteSupplier | DELETE | `/api/proxy/suppliers/${id}` |
| mergeSuppliers | POST | `/api/proxy/suppliers/${id}/merge` |
| getTopSuppliers | GET | `/api/proxy/suppliers/top?workspace_id=${ws}` |
| listAliases | GET | `/api/proxy/aliases?workspace_id=${ws}` |
| createAlias | POST | `/api/proxy/aliases` |
| deleteAlias | DELETE | `/api/proxy/aliases/${id}` |
| listTransactions | GET | `/api/proxy/transactions?workspace_id=${ws}` |
| getTransaction | GET | `/api/proxy/transactions/${id}` |
| createTransaction | POST | `/api/proxy/transactions` |
| updateTransaction | PUT | `/api/proxy/transactions/${id}` |
| deleteTransaction | DELETE | `/api/proxy/transactions/${id}` |
| getTransactionSummary | GET | `/api/proxy/transactions/summary?workspace_id=${ws}` |
| listPurchaseOrders | GET | `/api/proxy/purchase-orders?workspace_id=${ws}` |
| getPurchaseOrder | GET | `/api/proxy/purchase-orders/${id}` |
| createPurchaseOrder | POST | `/api/proxy/purchase-orders` |
| updatePurchaseOrder | PUT | `/api/proxy/purchase-orders/${id}` |
| deletePurchaseOrder | DELETE | `/api/proxy/purchase-orders/${id}` |
| listInvoices | GET | `/api/proxy/invoices?workspace_id=${ws}` |
| getInvoice | GET | `/api/proxy/invoices/${id}` |
| createInvoice | POST | `/api/proxy/invoices` |
| updateInvoice | PUT | `/api/proxy/invoices/${id}` |
| deleteInvoice | DELETE | `/api/proxy/invoices/${id}` |
| listContracts | GET | `/api/proxy/contracts?workspace_id=${ws}` |
| getContract | GET | `/api/proxy/contracts/${id}` |
| createContract | POST | `/api/proxy/contracts` |
| updateContract | PUT | `/api/proxy/contracts/${id}` |
| deleteContract | DELETE | `/api/proxy/contracts/${id}` |
| getContractCoverage | GET | `/api/proxy/contracts/coverage?workspace_id=${ws}` |
| getExpiringContracts | GET | `/api/proxy/contracts/expiring?workspace_id=${ws}` |
| listImports | GET | `/api/proxy/imports?workspace_id=${ws}` |
| getImport | GET | `/api/proxy/imports/${id}` |
| previewImport | POST | `/api/proxy/imports/preview` |
| commitImport | POST | `/api/proxy/imports` |
| rollbackImport | POST | `/api/proxy/imports/${id}/rollback` |
| listConnectors | GET | `/api/proxy/imports/connectors` |
| getTailSegments | GET | `/api/proxy/tail?workspace_id=${ws}` |
| computeTail | POST | `/api/proxy/tail/compute` |
| getTailConcentration | GET | `/api/proxy/tail/concentration?workspace_id=${ws}` |
| getTailTrend | GET | `/api/proxy/tail/trend?workspace_id=${ws}` |
| getTailSegmentSuppliers | GET | `/api/proxy/tail/segment/${segment}/suppliers?workspace_id=${ws}` |
| getDuplicateGroups | GET | `/api/proxy/duplicates/groups?workspace_id=${ws}` |
| getDuplicateGroup | GET | `/api/proxy/duplicates/groups/${id}` |
| detectDuplicates | POST | `/api/proxy/duplicates/detect` |
| decideDuplicateCandidate | POST | `/api/proxy/duplicates/candidates/${id}/decide` |
| updateDuplicateGroup | PUT | `/api/proxy/duplicates/groups/${id}` |
| getMaverickFindings | GET | `/api/proxy/maverick?workspace_id=${ws}` |
| detectMaverick | POST | `/api/proxy/maverick/detect` |
| getMaverickRate | GET | `/api/proxy/maverick/rate?workspace_id=${ws}` |
| updateMaverickFinding | PUT | `/api/proxy/maverick/${id}` |
| getDispersion | GET | `/api/proxy/dispersion?workspace_id=${ws}` |
| computeDispersion | POST | `/api/proxy/dispersion/compute` |
| getCostOfFragmentation | GET | `/api/proxy/dispersion/cost-of-fragmentation?workspace_id=${ws}` |
| getCostModels | GET | `/api/proxy/transaction-cost/models?workspace_id=${ws}` |
| createCostModel | POST | `/api/proxy/transaction-cost/models` |
| updateCostModel | PUT | `/api/proxy/transaction-cost/models/${id}` |
| deleteCostModel | DELETE | `/api/proxy/transaction-cost/models/${id}` |
| computeTransactionCost | POST | `/api/proxy/transaction-cost/compute` |
| getCostLedger | GET | `/api/proxy/transaction-cost/ledger?workspace_id=${ws}` |
| getCostReduction | GET | `/api/proxy/transaction-cost/reduction?workspace_id=${ws}` |
| listScenarios | GET | `/api/proxy/scenarios?workspace_id=${ws}` |
| getScenario | GET | `/api/proxy/scenarios/${id}` |
| createScenario | POST | `/api/proxy/scenarios` |
| updateScenario | PUT | `/api/proxy/scenarios/${id}` |
| deleteScenario | DELETE | `/api/proxy/scenarios/${id}` |
| modelScenario | POST | `/api/proxy/scenarios/${id}/model` |
| compareScenarios | GET | `/api/proxy/scenarios/compare?workspace_id=${ws}` |
| listRecommendations | GET | `/api/proxy/recommendations?workspace_id=${ws}` |
| generateRecommendations | POST | `/api/proxy/recommendations/generate` |
| updateRecommendation | PUT | `/api/proxy/recommendations/${id}` |
| recommendationToScenario | POST | `/api/proxy/recommendations/${id}/to-scenario` |
| recommendationToInitiative | POST | `/api/proxy/recommendations/${id}/to-initiative` |
| listInitiatives | GET | `/api/proxy/initiatives?workspace_id=${ws}` |
| getInitiative | GET | `/api/proxy/initiatives/${id}` |
| createInitiative | POST | `/api/proxy/initiatives` |
| updateInitiative | PUT | `/api/proxy/initiatives/${id}` |
| deleteInitiative | DELETE | `/api/proxy/initiatives/${id}` |
| addMilestone | POST | `/api/proxy/initiatives/${id}/milestones` |
| updateMilestone | PUT | `/api/proxy/initiatives/${id}/milestones/${mid}` |
| getPortfolio | GET | `/api/proxy/initiatives/portfolio?workspace_id=${ws}` |
| listSavings | GET | `/api/proxy/savings?workspace_id=${ws}` |
| createSavingsEntry | POST | `/api/proxy/savings` |
| updateSavingsEntry | PUT | `/api/proxy/savings/${id}` |
| deleteSavingsEntry | DELETE | `/api/proxy/savings/${id}` |
| getSavingsWaterfall | GET | `/api/proxy/savings/waterfall?workspace_id=${ws}` |
| getSavingsRealization | GET | `/api/proxy/savings/realization?workspace_id=${ws}` |
| listReports | GET | `/api/proxy/reports?workspace_id=${ws}` |
| getReport | GET | `/api/proxy/reports/${id}` |
| generateReport | POST | `/api/proxy/reports/generate` |
| deleteReport | DELETE | `/api/proxy/reports/${id}` |
| getDashboardKpis | GET | `/api/proxy/dashboard/kpis?workspace_id=${ws}` |
| getDashboardFunnel | GET | `/api/proxy/dashboard/funnel?workspace_id=${ws}` |
| getTopOpportunities | GET | `/api/proxy/dashboard/top-opportunities?workspace_id=${ws}` |
| listActivity | GET | `/api/proxy/activity?workspace_id=${ws}` |
| recordActivity | POST | `/api/proxy/activity` |
| listComments | GET | `/api/proxy/comments?workspace_id=${ws}` |
| createComment | POST | `/api/proxy/comments` |
| deleteComment | DELETE | `/api/proxy/comments/${id}` |
| seedSampleData | POST | `/api/proxy/sample-data/seed` |
| resetSampleData | POST | `/api/proxy/sample-data/reset` |
| getSampleDataStatus | GET | `/api/proxy/sample-data/status?workspace_id=${ws}` |
| getBillingPlan | GET | `/api/proxy/billing/plan` |
| startCheckout | POST | `/api/proxy/billing/checkout` |
| openBillingPortal | POST | `/api/proxy/billing/portal` |

---

## (d) Pages

Public pages have NO auth calls (landing is purely static). Dashboard pages are under `/dashboard/*`, wrapped by `web/app/dashboard/layout.tsx` → `<DashboardLayout>` (Pattern B), guarded by `proxy.ts` matcher + per-page `authClient.getSession()` check. Active workspace id is held in `localStorage` (set on the workspaces page) and passed to api methods.

| # | URL | file (under web/) | kind | api methods | renders |
|---|---|---|---|---|---|
| 1 | `/` | `app/page.tsx` | public | (none) | static landing: hero, 7 flagship features, CTA |
| 2 | `/pricing` | `app/pricing/page.tsx` | public | getBillingPlan | Free vs Pro plans, all-free note |
| 3 | `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | (authClient) | email/password sign-in |
| 4 | `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | (authClient) | email/password sign-up |
| 5 | `/dashboard` | `app/dashboard/page.tsx` | dashboard | getDashboardKpis, getDashboardFunnel, getTopOpportunities, getSampleDataStatus | KPI cards, savings funnel, top opportunities |
| 6 | `/dashboard/workspaces` | `app/dashboard/workspaces/page.tsx` | dashboard | listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, listMembers, addMember, removeMember | workspace switcher + members management |
| 7 | `/dashboard/imports` | `app/dashboard/imports/page.tsx` | dashboard | listImports, previewImport, commitImport, rollbackImport, listConnectors, getImport | CSV upload + mapping, dry-run preview, history, connectors |
| 8 | `/dashboard/sample-data` | `app/dashboard/sample-data/page.tsx` | dashboard | getSampleDataStatus, seedSampleData, resetSampleData | one-click demo seeding |
| 9 | `/dashboard/suppliers` | `app/dashboard/suppliers/page.tsx` | dashboard | listSuppliers, createSupplier, deleteSupplier, getTopSuppliers, listCategories | supplier master list + top-suppliers |
| 10 | `/dashboard/suppliers/[id]` | `app/dashboard/suppliers/[id]/page.tsx` | dashboard | getSupplier, updateSupplier, mergeSuppliers, listAliases, createAlias, deleteAlias, listComments, createComment | supplier profile, aliases, merge, comments |
| 11 | `/dashboard/categories` | `app/dashboard/categories/page.tsx` | dashboard | listCategories, createCategory, updateCategory, deleteCategory, getCategoryAnalytics | category tree + per-category analytics |
| 12 | `/dashboard/transactions` | `app/dashboard/transactions/page.tsx` | dashboard | listTransactions, getTransactionSummary, createTransaction, updateTransaction, deleteTransaction, listSuppliers, listCategories | filterable spend table + summary |
| 13 | `/dashboard/contracts` | `app/dashboard/contracts/page.tsx` | dashboard | listContracts, createContract, updateContract, deleteContract, getContractCoverage, getExpiringContracts, listSuppliers | contract registry + coverage + expiring |
| 14 | `/dashboard/purchasing` | `app/dashboard/purchasing/page.tsx` | dashboard | listPurchaseOrders, createPurchaseOrder, deletePurchaseOrder, listInvoices, createInvoice, deleteInvoice | POs and invoices tabs |
| 15 | `/dashboard/tail` | `app/dashboard/tail/page.tsx` | dashboard | getTailSegments, computeTail, getTailConcentration, getTailTrend, getTailSegmentSuppliers | Pareto segments, concentration, trend, drilldown |
| 16 | `/dashboard/duplicates` | `app/dashboard/duplicates/page.tsx` | dashboard | getDuplicateGroups, detectDuplicates, getDuplicateGroup, decideDuplicateCandidate, updateDuplicateGroup | duplicate groups + accept/reject candidates |
| 17 | `/dashboard/maverick` | `app/dashboard/maverick/page.tsx` | dashboard | getMaverickFindings, detectMaverick, getMaverickRate, updateMaverickFinding | off-contract findings + leakage + rate |
| 18 | `/dashboard/dispersion` | `app/dashboard/dispersion/page.tsx` | dashboard | getDispersion, computeDispersion, getCostOfFragmentation, listCategories | price-dispersion stats + cost of fragmentation |
| 19 | `/dashboard/transaction-cost` | `app/dashboard/transaction-cost/page.tsx` | dashboard | getCostModels, createCostModel, updateCostModel, deleteCostModel, computeTransactionCost, getCostLedger, getCostReduction | cost models, ledger, reduction sensitivity |
| 20 | `/dashboard/scenarios` | `app/dashboard/scenarios/page.tsx` | dashboard | listScenarios, createScenario, deleteScenario, compareScenarios, listCategories | scenario list + side-by-side compare |
| 21 | `/dashboard/scenarios/[id]` | `app/dashboard/scenarios/[id]/page.tsx` | dashboard | getScenario, updateScenario, modelScenario, listSuppliers | business-case builder w/ assumption sliders |
| 22 | `/dashboard/recommendations` | `app/dashboard/recommendations/page.tsx` | dashboard | listRecommendations, generateRecommendations, updateRecommendation, recommendationToScenario, recommendationToInitiative | impact/effort quadrant + convert actions |
| 23 | `/dashboard/initiatives` | `app/dashboard/initiatives/page.tsx` | dashboard | listInitiatives, createInitiative, getPortfolio, deleteInitiative | initiative portfolio + create |
| 24 | `/dashboard/initiatives/[id]` | `app/dashboard/initiatives/[id]/page.tsx` | dashboard | getInitiative, updateInitiative, addMilestone, updateMilestone, listSavings, createSavingsEntry, listComments, createComment | initiative detail, milestones, savings, comments |
| 25 | `/dashboard/savings` | `app/dashboard/savings/page.tsx` | dashboard | listSavings, getSavingsWaterfall, getSavingsRealization, createSavingsEntry, updateSavingsEntry, deleteSavingsEntry | target vs realized waterfall + realization |
| 26 | `/dashboard/reports` | `app/dashboard/reports/page.tsx` | dashboard | listReports, generateReport, getReport, deleteReport | board-ready report generator + saved reports |
| 27 | `/dashboard/activity` | `app/dashboard/activity/page.tsx` | dashboard | listActivity | audit trail feed |
| 28 | `/dashboard/settings` | `app/dashboard/settings/page.tsx` | dashboard | getWorkspace, updateWorkspace, getBillingPlan, startCheckout, openBillingPortal | workspace config (currency, thresholds) + billing |

Plus route handlers: `app/api/auth/[...path]/route.ts`, `app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` with `usePathname()` active state, sectioned NavLinks, mobile drawer. A workspace switcher sits at the top of the sidebar.

- **Overview**
  - Dashboard → `/dashboard`
- **Data**
  - Imports → `/dashboard/imports`
  - Sample Data → `/dashboard/sample-data`
  - Suppliers → `/dashboard/suppliers`
  - Categories → `/dashboard/categories`
  - Transactions → `/dashboard/transactions`
  - Contracts → `/dashboard/contracts`
  - Purchasing → `/dashboard/purchasing`
- **Analysis**
  - Tail Spend → `/dashboard/tail`
  - Duplicates → `/dashboard/duplicates`
  - Maverick Spend → `/dashboard/maverick`
  - Price Dispersion → `/dashboard/dispersion`
  - Transaction Cost → `/dashboard/transaction-cost`
- **Consolidation**
  - Scenarios → `/dashboard/scenarios`
  - Recommendations → `/dashboard/recommendations`
  - Initiatives → `/dashboard/initiatives`
  - Savings → `/dashboard/savings`
- **Output**
  - Reports → `/dashboard/reports`
  - Activity → `/dashboard/activity`
- **Account**
  - Workspaces → `/dashboard/workspaces`
  - Settings → `/dashboard/settings`

---

## Backend `index.ts` mounting order

```
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
```

25 route files, 28 pages. Every api method is implemented by exactly one endpoint and consumed by at least one page.
