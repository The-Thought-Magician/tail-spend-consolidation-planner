import Link from 'next/link'

const FEATURES = [
  {
    title: 'Tail-Spend Classifier',
    body: 'Pareto (80/20) segmentation of suppliers into head / mid / tail bands with configurable thresholds, concentration metrics, and trend over time.',
  },
  {
    title: 'Duplicate Supplier Detection',
    body: 'Fuzzy name matching with multi-signal scoring (name, tax id, domain) clusters near-duplicate suppliers and estimates the spend you could combine.',
  },
  {
    title: 'Maverick-Spend Finder',
    body: 'Match transactions to active contracts, flag off-contract buys, and quantify leakage as paid price minus contracted price by category and cost center.',
  },
  {
    title: 'Price-Dispersion Analysis',
    body: 'Per-item price statistics (min, max, median, p25, p75), a dispersion index, and addressable savings benchmarked to the best achievable price.',
  },
  {
    title: 'Transaction-Cost Ledger',
    body: 'Model fully-loaded cost-per-PO, cost-per-invoice, and cost-per-supplier, then quantify the transaction-cost reduction from removing N tail suppliers.',
  },
  {
    title: 'Consolidation Business-Case Builder',
    body: 'Collapse N suppliers into M with assumption sliders for price improvement, transaction cost, and ramp. Outputs net savings, ROI, and payback period.',
  },
  {
    title: 'Recommendations & Initiative Tracker',
    body: 'Auto-generate prioritized consolidation recommendations, convert them to scenarios or initiatives, and track target versus realized savings to close-out.',
  },
]

const PROBLEMS = [
  ['Spend is fragmented and invisible', 'Tail spend sits below category-manager thresholds, so nobody owns it, nobody negotiates it, and it regrows every year.'],
  ['Duplicate suppliers proliferate', 'The same category is served by dozens of overlapping vendors from decentralized buying, M&A, and ERP migrations, diluting volume leverage.'],
  ['Maverick spend leaks savings', 'Buyers purchase outside negotiated contracts and pay list price when a contracted rate already existed, with no systematic way to surface it.'],
  ['No defensible business case', 'There is rarely a clean, analyst-ready case that says collapse these N suppliers into these M and save $X in price, $Y in transaction cost, $Z in working capital.'],
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="inline-flex items-center gap-2 text-lg font-black tracking-tight text-cyan-400">
          <span className="inline-block h-3 w-3 rounded-sm bg-cyan-400" />
          TailSpendConsolidationPlanner
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-block rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
          Buy-side procurement spend analytics
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Turn fragmented tail spend into a defensible consolidation business case
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          Expose the long-tail, maverick, and duplicate-supplier spend hiding inside your purchasing data, then build a
          dollar-quantified case to consolidate it onto fewer contracts and fewer suppliers.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-600">No credit card. One-click sample dataset for an instant demo.</p>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold">Why tail spend leaks money</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-500">
            In most large enterprises roughly 20% of total spend is spread across 80% of suppliers as one-off purchases,
            redundant vendors, and off-contract buys.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {PROBLEMS.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
                <h3 className="font-semibold text-cyan-300">{title}</h3>
                <p className="mt-2 text-sm text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold">From spend cube to savings program</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-500">
            Deterministic analytics: ingestion to Pareto segmentation, fuzzy de-duplication, contract-coverage maverick
            detection, price-dispersion, transaction-cost modeling, and trackable initiatives.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 transition-colors hover:border-cyan-500/40">
                <h3 className="font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold">Built for the procurement cost-takeout program</h2>
          <p className="mt-3 text-sm text-slate-400">
            The analytical and project-management spine for CPOs, sourcing analysts, category managers, and the FP&A
            partners who validate the savings. Board-ready narratives, not spreadsheets.
          </p>
          <div className="mt-8">
            <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              Create your workspace
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 px-6 py-10 text-center text-sm text-slate-600">
        <p className="font-semibold text-slate-400">TailSpendConsolidationPlanner</p>
        <p className="mt-1">Buy-side procurement spend rationalization. All features free for signed-in users.</p>
      </footer>
    </main>
  )
}
