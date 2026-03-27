'use client'

import { CITY_ZIP_LOOKUP } from '@/lib/data/city-zip-lookup'

interface CityGridProps {
  onCitySelect: (zip: string, city?: string, state?: string) => void
}

export function CityGrid({ onCitySelect }: CityGridProps) {
  const GRID_CITIES = ['Austin', 'Charlotte', 'Chicago', 'Columbus', 'Dallas', 'Fort Worth', 'Houston', 'Indianapolis', 'Jacksonville', 'Los Angeles', 'New York', 'Philadelphia', 'Phoenix', 'San Antonio', 'San Diego', 'San Jose', 'Seattle']
  const cities = GRID_CITIES.map(name => CITY_ZIP_LOOKUP.find(c => c.display.startsWith(name + ','))!).filter(Boolean)

  return (
    <div className="mt-4">
      <p className="text-sm text-zinc-500 mb-3">Or explore a city →</p>
      <div
        data-testid="city-grid"
        className="flex flex-wrap justify-center gap-2"
      >
        {cities.map((city) => {
          const label = city.display.split(',')[0]
          return (
            <button
              key={city.zip}
              onClick={() => onCitySelect(city.zip, city.city, city.state)}
              className="rounded-full px-4 py-1.5 text-sm text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
