'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { TraceStatus, TraceStep } from '@/lib/resolution/types'
import { fmtDay, fmtMonthYear } from '@/lib/format'

const ICONS: Record<TraceStatus, { icon: string; className: string; text: string }> = {
  used: { icon: '✓', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/50', text: 'Used' },
  stale: { icon: '⚠', className: 'bg-amber-500/15 text-amber-300 border-amber-400/50', text: 'Used, but out of date' },
  unavailable: { icon: '✗', className: 'bg-zinc-800 text-rose-300 border-zinc-600', text: 'Unavailable' },
  invalid: { icon: '✗', className: 'bg-zinc-800 text-rose-300 border-zinc-600', text: 'Failed our checks' },
  'over-budget': { icon: '✗', className: 'bg-zinc-800 text-rose-300 border-zinc-600', text: 'Not fetched' },
  'not-applicable': { icon: '✗', className: 'bg-zinc-800 text-zinc-400 border-zinc-700', text: 'No series here' },
  'not-needed': { icon: '–', className: 'bg-zinc-900 text-zinc-500 border-zinc-700', text: 'Not needed' },
  'not-tried': { icon: '–', className: 'bg-zinc-900 text-zinc-500 border-zinc-700', text: 'Skipped' },
}

/** "Aug 2026" for a month, "week of Sep 28, 2026" for a weekly date. */
export function traceAsOf(asOf: string | undefined): string | undefined {
  if (!asOf) return undefined
  return asOf.length > 7 ? `week of ${fmtDay(asOf)}` : fmtMonthYear(asOf)
}

/** "Used, Aug 2026" / "Not needed" / "No series here" / "Used (between survey seasons), week of …". */
export function traceStatusText(step: Pick<TraceStep, 'status' | 'asOf' | 'seasonal'>): string {
  const base = step.status === 'stale' && step.seasonal ? 'Used (between survey seasons)' : ICONS[step.status]?.text ?? step.status
  const when = traceAsOf(step.asOf)
  return when && (step.status === 'used' || step.status === 'stale') ? `${base}, ${when}` : base
}

/**
 * "Where does this come from?": a disclosure button that opens an inline step flow, one row per rung of
 * the metric's ladder (most local first) with ✓ used / ✗ unavailable / – not needed / ⚠ stale, the
 * geography, a plain-English reason and the source link. Opening moves focus to the steps; Escape
 * closes and returns focus to the button (without closing an enclosing ⓘ panel).
 */
export function SourceTrace({ steps, subject, className = '', testId = 'source-trace' }: {
  steps: TraceStep[] | undefined
  /** What the number is, for the accessible name ("gas price"). */
  subject: string
  className?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusPanel = useRef(false)

  useEffect(() => {
    if (open && focusPanel.current) {
      focusPanel.current = false
      panelRef.current?.focus()
    }
  }, [open])

  if (!steps?.length) return null
  const toggle = () => {
    focusPanel.current = !open
    setOpen((o) => !o)
  }
  return (
    <div
      className={`text-[11px] leading-snug ${className}`}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex min-h-8 items-center gap-1 rounded text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        data-testid="source-trace-toggle"
      >
        Where does this come from?
        <span aria-hidden="true" className="text-zinc-500">{open ? '▴' : '▾'}</span>
      </button>
      <div
        id={panelId}
        ref={panelRef}
        hidden={!open}
        tabIndex={-1}
        role="region"
        aria-label={`How we picked the source for the ${subject}`}
        className="mt-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
        data-testid="source-trace-panel"
      >
        <p className="mb-2 text-zinc-400">Most local source first; the first with data is used:</p>
        <ol className="space-y-2.5">
          {steps.map((s, i) => {
            const icon = ICONS[s.status] ?? ICONS['not-applicable']
            const quiet = s.status === 'not-needed' || s.status === 'not-tried'
            return (
              <li
                key={`${s.rungId}-${i}`}
                className="relative flex gap-2.5 min-w-0"
                data-testid="source-trace-step"
                data-status={s.status}
                data-rung={s.rungId}
              >
                {/* connector to the next step */}
                {i < steps.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-5 -bottom-2.5 w-px bg-zinc-800" />}
                <span
                  aria-hidden="true"
                  className={`relative z-10 mt-px flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${icon.className}`}
                >
                  {icon.icon}
                </span>
                <div className={`min-w-0 break-words ${quiet ? 'text-zinc-500' : 'text-zinc-300'}`}>
                  <p>
                    <span className="sr-only">{icon.text}: </span>
                    <span className={quiet ? '' : 'font-medium text-zinc-100'}>{s.label}</span>
                    {s.geography?.name && <span> — {s.geography.name}</span>}
                  </p>
                  <p className={s.status === 'used' ? 'text-emerald-300/90' : s.status === 'stale' ? 'text-amber-300/90' : 'text-zinc-500'} data-testid="source-trace-status">
                    {traceStatusText(s)}
                    {s.reason && <span className="text-zinc-400">: {s.reason}</span>}
                  </p>
                  {/* Source link where a series was checked or used (not on "no series here" / not-needed rows) */}
                  {!quiet && s.status !== 'not-applicable' && s.citationUrl && (
                    <p className="text-zinc-500">
                      <a href={s.citationUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
                        {s.source}
                      </a>
                      {s.seriesId && <span> · series {s.seriesId}</span>}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
