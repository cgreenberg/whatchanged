'use client'

import { motion } from 'framer-motion'

interface StatCardProps {
  label: string
  value: string          // formatted display value e.g. "5.0%"
  change: string         // formatted change e.g. "+0.9 pts" or "+14%"
  direction: 'up' | 'down' | 'neutral'
  sourceLabel: string    // e.g. "BLS LAUS"
  sourceDate: string     // e.g. "Feb 2025"
  geoLevel: string       // e.g. "county-level"
  isNegative?: boolean   // true = up is bad (unemployment, prices)
  sourceUrl?: string
}

export function StatCard({
  label, value, change, direction, sourceLabel, sourceDate, geoLevel, isNegative, sourceUrl
}: StatCardProps) {
  const isWorrying = isNegative && direction === 'up'
  const changeColor = isWorrying ? 'text-danger-red' : 'text-electric-amber'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-2"
    >
      <p className="text-xs font-medium text-muted uppercase tracking-widest" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>{label}</p>
      <p className="text-4xl text-white leading-none" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>{value}</p>
      <p className={`text-sm font-medium ${changeColor}`} style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
        {direction === 'up' ? '↑' : direction === 'down' ? '↓' : ''} {change}
      </p>
      <p className="text-xs text-zinc-500 mt-auto pt-2 border-t border-zinc-800">
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
            {sourceLabel}
          </a>
        ) : sourceLabel} · {sourceDate} · {geoLevel}
      </p>
    </motion.div>
  )
}
