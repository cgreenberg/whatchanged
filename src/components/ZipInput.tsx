'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useCitySearch } from '@/hooks/useCitySearch'
import type { CityResult } from '@/lib/city-search'
import { reverseGeocodeToZip } from '@/lib/geocode'

interface ZipInputProps {
  onSubmit: (zip: string, city?: string, state?: string) => void
  isLoading: boolean
}

export function ZipInput({ onSubmit, isLoading }: ZipInputProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { results, status } = useCitySearch(value)

  // Close on outside mousedown — no setState in effect body, only in event handler
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDismissed(true)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // Derive dropdown open state — no useEffect needed, purely derived
  const dropdownOpen =
    !dismissed &&
    value.trim().length >= 2 &&
    !/^\d{5}$/.test(value) &&
    (results.length > 0 || status === 'error' || status === 'loading')

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    let v: string

    // If input contains any letter → allow all text (city mode)
    // Otherwise → digits only, capped at 5
    if (/[a-zA-Z]/.test(raw)) {
      v = raw
    } else {
      v = raw.replace(/\D/g, '').slice(0, 5)
    }

    setValue(v)
    setDismissed(false)
    setActiveIndex(-1)
    if (error) setError('')
  }

  const selectResult = useCallback((result: CityResult) => {
    setDismissed(true)
    setValue('')
    // Parse city and state from display string (format: "City Name, ST")
    const match = result.display.match(/^(.+),\s*([A-Z]{2})$/)
    const city = match ? match[1].trim() : undefined
    const state = match ? match[2].trim() : undefined
    onSubmit(result.zip, city, state)
  }, [onSubmit])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // If a dropdown item is active, select it
    if (dropdownOpen && activeIndex >= 0 && results[activeIndex]) {
      selectResult(results[activeIndex])
      return
    }

    // Close dropdown if open with no selection
    if (dropdownOpen) {
      setDismissed(true)
    }

    // Standard 5-digit zip submission
    if (!/^\d{5}$/.test(value)) {
      setError('Please enter a 5-digit zip code or select a city')
      return
    }
    onSubmit(value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Escape') {
      setDismissed(true)
      setActiveIndex(-1)
    } else if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault()
      selectResult(results[activeIndex])
    }
  }

  const showSpinner = status === 'loading' && !dismissed
  const listboxId = 'city-search-listbox'

  function handleGeoClick() {
    if (!navigator.geolocation) {
      setGeoError("Couldn't detect your location — please enter your zip code.")
      return
    }
    setGeoLoading(true)
    setGeoError(null)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        const zip = await reverseGeocodeToZip(latitude, longitude)
        setGeoLoading(false)
        if (zip) {
          onSubmit(zip)
        } else {
          setGeoError("Couldn't detect your location — please enter your zip code.")
        }
      },
      (err) => {
        setGeoLoading(false)
        if (err.code === 1) {
          setGeoError("Location access denied. On Mac: System Settings → Privacy & Security → Location Services → enable for your browser.")
        } else if (err.code === 3) {
          setGeoError("Location request timed out — please try again or enter your zip code.")
        } else {
          setGeoError("Couldn't detect your location — please enter your zip code.")
        }
      },
      { timeout: 15000, enableHighAccuracy: false }
    )
  }

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-3 w-full max-w-sm mx-auto">
      <form onSubmit={handleSubmit} className="w-full">
        {/* combobox wrapper satisfies aria-expanded on the correct role */}
        <div
          role="combobox"
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          className="relative w-full"
        >
          <input
            type="text"
            inputMode="text"
            placeholder="Zip code or city name"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            data-testid="zip-input"
            aria-autocomplete="list"
            aria-controls={dropdownOpen ? listboxId : undefined}
            aria-activedescendant={
              dropdownOpen && activeIndex >= 0
                ? `city-option-${activeIndex}`
                : undefined
            }
            className={`tnum w-full text-center font-display font-medium text-2xl sm:text-3xl tracking-wide bg-surface border border-line hover:border-ink-3 focus:border-ink focus:ring-1 focus:ring-ink rounded-md py-3.5 text-ink placeholder:text-ink-3 placeholder:font-normal outline-none transition-colors disabled:opacity-50 ${showSpinner ? 'pl-6 pr-12' : 'px-6'}`}
          />
          {showSpinner && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg
                className="animate-spin h-5 w-5 text-ink-3"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12" cy="12" r="10"
                  stroke="currentColor" strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}

          {dropdownOpen && (
            <ul
              id={listboxId}
              role="listbox"
              className="absolute top-full left-0 right-0 mt-1 bg-raised border border-line rounded-md z-50 overflow-hidden shadow-2xl shadow-black/50 text-left"
            >
              {status === 'error' && results.length === 0 ? (
                <li className="px-4 py-3 text-ink-3 text-sm">
                  No results — try entering your zip code directly
                </li>
              ) : (
                results.map((result, i) => (
                  <li
                    key={`${result.zip}-${i}`}
                    id={`city-option-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={() => selectResult(result)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors text-sm ${
                      i === activeIndex
                        ? 'bg-line text-ink'
                        : 'text-ink-2 hover:bg-line/60'
                    }`}
                  >
                    <span>
                      {result.source === 'census' ? '📍 ' : ''}
                      {result.display}
                    </span>
                    <span className="tnum font-mono text-ink-3 text-xs ml-2">{result.zip}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {error && (
          <p
            className="text-groceries text-sm mt-2 text-center"
            role="alert"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full mt-2.5 py-3 px-6 bg-ink text-desk font-semibold tracking-tight rounded-md hover:bg-white disabled:opacity-40 opacity-100 transition-[opacity,background-color] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-desk"
          style={{
            opacity: isLoading ? undefined : value.length === 0 ? 0.45 : 1,
          }}
        >
          {isLoading ? 'Loading...' : 'See What Changed'}
        </button>
      </form>

      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          data-testid="geo-button"
          disabled={geoLoading || isLoading}
          onClick={handleGeoClick}
          className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 ${geoLoading ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
            <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
          </svg>
          {geoLoading ? 'Detecting location...' : 'Use my location'}
        </button>
        {geoError && (
          <p className="text-xs text-groceries max-w-sm text-center" role="alert">
            {geoError}
          </p>
        )}
      </div>
    </div>
  )
}
