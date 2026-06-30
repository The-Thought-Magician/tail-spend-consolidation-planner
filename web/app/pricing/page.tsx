'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const FREE_FEATURES = [
  'Unlimited workspaces and members',
  'CSV import + sample-data seeder',
  'Tail-spend Pareto classifier',
  'Duplicate supplier detection',
  'Maverick-spend finder',
  'Price-dispersion analysis',
  'Transaction-cost ledger',
  'Consolidation business-case builder',
  'Recommendation engine',
  'Initiative tracker + savings ledger',
  'Board-ready reports',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    api.getBillingPlan()
      .then((p: any) => setStripeEnabled(Boolean(p?.stripeEnabled)))
      .catch(() => setStripeEnabled(false))
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="inline-flex items-center gap-2 text-lg font-black tracking-tight text-cyan-400">
          <span className="inline-block h-3 w-3 rounded-sm bg-cyan-400" />
          TailSpendConsolidationPlanner
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple, free pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Every feature is free for signed-in users. A paid Pro tier is reserved for the future and is currently
          {stripeEnabled === null ? ' loading...' : stripeEnabled ? ' available.' : ' not yet enabled.'}
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-cyan-500/40 bg-slate-900/70 p-8 text-left">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold text-white">Free</h2>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-medium text-cyan-300">Current plan</span>
            </div>
            <p className="mt-2 text-4xl font-black text-white">$0<span className="text-base font-medium text-slate-500">/mo</span></p>
            <p className="mt-2 text-sm text-slate-400">Everything you need to run a full consolidation program.</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-cyan-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/auth/sign-up" className="mt-8 block rounded-lg bg-cyan-500 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              Start free
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-left opacity-90">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold text-slate-200">Pro</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                {stripeEnabled ? 'Available' : 'Coming soon'}
              </span>
            </div>
            <p className="mt-2 text-4xl font-black text-slate-200">$49<span className="text-base font-medium text-slate-500">/mo</span></p>
            <p className="mt-2 text-sm text-slate-500">Reserved for future advanced connectors and SSO. Not required today.</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-400">
              <li className="flex items-start gap-2"><span className="mt-0.5 text-slate-600">•</span><span>Everything in Free</span></li>
              <li className="flex items-start gap-2"><span className="mt-0.5 text-slate-600">•</span><span>Live ERP / AP connectors</span></li>
              <li className="flex items-start gap-2"><span className="mt-0.5 text-slate-600">•</span><span>Priority support</span></li>
            </ul>
            <button
              disabled
              className="mt-8 block w-full cursor-not-allowed rounded-lg border border-slate-700 py-3 text-center text-sm font-medium text-slate-500"
            >
              {stripeEnabled ? 'Upgrade from Settings' : 'Not yet available'}
            </button>
          </div>
        </div>

        <p className="mt-10 text-xs text-slate-600">
          All analysis features are and will remain free for signed-in users.
        </p>
      </section>

      <footer className="border-t border-slate-800 px-6 py-10 text-center text-sm text-slate-600">
        <p className="font-semibold text-slate-400">TailSpendConsolidationPlanner</p>
      </footer>
    </main>
  )
}
