import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { fmtDay } from '@/lib/format'
import { HowWePick } from '@/components/HowWePick'
import { LADDERS, LADDER_ORDER } from '@/lib/resolution/ladders'
import { sourceRows } from '@/lib/resolution/doc'
import { DCRA_SOURCE, DCRA_PUBLISHER, DCRA_LICENSE_URL } from '@/lib/static-gas-meta'

/**
 * Revision date of THIS PAGE'S CONTENT (YYYY-MM-DD). Change it whenever the text below changes.
 * It is not a data date: each number's own data date is shown on its card.
 */
const ABOUT_LAST_UPDATED = '2026-10-04'

export const metadata: Metadata = {
  title: 'About the Data | What Changed',
  description: 'Data sources, methodology, and transparency information for What Changed.',
}

// Data-desk styling (tokens in globals.css / src/lib/theme.ts): charcoal cards, hairline rules,
// condensed display headings, mono kickers.
const sectionClass = 'bg-surface border border-line rounded-md p-5 sm:p-6 mb-6'
const h2Class = 'font-display font-semibold text-[24px] leading-tight tracking-tight text-ink mb-4'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={sectionClass}>
      <h2 className={h2Class}>{title}</h2>
      <div className="text-ink-2 text-sm leading-relaxed space-y-3 [&_strong]:text-ink [&_strong]:font-semibold">{children}</div>
    </section>
  )
}

const linkClass = 'text-ink underline decoration-ink-3 underline-offset-2 hover:decoration-ink'

export default function AboutPage() {
  return (
    <main className="min-h-screen px-4 py-10 sm:py-12 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <Link href="/" className="kicker text-ink-2 hover:text-ink transition-colors mb-8 inline-block">
          ← Back to dashboard
        </Link>
        <p className="kicker text-ink-3 mb-2">Sources &amp; methods</p>
        <h1 className="font-display font-semibold text-[44px] md:text-[60px] tracking-tight text-ink leading-none mb-3">
          About the data
        </h1>
        <p className="text-ink-2 text-lg">
          How we collect, calculate, and display local price data.
        </p>
        <p className="font-mono text-[12px] text-ink-2 mt-4 tnum" data-testid="about-last-updated">
          <span className="text-ink-3">Last updated: </span>
          <time dateTime={ABOUT_LAST_UPDATED}>{fmtDay(ABOUT_LAST_UPDATED)}</time>
        </p>
        <p className="text-ink-3 text-sm mt-1">
          That is when this page was last revised. Each number&apos;s own data date (the month or week its
          latest figure covers) is shown on its card, because every source publishes on its own schedule.
        </p>
      </div>

      <Section title="What the page shows">
        <p>
          Enter a zip code to see how local prices changed since January 20, 2025. Four summary cards
          come first: <strong>Gas</strong> (regular gasoline, $/gal),{' '}
          <strong>Rent</strong> (asking rents on new listings, Zillow: your county&apos;s series, else your
          metro area&apos;s, else your county&apos;s most populous place with a Zillow series; where Zillow has none of
          these, the card shows <strong>Shelter (CPI)</strong> instead),{' '}
          <strong>Groceries</strong> (CPI food at home) and{' '}
          <strong>Electricity</strong> (your state&apos;s average residential price per kWh over the last 12
          months). Each card shows the number, a short dollar translation where one applies, the comparison
          window and the U.S. figure where one exists, and a short source line (area · source · month). Tap
          the ⓘ on a card for everything else: the full source line with a link, the geography, the
          baseline, the adjustment, how the dollar figure is computed and any caveat.
        </p>
        <p>
          Below the cards are four graphs (Gas prices, Grocery prices, Housing with Rent, Home prices and
          Shelter (CPI) tabs, and Electricity prices) and, in states where at least 5% of homes heat with
          fuel oil or propane, a fifth: Home heating, with a tab for each fuel that matters there. Each
          graph has timeframe buttons, an optional U.S. comparison line and an ⓘ with the details. A county
          map colors every county by the change since January 2025 in gas prices, rent, home prices or grocery
          prices, or by electricity prices (latest 12 months vs the 12 months centered on January 2025); tap a county to see all five with the area each number covers. Rent
          and home prices are county figures, with month-by-month playback and the biggest increases and
          decreases. On the Rent layer, a county with no Zillow county series is drawn from the same stand-ins as the
          Rent card (light stripes = its metro area, dots = its most populous place with a Zillow city series); counties
          with no usable Zillow rent are solid gray. Where HUD publishes one, tapping such a county shows HUD&apos;s
          2-bedroom Fair Market Rent change, labeled as a yearly projected estimate, not a market-rent index (never a map
          color, never on the card). Gas, groceries and electricity are published for metro areas, regions or states, not
          counties, so neighboring counties share a color and there is no playback or ranking for them. On the Gas layer,
          outlines mark the area each published price covers, and colors compare monthly averages (EIA weekly prices
          averaged by month) from January 2025 to the latest month every series has, so areas compare fairly (the Gas card
          shows the latest week or month); the color scale spans the 2nd–98th percentile of counties, with larger changes
          in the end color, and a Hawaii or Alaska county with no gas series of its own takes the nearest metro&apos;s
          price, though local prices are often higher.
        </p>
      </Section>

      <Section title="How we pick your numbers">
        <HowWePick />
      </Section>

      {/* Generated from the ladder config (src/lib/resolution/doc.ts sourceRows), so it can't contradict the code */}
      <section className={sectionClass} data-testid="about-sources">
        <h2 className={h2Class}>Data sources</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink-2 leading-relaxed">
            <thead>
              <tr>
                <th className="kicker !text-[10.5px] text-ink-3 font-normal pb-3 pr-4 whitespace-nowrap">Source</th>
                <th className="kicker !text-[10.5px] text-ink-3 font-normal pb-3 pr-4 whitespace-nowrap">Used for (geography · frequency)</th>
                <th className="kicker !text-[10.5px] text-ink-3 font-normal pb-3 whitespace-nowrap">License / attribution</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows().map((r, i, all) => (
                <tr key={r.name} className={i === all.length - 1 ? '' : 'border-b border-line'} data-testid="about-source-row">
                  <td className="py-3 pr-4 text-ink align-top">
                    <a href={r.homepage} target="_blank" rel="noopener noreferrer" className={linkClass}>{r.name}</a>
                  </td>
                  <td className="py-3 pr-4 align-top">
                    <ul className="space-y-0.5">{r.usedFor.map(u => <li key={u}>{u}</li>)}</ul>
                  </td>
                  <td className="py-3 align-top">{r.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Generated from each ladder's method / comparison text */}
      <section className={sectionClass} data-testid="about-methods">
        <h2 className={h2Class}>Methods by measure</h2>
        <div className="text-ink-2 text-sm leading-relaxed space-y-4">
          {LADDER_ORDER.map(metric => {
            const l = LADDERS[metric] as { title: string; method?: string; comparison?: string; noData?: string }
            return (
              <div key={metric} data-testid={`about-method-${metric}`}>
                <h3 className="font-display font-semibold text-[17px] leading-tight tracking-tight text-ink mb-1">{l.title}</h3>
                {l.method && <p>{l.method}</p>}
                {l.comparison && <p className="text-ink-3 text-xs mt-1">U.S. comparison: {l.comparison}</p>}
                {l.noData && <p className="text-ink-3 text-xs mt-0.5">No data at any step: {l.noData}</p>}
              </div>
            )
          })}
        </div>
      </section>

      <Section title="Methodology">
        <p>
          Changes compare the most recent available data with a baseline tied to January 20, 2025, the
          date of the presidential inauguration. Each source uses the closest baseline it publishes: for
          weekly sources (EIA gas, EIA and NYSERDA heating fuel), the last weekly reading on or before
          January 20, 2025; for monthly sources (BLS gas average prices, Puerto Rico DACO gas, Zillow rent
          and home values), January 2025; for BLS consumer prices, the January 2025 index, or the nearest
          earlier month for areas BLS doesn&apos;t publish every month (for example December 2024); for the
          Alaska community fuel survey, the January 2025 survey; and for state electricity prices, the
          average of the 12 months centered on January 2025 (August 2024–July 2025), compared with the
          average of the latest 12 months. A full year on each side counts every season once (residential
          prices swing with the seasons). A 12-month window can&apos;t be centered exactly on January 20: this
          one&apos;s midpoint is about January 30 (July 2024–June 2025 would be about January 1, further away).
          A year ending January 2025 would instead be centered on mid-2024 and count months of change from
          before January 2025.
        </p>
        <p>
          Each card shows its area, source and the month (or, for weekly gas, the week) of its latest data;
          its ⓘ details add the full geography, baseline and adjustment. U.S. comparisons use the same
          source at the national level over the same period as the local figure. A &ldquo;Stale&rdquo;
          badge marks a source that has not updated on schedule.
        </p>
      </Section>

      <Section title="Graph markers">
        <p>
          Every graph marks the January 20, 2025 baseline with a thin gray line (&ldquo;Jan 2025
          baseline&rdquo; on monthly series). In the 3-, 5- and 10-year views the period since the baseline
          has a light gray background, and faint dotted lines mark January 2017 and January 2021 for
          reference. There is no party color coding.
        </p>
      </Section>

      <Section title="Data checks">
        <p>
          Data on this site is checked by automated tests against the government source APIs (BLS and EIA),
          including the electricity prices and their January 2025 baselines for several states.
        </p>
      </Section>

      <Section title="About this project">
        <p>
          Source code is available on{' '}
          <a href="https://github.com/cgreenberg/whatchanged" target="_blank" rel="noopener noreferrer" className={linkClass}>
            GitHub
          </a>
          .
        </p>
        <p data-testid="about-attribution">
          BLS, EIA, Census and HUD data are public domain. Rent and home value data: Zillow Research. Alaska gas
          prices: {DCRA_SOURCE}, {DCRA_PUBLISHER} (
          <a href={DCRA_LICENSE_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>CC BY 4.0</a>
          ; whatchanged matches each zip to a surveyed community or region, prices as published). Puerto Rico gas prices: Departamento de Asuntos del Consumidor (DACO). New York heating oil:
          NYSERDA (Open NY). Postal places for PO-box zips: GeoNames (CC BY 4.0). Every source, with its
          license, is listed in the Data sources table above.
        </p>
      </Section>
    </main>
  )
}
