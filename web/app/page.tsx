import Link from 'next/link'

const FEATURES = [
  {
    title: 'Tail-Spend Classifier',
    body: 'A Pareto (80/20) segmentation of your supplier base into head, mid, and tail bands, with configurable thresholds, concentration metrics, and trend tracking period over period.',
  },
  {
    title: 'Duplicate Supplier Detection',
    body: 'Multi-signal fuzzy matching on name, tax ID, and domain clusters near-duplicate suppliers and quantifies the spend available for combination within a category.',
  },
  {
    title: 'Maverick-Spend Finder',
    body: 'Transactions are matched against active contracts to flag off-contract purchases, with leakage quantified as paid price less contracted price, by category and cost center.',
  },
  {
    title: 'Price-Dispersion Analysis',
    body: 'Per-item price statistics, including minimum, maximum, median, and quartile bands, are paired with a dispersion index and an addressable-savings estimate benchmarked to the best price achieved.',
  },
  {
    title: 'Transaction-Cost Ledger',
    body: 'A configurable model of fully-loaded cost per PO, per invoice, and per supplier quantifies the transaction-cost reduction achievable by removing tail suppliers.',
  },
  {
    title: 'Consolidation Business-Case Builder',
    body: 'Model the consolidation of N suppliers into M, with assumptions for price improvement, transaction cost, and ramp. The output is net savings, ROI, and payback period, presented in a format suited for review with FP&A.',
  },
  {
    title: 'Recommendations & Initiative Tracker',
    body: 'Prioritized consolidation recommendations are generated automatically, converted into scenarios or initiatives, and tracked from target through realized savings at close-out.',
  },
]

const PROBLEMS = [
  ['Spend is fragmented and effectively invisible', 'Tail spend sits below the attention threshold of most category managers. As a result, it is unowned, unnegotiated, and it re-accumulates every year.'],
  ['Duplicate suppliers proliferate across categories', 'The same category is frequently served by a dozen or more overlapping vendors, a byproduct of decentralized buying, M&A activity, and ERP migrations. Each duplicate dilutes volume leverage.'],
  ['Maverick spend erodes negotiated savings', 'Buyers purchase outside negotiated contracts and pay list price where a contracted rate already existed, and there has been no systematic way to surface this leakage.'],
  ['A defensible business case rarely exists', 'Even where fragmentation is suspected, procurement teams seldom have an analyst-ready case demonstrating that consolidating N suppliers into M will yield $X in unit-price improvement, $Y in transaction-cost reduction, and $Z in working-capital benefit.'],
]

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-950 text-white">
      <nav className="flex items-center justify-between border-b border-stone-800 px-6 py-4">
        <span className="inline-flex items-center gap-2 text-lg font-black tracking-tight text-cyan-400">
          <span className="inline-block h-3 w-3 rounded-sm bg-cyan-400" />
          TailSpendConsolidationPlanner
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-stone-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-stone-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-cyan-400">
            Request Access
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-block rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
          Buy-side procurement spend analytics
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          A defensible business case for consolidating your tail spend
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-stone-400">
          We help procurement organizations quantify the long-tail, maverick, and duplicate-supplier spend embedded in
          their purchasing data, and translate it into a dollar-quantified case for consolidating that spend onto
          fewer contracts and fewer suppliers.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-stone-950 hover:bg-cyan-400">
            Start an assessment
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-stone-700 px-6 py-3 text-sm font-medium text-stone-200 hover:bg-stone-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-stone-600">No credit card required. A built-in sample dataset is available for an immediate walkthrough.</p>
      </section>

      <section className="border-t border-stone-800 bg-stone-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold">Why tail spend erodes procurement's leverage</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-stone-500">
            In most large enterprises, roughly twenty percent of total spend is distributed across eighty percent of
            suppliers, in the form of one-off purchases, redundant vendors, and off-contract buys.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {PROBLEMS.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-stone-800 bg-stone-900/70 p-6">
                <h3 className="font-semibold text-cyan-300">{title}</h3>
                <p className="mt-2 text-sm text-stone-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold">From spend cube to a savings program you can defend</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-stone-500">
            A deterministic analytical sequence carries your data from ingestion through Pareto segmentation, fuzzy
            de-duplication, contract-coverage maverick detection, price-dispersion analysis, and transaction-cost
            modeling, into a set of trackable consolidation initiatives.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-stone-800 bg-stone-900/70 p-6 transition-colors hover:border-cyan-500/40">
                <h3 className="font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-stone-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-stone-800 bg-stone-900/30 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold">Built for the procurement cost-takeout program</h2>
          <p className="mt-3 text-sm text-stone-400">
            This is the analytical and project-management spine for CPOs and VPs of Procurement who own a cost-takeout
            target, the sourcing analysts who do the hands-on modeling, the category managers who run the
            consolidation events, and the FP&A partners who must validate and book the savings. The output is a
            board-ready narrative, not a spreadsheet.
          </p>
          <div className="mt-8">
            <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-stone-950 hover:bg-cyan-400">
              Set up your workspace
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-800 px-6 py-10 text-center text-sm text-stone-600">
        <p className="font-semibold text-stone-400">TailSpendConsolidationPlanner</p>
        <p className="mt-1">Buy-side procurement spend rationalization, built for the enterprise sourcing function.</p>
      </footer>
    </main>
  )
}
