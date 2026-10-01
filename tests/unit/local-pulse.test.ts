import { fmtPct, rankPhrase, divergingColor, fmtMoney } from '@/lib/local-pulse'
import fs from 'fs'
import path from 'path'

describe('local-pulse helpers', () => {
  it('formats percentages without "-0.0%"', () => {
    expect(fmtPct(-0.04)).toBe('0%')
    expect(fmtPct(3.25)).toBe('+3.3%')
    expect(fmtPct(-1.2)).toBe('-1.2%')
  })
  it('phrases ranks in both directions', () => {
    expect(rankPhrase(82)).toMatch(/bigger increase than 82%/)
    expect(rankPhrase(10)).toMatch(/smaller increase than 90%/)
  })
  it('clamps colors and handles missing data', () => {
    expect(divergingColor(undefined, 10)).toBe('#18181b')
    expect(divergingColor(100, 10)).toBe(divergingColor(10, 10))
  })
  it('formats money', () => {
    expect(fmtMoney(2_967_210)).toBe('$2.97M')
    expect(fmtMoney(412_000)).toBe('$412K')
  })
})

describe('built local data sanity', () => {
  const dir = path.join(process.cwd(), 'public/data')
  const counties = JSON.parse(fs.readFileSync(path.join(dir, 'counties.json'), 'utf8'))
  it('covers most US counties', () => {
    const withHv = Object.values(counties).filter((c: any) => c.hv != null).length
    expect(withHv).toBeGreaterThan(2800)
  })
  it('keeps metrics within sane ranges', () => {
    for (const c of Object.values(counties) as any[]) {
      if (c.hv != null) expect(Math.abs(c.hv)).toBeLessThan(50)
      if (c.ur != null) expect(Math.abs(c.ur)).toBeLessThan(15)
      if (c.urCur != null) expect(c.urCur).toBeGreaterThanOrEqual(0)
      if (c.cpi != null) expect(Math.abs(c.cpi)).toBeLessThan(20)
    }
  })
  it('has zip shards with leading-zero zips (New England)', () => {
    const shard = JSON.parse(fs.readFileSync(path.join(dir, 'zip/021.json'), 'utf8'))
    expect(Object.keys(shard).every(z => /^021\d\d$/.test(z))).toBe(true)
  })
})
