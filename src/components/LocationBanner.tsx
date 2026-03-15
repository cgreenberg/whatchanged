'use client'
import { motion } from 'framer-motion'
import type { ZipInfo } from '@/types'

export function LocationBanner({ location }: { location: ZipInfo }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-4"
    >
      <p className="text-lg text-zinc-300" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
        📍 {location.cityName || location.countyName}, {location.stateAbbr} — {location.countyName}
      </p>
    </motion.div>
  )
}
