'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { TraceStatus, TraceStep } from '@/lib/resolution/types'
import { fmtDay, fmtMonthYear } from '@/lib/format'

// Data-desk step markers: the step used is the one solid (off-white) node; a stale one is outlined in the
// caution yellow; steps without data are hairline outlines in muted ink (no red/green good-bad coding).
const MISSING = 'bg-surface text-ink-2 border-ink-3/70'
const QUIET = 'bg-surface text-ink-3 border-line border-dashed'
const ICONS: Record<TraceStatus, { icon: string; className: string; text: string }> = {
  used: { icon: '✓', className: 'bg-ink text-desk border-ink', text: 'Used' },
  stale: { icon: '!', className: 'bg-surface text-caution border-caution', text: 'Used, but out of date' },
  unavailable: { icon: '✗', className: MISSING, text: 'Unavailable' },
  invalid: { icon: '✗', className: MISSING, text: 'Failed our checks' },
  'over-budget': { icon: '✗', className: MISSING, text: 'Not fetched' },
  'not-applicable': { icon: '✗', className: MISSING, text: 'No series here' },
  'not-needed': { icon: '–', className: QUIET, text: 'Not needed' },
  'not-tried': { icon: '–', className: QUIET, text: 'Skipped' },
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
        className="inline-flex min-h-8 items-center gap-1.5 rounded-sm font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-2 underline decoration-ink-3/60 decoration-dotted underline-offset-[3px] hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-2"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        data-testid="source-trace-toggle"
      >
        Where does this come from?
        <span aria-hidden="true" className="text-ink-3 no-underline">{open ? '▴' : '▾'}</span>
      </button>
      <div
        id={panelId}
        ref={panelRef}
        hidden={!open}
        tabIndex={-1}
        role="region"
        aria-label={`How we picked the source for the ${subject}`}
        className="mt-1.5 rounded-sm border border-line bg-desk/70 px-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-3"
        data-testid="source-trace-panel"
      >
        <p className="kicker !text-[10px] mb-2.5 text-ink-3">Most local source first; the first with data is used</p>
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
                {i < steps.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-5 -bottom-2.5 w-px bg-line" />}
                <span
                  aria-hidden="true"
                  className={`relative z-10 mt-px flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold leading-none ${icon.className}`}
                >
                  {icon.icon}
                </span>
                <div className={`min-w-0 break-words ${quiet ? 'text-ink-3' : 'text-ink-2'}`}>
                  <p>
                    <span className="sr-only">{icon.text}: </span>
                    <span className={quiet ? '' : 'font-medium text-ink'}>{s.label}</span>
                    {s.geography?.name && <span> — {s.geography.name}</span>}
                  </p>
                  <p className={s.status === 'used' ? 'text-ink' : s.status === 'stale' ? 'text-caution' : 'text-ink-3'} data-testid="source-trace-status">
                    {traceStatusText(s)}
                    {s.reason && <span className="text-ink-2">: {s.reason}</span>}
                  </p>
                  {/* Source link where a series was checked or used (not on "no series here" / not-needed rows) */}
                  {!quiet && s.status !== 'not-applicable' && s.citationUrl && (
                    <p className="font-mono text-[10.5px] text-ink-3">
                      <a href={s.citationUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-ink-3/60 underline-offset-2 hover:text-ink">
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
