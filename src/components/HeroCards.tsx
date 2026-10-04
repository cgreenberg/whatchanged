'use client'
import { useEffect, useState } from 'react'
import { StatCard } from '@/components/StatCard'
import { buildHeroCards, asOfRange, SHELTER_VS_RENT_NOTE, type HeroCountyContext } from '@/lib/hero-cards'
import { fetchCounty } from '@/lib/local-pulse'
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
  const showsRent = cards.some(c => c.id === 'rent')
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 mt-6" data-testid="stat-cards">
        {cards.map(c => (
          <StatCard
            key={c.id}
            testId={`stat-card-${c.id}`}
            label={c.label}
            value={c.value}
            change={c.change}
            direction={c.direction}
            detail={c.detail}
            caveat={c.caveat}
            nationalValue={c.nationalValue}
            provenance={c.provenance}
            accentColor={c.accentColor}
            stale={c.stale}
            unavailable={c.status === 'unavailable'}
          />
        ))}
      </div>
      {range && (
        <p className="mt-2 text-[11px] text-zinc-500 text-center" data-testid="asof-range">
          Latest data ranges {range}: each source publishes on its own schedule.
        </p>
      )}
      {showsRent && (
        <p className="mt-1 text-[11px] text-zinc-500 text-center" data-testid="rent-vs-cpi-note">
          {SHELTER_VS_RENT_NOTE}
        </p>
      )}
    </>
  )
}
