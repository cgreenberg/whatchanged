'use client'
import type { Timeframe } from '@/lib/charts/chart-config'

interface TimeframeToggleProps {
  selected: Timeframe
  onChange: (tf: Timeframe) => void
}

const timeframes: Timeframe[] = ['Jan 2025', '1Y', '3Y', '5Y', '10Y']

export function TimeframeToggle({ selected, onChange }: TimeframeToggleProps) {
  return (
    <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
      {timeframes.map(tf => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          data-testid={`timeframe-${tf}`}
          className={`px-3 py-1 text-xs font-inter font-medium rounded-md transition-colors ${
            selected === tf
              ? 'bg-zinc-700 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}
