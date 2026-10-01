'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import {
  fetchCounties, METRICS, divergingColor, fmtMonth,
  type CountyMap, type MetricKey,
} from '@/lib/local-pulse'

interface Shape { id: string; d: string; c: [number, number] }
interface Timeline { months: string[]; hv: Record<string, number[]>; rent: Record<string, number[]> }

const LEGEND_WORDS: Record<MetricKey, [string, string]> = {
  hv: ['fell', 'rose'], rent: ['fell', 'rose'], real: ['prices ahead', 'paychecks ahead'],
  ur: ['fell', 'rose'], permits: ['fewer', 'more'],
}

export function NationalMap({ countyFips, onZipSelect }: { countyFips?: string; onZipSelect: (zip: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [shapes, setShapes] = useState<{ counties: Shape[]; states: string } | null>(null)
  const [data, setData] = useState<CountyMap>({})
  const [metric, setMetric] = useState<MetricKey>('hv')
  // User's tap selection is scoped to the current county; a new zip resets it.
  const [picked, setPicked] = useState<{ base?: string; id?: string }>({})
  const selected = picked.base === countyFips && picked.id ? picked.id : countyFips
  const setSelected = (id: string) => setPicked({ base: countyFips, id })
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [frame, setFrame] = useState<number | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    fetch('/data/counties-albers-10m.json').then(r => r.json()).then((topo: Topology) => {
      const path = geoPath()
      const fc = feature(topo, topo.objects.counties as GeometryCollection)
      const counties = (fc as unknown as GeoJSON.FeatureCollection).features.map(f => ({
        id: String(f.id).padStart(5, '0'),
        d: path(f) ?? '',
        c: path.centroid(f) as [number, number],
      }))
      const states = path(mesh(topo, topo.objects.states as GeometryCollection, (a, b) => a !== b)) ?? ''
      setShapes({ counties, states })
    })
    fetchCounties().then(setData)
  }, [visible])

  // Time-lapse playback (home values / rent only)
  useEffect(() => {
    if (frame == null || !timeline) return
    if (frame >= timeline.months.length - 1) { const t = setTimeout(() => setFrame(null), 1500); return () => clearTimeout(t) }
    const t = setTimeout(() => setFrame(frame + 1), 380)
    return () => clearTimeout(t)
  }, [frame, timeline])

  async function play() {
    if (metric !== 'hv' && metric !== 'rent') setMetric('hv')
    let tl = timeline
    if (!tl) { tl = await fetch('/data/counties-timeline.json').then(r => r.json()); setTimeline(tl) }
    setFrame(0)
  }

  const def = METRICS.find(m => m.key === metric)!
  const value = (fips: string): number | undefined => {
    if (frame != null && timeline && (metric === 'hv' || metric === 'rent')) return timeline[metric][fips]?.[frame]
    return data[fips]?.[metric] as number | undefined
  }

  const movers = useMemo(() => {
    const rows = Object.entries(data)
      .filter(([, c]) => c[metric] != null && (c.emp ?? 0) >= 75000)
      .sort((a, b) => (b[1][metric] as number) - (a[1][metric] as number))
    return { top: rows.slice(0, 5), bottom: rows.slice(-5).reverse() }
  }, [data, metric])

  const sel = selected ? data[selected] : undefined
  const selShape = shapes?.counties.find(s => s.id === selected)

  return (
    <section ref={ref} className="mt-12" data-testid="national-map">
      <h2 className="text-3xl text-white" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
        America since January 2025
      </h2>
      <p className="text-sm text-zinc-400 mb-3">Every county, colored by how much it changed. Tap one to explore it.</p>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => { setFrame(null); setMetric(m.key) }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition ${metric === m.key ? 'bg-amber-500 text-black border-amber-500 font-semibold' : 'border-zinc-700 text-zinc-300'}`}
          >
            {m.short}
          </button>
        ))}
      </div>

      <div className="relative bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
        {!shapes ? (
          <div className="aspect-[975/610] flex items-center justify-center text-zinc-500 text-sm">Loading map…</div>
        ) : (
          <svg viewBox="0 0 975 610" className="w-full h-auto block" role="img" aria-label={`US county map of ${def.label}`}>
            <g>
              {shapes.counties.map(s => (
                <path
                  key={s.id}
                  d={s.d}
                  fill={divergingColor(value(s.id), def.clamp)}
                  stroke="#09090b"
                  strokeWidth={0.25}
                  onClick={() => setSelected(s.id)}
                  style={{ transition: 'fill 300ms linear', cursor: 'pointer' }}
                />
              ))}
            </g>
            <path d={shapes.states} fill="none" stroke="#0a0a0a" strokeWidth={1.1} pointerEvents="none" />
            {selShape && (
              <>
                <path d={selShape.d} fill="none" stroke="#fff" strokeWidth={2} pointerEvents="none" />
                <circle cx={selShape.c[0]} cy={selShape.c[1]} r={9} fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.6}>
                  <animate attributeName="r" values="6;16;6" dur="2s" repeatCount="indefinite" />
                </circle>
              </>
            )}
          </svg>
        )}
        {frame != null && timeline && (
          <div className="absolute top-2 left-3 text-white text-2xl" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
            {fmtMonth(timeline.months[frame])}
          </div>
        )}
        <button
          onClick={play}
          className="absolute top-2 right-2 bg-zinc-900/90 border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 rounded-full"
        >
          ▶ Play since Jan 2025
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 text-[11px] text-zinc-400">
        <span>{LEGEND_WORDS[metric][0]}</span>
        <div className="flex-1 h-2 rounded-full" style={{
          background: `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map(t => divergingColor(t * def.clamp, def.clamp)).join(',')})`,
        }} />
        <span>{LEGEND_WORDS[metric][1]}</span>
      </div>
      <p className="text-[11px] text-zinc-500 mt-1">
        Scale ±{def.clamp}{def.unit === '%' ? '%' : ' pts'} · {def.source} · near-black = no data
      </p>

      {/* Selected county panel */}
      {sel && (
        <div className="mt-3 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-white font-semibold">{sel.n}</p>
          <p className="text-sm text-zinc-300 mt-0.5">{def.describe(sel) ?? 'No data for this county'}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-zinc-400">
            {METRICS.filter(m => m.key !== metric).map(m => {
              const t = m.describe(sel)
              return t ? <p key={m.key}><span className="text-zinc-500">{m.short}:</span> {t.split(' · ')[0]}</p> : null
            })}
          </div>
          {sel.z && selected !== countyFips && (
            <button onClick={() => onZipSelect(sel.z!)} className="mt-3 text-sm font-semibold text-amber-400">
              See everything that changed here →
            </button>
          )}
        </div>
      )}

      {/* Movers */}
      {movers.top.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          {[['Biggest increases', movers.top], ['Biggest decreases', movers.bottom]].map(([title, rows]) => (
            <div key={title as string} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
              <p className="text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">{title as string}</p>
              {(rows as [string, typeof data[string]][]).map(([f, c]) => (
                <button key={f} onClick={() => setSelected(f)} className="flex justify-between w-full text-left text-xs py-0.5 gap-2">
                  <span className="text-zinc-300 truncate">{c.n}</span>
                  <span className="text-zinc-400 tabular-nums shrink-0">
                    {(c[metric] as number) > 0 ? '+' : ''}{(c[metric] as number).toFixed(metric === 'permits' ? 0 : 1)}{def.unit === '%' ? '%' : ''}
                  </span>
                </button>
              ))}
            </div>
          ))}
          <p className="col-span-2 text-[11px] text-zinc-500">Among counties with 75,000+ jobs.</p>
        </div>
      )}
    </section>
  )
}
