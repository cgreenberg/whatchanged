import type { Metadata } from 'next'
import { fetchSnapshot } from '@/lib/api/snapshot'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'
import HomeContent from '@/components/HomeContent'

type Props = {
  searchParams: Promise<{ zip?: string }>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { zip } = await searchParams

  if (!zip || !/^\d{5}$/.test(zip)) {
    return {
      title: 'What Changed in Your Town Since January 2025?',
      description: 'Enter your zip code. See what changed.',
      openGraph: {
        type: 'website',
        siteName: 'WhatChanged.us',
        title: 'What Changed in Your Town Since January 2025?',
        description: 'Enter your zip code. See what changed.',
        images: [{ url: '/api/og', width: 1200, height: 630 }],
      },
      twitter: { card: 'summary_large_image', site: '@whatchangedus' },
    }
  }

  const snapshot = await fetchSnapshot(zip)
  if (!snapshot) {
    return {
      title: 'What Changed in Your Town Since January 2025?',
      description: 'Enter your zip code. See what changed.',
    }
  }

  const cityName = snapshot.location.cityName || snapshot.location.countyName
  const state = snapshot.location.stateAbbr
  const title = `What Changed in ${cityName}, ${state} (${zip})?`
  const ogTitle = `What changed in ${cityName}, ${state} since Jan. 20, 2025?`

  const vParam = new Date().toISOString().slice(0, 7)
  const ogImageUrl = `/api/og?zip=${zip}&v=${vParam}`

  const parts: string[] = []
  if (snapshot.gas.data) {
    parts.push(`Gas: ${snapshot.gas.data.change > 0 ? '+' : ''}$${snapshot.gas.data.change.toFixed(2)}/gal`)
  }
  if (snapshot.cpi.data) {
    parts.push(`Groceries: ${snapshot.cpi.data.groceriesChange > 0 ? '+' : ''}${snapshot.cpi.data.groceriesChange.toFixed(1)}%`)
  }
  if (snapshot.cpi.data?.shelterChange !== undefined) {
    parts.push(`Shelter: ${snapshot.cpi.data.shelterChange > 0 ? '+' : ''}${snapshot.cpi.data.shelterChange.toFixed(1)}%`)
  }
  if (snapshot.census.data) {
    const cost = estimateTariffCost(snapshot.census.data.medianIncome)
    parts.push(`Tariff cost ~${formatDollars(cost)}/yr`)
  }
  parts.push('Check your zip at whatchanged.us')
  const description = parts.join(' · ')

  return {
    title,
    openGraph: {
      type: 'website',
      siteName: 'WhatChanged.us',
      title: ogTitle,
      description,
      url: `https://whatchanged.us/?zip=${zip}`,
      images: [{
        url: ogImageUrl,
        width: 1200,
        height: 630,
        type: 'image/png',
      }],
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
