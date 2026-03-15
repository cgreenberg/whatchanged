'use client'
import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'

// Dynamic import — Leaflet is client-only
const LeafletMap = dynamic(
  () => import('./LeafletMap').then(mod => ({ default: mod.LeafletMap })),
  { ssr: false, loading: () => <MapPlaceholder /> }
)

function MapPlaceholder() {
  return (
    <div className="w-full h-[400px] bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center">
      <p className="text-zinc-500 font-inter text-sm">Loading map...</p>
    </div>
  )
}

interface MapSectionProps {
  currentZip?: string
  markerPosition?: [number, number]
  onZipChange: (zip: string) => void
}

export function MapSection({ currentZip, markerPosition, onZipChange }: MapSectionProps) {
  const [isVisible, setIsVisible] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  // IntersectionObserver for lazy loading
  useEffect(() => {
    if (!sectionRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }  // Start loading 200px before visible
    )
    observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  async function handleMapClick(lat: number, lng: number) {
    // Reverse geocode to get zip code using Nominatim (free, no key)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`,
        { headers: { 'Accept-Language': 'en' } }
      )
      if (!res.ok) return
      const data = await res.json()
      const zip = data.address?.postcode
      if (zip && /^\d{5}/.test(zip)) {
        onZipChange(zip.slice(0, 5))
      }
    } catch {
      // Silently fail — user can still type zip manually
    }
  }

  return (
    <motion.section
      ref={sectionRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.6 }}
      className="mt-12"
      data-testid="map-section"
    >
      <h2 className="text-2xl font-bebas text-white mb-4">Explore the Map</h2>
      <p className="text-sm font-inter text-zinc-400 mb-4">
        Click anywhere on the map to see data for that area.
      </p>
      {isVisible ? (
        <LeafletMap
          markerPosition={markerPosition}
          onLocationClick={handleMapClick}
          center={markerPosition ?? [39.8283, -98.5795]}
          zoom={markerPosition ? 10 : 4}
        />
      ) : (
        <MapPlaceholder />
      )}
    </motion.section>
  )
}
