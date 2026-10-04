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
import { BASELINE_MONTH_LONG } from '@/lib/baseline'
import { pagePath, parsePlaceQuery, type PlaceQuery } from '@/lib/share-url'
import type { EconomicSnapshot } from '@/types'

// d3-geo/topojson are ESM-only; load the map chunk only on the client, and only near the viewport
const NationalMap = dynamic(
  () => import('@/components/map/NationalMap').then(m => ({ default: m.NationalMap })),
  { ssr: false, loading: () => <MapPlaceholder /> }
)

function MapPlaceholder() {
  return <div className="mt-12 aspect-[975/610] bg-zinc-900 rounded-xl" />
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
    <main className="min-h-screen px-4 py-12 max-w-4xl mx-auto">
      {/* Hero */}
      <section className="text-center mb-12">
        <h1 className="text-5xl md:text-7xl text-white leading-none mb-4" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
          Enter your zip code
        </h1>
        <p className="text-lg md:text-xl text-zinc-400 mb-8" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
          See what changed in your town since {BASELINE_MONTH_LONG}.
        </p>
        <ZipInput onSubmit={handleZipSubmit} isLoading={state === 'loading'} />
        {state === 'idle' && <CityGrid onCitySelect={handleZipSubmit} />}
      </section>

      {/* Results */}
      {state === 'loading' && (
        <section aria-busy>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 mt-6" data-testid="stat-cards-loading">
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

      {/* One map instance for the whole session: stays mounted across zip changes */}
      <ErrorBoundary>
        <LazyMount placeholder={<MapPlaceholder />}>
          <NationalMap countyFips={loaded ? snapshot.location.countyFips : undefined} onZipSelect={selectFromMap} />
        </LazyMount>
      </ErrorBoundary>

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
