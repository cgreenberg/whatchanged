// Provenance footer shared by hero cards and charts:
//   source · geography · window · as-of · adjustment
// Every part is generated from API fields / meta.json — never hard-coded dates.

import type { CpiData } from '@/types'
import { DATE_UNAVAILABLE } from '@/lib/format'
import { cpiMetroShortName, hiAkCpiOfficialName } from '@/lib/mappings/county-metro-cpi'

export interface Provenance {
  source: string
  sourceUrl?: string
  geography: string
  window: string
  /** Date of the latest data point (never today's date); "date unavailable" when unknown. */
  asOf: string
  adjustment: string
}

export const PROVENANCE_KEYS = ['source', 'geography', 'window', 'asOf', 'adjustment'] as const

export function provenanceParts(p: Provenance): string[] {
  return [p.source, p.geography, p.window, p.asOf || DATE_UNAVAILABLE, p.adjustment]
}

export function provenanceText(p: Provenance): string {
  return provenanceParts(p).join(' · ')
}

/** True when every provenance field is a non-empty string. */
export function isCompleteProvenance(p: Partial<Provenance> | null | undefined): p is Provenance {
  if (!p) return false
  return PROVENANCE_KEYS.every(k => typeof p[k] === 'string' && (p[k] as string).trim().length > 0)
}

/** CPI area code from the snapshot (areaCode, else parsed from the series id). */
export function cpiAreaCodeOf(cpi: Pick<CpiData, 'areaCode' | 'seriesIds'> | null | undefined): string | undefined {
  if (!cpi) return undefined
  if (cpi.areaCode) return cpi.areaCode
  const m = /^CUU[RS]([0-9A-Z]{4})/.exec(cpi.seriesIds?.groceries ?? '')
  return m ? m[1] : undefined
}

/**
 * CPI geography tier. Uses `tier` when present; for stale cache entries without it,
 * infers from the BLS area code: 0000 national, 0x00 region, 0xx0 division, Sxxx metro.
 */
export function cpiTierOf(cpi: Pick<CpiData, 'tier' | 'areaCode' | 'seriesIds' | 'metro'> | null | undefined): 1 | 2 | 3 | 4 | null {
  if (!cpi) return null
  if (cpi.tier === 1 || cpi.tier === 2 || cpi.tier === 3 || cpi.tier === 4) return cpi.tier
  const code = cpiAreaCodeOf(cpi)
  if (code) {
    if (code === '0000') return 4
    if (/^0[1-4]00$/.test(code)) return 3
    if (/^0\d\d0$/.test(code)) return 2
    if (/^S/.test(code)) return 1
  }
  if (cpi.metro === 'National') return 4
  return null
}

/** "metro: Chicago-Naperville-Elgin" / "division: Mountain" / "region: South Urban" / "national"
 * ("national (local data unavailable)" when the national series stands in for a failed local fetch). */
export function cpiGeoLabel(
  cpi: Pick<CpiData, 'tier' | 'areaCode' | 'seriesIds' | 'metro' | 'fallback'> | null | undefined,
): string {
  if (!cpi) return 'area unavailable'
  if (cpi.fallback === 'national') return 'national (local data unavailable)'
  const tier = cpiTierOf(cpi)
  switch (tier) {
    case 4: return 'national'
    case 3: return `region: ${cpi.metro}`
    case 2: return `division: ${cpi.metro}`
    case 1: {
      const official = hiAkCpiOfficialName(cpi.areaCode, cpi.metro)
      return official ? `metro: ${cpiMetroShortName(cpi.areaCode, cpi.metro)} (BLS area: ${official})` : `metro: ${cpi.metro}`
    }
    default: return `area: ${cpi.metro}`
  }
}
