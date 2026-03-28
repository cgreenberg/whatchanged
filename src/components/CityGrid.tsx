'use client'

interface CityGridProps {
  onCitySelect: (zip: string, city?: string, state?: string) => void
}

// One city per BLS CPI metro area (22 of 23 Tier 1 metros, alphabetical)
const GRID_CITIES = [
  { label: 'Anchorage',     zip: '99501', city: 'anchorage',     state: 'ak' },
  { label: 'Atlanta',       zip: '30303', city: 'atlanta',       state: 'ga' },
  { label: 'Baltimore',     zip: '21201', city: 'baltimore',     state: 'md' },
  { label: 'Boston',        zip: '02108', city: 'boston',         state: 'ma' },
  { label: 'Chicago',       zip: '60601', city: 'chicago',       state: 'il' },
  { label: 'Dallas',        zip: '75201', city: 'dallas',        state: 'tx' },
  { label: 'Denver',        zip: '80202', city: 'denver',        state: 'co' },
  { label: 'Detroit',       zip: '48201', city: 'detroit',       state: 'mi' },
  { label: 'Honolulu',      zip: '96813', city: 'honolulu',      state: 'hi' },
  { label: 'Houston',       zip: '77002', city: 'houston',       state: 'tx' },
  { label: 'Los Angeles',   zip: '90012', city: 'los angeles',   state: 'ca' },
  { label: 'Miami',         zip: '33101', city: 'miami',         state: 'fl' },
  { label: 'Minneapolis',   zip: '55401', city: 'minneapolis',   state: 'mn' },
  { label: 'New York',      zip: '10001', city: 'new york',      state: 'ny' },
  { label: 'Philadelphia',  zip: '19102', city: 'philadelphia',  state: 'pa' },
  { label: 'Phoenix',       zip: '85003', city: 'phoenix',       state: 'az' },
  { label: 'San Diego',     zip: '92101', city: 'san diego',     state: 'ca' },
  { label: 'San Francisco', zip: '94102', city: 'san francisco', state: 'ca' },
  { label: 'Seattle',       zip: '98101', city: 'seattle',       state: 'wa' },
  { label: 'St. Louis',     zip: '63101', city: 'st. louis',     state: 'mo' },
  { label: 'Tampa',         zip: '33602', city: 'tampa',         state: 'fl' },
  { label: 'Washington DC', zip: '20001', city: 'washington',    state: 'dc' },
]

export function CityGrid({ onCitySelect }: CityGridProps) {
  const cities = GRID_CITIES

  return (
    <div className="mt-4">
      <p className="text-sm text-zinc-500 mb-3">Or explore a city →</p>
      <div
        data-testid="city-grid"
        className="flex flex-wrap justify-center gap-2"
      >
        {cities.map((city) => (
            <button
              key={city.zip}
              onClick={() => onCitySelect(city.zip, city.city, city.state)}
              className="rounded-full px-4 py-1.5 text-sm text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              {city.label}
            </button>
          ))}
      </div>
    </div>
  )
}
