// Same-origin relative calls to /api/proxy/<path>; each path maps 1:1 to /api/v1/<path>.
// The proxy route resolves the session server-side and injects X-User-Id.

async function j(res: Response) {
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

const get = (path: string) => fetch(`/api/proxy/${path}`).then(j)
const post = (path: string, body?: unknown) =>
  fetch(`/api/proxy/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(j)
const put = (path: string, body?: unknown) =>
  fetch(`/api/proxy/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(j)
const del = (path: string) => fetch(`/api/proxy/${path}`, { method: 'DELETE' }).then(j)

const qs = (params: Record<string, unknown>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  createWorkspace: (body: unknown) => post('workspaces', body),
  updateWorkspace: (id: string, body: unknown) => put(`workspaces/${id}`, body),
  deleteWorkspace: (id: string) => del(`workspaces/${id}`),
  listMembers: (id: string) => get(`workspaces/${id}/members`),
  addMember: (id: string, body: unknown) => post(`workspaces/${id}/members`, body),
  removeMember: (id: string, memberId: string) => del(`workspaces/${id}/members/${memberId}`),

  // Categories
  listCategories: (ws: string) => get(`categories${qs({ workspace_id: ws })}`),
  getCategory: (id: string) => get(`categories/${id}`),
  createCategory: (body: unknown) => post('categories', body),
  updateCategory: (id: string, body: unknown) => put(`categories/${id}`, body),
  deleteCategory: (id: string) => del(`categories/${id}`),
  getCategoryAnalytics: (id: string) => get(`categories/${id}/analytics`),

  // Suppliers
  listSuppliers: (ws: string, params: Record<string, unknown> = {}) =>
    get(`suppliers${qs({ workspace_id: ws, ...params })}`),
  getSupplier: (id: string) => get(`suppliers/${id}`),
  createSupplier: (body: unknown) => post('suppliers', body),
  updateSupplier: (id: string, body: unknown) => put(`suppliers/${id}`, body),
  deleteSupplier: (id: string) => del(`suppliers/${id}`),
  mergeSuppliers: (id: string, body: unknown) => post(`suppliers/${id}/merge`, body),
  getTopSuppliers: (ws: string, params: Record<string, unknown> = {}) =>
    get(`suppliers/top${qs({ workspace_id: ws, ...params })}`),

  // Aliases
  listAliases: (ws: string, params: Record<string, unknown> = {}) =>
    get(`aliases${qs({ workspace_id: ws, ...params })}`),
  createAlias: (body: unknown) => post('aliases', body),
  deleteAlias: (id: string) => del(`aliases/${id}`),

  // Transactions
  listTransactions: (ws: string, params: Record<string, unknown> = {}) =>
    get(`transactions${qs({ workspace_id: ws, ...params })}`),
  getTransaction: (id: string) => get(`transactions/${id}`),
  createTransaction: (body: unknown) => post('transactions', body),
  updateTransaction: (id: string, body: unknown) => put(`transactions/${id}`, body),
  deleteTransaction: (id: string) => del(`transactions/${id}`),
  getTransactionSummary: (ws: string) => get(`transactions/summary${qs({ workspace_id: ws })}`),

  // Purchase Orders
  listPurchaseOrders: (ws: string, params: Record<string, unknown> = {}) =>
    get(`purchase-orders${qs({ workspace_id: ws, ...params })}`),
  getPurchaseOrder: (id: string) => get(`purchase-orders/${id}`),
  createPurchaseOrder: (body: unknown) => post('purchase-orders', body),
  updatePurchaseOrder: (id: string, body: unknown) => put(`purchase-orders/${id}`, body),
  deletePurchaseOrder: (id: string) => del(`purchase-orders/${id}`),

  // Invoices
  listInvoices: (ws: string, params: Record<string, unknown> = {}) =>
    get(`invoices${qs({ workspace_id: ws, ...params })}`),
  getInvoice: (id: string) => get(`invoices/${id}`),
  createInvoice: (body: unknown) => post('invoices', body),
  updateInvoice: (id: string, body: unknown) => put(`invoices/${id}`, body),
  deleteInvoice: (id: string) => del(`invoices/${id}`),

  // Contracts
  listContracts: (ws: string, params: Record<string, unknown> = {}) =>
    get(`contracts${qs({ workspace_id: ws, ...params })}`),
  getContract: (id: string) => get(`contracts/${id}`),
  createContract: (body: unknown) => post('contracts', body),
  updateContract: (id: string, body: unknown) => put(`contracts/${id}`, body),
  deleteContract: (id: string) => del(`contracts/${id}`),
  getContractCoverage: (ws: string) => get(`contracts/coverage${qs({ workspace_id: ws })}`),
  getExpiringContracts: (ws: string, params: Record<string, unknown> = {}) =>
    get(`contracts/expiring${qs({ workspace_id: ws, ...params })}`),

  // Imports
  listImports: (ws: string) => get(`imports${qs({ workspace_id: ws })}`),
  getImport: (id: string) => get(`imports/${id}`),
  previewImport: (body: unknown) => post('imports/preview', body),
  commitImport: (body: unknown) => post('imports', body),
  rollbackImport: (id: string) => post(`imports/${id}/rollback`),
  listConnectors: () => get('imports/connectors'),

  // Tail
  getTailSegments: (ws: string, params: Record<string, unknown> = {}) =>
    get(`tail${qs({ workspace_id: ws, ...params })}`),
  computeTail: (body: unknown) => post('tail/compute', body),
  getTailConcentration: (ws: string) => get(`tail/concentration${qs({ workspace_id: ws })}`),
  getTailTrend: (ws: string) => get(`tail/trend${qs({ workspace_id: ws })}`),
  getTailSegmentSuppliers: (segment: string, ws: string) =>
    get(`tail/segment/${segment}/suppliers${qs({ workspace_id: ws })}`),

  // Duplicates
  getDuplicateGroups: (ws: string) => get(`duplicates/groups${qs({ workspace_id: ws })}`),
  getDuplicateGroup: (id: string) => get(`duplicates/groups/${id}`),
  detectDuplicates: (body: unknown) => post('duplicates/detect', body),
  decideDuplicateCandidate: (id: string, body: unknown) =>
    post(`duplicates/candidates/${id}/decide`, body),
  updateDuplicateGroup: (id: string, body: unknown) => put(`duplicates/groups/${id}`, body),

  // Maverick
  getMaverickFindings: (ws: string, params: Record<string, unknown> = {}) =>
    get(`maverick${qs({ workspace_id: ws, ...params })}`),
  detectMaverick: (body: unknown) => post('maverick/detect', body),
  getMaverickRate: (ws: string, params: Record<string, unknown> = {}) =>
    get(`maverick/rate${qs({ workspace_id: ws, ...params })}`),
  updateMaverickFinding: (id: string, body: unknown) => put(`maverick/${id}`, body),

  // Dispersion
  getDispersion: (ws: string, params: Record<string, unknown> = {}) =>
    get(`dispersion${qs({ workspace_id: ws, ...params })}`),
  computeDispersion: (body: unknown) => post('dispersion/compute', body),
  getCostOfFragmentation: (ws: string) =>
    get(`dispersion/cost-of-fragmentation${qs({ workspace_id: ws })}`),

  // Transaction Cost
  getCostModels: (ws: string) => get(`transaction-cost/models${qs({ workspace_id: ws })}`),
  createCostModel: (body: unknown) => post('transaction-cost/models', body),
  updateCostModel: (id: string, body: unknown) => put(`transaction-cost/models/${id}`, body),
  deleteCostModel: (id: string) => del(`transaction-cost/models/${id}`),
  computeTransactionCost: (body: unknown) => post('transaction-cost/compute', body),
  getCostLedger: (ws: string) => get(`transaction-cost/ledger${qs({ workspace_id: ws })}`),
  getCostReduction: (ws: string, params: Record<string, unknown> = {}) =>
    get(`transaction-cost/reduction${qs({ workspace_id: ws, ...params })}`),

  // Scenarios
  listScenarios: (ws: string) => get(`scenarios${qs({ workspace_id: ws })}`),
  getScenario: (id: string) => get(`scenarios/${id}`),
  createScenario: (body: unknown) => post('scenarios', body),
  updateScenario: (id: string, body: unknown) => put(`scenarios/${id}`, body),
  deleteScenario: (id: string) => del(`scenarios/${id}`),
  modelScenario: (id: string, body?: unknown) => post(`scenarios/${id}/model`, body),
  compareScenarios: (ws: string, params: Record<string, unknown> = {}) =>
    get(`scenarios/compare${qs({ workspace_id: ws, ...params })}`),

  // Recommendations
  listRecommendations: (ws: string, params: Record<string, unknown> = {}) =>
    get(`recommendations${qs({ workspace_id: ws, ...params })}`),
  generateRecommendations: (body: unknown) => post('recommendations/generate', body),
  updateRecommendation: (id: string, body: unknown) => put(`recommendations/${id}`, body),
  recommendationToScenario: (id: string, body?: unknown) =>
    post(`recommendations/${id}/to-scenario`, body),
  recommendationToInitiative: (id: string, body?: unknown) =>
    post(`recommendations/${id}/to-initiative`, body),

  // Initiatives
  listInitiatives: (ws: string, params: Record<string, unknown> = {}) =>
    get(`initiatives${qs({ workspace_id: ws, ...params })}`),
  getInitiative: (id: string) => get(`initiatives/${id}`),
  createInitiative: (body: unknown) => post('initiatives', body),
  updateInitiative: (id: string, body: unknown) => put(`initiatives/${id}`, body),
  deleteInitiative: (id: string) => del(`initiatives/${id}`),
  addMilestone: (id: string, body: unknown) => post(`initiatives/${id}/milestones`, body),
  updateMilestone: (id: string, mid: string, body: unknown) =>
    put(`initiatives/${id}/milestones/${mid}`, body),
  getPortfolio: (ws: string) => get(`initiatives/portfolio${qs({ workspace_id: ws })}`),

  // Savings
  listSavings: (ws: string, params: Record<string, unknown> = {}) =>
    get(`savings${qs({ workspace_id: ws, ...params })}`),
  createSavingsEntry: (body: unknown) => post('savings', body),
  updateSavingsEntry: (id: string, body: unknown) => put(`savings/${id}`, body),
  deleteSavingsEntry: (id: string) => del(`savings/${id}`),
  getSavingsWaterfall: (ws: string) => get(`savings/waterfall${qs({ workspace_id: ws })}`),
  getSavingsRealization: (ws: string, params: Record<string, unknown> = {}) =>
    get(`savings/realization${qs({ workspace_id: ws, ...params })}`),

  // Reports
  listReports: (ws: string) => get(`reports${qs({ workspace_id: ws })}`),
  getReport: (id: string) => get(`reports/${id}`),
  generateReport: (body: unknown) => post('reports/generate', body),
  deleteReport: (id: string) => del(`reports/${id}`),

  // Dashboard
  getDashboardKpis: (ws: string) => get(`dashboard/kpis${qs({ workspace_id: ws })}`),
  getDashboardFunnel: (ws: string) => get(`dashboard/funnel${qs({ workspace_id: ws })}`),
  getTopOpportunities: (ws: string) =>
    get(`dashboard/top-opportunities${qs({ workspace_id: ws })}`),

  // Activity
  listActivity: (ws: string, params: Record<string, unknown> = {}) =>
    get(`activity${qs({ workspace_id: ws, ...params })}`),
  recordActivity: (body: unknown) => post('activity', body),

  // Comments
  listComments: (ws: string, params: Record<string, unknown> = {}) =>
    get(`comments${qs({ workspace_id: ws, ...params })}`),
  createComment: (body: unknown) => post('comments', body),
  deleteComment: (id: string) => del(`comments/${id}`),

  // Sample data
  seedSampleData: (body?: unknown) => post('sample-data/seed', body),
  resetSampleData: (body: unknown) => post('sample-data/reset', body),
  getSampleDataStatus: (ws: string) => get(`sample-data/status${qs({ workspace_id: ws })}`),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: (body?: unknown) => post('billing/checkout', body),
  openBillingPortal: (body?: unknown) => post('billing/portal', body),
}

export default api
