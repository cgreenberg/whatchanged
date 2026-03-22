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
        title: 'What Changed in Your Town Since January 2025?',
        description: 'Enter your zip code. See what changed.',
        images: [{ url: '/api/og', width: 1200, height: 630 }],
      },
      twitter: { card: 'summary_large_image' },
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

  // Build description from available data
  const parts: string[] = []
  if (snapshot.cpi.data) {
    parts.push(`Groceries: ${snapshot.cpi.data.groceriesChange > 0 ? '+' : ''}${snapshot.cpi.data.groceriesChange.toFixed(1)}%`)
  }
  if (snapshot.cpi.data?.shelterChange !== undefined) {
    parts.push(`Shelter: ${snapshot.cpi.data.shelterChange > 0 ? '+' : ''}${snapshot.cpi.data.shelterChange.toFixed(1)}%`)
  }
  if (snapshot.census.data) {
    const cost = estimateTariffCost(snapshot.census.data.medianIncome)
    parts.push(`Tariff impact: ~${formatDollars(cost)}/yr`)
  }
  if (snapshot.federal.data) {
    const amt = snapshot.federal.data.amountCut
    const formatted = amt >= 1_000_000_000
      ? `$${(amt / 1_000_000_000).toFixed(1)}B`
      : `$${(amt / 1_000_000).toFixed(0)}M`
    parts.push(`${formatted} in federal funding cut`)
  }
  parts.push('Enter your zip to see your town.')
  const description = parts.join(' · ')

  const ogTitle = `What Changed in ${cityName}, ${state} Since January 2025?`

  return {
    title,
    openGraph: {
      type: 'website',
      title: ogTitle,
      description,
      url: `https://whatchanged.us/?zip=${zip}`,
      images: [{ url: `/api/og?zip=${zip}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      images: [`/api/og?zip=${zip}`],
    },
  }
}

export default function Home() {
  return <HomeContent />
}
