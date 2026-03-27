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
  const prefetchedRef = useRef<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  const { results, status } = useCitySearch(value)

  // Prefetch only for valid 5-digit zips — side effect, no setState, fine in useEffect
  useEffect(() => {
    if (/^\d{5}$/.test(value) && !prefetchedRef.current.has(value)) {
      prefetchedRef.current.add(value)
      fetch(`/api/data/${value}`).catch(() => {})
    }
  }, [value])

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
            className={`w-full text-center text-3xl tracking-widest bg-zinc-900 border-2 border-zinc-700 focus:border-electric-amber rounded-xl py-4 text-white placeholder:text-zinc-600 outline-none transition-colors disabled:opacity-50 ${showSpinner ? 'pl-6 pr-12' : 'px-6'}`}
            style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
          />
          {showSpinner && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg
                className="animate-spin h-5 w-5 text-zinc-400"
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
              className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg z-50 overflow-hidden shadow-xl"
              style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
            >
              {status === 'error' && results.length === 0 ? (
                <li className="px-4 py-3 text-zinc-500 text-sm">
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
                        ? 'bg-zinc-700 text-white'
                        : 'text-zinc-100 hover:bg-zinc-800'
                    }`}
                  >
                    <span>
                      {result.source === 'census' ? '📍 ' : ''}
                      {result.display}
                    </span>
                    <span className="text-zinc-500 text-xs ml-2">{result.zip}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {error && (
          <p
            className="text-danger-red text-sm mt-2 text-center"
            style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
            role="alert"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full mt-3 py-3 px-6 bg-electric-amber text-black font-semibold rounded-xl disabled:opacity-40 opacity-100 transition-opacity"
          style={{
            fontFamily: 'var(--font-inter, sans-serif)',
            opacity: isLoading ? undefined : value.length === 0 ? 0.4 : 1,
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
          className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
        >
          <span className={geoLoading ? 'animate-pulse' : ''}>📍</span>{' '}
          {geoLoading ? 'Detecting location...' : 'Use my location'}
        </button>
        {geoError && (
          <p className="text-xs text-red-400" role="alert">
            {geoError}
          </p>
        )}
      </div>
    </div>
  )
}
