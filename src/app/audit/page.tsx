import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Audit Reports | What Changed',
  description: 'Weekly independent data verification reports for whatchanged.us',
}

export default function AuditPage() {
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
          Data Audit Reports
        </h1>
        <p
          className="text-zinc-400 text-lg"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          Weekly independent verification of the numbers on this site.
        </p>
      </div>

      {/* What is this */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          What Is This?
        </h2>
        <div
          className="text-zinc-300 text-sm leading-relaxed space-y-3"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          <p>
            Every week, an independent audit system verifies the data displayed on whatchanged.us
            against the original government sources (BLS, EIA, Census). The audit checks that
            numbers match, calculations are correct, and data is fresh — then produces a detailed
            report with pass/fail verdicts.
          </p>
          <p>
            The audit code is completely isolated from the main site — it interacts only through
            the public API, exactly like a regular user would. This prevents circular verification.
          </p>
        </div>
      </div>

      {/* View Reports */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          View Reports
        </h2>
        <p
          className="text-zinc-300 text-sm leading-relaxed mb-5"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          Audit reports are generated as GitHub Actions artifacts and can be downloaded from
          the workflow runs page. Each report includes detailed per-zip results, tolerance checks,
          and a summary verdict.
        </p>
        <a
          href="https://github.com/cgreenberg/whatchanged/actions/workflows/weekly-audit.yml"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          View Audit Reports on GitHub
        </a>
      </div>

      {/* What Gets Checked */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-5"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          What Gets Checked
        </h2>
        <div
          className="space-y-4 text-sm"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          {[
            {
              label: 'API Correctness',
              detail:
                'Gas prices match EIA, grocery and shelter CPI match BLS, unemployment matches LAUS county data.',
            },
            {
              label: 'Display Accuracy',
              detail:
                'Numbers shown on the page are checked against the raw API response to catch rounding or formatting errors.',
            },
            {
              label: 'Internal Math',
              detail:
                'Percentage changes and dollar-impact estimates are recalculated independently and compared to displayed values.',
            },
            {
              label: 'Cross-checks',
              detail:
                'Gas prices are spot-checked against AAA as an independent external source.',
            },
            {
              label: 'Metro Mapping',
              detail:
                'BLS series IDs are verified to match the correct geographic area for each zip code tested.',
            },
          ].map(({ label, detail }, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-amber-500 font-bold mt-0.5 shrink-0">{i + 1}.</span>
              <div className="text-zinc-300">
                <span className="text-white font-medium">{label}</span>
                {' — '}
                {detail}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Schedule */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          Schedule
        </h2>
        <p
          className="text-zinc-300 text-sm leading-relaxed"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          The audit runs automatically every Wednesday at 9:00 AM Eastern via GitHub Actions.
          Each run tests zip codes across different US regions, plus edge cases like Puerto Rico
          and Alaska, to ensure broad coverage.
        </p>
      </div>

      {/* Footer links */}
      <div
        className="text-center text-sm text-zinc-500 mt-8 space-x-4"
        style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
      >
        <a
          href="https://github.com/cgreenberg/whatchanged/tree/main/audit"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-300 transition-colors"
        >
          View audit source code on GitHub
        </a>
        <span>·</span>
        <Link href="/about" className="hover:text-zinc-300 transition-colors">
          About the Data
        </Link>
      </div>
    </main>
  )
}
