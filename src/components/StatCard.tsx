'use client'

import { useId, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Provenance } from '@/lib/provenance'
import { ProvenanceLine } from '@/components/ProvenanceLine'

export interface StatCardProps {
  testId?: string
  label: string
  /** Big number, e.g. "+3.1%". Ignored when `unavailable`. */
  value?: string
  /** Short dollar translation beside the big number, e.g. "≈ +$87/mo". */
  inline?: string
  /** Gas: the $ change since the baseline, under the big number. */
  change?: string
  direction?: 'up' | 'down' | 'neutral'
  /** The one short secondary line (window / national comparison / basis). */
  secondary?: string
  /** Short "{area} · {source} · {Mon YYYY}" line. */
  sourceLine: string
  /** Short caveat tags, e.g. "⚠ unusual". */
  tags?: string[]
  /** Lines shown in the ⓘ disclosure, above the full provenance line(s). */
  info?: string[]
  provenance: Provenance
  moreProvenance?: Provenance[]
  accentColor?: string
  stale?: boolean
  unavailable?: boolean
}

/**
 * Compact hero card: big number (+ inline $), at most one short secondary line and a short source line.
 * Everything else (full provenance, adjustments, caveat explanations, bases) is one tap away in the
 * ⓘ disclosure: a real button with aria-expanded / aria-controls, keyboard and touch friendly; Escape closes it.
 */
export function StatCard({
  testId, label, value, inline, change, direction = 'neutral', secondary, sourceLine, tags, info = [],
  provenance, moreProvenance = [], accentColor, stale, unavailable,
}: StatCardProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inter = { fontFamily: 'var(--font-inter, sans-serif)' }
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-5 flex flex-col gap-1.5 min-w-0"
      data-testid={testId}
      data-status={unavailable ? 'unavailable' : 'ok'}
      data-direction={unavailable ? undefined : direction}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest pt-1" style={inter}>
          {label}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {stale && !unavailable && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide text-amber-300 border border-amber-300/40 rounded px-1.5 py-0.5"
              title="The source hasn't updated recently or the latest refresh failed; showing the last good data."
              data-testid="stale-badge"
            >
              Stale
            </span>
          )}
          <button
            ref={buttonRef}
            type="button"
            className={`-mr-1.5 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-base leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${open ? 'text-white bg-zinc-800' : 'text-zinc-500 hover:text-zinc-200'}`}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? 'Hide' : 'Show'} sources and details for ${label}`}
            onClick={() => setOpen(o => !o)}
            data-testid="stat-info-toggle"
          >
            <span aria-hidden="true">ⓘ</span>
          </button>
        </div>
      </div>
      {unavailable ? (
        <p className="text-lg sm:text-xl text-zinc-500 leading-tight" data-testid="stat-value">Data unavailable</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-2xl sm:text-4xl leading-none" style={{ fontFamily: 'var(--font-bebas, sans-serif)', color: accentColor ?? 'white' }} data-testid="stat-value">
              {value}
            </p>
            {inline && (
              <p className="text-xs sm:text-sm font-semibold" style={{ ...inter, color: accentColor ?? '#F59E0B' }} data-testid="stat-inline">
                {inline}
              </p>
            )}
          </div>
          {change && (
            <p className="text-xs sm:text-sm font-medium" style={{ ...inter, color: accentColor ?? '#F59E0B' }} data-testid="stat-change">
              {change}
            </p>
          )}
          {(secondary || !!tags?.length) && (
            <p className="text-xs text-zinc-300" style={inter} data-testid="stat-secondary">
              {secondary}
              {tags?.map(t => (
                <span key={t} className="ml-1.5 whitespace-nowrap text-[11px] font-semibold text-amber-300" data-testid="stat-tag">{t}</span>
              ))}
            </p>
          )}
        </>
      )}
      <p className="mt-auto pt-1.5 text-[11px] text-zinc-500" style={inter} data-testid="stat-source">{sourceLine}</p>
      <div
        id={panelId}
        hidden={!open}
        className="mt-1 border-t border-zinc-800 pt-2 space-y-1.5 text-[11px] leading-snug text-zinc-400"
        style={inter}
        data-testid="stat-info"
      >
        {info.map((line, i) => <p key={i} data-testid="stat-info-line">{line}</p>)}
        <ProvenanceLine provenance={provenance} />
        {moreProvenance.map((p, i) => <ProvenanceLine key={i} provenance={p} />)}
      </div>
    </motion.div>
  )
}
