'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  fetchZipPulse, fetchCounty, fetchCity, fetchPulseMeta, fmtPct, fmtMoney, fmtMonth, provenance, sinceBaseline,
  approxNote, flagNote, BASELINE_MONTH, YOY_WINDOW,
  type ZipPulse, type CountyPulse, type CityPulse, type PulseMeta,
} from '@/lib/local-pulse'

const monthIndex = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return y * 12 + m - 1
}

function Sparkline({ start, s, color, baseline }: { start: string; s: (number | null)[]; color: string; baseline: string }) {
  // Show the 24 months before the baseline through the latest month, so the baseline sits mid-chart
  const baseAbs = monthIndex(baseline) - monthIndex(start)
  const offset = Math.max(0, baseAbs - 24)
  const pts = s.slice(offset).map((v, i) => [i, v] as const).filter(p => p[1] != null) as [number, number][]
  if (pts.length < 6) return null
  const n = s.length - offset
  const ys = pts.map(p => p[1])
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const W = 160, H = 44
  const x = (i: number) => (i / Math.max(1, n - 1)) * W
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  const baseIdx = baseAbs - offset
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-11" aria-hidden>
      <line x1={x(baseIdx)} x2={x(baseIdx)} y1={0} y2={H} stroke="#52525b" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <rect x={x(baseIdx)} y={0} width={Math.max(0, W - x(baseIdx))} height={H} fill={color} opacity={0.06} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Card({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-5 flex flex-col gap-1.5"
      data-testid={testId}
    >
      {children}
    </motion.div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-medium text-zinc-400 uppercase tracking-widest">{children}</p>
)
const Big = ({ children, color }: { children: React.ReactNode; color: string }) => (
  <p className="text-3xl sm:text-4xl leading-none" style={{ fontFamily: 'var(--font-bebas, sans-serif)', color }}>{children}</p>
)
const Src = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] text-zinc-500 mt-auto pt-2 border-t border-zinc-800" data-testid="provenance">{children}</p>
)
const Note = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-zinc-500">{children}</p>
const Caveat = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] text-amber-300/80" data-testid="flag-note">{children}</p>
)

type Status = 'loading' | 'error' | 'ready'

export interface LocalPulseProps {
  zip: string
  countyFips?: string
  countyName?: string
  cityName?: string
  stateAbbr?: string
  /** The hero "Rent" card already shows this county's Zillow rent: don't repeat it here. */
  heroShowsCountyRent?: boolean
}

export function LocalPulse({ zip, countyFips, countyName, cityName, stateAbbr, heroShowsCountyRent = false }: LocalPulseProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [pulse, setPulse] = useState<ZipPulse | null>(null)
  const [county, setCounty] = useState<CountyPulse | null>(null)
  const [city, setCity] = useState<CityPulse | null>(null)
  const [meta, setMeta] = useState<PulseMeta | null>(null)

  useEffect(() => {
    let live = true
    Promise.allSettled([
      fetchZipPulse(zip),
      countyFips ? fetchCounty(countyFips) : Promise.resolve(null),
      stateAbbr && cityName && countyName ? fetchCity(stateAbbr, cityName, countyName) : Promise.resolve(null),
      fetchPulseMeta(),
    ]).then(([p, c, ci, m]) => {
      if (!live) return
      setPulse(p.status === 'fulfilled' ? p.value : null)
      setCounty(c.status === 'fulfilled' ? c.value : null)
      setCity(ci.status === 'fulfilled' ? ci.value : null)
      setMeta(m.status === 'fulfilled' ? m.value : null)
      // Data files unreachable (not merely "no data for this zip") → show an error state
      setStatus(p.status === 'rejected' && c.status === 'rejected' ? 'error' : 'ready')
    })
    return () => { live = false }
  }, [zip, countyFips, countyName, cityName, stateAbbr])

  if (status === 'loading') {
    return (
      <section className="mt-10" data-testid="local-pulse-loading" aria-busy>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {[0, 1].map(i => <div key={i} className="h-40 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />)}
        </div>
      </section>
    )
  }
  if (status === 'error') {
    return (
      <section className="mt-10" data-testid="local-pulse">
        <p className="text-sm text-zinc-500">Local housing and paycheck data unavailable right now.</p>
      </section>
    )
  }

  const baseline = meta?.baseline ?? BASELINE_MONTH
  const since = sinceBaseline(meta)
  const countyLabel = county?.n ?? (countyName && stateAbbr ? `${countyName}, ${stateAbbr}` : countyName) ?? 'this county'
  const countyShort = countyLabel.split(',')[0]
  const cityLabel = city ? `${city.n} (city)` : ''

  // ---- Home values: county → city → zip estimate
  const zhv = pulse?.hv
  // asOf: the row's own latest month (county rows use the source's latest month from meta.json)
  const hvLead: { pct: number; cur?: number; geo: string; asOf?: string } | null =
    county?.hv != null ? { pct: county.hv, cur: county.hvCur, geo: countyShort }
      : city?.hv ? { pct: city.hv.pct, cur: city.hv.cur, geo: cityLabel, asOf: city.hv.asOf }
        : zhv ? { pct: zhv.pct, cur: zhv.cur, geo: `zip ${zip} (estimate)`, asOf: zhv.asOf }
          : null
  const hvIsZip = hvLead != null && county?.hv == null && !city?.hv
  const hvCaveat = county?.hv != null && hvLead?.geo === countyShort ? flagNote(county, 'hv') : null

  // ---- Rent: county (SA) → county (YoY) → city → zip estimate.
  // When the hero card already shows the county figure, only finer-grained detail is shown here.
  const zr = pulse?.rent
  type RentLead = { pct: number; cur?: number; basis: 'sa' | 'yoy'; geo: string; asOf?: string }
  const countyRentLead: RentLead | null = heroShowsCountyRent ? null
    : county?.rent != null ? { pct: county.rent, cur: county.rentCur, basis: 'sa', geo: countyShort }
      : county?.rentYoY != null ? { pct: county.rentYoY, cur: county.rentCur, basis: 'yoy', geo: countyShort }
        : null
  const rentLead: RentLead | null =
    countyRentLead
      ?? (city?.rent ? { pct: city.rent.pct, cur: city.rent.cur, basis: city.rent.basis, geo: cityLabel, asOf: city.rent.asOf }
        : zr ? { pct: zr.pct, cur: zr.cur, basis: zr.basis, geo: `zip ${zip} (estimate)`, asOf: zr.asOf }
          : null)
  const rentIsZip = rentLead != null && rentLead.geo.startsWith('zip ')
  const rentCaveat = countyRentLead ? flagNote(county, 'rent') : null
  const rentAsOf = rentLead?.asOf ?? meta?.sources.zori?.latest
  const rentWindow = (b: 'sa' | 'yoy') => (b === 'sa' ? since : YOY_WINDOW)
  const rentAdj = (b: 'sa' | 'yoy') => (b === 'sa' ? 'seasonally adjusted by whatchanged' : 'not seasonally adjusted (same-month comparison)')

  // ---- Paychecks
  const real = county?.real != null && county.wage != null && county.cpi != null
  const realCaveat = real ? flagNote(county, 'real') : null
  const signColor = (v: number, goodWhenUp: boolean) => (v === 0 ? '#A1A1AA' : (v > 0) === goodWhenUp ? '#22C55E' : '#F87171')
  const li = pulse?.listings
  const approx = county ? approxNote(county) : null

  if (!hvLead && !rentLead && !li && !real) {
    return (
      <section className="mt-10" data-testid="local-pulse">
        <p className="text-sm text-zinc-500">Detailed local housing data not available for this area.</p>
      </section>
    )
  }

  return (
    <section className="mt-10" data-testid="local-pulse">
      <h2 className="text-3xl text-white" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
        Housing &amp; paychecks in {countyLabel}
      </h2>
      <p className="text-sm text-zinc-400 mb-4">
        County figures first. Zip {zip} figures are estimates: independent sources don&apos;t confirm zip-to-zip differences within a county.
      </p>
      {approx && <p className="text-xs text-amber-300/80 mb-3" data-testid="approx-note">{approx}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {hvLead && (
          <Card testId="pulse-home-values">
            <Label>Home values · {hvLead.geo}</Label>
            <Big color="#F59E0B">{fmtPct(hvLead.pct)}</Big>
            {hvCaveat && <Caveat>{hvCaveat}</Caveat>}
            {hvLead.cur != null && <p className="text-xs text-zinc-300">Typical home value now: <b>{fmtMoney(hvLead.cur)}</b></p>}
            {zhv && !hvIsZip && (
              <p className="text-xs text-zinc-400">
                Estimate for zip {zip}: {fmtPct(zhv.pct)} (typical home {fmtMoney(zhv.cur)})
              </p>
            )}
            {zhv && (
              <>
                <Sparkline start={zhv.start} s={zhv.s} color="#F59E0B" baseline={baseline} />
                <Note>Trend line: zip {zip} estimate; dashed line marks {fmtMonth(baseline)}.</Note>
              </>
            )}
            <Src>{provenance(meta, 'zhvi', hvLead.geo, since, undefined, hvLead.asOf)}</Src>
          </Card>
        )}
        {rentLead && (
          <Card testId="pulse-rent">
            <Label>Rent on new leases · {rentLead.geo}</Label>
            <Big color="#3B82F6">{fmtPct(rentLead.pct)}</Big>
            <p className="text-[11px] text-zinc-500">{rentWindow(rentLead.basis)}</p>
            {rentCaveat && <Caveat>{rentCaveat}</Caveat>}
            {rentLead.cur != null && (
              <p className="text-xs text-zinc-300">
                Typical asking rent: <b>${rentLead.cur.toLocaleString('en-US')}/mo</b>{rentAsOf ? ` (${fmtMonth(rentAsOf)})` : ''}
              </p>
            )}
            {zr && !rentIsZip && (
              <p className="text-xs text-zinc-400">
                Estimate for zip {zip}: {fmtPct(zr.pct)} {rentWindow(zr.basis)}
              </p>
            )}
            {zr?.basis === 'sa' && zr.s && zr.start && (
              <>
                <Sparkline start={zr.start} s={zr.s} color="#3B82F6" baseline={baseline} />
                <Note>Trend line: zip {zip} estimate; dashed line marks {fmtMonth(baseline)}.</Note>
              </>
            )}
            <Note>
              {heroShowsCountyRent
                ? `The ${countyShort} figure is in the Rent card above; this is a finer-grained estimate from the same Zillow data.`
                : 'Zillow tracks asking rents on new leases. The Shelter prices (CPI) card above covers all renters (including existing leases) and homeowners and trails market rents by about a year, so the two can differ.'}
            </Note>
            <Src>{provenance(meta, 'zori', rentLead.geo, rentWindow(rentLead.basis), rentAdj(rentLead.basis), rentLead.asOf)}</Src>
          </Card>
        )}
        {real && county && (
          <Card testId="pulse-paychecks">
            <Label>Paychecks vs. prices · {countyShort}</Label>
            <div className="flex items-end gap-4">
              <div>
                <p className="text-[11px] text-zinc-500">Avg weekly pay</p>
                <Big color={signColor(county.wage!, true)}>{fmtPct(county.wage!)}</Big>
              </div>
              <p className="text-zinc-600 pb-1">vs</p>
              <div>
                <p className="text-[11px] text-zinc-500">Prices ({county.cpiName ?? 'regional'} CPI)</p>
                <Big color={signColor(county.cpi!, false)}>{fmtPct(county.cpi!)}</Big>
              </div>
            </div>
            <p className="text-sm font-semibold" style={{ color: signColor(county.real!, true) }}>
              {county.real! >= 0 ? 'Paychecks outpaced prices' : 'Prices outpaced paychecks'} by {Math.abs(county.real!).toFixed(1)}%
            </p>
            {realCaveat && <Caveat>{realCaveat}</Caveat>}
            <Note>
              {meta?.paycheckWindow ? `Compares ${meta.paycheckWindow}. ` : ''}
              This window is not &ldquo;{since}&rdquo;; it starts earlier.
              {county.wageCur != null && ` Average weekly pay across all jobs in the county: $${county.wageCur.toLocaleString('en-US')}.`}
              {' '}Averages shift when the mix of jobs changes, not just when raises happen.
            </Note>
            <Src>{provenance(meta, 'qcew', `${countyShort} wages, ${county.cpiName ?? 'regional'} CPI`)}</Src>
          </Card>
        )}
        {li && (
          <Card testId="pulse-listings">
            <Label>Homes for sale · zip {zip}</Label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-1">
              <Stat label="Median list price" v={fmtMoney(li.price)} d={li.priceYoY} />
              <Stat label="Homes for sale" v={li.active.toLocaleString('en-US')} d={li.activeYoY} />
              {li.dom != null && <Stat label="Days on market" v={`${li.dom}`} d={li.domYoY} />}
              {li.reduced != null && <Stat label="With price cuts" v={`${Math.round(li.reduced * 100)}%`} />}
            </div>
            <Note>
              List prices of homes currently for sale, vs a year ago. They shift with the mix of homes listed, so they
              can move differently from home values.
            </Note>
            {li.volatile && <Note>Few listings here, so figures can swing month to month.</Note>}
            <Src>{provenance(meta, 'realtor', `zip ${zip}`, 'vs a year earlier')}</Src>
          </Card>
        )}
      </div>
    </section>
  )
}

function Stat({ label, v, d }: { label: string; v: string; d?: number | null }) {
  return (
    <div>
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-lg text-white leading-tight" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>{v}</p>
      {d != null && <p className="text-[11px] text-zinc-400">{fmtPct(d * 100, 0)} vs last year</p>}
    </div>
  )
}
