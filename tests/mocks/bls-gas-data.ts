// GasPriceData for a BLS monthly gas tier, built from the real recorded BLS response
// (tests/fixtures/bls-gas-ap-2024-2026.json) with the real parser — national overlay = APU000074714.
import type { GasPriceData } from '@/types'
import type { BlsRawPoint } from '@/lib/api/bls-common'
import { describeBlsGasArea, parseBlsGasSeries, BLS_NATIONAL_GAS_LOOKUP } from '@/lib/api/bls-gas'
import { toGasPriceData } from '@/lib/api/eia'
import recorded from '../fixtures/bls-gas-ap-2024-2026.json'

export function blsGasRaw(area: string): BlsRawPoint[] {
  const s = (recorded.Results.series as Array<{ seriesID: string; data: BlsRawPoint[] }>).find((x) => x.seriesID === `APU${area}74714`)
  if (!s) throw new Error(`no recorded APU${area}74714`)
  return s.data
}

export function blsGasData(area: string): GasPriceData {
  const lookup = describeBlsGasArea(area)
  const local = parseBlsGasSeries(blsGasRaw(area), lookup.areaName ?? area)
  const nat = parseBlsGasSeries(blsGasRaw('0000'), BLS_NATIONAL_GAS_LOOKUP.areaName ?? 'U.S.')
  return toGasPriceData(lookup, local, { nationalSeries: nat.series })
}
