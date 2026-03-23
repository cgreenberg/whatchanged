import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About the Data | What Changed',
  description: 'Data sources, methodology, and transparency information for What Changed.',
}

export default function AboutPage() {
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
    ? process.env.NEXT_PUBLIC_BUILD_DATE
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <main className="min-h-screen px-4 py-12 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-white transition-colors mb-6 inline-block"
        >
          ← Back to dashboard
        </Link>
        <h1
          className="text-5xl md:text-7xl text-white leading-none mb-3"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          About the Data
        </h1>
        <p
          className="text-zinc-400 text-lg"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          How we collect, calculate, and display economic data.
        </p>
      </div>

      {/* Data Sources */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-5"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          Data Sources
        </h2>
        <div className="overflow-x-auto">
          <table
            className="w-full text-left text-sm text-zinc-300"
            style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
          >
            <thead>
              <tr>
                <th className="text-zinc-500 uppercase text-xs font-medium pb-3 pr-4 whitespace-nowrap">Metric</th>
                <th className="text-zinc-500 uppercase text-xs font-medium pb-3 pr-4 whitespace-nowrap">Source</th>
                <th className="text-zinc-500 uppercase text-xs font-medium pb-3 pr-4 whitespace-nowrap">Geography</th>
                <th className="text-zinc-500 uppercase text-xs font-medium pb-3 pr-4 whitespace-nowrap">Update Frequency</th>
                <th className="text-zinc-500 uppercase text-xs font-medium pb-3 whitespace-nowrap">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Unemployment Rate</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Local Area Unemployment Statistics</td>
                <td className="py-3 pr-4 whitespace-nowrap">County</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Not seasonally adjusted</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Grocery Prices</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Consumer Price Index</td>
                <td className="py-3 pr-4 whitespace-nowrap">Metro area</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Food at home category</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Shelter Costs</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Consumer Price Index</td>
                <td className="py-3 pr-4 whitespace-nowrap">Metro area</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Shelter sub-index</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Energy Costs</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Consumer Price Index</td>
                <td className="py-3 pr-4 whitespace-nowrap">Metro area</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Energy sub-index</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Gas Prices</td>
                <td className="py-3 pr-4 text-zinc-300">EIA Weekly Retail Gasoline Prices</td>
                <td className="py-3 pr-4 whitespace-nowrap">State-level</td>
                <td className="py-3 pr-4 whitespace-nowrap">Weekly</td>
                <td className="py-3">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          Methodology
        </h2>
        <p
          className="text-zinc-300 text-sm leading-relaxed"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          Year-over-year percentage changes are calculated by comparing the most recent available
          data point to the value from January 20, 2025 — the date of the presidential
          inauguration. National comparison overlays use the same BLS and EIA series at the
          national level, allowing you to see whether local trends diverge from the country as a
          whole.
        </p>
      </div>

      {/* Political Era Shading */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          Political Era Shading
        </h2>
        <p
          className="text-zinc-300 text-sm leading-relaxed"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          Charts include subtle background shading to mark presidential terms. Vertical lines and
          shaded bands indicate inauguration dates: January 20, 2017, January 20, 2021, and
          January 20, 2025.
        </p>
      </div>

      {/* Data Audit */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          Data Audit
        </h2>
        <div
          className="text-zinc-300 text-sm leading-relaxed space-y-3"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          <p>
            Every week, an automated audit verifies the data on this site against the original
            government sources. It tests 10 random zip codes, checks that every number matches
            BLS, EIA, and Census data, re-derives all calculations, and takes screenshots as
            evidence.
          </p>
          <p>
            The audit checks API correctness, display accuracy, internal math, and
            cross-references gas prices against AAA as an independent source.
          </p>
        </div>
        <a
          href="/audit-report.html"
          className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm transition-colors mt-4"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          View Latest Audit Report
        </a>
      </div>

      {/* About This Project */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          About This Project
        </h2>
        <div
          className="text-zinc-300 text-sm leading-relaxed space-y-3"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          <p>
            Source code is available on{' '}
            <a
              href="https://github.com/cgreenberg/whatchanged"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-500 hover:text-amber-400 underline"
            >
              GitHub
            </a>
            .
          </p>
          <p>
            <span className="text-zinc-500">Last updated: </span>
            {buildDate}
          </p>
          <p>
            All BLS and EIA data used on this site is public domain and freely available from the
            respective government agencies.
          </p>
        </div>
      </div>
    </main>
  )
}
