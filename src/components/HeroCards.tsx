'use client'
import { useEffect, useState } from 'react'
import { StatCard } from '@/components/StatCard'
import { buildHeroCards, asOfRange, TRACE_FOR_CARD, type HeroCountyContext } from '@/lib/hero-cards'
import { fetchCounty } from '@/lib/county-data'
import type { EconomicSnapshot } from '@/types'

export function HeroCards({ snapshot }: { snapshot: EconomicSnapshot }) {
  // County flags/notes (static shard, shared fetch cache) so flagged county figures carry a caveat
  const countyFips = snapshot.location?.countyFips
  const [county, setCounty] = useState<{ fips: string; data: HeroCountyContext | null } | null>(null)
  useEffect(() => {
    if (!countyFips) return
    let live = true
    Promise.resolve()
      .then(() => fetchCounty(countyFips))
      .then(c => { if (live) setCounty({ fips: countyFips, data: c ?? null }) })
      .catch(() => {})
    return () => { live = false }
  }, [countyFips])

  const cards = buildHeroCards(snapshot, county?.fips === countyFips ? county.data : null)
  const range = asOfRange(cards)
  return (
    <>
      {/* Cards stretch to equal height; while a card's ⓘ is open the row stops stretching, so its neighbor doesn't grow */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 mt-5 has-[[aria-expanded=true]]:items-start" data-testid="stat-cards">
        {cards.map(c => (
          <StatCard
            key={c.id}
            testId={`stat-card-${c.id}`}
            label={c.label}
            value={c.value}
            valueNote={c.valueNote}
            inline={c.inline}
            direction={c.direction}
            secondary={c.secondary}
            sourceLine={c.sourceLine}
            tags={c.tags}
            info={c.info}
            provenance={c.provenance}
            moreProvenance={c.moreProvenance}
            accentColor={c.accentColor}
            stale={c.stale}
            unavailable={c.status === 'unavailable'}
            trace={c.id === 'shelter' && c.inline
              // The Shelter card's $ also rests on a rent base: show that step too
              ? [...(snapshot.trace?.rent ?? []), ...(snapshot.trace?.rentBase ?? [])]
              : snapshot.trace?.[TRACE_FOR_CARD[c.id]]}
          />
        ))}
      </div>
      {range && (
        <p className="tnum mt-2.5 font-mono text-[10.5px] text-ink-3" data-testid="asof-range">
          Latest data ranges {range}: each source publishes on its own schedule.
        </p>
      )}
    </>
  )
}
