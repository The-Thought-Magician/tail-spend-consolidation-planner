import type { Metadata } from 'next'
import { IBM_Plex_Sans } from 'next/font/google'
import './globals.css'

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'TailSpendConsolidationPlanner',
  description: 'Expose long-tail, maverick, and duplicate-supplier spend and build a dollar-quantified consolidation business case.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={ibmPlexSans.variable}>
      <body className="bg-stone-950 text-stone-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
