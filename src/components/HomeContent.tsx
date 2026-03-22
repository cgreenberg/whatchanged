'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ZipInput } from '@/components/ZipInput'
import { LocationBanner } from '@/components/LocationBanner'
import { StatCard } from '@/components/StatCard'
import { StatCardSkeleton } from '@/components/StatCardSkeleton'
import { ChartsSection } from '@/components/charts/ChartsSection'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'
import { ShareButton } from '@/components/ShareButton'
import { MapSection } from '@/components/map/MapSection'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { geocodeZip } from '@/lib/data/zip-coords'
import type { EconomicSnapshot } from '@/types'

type PageState = 'idle' | 'loading' | 'loaded' | 'error'

export default function HomeContent() {
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
          Enter your zip code
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6" data-testid="stat-cards">
            {state === 'loading' ? (
              <>
                <StatCardSkeleton />
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
                    geoLevel={`${snapshot.gas.data.geoLevel ?? 'state-level'}${snapshot.gas.data.isNationalFallback ? ' (state data unavailable)' : ''}`}
                    isNegative
                    sourceUrl="https://www.eia.gov/petroleum/gasdiesel/"
                    accentColor="#F59E0B"
                  />
                )}
                {snapshot.census.data && (() => {
                  const cost = estimateTariffCost(snapshot.census.data!.medianIncome)
                  return (
                    <StatCard
                      label="Tariff Impact"
                      value={`~${formatDollars(cost)}/yr`}
                      change={`based on ${formatDollars(snapshot.census.data!.medianIncome)} local income`}
                      direction="up"
                      sourceLabel="Yale Budget Lab"
                      sourceDate="2025 est."
                      geoLevel="zip-level income"
                      isNegative
                      sourceUrl="https://budgetlab.yale.edu/research/where-we-stand-fiscal-economic-and-distributional-effects-all-us-tariffs"
                      accentColor="#A855F7"
                    />
                  )
                })()}
                {snapshot.cpi.data && (() => {
                  const shelterChange = snapshot.cpi.data!.shelterChange ?? 0
                  return (
                    <StatCard
                      label="Housing Costs"
                      value={`${shelterChange > 0 ? '+' : ''}${shelterChange.toFixed(1)}%`}
                      change="since Jan 2025"
                      direction={shelterChange > 0 ? 'up' : 'down'}
                      sourceLabel="BLS CPI"
                      sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      geoLevel={snapshot.cpi.data?.metro === 'National' ? 'national' : `metro: ${snapshot.cpi.data?.metro}`}
                      isNegative
                      sourceUrl="https://data.bls.gov/cgi-bin/surveymost?cu"
                      accentColor="#3B82F6"
                    />
                  )
                })()}
                {snapshot.cpi.data && (() => {
                  const pctChange = snapshot.cpi.data.groceriesChange
                  const localIncome = snapshot.census.data?.medianIncome ?? 74580
                  const grocerySpend = 6000 * (localIncome / 74580)
                  const dollarImpact = Math.round(grocerySpend * Math.abs(pctChange) / 100)
                  return (
                    <StatCard
                      label="Grocery Prices"
                      value={`${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`}
                      change={`~$${dollarImpact}/yr ${pctChange >= 0 ? 'more' : 'less'} since Jan 2025`}
                      direction={pctChange > 0 ? 'up' : 'down'}
                      sourceLabel="BLS CPI"
                      sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      geoLevel={snapshot.cpi.data?.metro === 'National' ? 'national' : `metro: ${snapshot.cpi.data?.metro}`}
                      isNegative
                      sourceUrl="https://data.bls.gov/cgi-bin/surveymost?cu"
                      accentColor="#EF4444"
                    />
                  )
                })()}
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
          {/* <DigDeeper snapshot={snapshot} /> */}
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

      {/* Footer */}
      <footer className="mt-16 mb-4 text-center">
        <Link
          href="/about"
          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          About the data
        </Link>
      </footer>
    </main>
  )
}
