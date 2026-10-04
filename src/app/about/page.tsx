import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { fmtDay } from '@/lib/format'

/**
 * Revision date of THIS PAGE'S CONTENT (YYYY-MM-DD). Change it whenever the text below changes.
 * It is not a data date: each number's own data date is shown on its card.
 */
const ABOUT_LAST_UPDATED = '2026-10-03'

export const metadata: Metadata = {
  title: 'About the Data | What Changed',
  description: 'Data sources, methodology, and transparency information for What Changed.',
}

const inter = { fontFamily: 'var(--font-inter, sans-serif)' }
const bebas = { fontFamily: 'var(--font-bebas, sans-serif)' }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
      <h2 className="text-2xl text-white mb-4" style={bebas}>{title}</h2>
      <div className="text-zinc-300 text-sm leading-relaxed space-y-3" style={inter}>{children}</div>
    </div>
  )
}

function Row({ metric, source, geo, freq, children, last }: {
  metric: string; source: string; geo: ReactNode; freq: string; children: ReactNode; last?: boolean
}) {
  return (
    <tr className={last ? '' : 'border-b border-zinc-800'}>
      <td className="py-3 pr-4 font-medium text-white whitespace-nowrap align-top">{metric}</td>
      <td className="py-3 pr-4 text-zinc-300 align-top">{source}</td>
      <td className="py-3 pr-4 align-top">{geo}</td>
      <td className="py-3 pr-4 whitespace-nowrap align-top">{freq}</td>
      <td className="py-3 align-top">{children}</td>
    </tr>
  )
}

export default function AboutPage() {
  return (
    <main className="min-h-screen px-4 py-12 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors mb-6 inline-block">
          ← Back to dashboard
        </Link>
        <h1 className="text-5xl md:text-7xl text-white leading-none mb-3" style={bebas}>
          About the Data
        </h1>
        <p className="text-zinc-400 text-lg" style={inter}>
          How we collect, calculate, and display local price data.
        </p>
        <p className="text-zinc-400 text-sm mt-3" style={inter} data-testid="about-last-updated">
          <span className="text-zinc-500">Last updated: </span>
          <time dateTime={ABOUT_LAST_UPDATED}>{fmtDay(ABOUT_LAST_UPDATED)}</time>
        </p>
        <p className="text-zinc-500 text-sm mt-1" style={inter}>
          That is when this page was last revised. Each number&apos;s own data date (the month or week its
          latest figure covers) is shown on its card, because every source publishes on its own schedule.
        </p>
      </div>

      <Section title="What the Page Shows">
        <p>
          Enter a zip code to see how local prices changed since January 20, 2025. Four summary cards
          come first: <strong className="text-white">Gas</strong> (regular gasoline, $/gal),{' '}
          <strong className="text-white">Rent</strong> (asking rents on new leases, Zillow; where Zillow
          has no county rent, the card shows <strong className="text-white">Shelter (CPI)</strong> instead),{' '}
          <strong className="text-white">Groceries</strong> (CPI food at home) and{' '}
          <strong className="text-white">Electricity</strong> (your state&apos;s average residential price
          per kWh). Each card shows the number, a short dollar translation where one applies, the
          comparison window and the U.S. figure where one exists, and a short source line (area · source ·
          month). Tap the ⓘ on a card for everything else: the full source line with a link, the
          geography, the baseline, whether the series is seasonally adjusted, how the dollar figure is
          computed and any caveat.
        </p>
        <p>
          Below the cards are four graphs: Gas prices, Grocery prices, Housing (with Rent, Home prices
          and Shelter (CPI) tabs) and Electricity prices, each with timeframe buttons, an optional U.S.
          comparison line and an ⓘ with the details. A county map colors every county by the change since
          January 2025 in gas prices, rent, home prices, grocery prices or electricity prices; tap a
          county to see all five with the area each number covers. Rent and home prices are county
          figures, with month-by-month playback and the biggest increases and decreases. Gas, groceries
          and electricity are published for metro areas, regions or states, not counties, so neighboring
          counties share a color and there is no playback or ranking for them.
        </p>
      </Section>

      {/* Data Sources */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2 className="text-2xl text-white mb-5" style={bebas}>Data Sources</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300" style={inter}>
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
              <Row
                metric="Gas (regular)"
                source="EIA Weekly Retail Gasoline Prices, regular grade"
                geo="EIA city where EIA publishes one; otherwise EIA state (9 states) or PADD region (PADD 1 split into New England, Central Atlantic and Lower Atlantic)"
                freq="Weekly"
              >
                Baseline: last weekly reading on or before Jan 20, 2025. Not seasonally adjusted. The U.S.
                comparison is EIA&apos;s U.S. average. Puerto Rico and other territories have no EIA series
                and show the U.S. average, labeled.
              </Row>
              <Row
                metric="Gas (regular), BLS areas"
                source="BLS CPI Average Price Data, gasoline (unleaded regular), per gallon"
                geo="CPI metro areas without an EIA city series (e.g. Philadelphia, Washington DC, Atlanta, Phoenix), plus Honolulu and Anchorage. Elsewhere in Hawaii and Alaska, where neither BLS nor EIA publishes a gas price, the Honolulu or Anchorage price stands in, marked with * (e.g. “Honolulu-area*”)"
                freq="Monthly"
              >
                Baseline: January 2025. Not seasonally adjusted. Monthly figures run several weeks behind
                the weekly EIA ones; the card&apos;s source line names the month. The U.S. comparison is the
                BLS U.S. city average for the same months, never EIA (BLS average prices run slightly above
                EIA&apos;s). BLS titles the two series &ldquo;Urban Hawaii&rdquo; and &ldquo;Urban
                Alaska&rdquo;, but they cover only the Honolulu and Anchorage metros; prices on the other
                islands and elsewhere in Alaska are typically higher and may have changed differently. If a
                BLS series is temporarily unavailable, the zip&apos;s EIA weekly regional price is shown
                instead, labeled &ldquo;metro n/a&rdquo; (for Hawaii and Alaska, which have no EIA regional
                series, the EIA U.S. average, labeled &ldquo;U.S. avg (local n/a)&rdquo;).
              </Row>
              <Row
                metric="Rent (new leases)"
                source="Zillow Observed Rent Index (ZORI)"
                geo="County"
                freq="Monthly"
              >
                Asking rents on new leases: the Rent card, the Housing graph&apos;s Rent tab and the county
                map. The % change since January 2025 is seasonally adjusted by whatchanged. The $/mo figure is
                that adjusted % expressed in dollars at today&apos;s typical rent (current rent − current rent
                ÷ (1 + %)), so it removes the usual seasonal rise and is not the raw difference between two
                months&apos; listed rents. Counties whose figure is far outside the U.S. range are tagged
                &ldquo;⚠ unusual&rdquo;.
              </Row>
              <Row
                metric="Home prices"
                source="Zillow Home Value Index (ZHVI)"
                geo="County"
                freq="Monthly"
              >
                Zillow&apos;s smoothed, seasonally adjusted estimate of the typical (middle-tier) home value.
                Shown in the Housing graph&apos;s Home prices tab and on the county map.
              </Row>
              <Row
                metric="Shelter (CPI)"
                source="BLS Consumer Price Index: shelter; for its dollar figure, rent of primary residence"
                geo="Metro area, Census division, or region"
                freq="Monthly"
              >
                CPI shelter covers rents plus owners&apos; equivalent rent for homeowners, including existing
                leases, so it lags new-lease asking rents by about a year. It is the Housing graph&apos;s
                Shelter (CPI) tab, and the housing card where Zillow has no county rent. That card&apos;s
                headline % is CPI shelter; its &ldquo;≈ $/yr in rent&rdquo; figure is the same area&apos;s BLS
                CPI rent of primary residence % change applied to the local Census median rent × 12 (not the
                shelter %, which is mostly owners&apos; equivalent rent). No dollar figure is shown where the
                rent index or a local rent figure is unavailable, or where only national CPI exists (e.g.
                Puerto Rico). Not seasonally adjusted.
              </Row>
              <Row
                metric="Groceries"
                source="BLS Consumer Price Index (food at home)"
                geo="Metro area, Census division, or region"
                freq="Monthly"
              >
                $ estimate: $6,000/yr typical household grocery spend × % change. Not seasonally adjusted.
              </Row>
              <Row
                metric="Electricity"
                source="EIA average residential electricity price (Form EIA-861M, via the EIA API's electricity retail-sales data)"
                geo="State (statewide average across utilities). EIA publishes no price for Puerto Rico or other territories, which show “Data unavailable”"
                freq="Monthly (about two months behind)"
                last
              >
                The card shows the latest published price in ¢/kWh with its month. The % change since January
                2025 compares seasonally adjusted prices: residential prices are seasonal (in many states the
                summer price per kWh runs well above winter&apos;s), so a raw January-to-latest comparison
                would mostly measure the season. whatchanged removes each state&apos;s typical month-to-month
                pattern, estimated from 2014–2024 (the same classical method used for Zillow rents); the ⓘ
                also shows the unadjusted change. The ≈ $/mo figure is the change in the adjusted price
                × the state&apos;s average home use (residential sales ÷ customers, averaged over the latest 12
                months). It is a statewide average: your utility&apos;s rate and your own use can differ. The
                U.S. comparison is EIA&apos;s U.S. average with the same method over the same months.
              </Row>
            </tbody>
          </table>
        </div>
      </div>

      <Section title="Methodology">
        <p>
          Changes compare the most recent available data with a baseline tied to January 20, 2025, the
          date of the presidential inauguration. Each source uses the closest baseline it publishes: for
          gas (EIA, weekly), the last weekly reading on or before January 20, 2025; for gas from BLS
          average prices (monthly), January 2025; for BLS consumer prices, the January 2025 index, or the
          nearest earlier month for areas BLS doesn&apos;t publish every month (for example December 2024);
          for county rent and home values (Zillow) and state electricity prices (EIA), January 2025.
        </p>
        <p>
          Each card shows its area, source and the month (or, for weekly gas, the week) of its latest data;
          its ⓘ details add the full geography, baseline and whether the figures are seasonally adjusted.
          U.S. comparisons use the same BLS and EIA series at the national level over the same months as
          the local figure. A &ldquo;Stale&rdquo; badge marks a source that has not updated on schedule.
        </p>
      </Section>

      <Section title="Presidential Term Shading">
        <p>
          Graphs include subtle background shading for presidential terms, with labels at the inauguration
          dates January 20, 2017, January 20, 2021, and January 20, 2025.
        </p>
      </Section>

      <Section title="Data Checks">
        <p>
          Data on this site is checked by automated tests against the government source APIs (BLS and EIA),
          including the electricity prices and their January 2025 baselines for several states.
        </p>
      </Section>

      <Section title="About This Project">
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
          All BLS, EIA, and Census data used on this site is public domain and freely available from the
          respective government agencies. Rent and home value data come from Zillow Research.
        </p>
      </Section>
    </main>
  )
}
