// About page: "How we pick your numbers", rendered from the resolution ladders (no hand-maintained copy).
// Each metric's ladder reads most local → least local: horizontal pills on wide screens, vertical on phones.

import { LADDERS, LADDER_ORDER } from '@/lib/resolution/ladders'
import { ladderPills, RESOLUTION_RULES } from '@/lib/resolution/doc'

export function HowWePick() {
  return (
    <div className="space-y-5" data-testid="how-we-pick">
      <p data-testid="resolution-rules">{RESOLUTION_RULES}</p>
      <p className="text-ink-2">
        Each ladder runs from the most local source (left, or top on a phone) to the least local. Tap
        &ldquo;Where does this come from?&rdquo; on any card or graph to see the steps for your zip.
      </p>
      {LADDER_ORDER.map((metric) => {
        const ladder = LADDERS[metric] as { title: string; comparison?: string; noData?: string }
        const pills = ladderPills(metric)
        return (
          <div key={metric} data-testid={`ladder-${metric}`}>
            <h3 className="font-display font-semibold text-[17px] leading-tight tracking-tight text-ink mb-2">{ladder.title}</h3>
            <ol className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-1.5" aria-label={`${ladder.title}: most local first`}>
              {pills.map((p, i) => (
                <li key={p.rungId} className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-1.5" data-testid="ladder-pill">
                  <span
                    className={`inline-flex flex-wrap items-baseline gap-x-1.5 rounded-sm border px-2.5 py-1 text-xs ${i === 0 ? 'border-ink-3/70 bg-raised' : 'border-line bg-desk/60'}`}
                    title={p.covers}
                  >
                    <span className="font-semibold text-ink">{p.level}</span>
                    <span className="font-mono text-[10.5px] text-ink-3">{p.source}</span>
                  </span>
                  {i < pills.length - 1 && (
                    <span aria-hidden="true" className="pl-4 sm:pl-0 text-ink-3 leading-none">
                      <span className="sm:hidden">↓</span>
                      <span className="hidden sm:inline">→</span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {ladder.comparison && <p className="mt-1.5 text-xs text-ink-3">U.S. comparison: {ladder.comparison}</p>}
            {ladder.noData && <p className="mt-0.5 text-xs text-ink-3">No data at any step: {ladder.noData}</p>}
          </div>
        )
      })}
    </div>
  )
}
