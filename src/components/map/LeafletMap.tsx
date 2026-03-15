'use client'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface LeafletMapProps {
  center?: [number, number]  // [lat, lng]
  zoom?: number
  onLocationClick?: (lat: number, lng: number) => void
  markerPosition?: [number, number]
}

// Fix Leaflet's default icon paths (broken in webpack/Next.js)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export function LeafletMap({
  center = [39.8283, -98.5795],  // Center of US
  zoom = 4,
  onLocationClick,
  markerPosition,
}: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView(center, zoom)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map)

    if (onLocationClick) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        onLocationClick(e.latlng.lat, e.latlng.lng)
      })
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Update marker when position changes
  useEffect(() => {
    if (!mapRef.current) return

    if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }

    if (markerPosition) {
      markerRef.current = L.marker(markerPosition).addTo(mapRef.current)
      mapRef.current.setView(markerPosition, 10, { animate: true })
    }
  }, [markerPosition])

  return (
    <div
      ref={containerRef}
      data-testid="leaflet-map"
      className="w-full h-[400px] rounded-xl overflow-hidden"
      style={{ zIndex: 0 }}
    />
  )
}
