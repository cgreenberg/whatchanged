'use client'

import { useId, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Provenance } from '@/lib/provenance'
import { ProvenanceLine } from '@/components/ProvenanceLine'
import { SourceTrace } from '@/components/SourceTrace'
import type { TraceStep } from '@/lib/resolution/types'

export interface StatCardProps {
  testId?: string
  label: string
  /** Big number, e.g. "+3.1%". Ignored when `unavailable`. */
  value?: string
  /** Small qualifier right after the big number, e.g. "avg, last 12 mo". */
  valueNote?: string
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
  /** How the number's source was picked (ladder trace): "Where does this come from?" in the ⓘ panel. */
  trace?: TraceStep[]
}

/**
 * Compact hero card: big number (+ inline $), at most one short secondary line and a short source line.
 * Everything else (full provenance, adjustments, caveat explanations, bases) is one tap away in the
 * ⓘ disclosure: a real button with aria-expanded / aria-controls, keyboard and touch friendly; Escape closes it.
 */
export function StatCard({
  testId, label, value, valueNote, inline, change, direction = 'neutral', secondary, sourceLine, tags, info = [],
  provenance, moreProvenance = [], accentColor, stale, unavailable, trace,
}: StatCardProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const accent = accentColor ?? '#F1EFEA'
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative bg-surface border border-line rounded-md px-3 pt-3 pb-2.5 sm:px-4 sm:pt-4 sm:pb-3 flex flex-col gap-1.5 min-w-0 overflow-hidden"
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
      {/* Metric key: the same accent as this metric's graph line */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ background: unavailable ? '#2A2F36' : accent }} />
      <div className="flex items-start justify-between gap-1.5">
        <p className="kicker text-ink-2 pt-1.5">
          {label}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {stale && !unavailable && (
            <span
              className="kicker !text-[10px] text-caution border border-caution/40 rounded-sm px-1.5 py-0.5"
              title="The source hasn't updated recently or the latest refresh failed; showing the last good data."
              data-testid="stale-badge"
            >
              Stale
            </span>
          )}
          <button
            ref={buttonRef}
            type="button"
            className={`-mr-1.5 -mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[15px] leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-2 ${open ? 'text-ink bg-line' : 'text-ink-3 hover:text-ink'}`}
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
        <p className="font-display font-medium text-xl sm:text-2xl text-ink-3 leading-tight mt-1" data-testid="stat-value">Data unavailable</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-0.5">
            <p className="tnum font-display font-semibold text-[32px] sm:text-[44px] leading-[0.9] tracking-tight text-ink" data-testid="stat-value">
              {value}
            </p>
            {valueNote && (
              <p className="text-[11px] sm:text-xs text-ink-3 leading-none" data-testid="stat-value-note">{valueNote}</p>
            )}
            {/* Signed values in neutral ink: color would imply good/bad (accents stay on bars/lines/the top bar) */}
            {inline && (
              <p className="tnum text-[13px] sm:text-[15px] font-semibold text-ink" data-testid="stat-inline">
                {inline}
              </p>
            )}
          </div>
          {change && (
            <p className="tnum text-[13px] sm:text-[15px] font-semibold text-ink" data-testid="stat-change">
              {change}
            </p>
          )}
          {(secondary || !!tags?.length) && (
            <p className="tnum text-xs sm:text-[13px] leading-snug text-ink-2" data-testid="stat-secondary">
              {secondary}
              {tags?.map(t => (
                <span key={t} className="ml-1.5 whitespace-nowrap text-[11px] font-semibold text-caution" data-testid="stat-tag">{t}</span>
              ))}
            </p>
          )}
        </>
      )}
      <p className="mt-auto pt-2 border-t border-line/70 font-mono text-[10.5px] leading-snug text-ink-3" data-testid="stat-source">{sourceLine}</p>
      <div
        id={panelId}
        hidden={!open}
        className="mt-0.5 pt-2 border-t border-line space-y-1.5 text-[11.5px] leading-snug text-ink-2"
        data-testid="stat-info"
      >
        {info.map((line, i) => <p key={i} data-testid="stat-info-line">{line}</p>)}
        <ProvenanceLine provenance={provenance} />
        {moreProvenance.map((p, i) => <ProvenanceLine key={i} provenance={p} />)}
        <SourceTrace steps={trace} subject={label.toLowerCase()} className="pt-0.5" />
      </div>
    </motion.div>
  )
}
