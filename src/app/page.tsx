'use client'
import { useState, useEffect } from 'react'
import { ZipInput } from '@/components/ZipInput'
import { LocationBanner } from '@/components/LocationBanner'
import { StatCard } from '@/components/StatCard'
import { StatCardSkeleton } from '@/components/StatCardSkeleton'
import { ChartsSection } from '@/components/charts/ChartsSection'
import { TariffWidget } from '@/components/TariffWidget'
import { DigDeeper } from '@/components/DigDeeper'
import { ShareButton } from '@/components/ShareButton'
import { MapSection } from '@/components/map/MapSection'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
      window.history.replaceState({}, '', `/?zip=${zip}`)
      const coords = await geocodeZip(zip)
      if (coords) setMarkerPosition(coords)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const zip = params.get('zip')
    if (zip && /^\d{5}$/.test(zip)) {
      handleZipSubmit(zip)
    }
  }, [])

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
                {snapshot.gas.data && (
                  <StatCard
                    label="Gas Prices"
                    value={`$${snapshot.gas.data.current.toFixed(2)}/gal`}
                    change={`${snapshot.gas.data.change > 0 ? '+' : ''}$${snapshot.gas.data.change.toFixed(2)} since Jan 2025`}
                    direction={snapshot.gas.data.change > 0 ? 'up' : 'down'}
                    sourceLabel="EIA"
                    sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    geoLevel="state-level"
                    isNegative
                    sourceUrl="https://www.eia.gov/petroleum/gasdiesel/"
                  />
                )}
                {snapshot.cpi.data && (
                  <StatCard
                    label="Grocery Prices"
                    value={`${snapshot.cpi.data.groceriesChange > 0 ? '+' : ''}${snapshot.cpi.data.groceriesChange.toFixed(1)}%`}
                    change={`${snapshot.cpi.data.groceriesChange.toFixed(1)}% since Jan 2025`}
                    direction={snapshot.cpi.data.groceriesChange > 0 ? 'up' : 'down'}
                    sourceLabel="BLS CPI"
                    sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    geoLevel={snapshot.cpi.data?.metro === 'National' ? 'national' : `metro: ${snapshot.cpi.data?.metro}`}
                    isNegative
                    sourceUrl="https://data.bls.gov/cgi-bin/surveymost?cu"
                  />
                )}
                {snapshot.unemployment.data && (
                  <StatCard
                    label="Unemployment"
                    value={`${snapshot.unemployment.data.current}%`}
                    change={`${snapshot.unemployment.data.change > 0 ? '+' : ''}${snapshot.unemployment.data.change} pts since Jan 2025`}
                    direction={snapshot.unemployment.data.change > 0 ? 'up' : 'down'}
                    sourceLabel="BLS LAUS"
                    sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    geoLevel="county-level"
                    isNegative
                    sourceUrl={`https://data.bls.gov/timeseries/LAUCN${snapshot.location.countyFips.padStart(5, '0')}0000000003`}
                  />
                )}
              </>
            )}
          </div>
        </section>
      )}

      {state === 'loaded' && snapshot && (
        <>
          <ErrorBoundary>
            <ChartsSection snapshot={snapshot} />
          </ErrorBoundary>
          {snapshot.census.data && (
            <TariffWidget medianIncome={snapshot.census.data.medianIncome} />
          )}
          <DigDeeper snapshot={snapshot} />
          <ShareButton snapshot={snapshot} />
          <ErrorBoundary>
            <MapSection
              currentZip={snapshot.zip}
              markerPosition={markerPosition}
              onZipChange={handleZipSubmit}
            />
          </ErrorBoundary>
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
