import type { Metadata } from 'next'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { cityContainsZip } from '@/lib/data/census-acs'
import HomeContent from '@/components/HomeContent'
import { metadataDescription } from '@/lib/hero-cards'
import { BASELINE_MONTH_LONG, BASELINE_DAY_LABEL } from '@/lib/baseline'
import { firstParam, ogImagePath, pageUrl, type PlaceQuery } from '@/lib/share-url'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const GENERIC_TITLE = `What Changed in Your Town Since ${BASELINE_MONTH_LONG}?`
const GENERIC_DESCRIPTION = 'Enter your zip code. See what changed.'

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  // Repeated params (?city=a&city=b) arrive as arrays: use the first value.
  const sp = await searchParams
  const zip = firstParam(sp.zip)
  const city = firstParam(sp.city)
  const state = firstParam(sp.state)

  if (!zip || !/^\d{5}$/.test(zip)) {
    return {
      title: GENERIC_TITLE,
      description: GENERIC_DESCRIPTION,
      openGraph: {
        type: 'website',
        siteName: 'WhatChanged.us',
        title: GENERIC_TITLE,
        description: GENERIC_DESCRIPTION,
        images: [{ url: '/api/og', width: 1200, height: 630 }],
      },
      twitter: { card: 'summary_large_image', site: '@whatchangedus' },
    }
  }

  const requested: PlaceQuery = city && state ? { zip, city: city.slice(0, 100), state: state.slice(0, 2) } : { zip }
  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return { title: GENERIC_TITLE, description: GENERIC_DESCRIPTION }
  }

  // Echo city/state into og:url and the OG image only when they're validated against the zip
  const place: PlaceQuery = requested.city && requested.state && cityContainsZip(zip, requested.city, requested.state)
    ? requested
    : { zip }
  const cityName = snapshot.location.cityName || snapshot.location.countyName
  const stateAbbr = snapshot.location.stateAbbr
  const title = `What Changed in ${cityName}, ${stateAbbr} (${zip})?`
  const ogTitle = `What changed in ${cityName}, ${stateAbbr} since ${BASELINE_DAY_LABEL}?`
  // `v` only busts social-crawler caches (monthly); it is never displayed
  const ogImageUrl = ogImagePath(place, new Date().toISOString().slice(0, 7))
  const description = metadataDescription(snapshot)

  return {
    title,
    openGraph: {
      type: 'website',
      siteName: 'WhatChanged.us',
      title: ogTitle,
      description,
      url: pageUrl(place),
      images: [{ url: ogImageUrl, width: 1200, height: 630, type: 'image/png' }],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@whatchangedus',
      title: ogTitle,
      description,
      images: [ogImageUrl],
    },
  }
}

export default function Home() {
  return <HomeContent />
}
