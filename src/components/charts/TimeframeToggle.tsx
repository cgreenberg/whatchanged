'use client'
import type { Timeframe } from '@/lib/charts/chart-config'

interface TimeframeToggleProps {
  selected: Timeframe
  onChange: (tf: Timeframe) => void
}

const timeframes: Timeframe[] = ['Jan 2025', '3Y', '5Y', '10Y']

export function TimeframeToggle({ selected, onChange }: TimeframeToggleProps) {
  return (
    <div className="flex shrink-0 border border-line rounded-sm overflow-hidden divide-x divide-line" role="group" aria-label="Time range">
      {timeframes.map(tf => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          aria-pressed={selected === tf}
          data-testid={`timeframe-${tf}`}
          className={`tnum px-2.5 sm:px-3 py-1 text-[11.5px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:bg-line ${
            selected === tf
              ? 'bg-ink text-desk'
              : 'text-ink-2 hover:text-ink hover:bg-raised'
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}
