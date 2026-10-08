'use client'
import { motion } from 'framer-motion'
import type { ZipInfo } from '@/types'
import { BASELINE_DAY_LABEL } from '@/lib/baseline'

/** Dateline over the results: kicker, place name as the headline, county + zip as the deck. */
export function LocationBanner({ location }: { location: ZipInfo }) {
  const place = location.cityName ? `${location.cityName}, ${location.stateAbbr}` : `${location.countyName}, ${location.stateAbbr}`
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="pt-6 pb-1 border-t border-line"
      data-testid="location-banner"
    >
      <p className="kicker text-ink-3">What changed since {BASELINE_DAY_LABEL}</p>
      <h2 className="mt-1.5 font-display font-semibold text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        {place}
      </h2>
      <p className="mt-1.5 text-sm text-ink-2">
        {location.cityName ? location.countyName : null}
        {location.cityName && location.zip ? <span className="text-ink-3"> · </span> : null}
        {location.zip ? <span className="tnum font-mono text-ink-3">{location.zip}</span> : null}
      </p>
    </motion.div>
  )
}
