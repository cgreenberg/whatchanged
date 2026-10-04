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
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Gas Prices (regular)</td>
                <td className="py-3 pr-4 text-zinc-300">EIA Weekly Retail Gasoline Prices, regular grade</td>
                <td className="py-3 pr-4">EIA city where EIA publishes one; otherwise EIA state (9 states) or PADD region</td>
                <td className="py-3 pr-4 whitespace-nowrap">Weekly</td>
                <td className="py-3">Baseline: last weekly reading on or before Jan 20, 2025. Not seasonally adjusted. The national comparison is EIA&apos;s U.S. average.</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Gas Prices (regular), BLS areas</td>
                <td className="py-3 pr-4 text-zinc-300">BLS CPI Average Price Data, gasoline (unleaded regular), per gallon</td>
                <td className="py-3 pr-4">CPI metro areas without an EIA city series (e.g. Philadelphia, Washington DC, Atlanta, Phoenix), plus Honolulu and Anchorage. Elsewhere in Hawaii and Alaska, where neither BLS nor EIA publishes a gas price, the Honolulu or Anchorage price is shown, labeled as such</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Used only for metros EIA does not cover weekly, and for Hawaii/Alaska (EIA publishes nothing there). Baseline: January 2025. Not seasonally adjusted. Monthly figures run several weeks behind the weekly EIA ones, so the card says which month they run through. The national comparison is the BLS U.S. city average for the same months, never EIA, so it differs from the EIA national figure shown for weekly areas. BLS average prices run slightly above EIA&apos;s. BLS titles these two series &ldquo;Urban Hawaii&rdquo; and &ldquo;Urban Alaska&rdquo;, but they cover only the Urban Honolulu and Anchorage metros; prices on the other islands and elsewhere in Alaska are typically higher. If a BLS series is temporarily unavailable, the page shows the EIA weekly regional price instead, labeled.</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Rent (new leases)</td>
                <td className="py-3 pr-4 text-zinc-300">Zillow Observed Rent Index (ZORI)</td>
                <td className="py-3 pr-4">County</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Asking rents on new leases. The % change since January 2025 is seasonally adjusted by whatchanged. The $/mo figure is that adjusted % expressed in dollars at today&apos;s typical rent (current rent − current rent ÷ (1 + %)), so it removes the usual seasonal rise and is not the raw difference between two months&apos; listed rents. The typical asking rent is shown separately, as listed for its month.</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Home Prices</td>
                <td className="py-3 pr-4 text-zinc-300">Zillow Home Value Index (ZHVI)</td>
                <td className="py-3 pr-4">County</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">Zillow&apos;s smoothed, seasonally adjusted estimate of the typical (middle-tier) home value. Shown in the housing graph and on the county map.</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Shelter Prices</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Consumer Price Index (shelter)</td>
                <td className="py-3 pr-4">Metro area, Census division, or region</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">All tenants (including existing leases) and homeowners&apos; equivalent rent; lags new-lease asking rents by about a year, so it can move differently from the Rent card. Shown as a chart, and as the housing card where county rent isn&apos;t available. $ estimate uses local Census median rent (none where only national CPI is available, e.g. Puerto Rico). Not seasonally adjusted.</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Grocery Prices</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Consumer Price Index (food at home)</td>
                <td className="py-3 pr-4">Metro area, Census division, or region</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">$ estimate: $6,000/yr typical grocery spend × % change. Not seasonally adjusted.</td>
              </tr>
              <tr className="border-b border-zinc-800">
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Energy Costs</td>
                <td className="py-3 pr-4 text-zinc-300">BLS Consumer Price Index (energy)</td>
                <td className="py-3 pr-4">Metro area, Census division, or region</td>
                <td className="py-3 pr-4 whitespace-nowrap">Monthly</td>
                <td className="py-3">BLS &ldquo;Energy&rdquo; combines household energy (electricity and utility natural gas, plus fuel oil) with motor fuel (gasoline), which is roughly half its weight, so it moves with gas prices as well as utility bills. Not seasonally adjusted.</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-white whitespace-nowrap">Tariff Impact</td>
                <td className="py-3 pr-4 text-zinc-300">Yale Budget Lab estimate</td>
                <td className="py-3 pr-4">Zip, city, or county (Census ACS median household income)</td>
                <td className="py-3 pr-4 whitespace-nowrap">Static</td>
                <td className="py-3">Estimate: median household income × 2.05%. Not a measured change. PO-box zips without Census data borrow the income of the largest residential zip in the same city or county (labeled); zips with no usable zip-level figure use their county&apos;s ACS median (labeled county); where no local figure exists, the U.S. median is used and labeled national.</td>
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
          Changes compare the most recent available data with a baseline tied to January 20, 2025,
          the date of the presidential inauguration. Each source uses the closest baseline it
          publishes: for gas (EIA, weekly), the last weekly reading on or before January 20, 2025;
          for gas from BLS average prices (monthly), January 2025;
          for BLS consumer prices, the January 2025 index, or the nearest earlier month for areas
          BLS doesn&apos;t publish every month (for example December 2024); for county rent and home
          values (Zillow), January 2025. Every card shows its source, geography, baseline, the date of its latest
          data, and whether the figures are seasonally adjusted. National comparisons use the same
          BLS and EIA series at the national level over the same months as the local figure.
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

      {/* Data Checks */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2
          className="text-2xl text-white mb-4"
          style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
        >
          Data Checks
        </h2>
        <p
          className="text-zinc-300 text-sm leading-relaxed"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          Data on this site is checked by automated tests against the government source APIs
          (BLS and EIA).
        </p>
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
            All BLS, EIA, and Census data used on this site is public domain and freely available from
            the respective government agencies. Rent and home value data come from Zillow Research.
          </p>
        </div>
      </div>
    </main>
  )
}
