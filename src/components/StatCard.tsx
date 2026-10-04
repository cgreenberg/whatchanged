'use client'

import { motion } from 'framer-motion'
import type { Provenance } from '@/lib/provenance'
import { ProvenanceLine } from '@/components/ProvenanceLine'

export interface StatCardProps {
  testId?: string
  label: string
  /** Formatted display value, e.g. "+3.1%". Ignored when `unavailable`. */
  value?: string
  change?: string
  direction?: 'up' | 'down' | 'neutral'
  detail?: string
  /** Amber caveat line, e.g. an outlier flag or documented data note. */
  caveat?: string
  nationalValue?: string
  provenance: Provenance
  accentColor?: string
  stale?: boolean
  unavailable?: boolean
}

export function StatCard({
  testId, label, value, change, direction = 'neutral', detail, caveat, nationalValue, provenance, accentColor, stale, unavailable,
}: StatCardProps) {
  const arrow = direction === 'up' ? '↑ ' : direction === 'down' ? '↓ ' : ''
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-5 flex flex-col gap-2 min-w-0"
      data-testid={testId}
      data-status={unavailable ? 'unavailable' : 'ok'}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest" style={{ fontFamily: 'var(--font-inter, sans-serif)' }}>
          {label}
        </p>
        {stale && !unavailable && (
          <span
            className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-300 border border-amber-300/40 rounded px-1.5 py-0.5"
            title="The source hasn't updated recently or the latest refresh failed; showing the last good data."
            data-testid="stale-badge"
          >
            Stale
          </span>
        )}
      </div>
      {unavailable ? (
        <p className="text-lg sm:text-xl text-zinc-500 leading-tight" data-testid="stat-value">Data unavailable</p>
      ) : (
        <>
          <p className="text-2xl sm:text-4xl leading-none" style={{ fontFamily: 'var(--font-bebas, sans-serif)', color: accentColor ?? 'white' }} data-testid="stat-value">
            {value}
          </p>
          {change && (
            <p className="text-xs sm:text-sm font-medium" style={{ fontFamily: 'var(--font-inter, sans-serif)', color: accentColor ?? '#F59E0B' }} data-testid="stat-change">
              {arrow}{change}
            </p>
          )}
          {detail && <p className="text-[11px] text-zinc-400" data-testid="stat-detail">{detail}</p>}
          {caveat && <p className="text-[11px] text-amber-300/80" data-testid="stat-caveat">{caveat}</p>}
          {nationalValue && (
            <p className="text-xs font-semibold text-zinc-300" style={{ fontFamily: 'var(--font-inter, sans-serif)' }} data-testid="stat-national">
              {nationalValue}
            </p>
          )}
        </>
      )}
      <ProvenanceLine provenance={provenance} className="mt-auto pt-2 border-t border-zinc-800" />
    </motion.div>
  )
}
