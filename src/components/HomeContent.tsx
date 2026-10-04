'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ZipInput } from '@/components/ZipInput'
import { LocationBanner } from '@/components/LocationBanner'
import { StatCardSkeleton } from '@/components/StatCardSkeleton'
import { HeroCards } from '@/components/HeroCards'
import { ChartsSection } from '@/components/charts/ChartsSection'
import { ShareButton } from '@/components/ShareButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { CityGrid } from '@/components/CityGrid'
import { LazyMount } from '@/components/LazyMount'
import { BASELINE_MONTH_LONG, BASELINE_DAY_LABEL } from '@/lib/baseline'
import { pagePath, parsePlaceQuery, type PlaceQuery } from '@/lib/share-url'
import type { EconomicSnapshot } from '@/types'
import { zipPanelOverrides } from '@/lib/county-data'

// d3-geo/topojson are ESM-only; load the map chunk only on the client, and only near the viewport
const NationalMap = dynamic(
  () => import('@/components/map/NationalMap').then(m => ({ default: m.NationalMap })),
  { ssr: false, loading: () => <MapPlaceholder /> }
)

function MapPlaceholder() {
  return <div className="mt-16 aspect-[975/610] bg-surface rounded-md" />
}

type PageState = 'idle' | 'loading' | 'loaded' | 'error'

export default function HomeContent() {
  const [state, setState] = useState<PageState>('idle')
  const [snapshot, setSnapshot] = useState<EconomicSnapshot | null>(null)
  const [place, setPlace] = useState<PlaceQuery | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  // Only the latest request may update state: older responses/errors are dropped and aborted.
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const handleZipSubmit = useCallback(async (zip: string, city?: string, stateAbbr?: string) => {
    const id = ++requestId.current
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const q: PlaceQuery = city && stateAbbr ? { zip, city, state: stateAbbr } : { zip }
    setState('loading')
    setErrorMsg('')
    try {
      // The city/state only name the place in the page URL; the data comes from the zip alone
      const res = await fetch(`/api/data/${zip}`, { signal: ctrl.signal })
      if (res.status === 404) throw new Error('Zip code not found')
      if (!res.ok) throw new Error('Failed to load data')
      const data: EconomicSnapshot = await res.json()
      if (id !== requestId.current) return
      setSnapshot(data)
      setPlace(q)
      setState('loaded')
      window.history.replaceState({}, '', pagePath(q))
    } catch (err) {
      if (id !== requestId.current) return
      if (err instanceof Error && err.name === 'AbortError') return
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }, [])

  const selectFromMap = useCallback((zip: string) => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    handleZipSubmit(zip)
  }, [handleZipSubmit])

  useEffect(() => {
    const q = parsePlaceQuery(window.location.search)
    if (q) handleZipSubmit(q.zip, q.city ?? undefined, q.state ?? undefined)
    return () => abortRef.current?.abort()
  }, [handleZipSubmit])

  const loaded = state === 'loaded' && snapshot

  return (
    <>
    {/* Masthead: quiet wordmark + standing dateline */}
    <header className="border-b border-line">
      <div className="max-w-[70rem] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">
        {/* Full reload on purpose: resets the page to its idle state */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="font-display font-semibold text-ink text-lg tracking-tight leading-none">
          What Changed<span className="text-ink-3">.us</span>
        </a>
        <p className="kicker text-ink-3 hidden sm:block">Local prices since {BASELINE_DAY_LABEL}</p>
      </div>
    </header>
    <main className="min-h-screen px-4 sm:px-6 pt-10 sm:pt-14 pb-12 max-w-[70rem] mx-auto">
      {/* Hero */}
      <section className="text-center mb-10 sm:mb-12">
        <p className="kicker text-ink-3 mb-3">Public data · BLS · EIA · Zillow · Census</p>
        <h1 className="font-display font-semibold text-5xl md:text-7xl text-ink leading-[0.95] tracking-tight mb-4">
          Enter your zip code
        </h1>
        <p className="text-base md:text-lg text-ink-2 mb-8 max-w-xl mx-auto">
          See what changed in your town since {BASELINE_MONTH_LONG}.
        </p>
        <ZipInput onSubmit={handleZipSubmit} isLoading={state === 'loading'} />
        {state === 'idle' && <CityGrid onCitySelect={handleZipSubmit} />}
      </section>

      {/* Results */}
      {state === 'loading' && (
        <section aria-busy>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 mt-6" data-testid="stat-cards-loading">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        </section>
      )}

      {loaded && (
        <>
          <section>
            <LocationBanner location={snapshot.location} />
            <HeroCards snapshot={snapshot} />
            <ShareButton snapshot={snapshot} place={place} />
          </section>
          <ErrorBoundary>
            <ChartsSection snapshot={snapshot} />
          </ErrorBoundary>
          <ShareButton snapshot={snapshot} place={place} />
          <CityGrid onCitySelect={handleZipSubmit} />
        </>
      )}

      {state === 'error' && (
        <div className="text-center mt-8">
          <p className="text-groceries mb-4">{errorMsg}</p>
          <button
            onClick={() => setState('idle')}
            className="text-ink-2 underline underline-offset-4 text-sm hover:text-ink"
          >
            Try again
          </button>
        </div>
      )}

      {/* One map instance for the whole session: stays mounted across zip changes */}
      <ErrorBoundary>
        <LazyMount placeholder={<MapPlaceholder />}>
          <NationalMap countyFips={loaded ? snapshot.location.countyFips : undefined} onZipSelect={selectFromMap} zipOverrides={loaded ? zipPanelOverrides(snapshot) : undefined} />
        </LazyMount>
      </ErrorBoundary>

      {/* Footer */}
      <footer className="mt-16 pt-5 border-t border-line flex flex-wrap items-center justify-center gap-x-5 gap-y-2 kicker">
        <Link href="/about" className="text-ink-3 hover:text-ink transition-colors">
          About the data
        </Link>
        <a
          href="https://github.com/cgreenberg/whatchanged"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink-3 hover:text-ink transition-colors"
        >
          View on GitHub
        </a>
        <a
          href="https://github.com/cgreenberg/whatchanged/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink-3 hover:text-ink transition-colors"
        >
          Report an issue
        </a>
      </footer>
    </main>
    </>
  )
}
