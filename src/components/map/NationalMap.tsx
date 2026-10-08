'use client'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react'
import { geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import {
  fetchCounties, fetchLocalMeta, fetchMapMetrics, METRICS, LIVE_METRICS, MAP_METRIC_ORDER, NO_MOVERS_NOTE, NO_DATA_COLOR, mapScaleFor, scaleColor, scaleText, fmtScaleValue,
  oppositeColor, isOppositeSide, sequentialClaim, gasWindowText, elecWindowText, BASELINE_MONTH,
  hudRentLabel, hudWindow, hudPanelArea, type ZipPanelOverrides, fmtMonth, fmtPct, fmtMoney, sinceBaseline, metricFooter, liveFooter, liveValue, moversFor, flagNote, isCountyMetric, MOVERS_MIN_JOBS, timelineMonths,
  type CountyMap, type MetricKey, type CountyMetricKey, type LocalMeta, type MetricDef, type LiveMetricDef,
} from '@/lib/county-data'
import type { MapMetrics } from '@/lib/api/map-metrics'
import { mapRentTier, rentLayer, type MapRentTier } from '@/lib/map-metro-rent'
import { mapTooltip } from '@/lib/map-tooltip'
import { rentSeasonalCaveat, hasSeasonalCaveat } from '@/lib/rent-range'

/** Light diagonal stripes over a county colored by its metro's rent (no Zillow county series). */
const METRO_HATCH_ID = 'map-metro-hatch'
const METRO_HATCH_CSS = 'repeating-linear-gradient(45deg, rgba(241,239,234,0.5) 0 1.2px, transparent 1.2px 4px)'
/** Light dots over a county colored by a city's rent (no usable Zillow county or metro series). */
const CITY_DOTS_ID = 'map-city-dots'
const CITY_DOTS_CSS = 'radial-gradient(circle, rgba(241,239,234,0.6) 0 0.9px, transparent 1.1px) 0 0 / 4px 4px'
/** Gas: a light grid over a county priced on its own window (Alaska DCRA survey months), not the layer's monthly averages. */
const SURVEY_GRID_ID = 'map-survey-grid'
const SURVEY_GRID_CSS = 'repeating-linear-gradient(0deg, rgba(241,239,234,0.55) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgba(241,239,234,0.55) 0 1px, transparent 1px 4px)'
/** A tap / click focuses the map box: keyboard browsing must not start from it (ms after a pointerdown). */
const POINTER_FOCUS_MS = 1500
const VIEW_W = 975
const VIEW_H = 610

/**
 * The county shapes, memoized so hover / focus changes (tooltip only) never re-render 3,000+ paths.
 * Clicks are delegated: the county's FIPS is on its path.
 */
const CountyLayer = memo(function CountyLayer({ shapes, fills, onPick }: {
  shapes: Shape[]
  fills: Map<string, string>
  onPick: (fips: string) => void
}) {
  return (
    <g onClick={(e) => {
      const f = (e.target as Element).getAttribute?.('data-fips')
      if (f) onPick(f)
    }}>
      {shapes.map(s => (
        <path
          key={s.id}
          d={s.d}
          data-fips={s.id}
          fill={fills.get(s.id) ?? NO_DATA_COLOR}
          stroke="#111316"
          strokeWidth={0.3}
          style={{ transition: 'fill 300ms linear', cursor: 'pointer' }}
        />
      ))}
    </g>
  )
})

/** Nearest county centroid from `from` in an arrow-key direction (within a ±60° cone), for keyboard browsing. */
function neighborInDirection(shapes: Shape[], from: Shape, dir: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): Shape | null {
  const [ux, uy] = dir === 'ArrowLeft' ? [-1, 0] : dir === 'ArrowRight' ? [1, 0] : dir === 'ArrowUp' ? [0, -1] : [0, 1]
  let best: Shape | null = null
  let bestScore = Infinity
  for (const s of shapes) {
    if (s.id === from.id || !Number.isFinite(s.c[0])) continue
    const dx = s.c[0] - from.c[0]
    const dy = s.c[1] - from.c[1]
    const along = dx * ux + dy * uy
    if (along <= 0.5) continue
    const across = Math.abs(dx * uy - dy * ux)
    if (across > along * 1.75) continue
    const score = along + across * 2
    if (score < bestScore) { bestScore = score; best = s }
  }
  return best
}

type AnyDef = (MetricDef & { scope: 'county' }) | (LiveMetricDef & { scope: 'live' })
const DEFS: AnyDef[] = MAP_METRIC_ORDER.map(k => {
  const c = METRICS.find(m => m.key === k)
  if (c) return { ...c, scope: 'county' as const }
  return { ...LIVE_METRICS.find(m => m.key === k)!, scope: 'live' as const }
})

interface Shape { id: string; d: string; c: [number, number] }
interface Timeline {
  months: string[]
  /** Present when rent rows cover different months than home values (rows align to this instead). */
  rentMonths?: string[]
  hv: Record<string, number[]>
  rent: Record<string, number[]>
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export function NationalMap({ countyFips, onZipSelect, zipOverrides }: {
  countyFips?: string
  onZipSelect: (zip: string) => void
  /** The zip's own county: the card's figure where the county-wide map value differs (Alaska survey community, metro rent). */
  zipOverrides?: ZipPanelOverrides
}) {
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mapBoxRef = useRef<HTMLDivElement>(null)
  // When the last pointerdown on the map happened: a focus that follows it is a click / tap, not keyboard navigation
  const lastPointerDown = useRef(-Infinity)
  // Mouse hover (container px) and keyboard focus (a county browsed with the arrow keys): tooltip only
  const [hover, setHover] = useState<{ fips: string; x: number; y: number; w: number; h: number } | null>(null)
  const [kbdAt, setKbdAt] = useState<{ fips: string; x: number; y: number; w: number; h: number } | null>(null)
  const kbd = kbdAt?.fips ?? null
  const [visible, setVisible] = useState(false)
  const [shapes, setShapes] = useState<{ counties: Shape[]; states: string } | null>(null)
  const [data, setData] = useState<CountyMap>({})
  const [meta, setMeta] = useState<LocalMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [metric, setMetric] = useState<MetricKey>('hv')
  // Gas / Groceries / Electricity: cache-backed values per metro / region / state (never upstream)
  const [liveData, setLiveData] = useState<MapMetrics | null>(null)
  const [liveError, setLiveError] = useState(false)
  // User's tap selection is scoped to the current county; a new zip resets it.
  const [picked, setPicked] = useState<{ base?: string; id?: string; reveal?: number }>({})
  const selected = picked.base === countyFips && picked.id ? picked.id : countyFips
  const setSelected = useCallback((id: string, reveal = false) =>
    setPicked(p => ({ base: countyFips, id, reveal: reveal ? (p.reveal ?? 0) + 1 : p.reveal })), [countyFips])
  const pick = useCallback((id: string) => setSelected(id), [setSelected])
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
    fetchLocalMeta().then(m => { if (live) setMeta(m) }).catch(() => {})
    fetchMapMetrics()
      .then(m => { if (live) { setLiveData(m); setLiveError(false) } })
      .catch(() => { if (live) setLiveError(true) })
    return () => { live = false }
  }, [visible, attempt])

  // Time-lapse playback (county metrics only)
  useEffect(() => {
    if (frame == null || !timeline || !isCountyMetric(metric)) return
    if (frame >= timelineMonths(timeline, metric).length - 1) { const t = setTimeout(() => setFrame(null), 1500); return () => clearTimeout(t) }
    const t = setTimeout(() => setFrame(frame + 1), 380)
    return () => clearTimeout(t)
  }, [frame, timeline, metric])

  // A pick from the movers list (below the panel) brings the panel back into view.
  useEffect(() => {
    if (!picked.reveal) return
    panelRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [picked.reveal])

  async function play() {
    if (frame != null) { setFrame(null); return }
    try {
      const tl = timeline ?? await getJson<Timeline>('/data/counties-timeline.json')
      if (!timeline) setTimeline(tl)
      setTimelineError(false)
      setFrame(0)
    } catch {
      setTimelineError(true)
    }
  }

  const def = DEFS.find(m => m.key === metric)!
  const countyKey: CountyMetricKey | null = isCountyMetric(metric) ? metric : null
  const playing = frame != null && !!timeline && !!countyKey
  const value = useCallback((fips: string): number | undefined => {
    if (!countyKey) return liveValue(liveData, fips, metric as Exclude<MetricKey, CountyMetricKey>)?.value
    if (frame != null && timeline) return timeline[countyKey][fips]?.[frame]
    return data[fips]?.[countyKey]
  }, [countyKey, liveData, metric, frame, timeline, data])
  // Rent: a county with no Zillow county series takes the Rent card's next rung — its metro's rent (light stripes),
  // else its most populous city's (dots). Not during the time-lapse (it plays the county series only). A county with
  // no usable Zillow rent at all stays gray; HUD's Fair Market Rent estimate (not actual rents) is only in its tooltip
  // and panel, never a color.
  const rentTiers = useMemo(() => {
    const out = new Map<string, Extract<MapRentTier, { tier: 'metro' | 'city' }>>()
    if (metric !== 'rent' || playing || !shapes) return out
    for (const s of shapes.counties) {
      const t = mapRentTier(s.id, data[s.id])
      if (t && (t.tier === 'metro' || t.tier === 'city')) out.set(s.id, t)
    }
    return out
  }, [metric, playing, shapes, data])
  /** Rent layer (latest values): Zillow county / metro / city values only; HUD-tier and no-data counties are gray. */
  const rentLatest = useMemo(
    () => (countyKey === 'rent' && shapes ? rentLayer(shapes.counties.map(s => s.id), data, def.clamp) : null),
    [countyKey, shapes, data, def.clamp],
  )
  /** Counties with no usable Zillow rent that have a HUD Fair Market Rent estimate (gray; shown on hover / tap). */
  const hudCount = useMemo(() => {
    if (metric !== 'rent' || !shapes) return 0
    let n = 0
    for (const s of shapes.counties) if (mapRentTier(s.id, data[s.id])?.tier === 'hud') n++
    return n
  }, [metric, shapes, data])
  // Gas: HI/AK counties with no series (the nearest metro's price: stripes) and areas on their own window (Alaska's
  // DCRA survey months, a lagging series: grid), each patterned and in the legend
  const gasTiers = useMemo(() => {
    const standIn: Shape[] = []
    const own: Shape[] = []
    let survey = 0
    if (metric !== 'gas' || !shapes) return { standIn, own, onlySurvey: true, surveyFrom: null as string | null, surveyTo: null as string | null }
    let surveyTo: string | null = null
    let surveyFrom: string | null = null
    for (const s of shapes.counties) {
      const v = liveValue(liveData, s.id, 'gas')
      if (!v) continue
      if (v.standIn) standIn.push(s)
      if (v.ownWindow) {
        own.push(s)
        if (v.survey) {
          survey++
          if (v.asOf && (!surveyTo || v.asOf > surveyTo)) surveyTo = v.asOf
          const from = liveData?.gas[liveData.counties[s.id]?.[0] ?? -1]?.baselineAsOf
          if (from && (!surveyFrom || from < surveyFrom)) surveyFrom = from
        }
      }
    }
    return { standIn, own, onlySurvey: survey === own.length, surveyFrom, surveyTo }
  }, [metric, shapes, liveData])
  // Color scale from the LATEST values (fixed through the time-lapse so frames are comparable): ±95th percentile of
  // |change| (diverging), or the counties' 2nd–98th percentile range when nearly every county moved the same way (gas).
  // Rent: Zillow values only (county, metro, city: rentLayer); HUD's estimates never enter the scale. Gas: the common
  // monthly-average window only (own-window survey areas are drawn on that scale, patterned).
  const unit: 'usd' | 'pct' = def.scope === 'live' ? def.unit : 'pct'
  const scale = useMemo(() => {
    if (rentLatest) return rentLatest.scale
    const vals: (number | undefined)[] = []
    for (const s of shapes?.counties ?? []) {
      if (!countyKey) {
        const v = liveValue(liveData, s.id, metric as Exclude<MetricKey, CountyMetricKey>)
        vals.push(v && !v.ownWindow ? v.value : undefined)
        continue
      }
      vals.push(data[s.id]?.[countyKey])
    }
    return mapScaleFor(vals, unit, def.clamp, def.scope === 'live' && !!def.sequential)
  }, [rentLatest, shapes, countyKey, data, liveData, metric, unit, def])
  const fills = useMemo(() => {
    if (rentLatest && !playing) return rentLatest.fills
    const out = new Map<string, string>()
    if (!shapes) return out
    for (const s of shapes.counties) {
      const v = value(s.id)
      if (Number.isFinite(v)) out.set(s.id, scaleColor(v, scale))
    }
    return out
  }, [rentLatest, playing, shapes, value, scale])
  // Sequential scale: "every county rose" only when no drawn county fell (else "nearly every"); falls get their own color
  const drawnValues = useMemo(() => (shapes?.counties ?? []).map(s => value(s.id)), [shapes, value])
  const claim = sequentialClaim(drawnValues, scale)
  const oppositeCount = useMemo(() => drawnValues.filter(v => isOppositeSide(v, scale)).length, [drawnValues, scale])
  const metroShapes = useMemo(() => (shapes ? shapes.counties.filter(s => rentTiers.get(s.id)?.tier === 'metro') : []), [shapes, rentTiers])
  const cityShapes = useMemo(() => (shapes ? shapes.counties.filter(s => rentTiers.get(s.id)?.tier === 'city') : []), [shapes, rentTiers])
  const hudLabel = hudRentLabel(meta)
  const shapeById = useMemo(() => new Map((shapes?.counties ?? []).map(s => [s.id, s])), [shapes])
  /** Keyboard browsing starts at the selected county, else the one nearest the map's center. */
  const centerFips = useMemo(() => {
    let best: string | null = null
    let d = Infinity
    for (const s of shapes?.counties ?? []) {
      const dd = (s.c[0] - VIEW_W / 2) ** 2 + (s.c[1] - VIEW_H / 2) ** 2
      if (dd < d) { d = dd; best = s.id }
    }
    return best
  }, [shapes])
  const tipId = 'map-kbd-tooltip'
  /** Keyboard focus on a county: its tooltip sits at the county's centroid (container px). */
  const focusCounty = (fips: string | null) => {
    const sh = fips ? shapeById.get(fips) : undefined
    const r = mapBoxRef.current?.getBoundingClientRect()
    if (!sh || !r) { setKbdAt(null); return }
    const k = r.width / VIEW_W
    setKbdAt({ fips: sh.id, x: sh.c[0] * k, y: sh.c[1] * k, w: r.width, h: r.height })
  }
  // Tooltip: the hovered county (mouse), else the keyboard-focused one
  const tipFips = hover?.fips ?? kbd
  const countyLatest = countyKey ? meta?.sources[def.scope === 'county' ? def.sourceKey : '']?.latest : undefined
  const countyWhen = meta && countyLatest && /^\d{4}-\d{2}$/.test(countyLatest) ? `${fmtMonth(meta.baseline)} → ${fmtMonth(countyLatest)}` : undefined
  const tipFor = (fips: string | null) => (fips
    ? mapTooltip({
        fips, metric, county: data[fips], liveData, hudWindowText: hudWindow(meta).window, countyWhen,
        ...(playing && countyKey ? { frame: { value: value(fips), month: timelineMonths(timeline!, countyKey)[frame!] } } : {}),
      })
    : null)
  const tip = tipFor(tipFips)
  const kbdTip = !hover && kbd ? tip : null
  const tipShape = tipFips ? shapeById.get(tipFips) : undefined
  // Position (container px): beside the pointer / county centroid, flipped toward the map's center so it stays inside
  let tipPos: CSSProperties | null = null
  let tipMaxW = 260
  {
    const box = hover ?? kbdAt
    if (box && box.w > 0) {
      const gap = 14
      tipMaxW = Math.max(140, Math.min(260, box.w / 2 - gap - 4))
      tipPos = {
        ...(box.x > box.w / 2 ? { right: Math.max(4, box.w - box.x + gap) } : { left: Math.max(4, box.x + gap) }),
        ...(box.y > box.h / 2 ? { bottom: Math.max(4, box.h - box.y + gap) } : { top: Math.max(4, box.y + gap) }),
      }
    }
  }

  const movers = useMemo(() => (countyKey ? moversFor(data, countyKey) : { top: [], bottom: [] }), [data, countyKey])
  const gasWindow = gasWindowText(liveData)
  const elecAsOf = Object.values(liveData?.electricity ?? {}).map(e => e.asOf).sort().pop()
  const window_ = def.scope === 'county'
    ? def.window(meta)
    : def.key === 'gas' && gasWindow ? `${gasWindow}, so areas compare fairly`
      : def.key === 'elec' ? `latest 12-month average${elecAsOf ? ` (to ${fmtMonth(elecAsOf)})` : ''} vs the 12 months centered on ${fmtMonth(meta?.baseline ?? BASELINE_MONTH)}`
        : sinceBaseline(meta)
  /** Legend title per layer: the window the colors compare. */
  const legendTitle = def.key === 'gas' && gasWindow
    ? `${gasWindow}, so areas compare fairly`
    : def.key === 'elec' ? elecWindowText(elecAsOf) : `Change since ${meta ? fmtMonth(meta.baseline) : 'baseline'}`
  const footer = def.scope === 'county' ? metricFooter(def, meta) : liveFooter(def.key, liveData)
  const scaleNote = scaleText(scale, unit)
  const legendStops = Array.from({ length: 21 }, (_, i) => scale.kind === 'diverging'
    ? scaleColor((i / 10 - 1) * scale.clamp, scale)
    : scaleColor(scale.lo + (i / 20) * (scale.hi - scale.lo), scale))

  const sel = selected ? data[selected] : undefined
  const selShape = shapes?.counties.find(s => s.id === selected)
  const selCaveat = sel && countyKey ? flagNote(sel, countyKey) : null
  /** Every measure for the selected county, each with its own area (county, metro/region, state). */
  const rows = selected && sel
    ? DEFS.map(d => {
        const own = selected === countyFips ? zipOverrides : undefined
        if (d.scope === 'county') {
          const text = d.describe(sel)
          if (!text && d.key === 'rent' && own?.rent) {
            return { key: d.key, short: d.short, text: own.rent.text, area: own.rent.area, caveat: null, seasonal: own.rent.seasonal }
          }
          const t = !text && d.key === 'rent' ? mapRentTier(selected, sel) : null
          if (t?.tier === 'metro') {
            const m = t.metro
            return {
              key: d.key, short: d.short,
              text: `${fmtPct(m.pct)} ${sinceBaseline(meta)} · typical asking rent ${fmtMoney(m.cur)}/mo`,
              area: `metro rent: ${m.name} metro (no usable Zillow county series)`,
              caveat: null,
              seasonal: rentSeasonalCaveat(m.saCaveat, 'metro', { pct: m.pct, curRent: m.cur }),
            }
          }
          if (t?.tier === 'city') {
            const c = t.city
            return {
              key: d.key, short: d.short,
              text: `${fmtPct(c.pct)} ${sinceBaseline(meta)} · typical asking rent ${fmtMoney(c.cur)}/mo`,
              area: `${c.name} area rent (Zillow city series): the county’s most populous place with a Zillow series (no usable county or metro series)`,
              caveat: null,
              seasonal: rentSeasonalCaveat(c.saCaveat, 'city', { pct: c.pct, curRent: c.cur }),
            }
          }
          if (t?.tier === 'hud') {
            // Gray on the map: HUD's yearly estimate, labeled as such, never presented as actual rents
            const h = t.hud
            return {
              key: d.key, short: d.short,
              text: `No usable Zillow rent here · HUD Fair Market Rent estimate: ${fmtPct(h.pct)} (not actual rents; 2-bedroom ${fmtMoney(h.base)} → ${fmtMoney(h.cur)}/mo)`,
              area: `${hudPanelArea(meta)}${h.from ? `; ${h.from} figure` : ''}${h.areas ? `; the HUD area covering most of its towns` : ''}`,
              caveat: null,
            }
          }
          return {
            key: d.key, short: d.short,
            // The rent number carries its seasonal-pattern caveat wherever it appears (card, graph, map)
            seasonal: text && d.key === 'rent' ? rentSeasonalCaveat(sel.rentSaCav, 'county', { pct: sel.rent, curRent: sel.rentCur }) : undefined,
            text: text ?? (d.key === 'rent'
              ? 'No rent data for this county (no usable Zillow county, metro or city series and no HUD Fair Market Rent estimate)'
              : `No Zillow ${d.short.toLowerCase()} data for this county`),
            area: text ? 'county' : null,
            caveat: flagNote(sel, d.key),
          }
        }
        if (d.key === 'gas' && own?.gas) {
          return { key: d.key, short: d.short, text: `${own.gas.text} · ${own.gas.detail}`, area: own.gas.area, caveat: null }
        }
        const v = liveValue(liveData, selected, d.key)
        return {
          key: d.key, short: d.short,
          text: v ? `${v.text} · ${v.detail}` : liveError ? 'unavailable right now' : liveData ? 'no data' : 'loading…',
          area: v?.area ?? null,
          caveat: null,
        }
      })
    : []
  const rentSeasonal = rows.find(r => r.key === 'rent')?.seasonal

  return (
    <section ref={ref} className="mt-16 border-t border-line pt-5" data-testid="national-map">
      <p className="kicker text-ink-3">The nation</p>
      <h2 className="mt-1 font-display font-semibold text-3xl sm:text-[34px] leading-none tracking-tight text-ink">
        How every county changed
      </h2>
      <p className="text-sm text-ink-2 mt-2 mb-4 max-w-2xl">
        Each county colored by {def.label.toLowerCase()}{window_ ? `, ${window_}` : ''}{hudCount > 0 && !playing ? '; gray counties have no actual-rent data (hover or tap for HUD’s Fair Market Rent estimate where available)' : ''}. Tap one to see all five measures.
      </p>

      {/* Controls sit above the map, never on top of it, so every county stays tappable */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="flex max-w-full overflow-x-auto border border-line rounded-sm divide-x divide-line" role="group" aria-label="Map measure">
        {DEFS.map(m => (
          <button
            key={m.key}
            onClick={() => { setFrame(null); setMetric(m.key) }}
            aria-pressed={metric === m.key}
            className={`shrink-0 whitespace-nowrap px-2.5 sm:px-3 py-1.5 text-[12.5px] sm:text-[13px] transition-colors focus:outline-none focus-visible:bg-line ${metric === m.key ? 'bg-ink text-desk font-semibold' : 'text-ink-2 hover:text-ink hover:bg-raised'}`}
          >
            {m.short}
          </button>
        ))}
        </div>
        {/* Time-lapse only where there is a county-by-county monthly history (Zillow rent and home prices) */}
        {shapes && !error && countyKey && (
          <button
            onClick={play}
            data-testid="map-play"
            className="ml-auto shrink-0 border border-line text-ink-2 hover:text-ink hover:border-ink-3 text-xs px-3 py-1.5 rounded-sm tnum transition-colors"
          >
            {timelineError
              ? 'Time-lapse unavailable, retry'
              : frame != null ? '■ Stop' : `▶ Play ${meta ? `since ${fmtMonth(meta.baseline)}` : 'month by month'}`}
          </button>
        )}
      </div>

      <div
        ref={mapBoxRef}
        className="relative bg-desk border border-line rounded-md overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-2"
        data-testid="map-box"
        {...(shapes && !error ? {
          tabIndex: 0,
          role: 'group',
          'aria-label': `US county map of ${def.label}. Arrow keys move between counties; Enter selects one.`,
          'aria-describedby': kbdTip ? tipId : undefined,
          // A click / tap focuses the box too: keyboard browsing (tooltip at a county's centroid) starts only on a
          // keyboard focus or the first arrow key, so a tap never leaves a stray tooltip on another county
          onPointerDown: () => { lastPointerDown.current = performance.now(); setKbdAt(null) },
          onFocus: (e: FocusEvent) => {
            if (e.target !== e.currentTarget || kbd) return
            if (performance.now() - lastPointerDown.current < POINTER_FOCUS_MS) return
            focusCounty(selected && shapeById.has(selected) ? selected : centerFips)
          },
          onBlur: () => setKbdAt(null),
          onKeyDown: (e: KeyboardEvent) => {
            if (!shapes) return
            if (e.key === 'Escape') { setKbdAt(null); return }
            const cur = shapeById.get(kbd ?? selected ?? centerFips ?? '')
            if (!cur) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(cur.id); focusCounty(cur.id); return }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              setHover(null)
              focusCounty((kbd ? neighborInDirection(shapes.counties, cur, e.key) : null)?.id ?? cur.id)
            }
          },
        } : {})}
      >
        {error ? (
          <div className="aspect-[975/610] flex flex-col gap-2 items-center justify-center text-ink-3 text-sm" data-testid="map-error">
            <p>{error}</p>
            <button onClick={() => { setError(null); setAttempt(a => a + 1) }} className="text-ink underline underline-offset-4 text-xs">Try again</button>
          </div>
        ) : !shapes ? (
          <div className="aspect-[975/610] flex items-center justify-center text-ink-3 text-sm">Loading map…</div>
        ) : (
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-auto block"
            role="img"
            aria-label={`US county map of ${def.label}`}
            // Hover tooltip for a mouse / pen only: touch keeps tap-to-select (no hover state to show)
            onPointerMove={(e) => {
              if (e.pointerType === 'touch') return
              const f = (e.target as Element).getAttribute?.('data-fips')
              const box = mapBoxRef.current?.getBoundingClientRect()
              if (!f || !box) { setHover(null); return }
              setHover({ fips: f, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width, h: box.height })
            }}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {/* Metro rent: light stripes over the county's color (lighter + hatched, unlike the gray no-data hatch) */}
              <pattern id={METRO_HATCH_ID} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={1.2} height={4} fill="rgba(241,239,234,0.5)" />
              </pattern>
              {/* City rent: light dots over the county's color */}
              <pattern id={CITY_DOTS_ID} width={4} height={4} patternUnits="userSpaceOnUse">
                <circle cx={2} cy={2} r={0.9} fill="rgba(241,239,234,0.6)" />
              </pattern>
              {/* Gas on its own window (Alaska survey months): a light grid over the county's color */}
              <pattern id={SURVEY_GRID_ID} width={4} height={4} patternUnits="userSpaceOnUse">
                <rect width={4} height={0.9} fill="rgba(241,239,234,0.55)" />
                <rect width={0.9} height={4} fill="rgba(241,239,234,0.55)" />
              </pattern>
            </defs>
            <CountyLayer shapes={shapes.counties} fills={fills} onPick={pick} />
            {/* Decorations never take clicks: they must not shadow the counties under them */}
            {metroShapes.length > 0 && (
              <g pointerEvents="none" data-testid="map-metro-hatch">
                {metroShapes.map(s => <path key={s.id} d={s.d} data-metro-fips={s.id} fill={`url(#${METRO_HATCH_ID})`} />)}
              </g>
            )}
            {gasTiers.standIn.length > 0 && (
              <g pointerEvents="none" data-testid="map-gas-standin-hatch">
                {gasTiers.standIn.map(s => <path key={s.id} d={s.d} data-standin-fips={s.id} fill={`url(#${METRO_HATCH_ID})`} />)}
              </g>
            )}
            {gasTiers.own.length > 0 && (
              <g pointerEvents="none" data-testid="map-gas-own-window">
                {gasTiers.own.map(s => <path key={s.id} d={s.d} data-own-fips={s.id} fill={`url(#${SURVEY_GRID_ID})`} />)}
              </g>
            )}
            {cityShapes.length > 0 && (
              <g pointerEvents="none" data-testid="map-city-dots">
                {cityShapes.map(s => <path key={s.id} d={s.d} data-city-fips={s.id} fill={`url(#${CITY_DOTS_ID})`} />)}
              </g>
            )}
            <path d={shapes.states} fill="none" stroke="#111316" strokeWidth={1.3} strokeLinejoin="round" pointerEvents="none" />
            {selShape && (
              <g pointerEvents="none" data-testid="map-highlight">
                <path d={selShape.d} fill="none" stroke="#111316" strokeWidth={4} strokeLinejoin="round" />
                <path d={selShape.d} fill="none" stroke="#F1EFEA" strokeWidth={1.75} strokeLinejoin="round" />
                <line x1={selShape.c[0]} y1={selShape.c[1] - 9} x2={selShape.c[0]} y2={selShape.c[1] - 26} stroke="#F1EFEA" strokeWidth={1} />
                <circle cx={selShape.c[0]} cy={selShape.c[1] - 28} r={2} fill="#F1EFEA" />
              </g>
            )}
            {tipShape && tipShape.id !== selShape?.id && (
              <path d={tipShape.d} fill="none" stroke="#F1EFEA" strokeWidth={1.1} strokeLinejoin="round" pointerEvents="none" data-testid="map-hover-outline" />
            )}
          </svg>
        )}
        {frame != null && timeline && countyKey && (
          <div className="pointer-events-none absolute top-2.5 left-3" data-testid="map-frame-box">
            <p className="tnum font-display font-semibold text-ink text-2xl tracking-tight" data-testid="map-frame">
              {fmtMonth(timelineMonths(timeline, countyKey)[frame])}
            </p>
            {countyKey === 'rent' && (
              <p className="text-[11px] text-ink-2" data-testid="map-timelapse-note">Time-lapse shows Zillow county series only</p>
            )}
          </div>
        )}
        {tip && tipPos && (
          <div
            className="pointer-events-none absolute z-10 rounded-sm border border-line bg-raised/95 px-2.5 py-1.5 shadow-lg text-[12px] leading-snug"
            style={{ ...tipPos, maxWidth: tipMaxW }}
            data-testid="map-tooltip"
            data-fips={tipFips}
            aria-hidden="true"
          >
            <p className="font-semibold text-ink">{tip.name}</p>
            <p className={`tnum ${tip.noData ? 'text-ink-3' : 'text-ink'}`}>
              {tip.value}{tip.note && <span className="text-caution/90"> · {tip.note}</span>}
            </p>
            {tip.geo && <p className="text-ink-3 text-[11px]">{tip.geo}</p>}
            {tip.when && <p className="text-ink-3 text-[11px]" data-testid="map-tooltip-when">{tip.when}</p>}
          </div>
        )}
        {/* Screen readers: the keyboard-focused county's tooltip, announced as it changes */}
        <p id={tipId} className="sr-only" aria-live="polite" data-testid="map-kbd-status">
          {kbdTip ? [kbdTip.name, kbdTip.value, kbdTip.geo, kbdTip.when, kbdTip.note].filter(Boolean).join(' · ') : ''}
        </p>
      </div>

      {/* Legend: a stepped diverging key with its end values, plus the no-data swatch */}
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="w-full max-w-xs">
          <p className="kicker !text-[10px] text-ink-3 mb-1" data-testid="map-legend-title">
            {legendTitle}
            {claim && <span data-testid="map-legend-claim">{` · ${claim}`}</span>}
          </p>
          <div className="relative h-2.5 rounded-[1px]" aria-hidden style={{ background: `linear-gradient(90deg, ${legendStops.join(',')})` }}>
            {scale.kind === 'diverging' && <span className="absolute left-1/2 -top-0.5 -bottom-0.5 w-px bg-ink-3" />}
          </div>
          <div className="tnum flex justify-between mt-1 font-mono text-[10px] text-ink-3" data-testid="map-legend-scale">
            {scale.kind === 'diverging' ? (
              <>
                <span>{fmtScaleValue(-scale.clamp, unit)} fell</span>
                <span>0</span>
                <span>rose {fmtScaleValue(scale.clamp, unit)}</span>
              </>
            ) : (
              <>
                <span>{fmtScaleValue(scale.lo, unit)}{unit === 'usd' ? '/gal' : ''}</span>
                <span>{fmtScaleValue(scale.hi, unit)}{unit === 'usd' ? '/gal' : ''}</span>
              </>
            )}
          </div>
        </div>
        {oppositeCount > 0 && oppositeColor(scale) && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-opposite">
            <span className="inline-block w-3 h-3 rounded-[1px] border border-line" style={{ background: `linear-gradient(90deg, ${oppositeColor(scale, 0)}, ${oppositeColor(scale)})` }} aria-hidden />
            <span>{scale.kind === 'sequential' && scale.hi > 0 ? `fell (below ${unit === 'usd' ? '$0' : '0%'})` : `rose (above ${unit === 'usd' ? '$0' : '0%'})`}</span>
          </div>
        )}
        {gasTiers.standIn.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-gas-standin">
            <span className="inline-block w-3 h-3 rounded-[1px] border border-line" style={{ background: `${METRO_HATCH_CSS}, ${legendStops[12]}` }} aria-hidden />
            <span>no local series (HI/AK): nearest metro’s price</span>
          </div>
        )}
        {gasTiers.own.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-gas-own">
            <span className="inline-block w-3 h-3 rounded-[1px] border border-line" style={{ background: `${SURVEY_GRID_CSS}, ${legendStops[12]}` }} aria-hidden />
            <span>
              {gasTiers.onlySurvey
                ? `Alaska survey, ${fmtMonth((gasTiers.surveyFrom ?? BASELINE_MONTH).slice(0, 7))} → ${gasTiers.surveyTo ? fmtMonth(gasTiers.surveyTo.slice(0, 7)) : 'latest'} surveys (different window)`
                : 'own window (see tooltip): Alaska survey or a series behind the common month'}
            </span>
          </div>
        )}
        {metric === 'rent' && !playing && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-county">
            <span className="inline-block w-3 h-3 rounded-[1px] border border-line" style={{ background: legendStops[16] }} aria-hidden />
            <span>county rent (Zillow)</span>
          </div>
        )}
        {metroShapes.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-metro">
            <span
              className="inline-block w-3 h-3 rounded-[1px] border border-line"
              style={{ background: `${METRO_HATCH_CSS}, ${legendStops[16]}` }}
              aria-hidden
            />
            <span>metro rent (no usable Zillow county series)</span>
          </div>
        )}
        {cityShapes.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-city">
            <span
              className="inline-block w-3 h-3 rounded-[1px] border border-line"
              style={{ background: `${CITY_DOTS_CSS}, ${legendStops[16]}` }}
              aria-hidden
            />
            <span>city rent (no usable county or metro series)</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-4" data-testid="map-legend-nodata">
          <span className="inline-block w-3 h-3 rounded-[1px] border border-line" style={{ background: NO_DATA_COLOR }} aria-hidden />
          <span>
            {metric !== 'rent'
              ? 'no data'
              : playing ? 'no Zillow county series (time-lapse)'
                : hudCount > 0 ? 'no actual-rent data (hover for HUD estimate where available)' : 'no rent data'}
          </span>
        </div>
      </div>
      <p className="tnum font-mono text-[10.5px] leading-relaxed text-ink-3 mt-1" data-testid="map-source">
        Scale {scaleNote}{metric === 'rent' ? ' (Zillow figures only)' : ''} · {footer}
        {metroShapes.length > 0 ? ' · light stripes = metro rent: the county’s metro series where Zillow has no usable one for the county, as on the Rent card' : ''}
        {gasTiers.standIn.length > 0 ? ' · light stripes = a Hawaii / Alaska county with no gas series of its own, colored by the nearest metro’s price (local prices often higher)' : ''}
        {gasTiers.own.length > 0 ? ' · grid = priced on its own window, not the monthly averages: Alaska’s twice-yearly DCRA community survey (or a series behind the common month); months in the tooltip' : ''}
        {oppositeCount > 0 && scale.kind === 'sequential' ? ` · ${scale.hi > 0 ? 'blue = fell' : 'orange = rose'} (the other side of zero)` : ''}
        {cityShapes.length > 0 ? ' · dots = city rent: the county’s most populous city with a Zillow series where it has no usable county or metro series, as on the Rent card' : ''}
        {hudCount > 0 && !playing
          ? ` · solid gray = no actual-rent data; where HUD publishes one, the tooltip and panel show its ${hudLabel}, 2-bedroom (an estimate, not actual rents; never a map color; not on the Rent card)`
          : ' · solid gray = no data'}
      </p>
      {def.scope === 'live' && (
        <p className="text-[12px] text-ink-2 mt-1" data-testid="map-scope-note">
          {def.scopeNote}{liveError ? ' Live prices are unavailable right now.' : ''}
        </p>
      )}

      {/* Selected county panel: all five measures, each with the area its number covers */}
      {sel && (
        <div ref={panelRef} className="mt-4 bg-surface border border-line rounded-md p-4 sm:p-5" data-testid="map-selection" data-fips={selected}>
          <p className="kicker text-ink-3">Selected county</p>
          <p className="mt-1 font-display font-semibold text-xl leading-tight tracking-tight text-ink">{sel.n}</p>
          <dl className="tnum mt-3 text-[13px] divide-y divide-line border-y border-line">
            {rows.map(r => (
              <div key={r.key} className={`grid grid-cols-[6.5rem_1fr] gap-3 py-1.5 ${r.key === metric ? 'text-ink' : 'text-ink-2'}`} data-testid={`map-value-${r.key}`}>
                <dt className={r.key === metric ? 'font-semibold text-ink' : 'text-ink-3'}>{r.short}: </dt>
                <dd>
                  {r.text}
                  {r.area && <span className="text-ink-3"> · {r.area}</span>}
                  {r.caveat && r.key !== metric && <span className="text-caution/90" title={r.caveat}> (unusual value)</span>}
                  {r.seasonal && <span className="text-caution/90" title={r.seasonal}> †</span>}
                </dd>
              </div>
            ))}
          </dl>
          {selCaveat && <p className="text-[11px] text-caution/90 mt-1.5" data-testid="map-flag-note">{selCaveat}</p>}
          {rentSeasonal && <p className="text-[11px] text-caution/90 mt-1.5" data-testid="map-seasonal-note">† Rent: {rentSeasonal}</p>}
          {sel.z && selected !== countyFips && (
            <button onClick={() => onZipSelect(sel.z!)} className="mt-3 text-sm font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink" data-testid="map-see-place">
              See everything that changed here →
            </button>
          )}
        </div>
      )}

      {/* Movers */}
      {!countyKey && (
        <p className="mt-3 text-[11px] text-ink-3" data-testid="map-no-movers">{NO_MOVERS_NOTE}</p>
      )}
      {countyKey && movers.top.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {([['Biggest increases', movers.top], ['Biggest decreases', movers.bottom]] as const).map(([title, rows]) => (
            <div key={title} className="bg-surface border border-line rounded-md px-4 py-3">
              <p className="kicker text-ink-3 mb-1.5">{title}</p>
              {rows.map(([f, c]) => {
                // Rent: the same seasonal-pattern caveat (†) the card, tooltip and panel carry
                const seasonal = countyKey === 'rent' && hasSeasonalCaveat(c.rentSaCav)
                  ? rentSeasonalCaveat(c.rentSaCav, 'county', { pct: c.rent, curRent: c.rentCur })
                  : undefined
                return (
                  <button key={f} onClick={() => setSelected(f, true)} className="flex justify-between w-full text-left text-[13px] py-1 gap-2 border-t border-line first-of-type:border-t-0 hover:bg-raised -mx-1 px-1 rounded-[2px]" data-testid="map-mover">
                    <span className="text-ink-2 truncate">{c.n}</span>
                    <span className="text-ink tabular-nums font-medium shrink-0">
                      {(c[countyKey] as number) > 0 ? '+' : ''}{(c[countyKey] as number).toFixed(1)}%
                      {seasonal && <span className="text-caution/90" title={seasonal} data-testid="map-mover-seasonal"> †</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          <p className="sm:col-span-2 text-[11px] text-ink-3">
            Among counties with {MOVERS_MIN_JOBS.toLocaleString('en-US')}+ jobs, excluding statistical outliers for this measure and counties whose job counts are approximated (Connecticut).
            {countyKey === 'rent' && [...movers.top, ...movers.bottom].some(([, c]) => hasSeasonalCaveat(c.rentSaCav)) &&
              ' † Seasonal pattern uncertain: the county’s recent seasonal swing differs from the pattern used to adjust it, so this reading may be too high or too low (tap for the size and direction).'}
          </p>
        </div>
      )}
    </section>
  )
}
