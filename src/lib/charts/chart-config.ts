import { fmtSignedPct } from '@/lib/format'

export type ChartType = 'area' | 'line' | 'bar'
export type Timeframe = 'Jan 2025' | '3Y' | '5Y' | '10Y'
export type ChartSize = 'small' | 'medium' | 'large'

export interface SeriesConfig {
  dataKey: string        // key in the data point object
  label: string          // legend label
  color: string          // stroke/fill color
  type?: 'monotone' | 'linear' | 'step'
}

export interface ChartConfig {
  id: string
  title: string
  description?: string  // tooltip explaining what this metric is
  chartType: ChartType
  series: SeriesConfig[]
  trendline?: boolean
  size: ChartSize
  order: number
  defaultTimeframe: Timeframe
  eraShading: boolean
  yAxisLabel?: string
  yAxisDomain?: [number | 'auto', number | 'auto']
  formatValue?: (value: number) => string
  sourceLabel?: string
  sourceUrl?: string
  geoLevel?: string
  showNationalToggle?: boolean
  normalizeToBaseline?: boolean  // normalize first visible point to 100 (percentage change view)
}

// ORDER KEY (ChartsSection renders the Housing graph in the shelter slot, with three tabs):
// 2 × 2 grid from 768px (md), all 'medium':
// Row 1: gas (1) | groceries (2)
// Row 2: Housing (3): Rent | Home prices | Shelter (CPI) tabs | energy (4)
// Under 768px: one column, same order

export const chartConfigs: ChartConfig[] = [
  {
    id: 'gas',
    title: 'Gas prices (regular)',
    description: 'EIA average retail price per gallon of regular gasoline for the closest area EIA publishes (city, state, or region), updated weekly.',
    chartType: 'line',
    series: [
      { dataKey: 'price', label: 'Regular Gas ($/gal)', color: '#F59E0B', type: 'monotone' },
    ],
    size: 'medium',
    order: 1,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '$/gal',
    formatValue: (v) => `$${v.toFixed(2)}`,
    sourceLabel: 'EIA Weekly Retail Gasoline Prices',
    sourceUrl: 'https://www.eia.gov/petroleum/gasdiesel/',
    geoLevel: 'State-level',
    showNationalToggle: true,
  },
  {
    id: 'cpi-groceries',
    title: 'Grocery Prices',
    description: 'BLS Consumer Price Index for food purchased at grocery stores and supermarkets (food at home).',
    chartType: 'line',
    series: [
      { dataKey: 'groceries', label: 'Groceries', color: '#EF4444', type: 'monotone' },
    ],
    size: 'medium',
    order: 2,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '% change',
    normalizeToBaseline: true,
    formatValue: (v) => fmtSignedPct(v),
    sourceLabel: 'BLS Consumer Price Index',
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SAF11',
    geoLevel: 'Metro area (when available)',
    showNationalToggle: true,
  },
  {
    id: 'cpi-shelter',
    title: 'Housing costs',
    description: 'BLS CPI shelter: rent paid by all tenants (including existing leases) plus homeowners\' equivalent rent. It trails new-lease asking rents by about a year.',
    chartType: 'line',
    series: [
      { dataKey: 'shelter', label: 'Shelter', color: '#3B82F6', type: 'monotone' },
    ],
    size: 'medium',
    order: 3,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '% change',
    normalizeToBaseline: true,
    formatValue: (v) => fmtSignedPct(v),
    sourceLabel: 'BLS Consumer Price Index',
    geoLevel: 'Metro area (when available)',
    showNationalToggle: true,
  },
  {
    id: 'cpi-energy',
    title: 'Energy Costs',
    description: 'BLS CPI energy index: household energy (electricity, utility natural gas, fuel oil) plus motor fuel (gasoline), which is roughly half its weight.',
    chartType: 'line',
    series: [
      { dataKey: 'energy', label: 'Energy', color: '#10B981', type: 'monotone' },
    ],
    size: 'medium',
    order: 4,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '% change',
    normalizeToBaseline: true,
    formatValue: (v) => fmtSignedPct(v),
    sourceLabel: 'BLS Consumer Price Index',
    geoLevel: 'Metro area (when available)',
    showNationalToggle: true,
  },
]

/** Zillow tabs of the Housing graph (same slot and layout as CPI shelter; % change from the first visible month). */
export const housingTabConfigs: Record<'rent' | 'homePrices', ChartConfig> = {
  rent: {
    id: 'housing-rent',
    title: 'Housing costs',
    description: 'Zillow Observed Rent Index (ZORI): typical asking rent on new leases in your county, seasonally adjusted by whatchanged. Same series as the Rent card.',
    chartType: 'line',
    series: [{ dataKey: 'rent', label: 'Rent (new leases)', color: '#3B82F6', type: 'monotone' }],
    size: 'medium',
    order: 3,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '% change',
    normalizeToBaseline: true,
    formatValue: (v) => fmtSignedPct(v),
    sourceLabel: 'Zillow Observed Rent Index (ZORI)',
    sourceUrl: 'https://www.zillow.com/research/data/',
    geoLevel: 'County',
    showNationalToggle: true,
  },
  homePrices: {
    id: 'housing-home-prices',
    title: 'Housing costs',
    description: "Zillow Home Value Index (ZHVI): Zillow's smoothed, seasonally adjusted estimate of the typical (middle-tier) home value in your county.",
    chartType: 'line',
    series: [{ dataKey: 'hv', label: 'Typical home value', color: '#8B5CF6', type: 'monotone' }],
    size: 'medium',
    order: 3,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '% change',
    normalizeToBaseline: true,
    formatValue: (v) => fmtSignedPct(v),
    sourceLabel: 'Zillow Home Value Index (ZHVI)',
    sourceUrl: 'https://www.zillow.com/research/data/',
    geoLevel: 'County',
    showNationalToggle: true,
  },
}
