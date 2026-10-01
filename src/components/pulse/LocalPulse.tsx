'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  fetchZipPulse, fetchCounties, fetchPulseMeta, fmtPct, fmtMoney, fmtMonth, rankPhrase,
  type ZipPulse, type CountyPulse, type MonthlySeries,
} from '@/lib/local-pulse'

function Sparkline({ series, color }: { series: MonthlySeries; color: string }) {
  // Show Jan 2023 → latest so the Jan 2025 marker sits mid-chart
  const [sy, sm] = series.start.split('-').map(Number)
  const offset = Math.max(0, (2023 - sy) * 12 + (1 - sm))
  const pts = series.s.slice(offset).map((v, i) => [i, v] as const).filter(p => p[1] != null) as [number, number][]
  if (pts.length < 6) return null
  const n = series.s.length - offset
  const ys = pts.map(p => p[1])
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const W = 160, H = 44
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  const baseIdx = (2025 - sy) * 12 + (1 - sm) - offset
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-11" aria-hidden>
      <line x1={x(baseIdx)} x2={x(baseIdx)} y1={0} y2={H} stroke="#52525b" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <rect x={x(baseIdx)} y={0} width={W - x(baseIdx)} height={H} fill={color} opacity={0.06} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      
    </svg>
  )
}

function RankBar({ rank, color }: { rank: number; color: string }) {
  return (
    <div className="mt-1">
      <div className="relative h-1.5 rounded-full bg-zinc-800">
        <motion.div
          className="absolute -top-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-950"
          style={{ background: color }}
          initial={{ left: '0%' }}
          animate={{ left: `calc(${rank}% - 7px)` }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
        <span>slowest</span><span>US zips</span><span>fastest</span>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-5 flex flex-col gap-1.5"
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
  <p className="text-[11px] text-zinc-500 mt-auto pt-2 border-t border-zinc-800">{children}</p>
)

export function LocalPulse({ zip, countyFips }: { zip: string; countyFips?: string }) {
  const [pulse, setPulse] = useState<ZipPulse | null | undefined>(undefined)
  const [county, setCounty] = useState<CountyPulse | null>(null)
  const [window_, setWindow] = useState<string>('latest quarter vs a year earlier')

  useEffect(() => {
    let live = true
    fetchZipPulse(zip).then(p => live && setPulse(p))
    fetchPulseMeta().then(m => live && m?.paycheckWindow && setWindow(m.paycheckWindow))
    if (countyFips) fetchCounties().then(c => live && setCounty(c[countyFips] ?? null))
    return () => { live = false }
  }, [zip, countyFips])

  if (pulse === undefined) return null
  const hv = pulse?.hv, rent = pulse?.rent, li = pulse?.listings
  const real = county?.real != null && county.wage != null && county.cpi != null
  if (!hv && !rent && !li && !real) return null

  return (
    <section className="mt-10" data-testid="local-pulse">
      <h2 className="text-3xl text-white" style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}>
        Zoom in: zip {zip}
      </h2>
      <p className="text-sm text-zinc-400 mb-4">Neighborhood-level data, not metro averages.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {real && county && (
          <Card>
            <Label>Paychecks vs. prices · {county.n.split(',')[0]}</Label>
            <div className="flex items-end gap-4">
              <div>
                <p className="text-[11px] text-zinc-500">Avg weekly pay</p>
                <Big color="#22C55E">{fmtPct(county.wage!)}</Big>
              </div>
              <p className="text-zinc-600 pb-1">vs</p>
              <div>
                <p className="text-[11px] text-zinc-500">Local prices</p>
                <Big color="#F87171">{fmtPct(county.cpi!)}</Big>
              </div>
            </div>
            <p className="text-sm font-semibold" style={{ color: county.real! >= 0 ? '#22C55E' : '#F87171' }}>
              {county.real! >= 0 ? 'Paychecks outpaced prices' : 'Prices outpaced paychecks'} by {Math.abs(county.real!).toFixed(1)}%
            </p>
            {county.wageCur != null && (
              <p className="text-xs text-zinc-400">
                Average weekly pay across all jobs in the county: ${county.wageCur.toLocaleString('en-US')} (latest quarter).
                Averages shift when the mix of jobs changes, not just when raises happen.
              </p>
            )}
            <Src>BLS QCEW + CPI · {window_} · county-level wages</Src>
          </Card>
        )}
        {hv && (
          <Card>
            <Label>Home values</Label>
            <Big color="#F59E0B">{fmtPct(hv.pct)}</Big>
            <p className="text-xs text-zinc-300">
              Typical home {fmtMoney(hv.base)} → <b>{fmtMoney(hv.cur)}</b>
              {' '}({hv.cur - hv.base >= 0 ? '+' : '−'}{fmtMoney(Math.abs(hv.cur - hv.base))})
            </p>
            <Sparkline series={hv} color="#F59E0B" />
            <p className="text-xs text-zinc-400">{rankPhrase(hv.rank)}</p>
            <RankBar rank={hv.rank} color="#F59E0B" />
            <Src>Zillow ZHVI · {fmtMonth(hv.asOf)} · zip-level</Src>
          </Card>
        )}
        {rent && (
          <Card>
            <Label>Rent</Label>
            <Big color="#3B82F6">{fmtPct(rent.pct)}</Big>
            <p className="text-xs text-zinc-300">
              Typical rent ${rent.base.toLocaleString('en-US')} → <b>${rent.cur.toLocaleString('en-US')}/mo</b>
              {' '}(≈ {rent.cur - rent.base >= 0 ? '+' : '−'}${Math.abs((rent.cur - rent.base) * 12).toLocaleString('en-US')}/yr)
            </p>
            <Sparkline series={rent} color="#3B82F6" />
            <p className="text-xs text-zinc-400">{rankPhrase(rent.rank)}</p>
            <RankBar rank={rent.rank} color="#3B82F6" />
            <Src>Zillow ZORI (seasonally adj.) · {fmtMonth(rent.asOf)} · zip-level</Src>
          </Card>
        )}
        {li && (
          <Card>
            <Label>For-sale market right now</Label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-1">
              <Stat label="Median list price" v={fmtMoney(li.price)} d={li.priceYoY} />
              <Stat label="Homes for sale" v={li.active.toLocaleString('en-US')} d={li.activeYoY} />
              {li.dom != null && <Stat label="Days on market" v={`${li.dom}`} d={li.domYoY} />}
              {li.reduced != null && <Stat label="With price cuts" v={`${Math.round(li.reduced * 100)}%`} />}
            </div>
            {li.volatile && <p className="text-[11px] text-zinc-500">Few listings here — figures can swing month to month.</p>}
            <Src>Realtor.com® Economic Research · vs. 1 year ago · zip-level</Src>
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
