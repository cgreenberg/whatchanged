'use client'

import { CITY_ZIP_LOOKUP } from '@/lib/data/city-zip-lookup'

interface CityGridProps {
  onCitySelect: (zip: string) => void
}

export function CityGrid({ onCitySelect }: CityGridProps) {
  const cities = CITY_ZIP_LOOKUP.slice(0, 16)

  return (
    <div className="mt-4">
      <p className="text-sm text-zinc-500 mb-3">Or explore a city →</p>
      <div
        data-testid="city-grid"
        className="overflow-x-auto flex flex-nowrap gap-2 sm:flex-wrap"
      >
        {cities.map((city) => {
          const label = city.display.split(',')[0]
          return (
            <button
              key={city.zip}
              onClick={() => onCitySelect(city.zip)}
              className="rounded-full px-4 py-1.5 text-sm text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500 transition-colors whitespace-nowrap"
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
