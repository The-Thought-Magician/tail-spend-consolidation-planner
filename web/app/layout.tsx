import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TailSpendConsolidationPlanner',
  description: 'Expose long-tail, maverick, and duplicate-supplier spend and build a dollar-quantified consolidation business case.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
