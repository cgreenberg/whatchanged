'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import {
  fetchCounties, fetchPulseMeta, METRICS, divergingColor, fmtMonth, metricFooter, moversFor, approxNote, flagNote,
  MOVERS_MIN_JOBS, timelineMonths,
  type CountyMap, type MetricKey, type PulseMeta,
} from '@/lib/local-pulse'

interface Shape { id: string; d: string; c: [number, number] }
interface Timeline {
  months: string[]
  /** Present when rent rows cover different months than home values (rows align to this instead). */
  rentMonths?: string[]
  hv: Record<string, number[]>
  rent: Record<string, number[]>
}

const LEGEND_WORDS: Record<MetricKey, [string, string]> = {
  hv: ['fell', 'rose'], rent: ['fell', 'rose'], real: ['prices ahead', 'paychecks ahead'],
  ur: ['fell', 'rose'], permits: ['fewer', 'more'],
}

const MOVERS_NOTE: Partial<Record<MetricKey, string>> = {
  permits: 'Permits are lumpy: one large apartment project can double a county’s count.',
  real: 'Average pay also moves with the mix of jobs, not just raises.',
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export function NationalMap({ countyFips, onZipSelect }: { countyFips?: string; onZipSelect: (zip: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [shapes, setShapes] = useState<{ counties: Shape[]; states: string } | null>(null)
  const [data, setData] = useState<CountyMap>({})
  const [meta, setMeta] = useState<PulseMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [metric, setMetric] = useState<MetricKey>('hv')
  // User's tap selection is scoped to the current county; a new zip resets it.
  const [picked, setPicked] = useState<{ base?: string; id?: string }>({})
  const selected = picked.base === countyFips && picked.id ? picked.id : countyFips
  const setSelected = (id: string) => setPicked({ base: countyFips, id })
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [timelineError, setTimelineError] = useState(false)
  const [frame, setFrame] = useState<number | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect() } }, { rootMargin: '100px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let live = true
    Promise.all([getJson<Topology>('/data/counties-albers-10m.json'), fetchCounties()])
      .then(([topo, counties]) => {
        if (!live) return
        const path = geoPath()
        const fc = feature(topo, topo.objects.counties as GeometryCollection)
        const shapesList = (fc as unknown as GeoJSON.FeatureCollection).features.map(f => ({
          id: String(f.id).padStart(5, '0'),
          d: path(f) ?? '',
          c: path.centroid(f) as [number, number],
        }))
        const states = path(mesh(topo, topo.objects.states as GeometryCollection, (a, b) => a !== b)) ?? ''
        setShapes({ counties: shapesList, states })
        setData(counties)
        setError(null)
      })
      .catch(() => { if (live) setError('Map unavailable right now.') })
    fetchPulseMeta().then(m => { if (live) setMeta(m) }).catch(() => {})
    return () => { live = false }
  }, [visible, attempt])

  // Time-lapse playback (home values / rent only)
  useEffect(() => {
    if (frame == null || !timeline) return
    if (frame >= timelineMonths(timeline, metric).length - 1) { const t = setTimeout(() => setFrame(null), 1500); return () => clearTimeout(t) }
    const t = setTimeout(() => setFrame(frame + 1), 380)
    return () => clearTimeout(t)
  }, [frame, timeline, metric])

  async function play() {
    if (metric !== 'hv' && metric !== 'rent') setMetric('hv')
    try {
      const tl = timeline ?? await getJson<Timeline>('/data/counties-timeline.json')
      if (!timeline) setTimeline(tl)
      setTimelineError(false)
      setFrame(0)
    } catch {
      setTimelineError(true)
    }
  }

  const def = METRICS.find(m => m.key === metric)!
  const value = (fips: string): number | undefined => {
    if (frame != null && timeline && (metric === 'hv' || metric === 'rent')) return timeline[metric][fips]?.[frame]
    return data[fips]?.[metric] as number | undefined
  }

  const movers = useMemo(() => moversFor(data, metric), [data, metric])
  const window_ = def.window(meta)

  const sel = selected ? data[selected] : undefined
  const selShape = shapes?.counties.find(s => s.id === selected)
  const selApprox = sel ? approxNote(sel) : null
  const selCaveat = sel ? flagNote(sel, metric) : null

  return (
    <section ref={ref} className="mt-12" data-testid="national-map">
      <h2 className="text-3xl text-white" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
        How every county changed
      </h2>
      <p className="text-sm text-zinc-400 mb-3">
        Each county colored by {def.label.toLowerCase()}{window_ ? `, ${window_}` : ''}. Tap one to explore it.
      </p>

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
        {error ? (
          <div className="aspect-[975/610] flex flex-col gap-2 items-center justify-center text-zinc-500 text-sm" data-testid="map-error">
            <p>{error}</p>
            <button onClick={() => { setError(null); setAttempt(a => a + 1) }} className="text-amber-400 underline text-xs">Try again</button>
          </div>
        ) : !shapes ? (
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
            {fmtMonth(timelineMonths(timeline, metric)[frame])}
          </div>
        )}
        {shapes && !error && (
          <button
            onClick={play}
            className="absolute top-2 right-2 bg-zinc-900/90 border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 rounded-full"
          >
            {timelineError ? 'Time-lapse unavailable, retry' : `▶ Play ${meta ? `since ${fmtMonth(meta.baseline)}` : 'month by month'}`}
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 text-[11px] text-zinc-400">
        <span>{LEGEND_WORDS[metric][0]}</span>
        <div className="flex-1 h-2 rounded-full" style={{
          background: `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map(t => divergingColor(t * def.clamp, def.clamp)).join(',')})`,
        }} />
        <span>{LEGEND_WORDS[metric][1]}</span>
      </div>
      <p className="text-[11px] text-zinc-500 mt-1" data-testid="map-source">
        Scale ±{def.clamp}{def.unit === '%' ? '%' : ' pts'} · {metricFooter(def, meta)} · near-black = no data
      </p>

      {/* Selected county panel */}
      {sel && (
        <div className="mt-3 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-white font-semibold">{sel.n}</p>
          <p className="text-sm text-zinc-300 mt-0.5">{def.describe(sel) ?? 'No data for this county'}</p>
          {window_ && def.describe(sel) && <p className="text-[11px] text-zinc-500">{window_}</p>}
          {selCaveat && <p className="text-[11px] text-amber-300/80 mt-1" data-testid="map-flag-note">{selCaveat}</p>}
          {selApprox && <p className="text-[11px] text-amber-300/80 mt-1">{selApprox}</p>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-zinc-400">
            {METRICS.filter(m => m.key !== metric).map(m => {
              const t = m.describe(sel)
              const flagged = !!flagNote(sel, m.key)
              return t ? (
                <p key={m.key}>
                  <span className="text-zinc-500">{m.short}:</span> {t.split(' · ')[0]}
                  {flagged && <span className="text-amber-300/80" title={flagNote(sel, m.key) ?? undefined}> (unusual value)</span>}
                </p>
              ) : null
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
          {([['Biggest increases', movers.top], ['Biggest decreases', movers.bottom]] as const).map(([title, rows]) => (
            <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
              <p className="text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">{title}</p>
              {rows.map(([f, c]) => (
                <button key={f} onClick={() => setSelected(f)} className="flex justify-between w-full text-left text-xs py-0.5 gap-2">
                  <span className="text-zinc-300 truncate">{c.n}</span>
                  <span className="text-zinc-400 tabular-nums shrink-0">
                    {(c[metric] as number) > 0 ? '+' : ''}{(c[metric] as number).toFixed(metric === 'permits' ? 0 : 1)}{def.unit === '%' ? '%' : ' pts'}
                  </span>
                </button>
              ))}
            </div>
          ))}
          <p className="col-span-2 text-[11px] text-zinc-500">
            Among counties with {MOVERS_MIN_JOBS.toLocaleString('en-US')}+ jobs, excluding statistical outliers and counties
            whose figures are approximated. {MOVERS_NOTE[metric] ?? ''}
          </p>
        </div>
      )}
    </section>
  )
}
