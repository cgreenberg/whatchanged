'use client'
import { useState } from 'react'
import { ZipInput } from '@/components/ZipInput'
import { LocationBanner } from '@/components/LocationBanner'
import { StatCard } from '@/components/StatCard'
import { StatCardSkeleton } from '@/components/StatCardSkeleton'
import { ChartsSection } from '@/components/charts/ChartsSection'
import { TariffWidget } from '@/components/TariffWidget'
import { DigDeeper } from '@/components/DigDeeper'
import { ShareButton } from '@/components/ShareButton'
import { MapSection } from '@/components/map/MapSection'
import { geocodeZip } from '@/lib/data/zip-coords'
import type { EconomicSnapshot } from '@/types'

type PageState = 'idle' | 'loading' | 'loaded' | 'error'

export default function Home() {
  const [state, setState] = useState<PageState>('idle')
  const [snapshot, setSnapshot] = useState<EconomicSnapshot | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [markerPosition, setMarkerPosition] = useState<[number, number] | undefined>()

  async function handleZipSubmit(zip: string) {
    setState('loading')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/data/${zip}`)
      if (res.status === 404) throw new Error('Zip code not found')
      if (!res.ok) throw new Error('Failed to load data')
      const data: EconomicSnapshot = await res.json()
      setSnapshot(data)
      setState('loaded')
      const coords = await geocodeZip(zip)
      if (coords) setMarkerPosition(coords)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  return (
    <main className="min-h-screen px-4 py-12 max-w-4xl mx-auto">
      {/* Hero */}
      <section className="text-center mb-12">
        <h1 className="text-5xl md:text-7xl text-white leading-none mb-4" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
          Enter your zip code.
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 mb-8" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
          See what changed in your town since January 2025.
        </p>
        <ZipInput onSubmit={handleZipSubmit} isLoading={state === 'loading'} />
      </section>

      {/* Results */}
      {(state === 'loading' || state === 'loaded') && (
        <section>
          {snapshot && state === 'loaded' && (
            <LocationBanner location={snapshot.location} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6" data-testid="stat-cards">
            {state === 'loading' ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : snapshot && (
              <>
                {snapshot.unemployment.data && (
                  <StatCard
                    label="Unemployment"
                    value={`${snapshot.unemployment.data.current}%`}
                    change={`${snapshot.unemployment.data.change > 0 ? '+' : ''}${snapshot.unemployment.data.change} pts`}
                    direction={snapshot.unemployment.data.change > 0 ? 'up' : 'down'}
                    sourceLabel="BLS LAUS"
                    sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    geoLevel="county-level"
                    isNegative
                  />
                )}
                {snapshot.cpi.data && (
                  <StatCard
                    label="Grocery Prices"
                    value={`+${snapshot.cpi.data.groceriesChange.toFixed(1)}%`}
                    change={`${snapshot.cpi.data.groceriesChange.toFixed(1)}%`}
                    direction={snapshot.cpi.data.groceriesChange > 0 ? 'up' : 'down'}
                    sourceLabel="BLS CPI"
                    sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    geoLevel="national"
                    isNegative
                  />
                )}
                {snapshot.federal.data && (
                  <StatCard
                    label="Federal $ Cut Locally"
                    value={`$${(snapshot.federal.data.amountCut / 1_000_000).toFixed(1)}M`}
                    change={`$${(snapshot.federal.data.amountCut / 1_000_000).toFixed(1)}M since Jan 20`}
                    direction="down"
                    sourceLabel="USASpending"
                    sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    geoLevel="county-level"
                    isNegative
                  />
                )}
              </>
            )}
          </div>
        </section>
      )}

      {state === 'loaded' && snapshot && (
        <>
          <ChartsSection snapshot={snapshot} />
          {snapshot.census.data && (
            <TariffWidget medianIncome={snapshot.census.data.medianIncome} />
          )}
          <DigDeeper snapshot={snapshot} />
          <ShareButton snapshot={snapshot} />
          <MapSection
            currentZip={snapshot.zip}
            markerPosition={markerPosition}
            onZipChange={handleZipSubmit}
          />
        </>
      )}

      {state === 'error' && (
        <div className="text-center mt-8">
          <p className="text-danger-red mb-4" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>{errorMsg}</p>
          <button
            onClick={() => setState('idle')}
            className="text-zinc-400 underline text-sm"
            style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
          >
            Try again
          </button>
        </div>
      )}
    </main>
  )
}
