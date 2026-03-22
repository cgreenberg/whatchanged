export interface ZipInfo {
  zip: string
  countyFips: string
  countyName: string
  stateName: string
  stateAbbr: string
  cityName: string
}

export interface DataResult<T> {
  data: T | null
  error: string | null
  fetchedAt: string // ISO date string
  sourceId: string
}

export interface UnemploymentPoint {
  date: string // YYYY-MM format
  rate: number
}

export interface UnemploymentData {
  current: number
  baseline: number // Jan 2025 value
  change: number // current - baseline
  series: UnemploymentPoint[]
  countyFips: string
  seriesId?: string
  nationalSeries?: UnemploymentPoint[]
}

export interface CpiPoint {
  date: string
  groceries: number
  shelter: number | null
  energy: number | null
}

export interface CpiData {
  groceriesCurrent: number
  groceriesBaseline: number
  groceriesChange: number
  shelterChange: number
  series: CpiPoint[]
  metro: string
  seriesIds?: { groceries: string; shelter: string; energy: string }
  nationalSeries?: CpiPoint[]
}

export interface GasPriceData {
  current: number
  baseline: number
  change: number
  region: string
  series: Array<{ date: string; price: number }>
  nationalSeries?: Array<{ date: string; price: number }>
  isNationalFallback?: boolean
  geoLevel?: string
}

export interface FederalFundingData {
  amountCut: number // total $ cut since Jan 20 2025
  contractsCut: number // count of contracts cancelled/reduced
  grantsCut: number // count of grants cancelled/reduced
  countyFips: string
}

export interface CensusData {
  medianIncome: number
  medianRent: number
  zip: string
  year: number
}

export interface CacheStatus {
  unemployment: 'hit' | 'miss'
  cpi: 'hit' | 'miss'
  gas: 'hit' | 'miss'
  federal: 'hit' | 'miss'
  census: 'hit' | 'miss'
}

export interface EconomicSnapshot {
  zip: string
  location: ZipInfo
  unemployment: DataResult<UnemploymentData>
  cpi: DataResult<CpiData>
  gas: DataResult<GasPriceData>
  federal: DataResult<FederalFundingData>
  census: DataResult<CensusData>
  fetchedAt: string
  cacheStatus?: CacheStatus
}
