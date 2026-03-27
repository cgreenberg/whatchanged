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
import { CityGrid } from '@/components/CityGrid'
import type { EconomicSnapshot } from '@/types'

type PageState = 'idle' | 'loading' | 'loaded' | 'error'

export default function HomeContent() {
  const [state, setState] = useState<PageState>('idle')
  const [snapshot, setSnapshot] = useState<EconomicSnapshot | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [markerPosition, setMarkerPosition] = useState<[number, number] | undefined>()
  async function handleZipSubmit(zip: string, city?: string, state?: string) {
    setState('loading')
    setErrorMsg('')
    try {
      const url = city && state
        ? `/api/data/${zip}?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`
        : `/api/data/${zip}`
      const res = await fetch(url)
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
        {state === 'idle' && <CityGrid onCitySelect={handleZipSubmit} />}
      </section>


      {/* Results */}
      {(state === 'loading' || state === 'loaded') && (
        <section>
          {snapshot && state === 'loaded' && (
            <LocationBanner location={snapshot.location} />
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 mt-6" data-testid="stat-cards">
            {state === 'loading' ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : snapshot && (() => {
              const natGas = snapshot.gas.data?.nationalSeries
              const natGasPrice = natGas?.length ? natGas[natGas.length - 1].price : undefined
              const natGasBaseline = natGas?.find(p => p.date.startsWith('2025-01'))?.price
              const natGasDelta = natGasPrice != null && natGasBaseline != null ? natGasPrice - natGasBaseline : undefined

              const natCpi = snapshot.cpi.data?.nationalSeries

              // Find Jan 2025 baseline in national series (series may start from 2020)
              const natBaseline = natCpi?.find(p => p.date === '2025-01')
              const natLatest = natCpi?.length ? natCpi[natCpi.length - 1] : undefined

              let natShelterChange: number | undefined
              if (natBaseline && natLatest) {
                const first = natBaseline.shelter
                const last = natLatest.shelter
                if (first != null && last != null && first !== 0) {
                  natShelterChange = ((last - first) / first) * 100
                }
              }

              let natGroceriesChange: number | undefined
              if (natBaseline && natLatest) {
                const first = natBaseline.groceries
                const last = natLatest.groceries
                if (first != null && last != null && first !== 0) {
                  natGroceriesChange = ((last - first) / first) * 100
                }
              }

              return (
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
                      nationalValue={natGasPrice != null ? `National: $${natGasPrice.toFixed(2)}/gal${natGasDelta != null ? ` (${natGasDelta > 0 ? '+' : ''}$${natGasDelta.toFixed(2)})` : ''}` : undefined}
                    />
                  )}
                  {snapshot.cpi.data && (() => {
                    const shelterChange = snapshot.cpi.data!.shelterChange ?? 0
                    const medianRent = snapshot.census.data?.medianRent ?? 1271
                    const annualRent = medianRent * 12
                    const shelterDollarImpact = Math.round(annualRent * Math.abs(shelterChange) / 100)
                    return (
                      <StatCard
                        label="Housing Costs"
                        value={`${shelterChange > 0 ? '+' : ''}${shelterChange.toFixed(1)}%`}
                        change={`~$${shelterDollarImpact}/yr ${shelterChange >= 0 ? 'more' : 'less'} since Jan 2025`}
                        direction={shelterChange > 0 ? 'up' : 'down'}
                        sourceLabel="BLS CPI"
                        sourceDate={new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        geoLevel={snapshot.cpi.data?.metro === 'National' ? 'national' : `metro: ${snapshot.cpi.data?.metro}`}
                        isNegative
                        sourceUrl="https://data.bls.gov/cgi-bin/surveymost?cu"
                        accentColor="#3B82F6"
                        nationalValue={natShelterChange != null ? `National: ${natShelterChange > 0 ? '+' : ''}${natShelterChange.toFixed(1)}%` : undefined}
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
                        nationalValue={natGroceriesChange != null ? `National: ${natGroceriesChange > 0 ? '+' : ''}${natGroceriesChange.toFixed(1)}%` : undefined}
                      />
                    )
                  })()}
                  {snapshot.census.data && (() => {
                    const cost = estimateTariffCost(snapshot.census.data!.medianIncome)
                    const isCityLevel = snapshot.census.data?.isCityLevel
                    const cityName = snapshot.census.data?.cityName
                    return (
                      <StatCard
                        label="Tariff Impact"
                        value={`~${formatDollars(cost)}/yr`}
                        change={`based on ${formatDollars(snapshot.census.data!.medianIncome)} local income`}
                        direction="up"
                        sourceLabel="Yale Budget Lab"
                        sourceDate="2025 est."
                        geoLevel={isCityLevel && cityName ? `${cityName} city proper median income` : 'zip-level income'}
                        isNegative
                        sourceUrl="https://budgetlab.yale.edu/research/where-we-stand-fiscal-economic-and-distributional-effects-all-us-tariffs"
                        accentColor="#A855F7"
                      />
                    )
                  })()}
                </>
              )
            })()}
          </div>

          {/* Primary share buttons — above charts */}
          {state === 'loaded' && snapshot && (
            <ShareButton snapshot={snapshot} />
          )}
        </section>
      )}

      {state === 'loaded' && snapshot && (
        <>
          <ErrorBoundary>
            <ChartsSection snapshot={snapshot} />
          </ErrorBoundary>
          {/* <DigDeeper snapshot={snapshot} /> */}
          <ShareButton snapshot={snapshot} />
          <CityGrid onCitySelect={handleZipSubmit} />
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
      <footer className="mt-16 mb-4 text-center text-sm" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
        <Link
          href="/about"
          className="text-[#888] hover:text-white hover:underline transition-colors"
        >
          About the Data
        </Link>
        <span className="text-[#888] mx-2">·</span>
        <a
          href="https://github.com/cgreenberg/whatchanged"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#888] hover:text-white hover:underline transition-colors"
        >
          View on GitHub
        </a>
        <span className="text-[#888] mx-2">·</span>
        <a
          href="https://github.com/cgreenberg/whatchanged/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#888] hover:text-white hover:underline transition-colors"
        >
          Report an Issue
        </a>
      </footer>
    </main>
  )
}
