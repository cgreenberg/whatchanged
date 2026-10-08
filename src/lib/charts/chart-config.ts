import { fmtSignedPct } from '@/lib/format'
import { METRIC_COLORS } from '@/lib/theme'

export type ChartType = 'area' | 'line' | 'bar'
export type Timeframe = 'Jan 2025' | '3Y' | '5Y' | '10Y'
export type ChartSize = 'small' | 'medium' | 'large'

export interface SeriesConfig {
  dataKey: string        // key in the data point object
  label: string          // legend label
  color: string          // stroke/fill color
  type?: 'monotone' | 'linear' | 'step'
  /** Secondary line styling (e.g. the published monthly electricity price under the 12-month average). */
  strokeWidth?: number
  strokeOpacity?: number
  strokeDasharray?: string
  /** Secondary lines: also label this line's latest value at the right edge, with this short tag ("month"). */
  endLabel?: string
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
// Row 2: Housing (3): Rent | Home prices | Shelter (CPI) tabs | electricity (4)
// Under 768px: one column, same order

export const chartConfigs: ChartConfig[] = [
  {
    id: 'gas',
    title: 'Gas prices (regular)',
    description: 'EIA average retail price per gallon of regular gasoline for the closest area EIA publishes (city, state, or region), updated weekly.',
    chartType: 'line',
    series: [
      { dataKey: 'price', label: 'Regular gas ($/gal)', color: METRIC_COLORS.gas, type: 'monotone' },
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
      { dataKey: 'groceries', label: 'Groceries', color: METRIC_COLORS.groceries, type: 'monotone' },
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
    description: 'BLS CPI shelter: rent paid by all tenants (including existing leases) plus homeowners\' equivalent rent. It trails asking rents on new listings by about a year.',
    chartType: 'line',
    series: [
      { dataKey: 'shelter', label: 'Shelter', color: METRIC_COLORS.shelter, type: 'monotone' },
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
    id: 'electricity',
    title: 'Electricity prices',
    description: "EIA average residential electricity price for your state, in cents per kWh. The bold line is a 12-month average plotted at the middle of its 12 months, so its point at Jan 2025 is the baseline (Aug 2024–Jul 2025) and it ends 6 months before the latest month with the latest 12 months' average: the card's two numbers. The thin line is each month's published price, which swings with the seasons.",
    chartType: 'line',
    series: [
      { dataKey: 'avg12', label: '12-month average (centered)', color: METRIC_COLORS.electricity, type: 'monotone' },
      { dataKey: 'price', label: 'Monthly price', color: METRIC_COLORS.electricity, type: 'monotone', strokeWidth: 1, strokeOpacity: 0.45, endLabel: 'month' },
    ],
    size: 'medium',
    order: 4,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '¢/kWh',
    formatValue: (v) => `${v.toFixed(1)}¢`,
    sourceLabel: 'EIA Electricity Data Browser',
    sourceUrl: 'https://www.eia.gov/electricity/data/browser/',
    geoLevel: 'State',
    showNationalToggle: true,
  },
]

/** Zillow tabs of the Housing graph (same slot and layout as CPI shelter; % change from the first visible month). */
export const housingTabConfigs: Record<'rent' | 'homePrices', ChartConfig> = {
  rent: {
    id: 'housing-rent',
    title: 'Housing costs',
    description: 'Zillow Observed Rent Index (ZORI): typical asking rent on new listings in your county, seasonally adjusted by whatchanged. Same series as the Rent card.',
    chartType: 'line',
    series: [{ dataKey: 'rent', label: 'Rent (new listings)', color: METRIC_COLORS.rent, type: 'monotone' }],
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
    series: [{ dataKey: 'hv', label: 'Typical home value', color: METRIC_COLORS.homePrices, type: 'monotone' }],
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

/** ⓘ notes for the Home heating graph. */
export const HEATING_NOTE =
  "EIA's State Heating Oil and Propane Program (SHOPP) surveys residential prices weekly from October through March only; " +
  'between seasons the latest reading is the end of March. Prices are per gallon delivered to homes, before taxes.'
export const NYSERDA_NOTE =
  'NYSERDA surveys New York heating oil dealers weekly September–March and twice a month April–August; ' +
  'the regional average for your county, compared with the New York statewide average from the same survey.'

/**
 * Home heating graph (5th graph, after Electricity; not a hero card): Heating oil | Propane tabs, each only
 * where a source has data. Weekly $/gal; % headline since the week of Jan 20, 2025.
 */
export const heatingTabConfigs: Record<'oil' | 'propane', ChartConfig> = {
  oil: {
    id: 'heating-oil',
    title: 'Home heating fuel',
    description: 'Average residential price per gallon of No. 2 heating oil delivered to homes, weekly.',
    chartType: 'line',
    series: [{ dataKey: 'price', label: 'Heating oil ($/gal)', color: METRIC_COLORS.heating, type: 'monotone' }],
    size: 'medium',
    order: 5,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '$/gal',
    formatValue: (v) => `$${v.toFixed(2)}`,
    sourceLabel: 'EIA Heating Oil and Propane Update',
    sourceUrl: 'https://www.eia.gov/petroleum/heatingoilpropane/',
    geoLevel: 'State (NY: NYSERDA region)',
    showNationalToggle: true,
  },
  propane: {
    id: 'heating-propane',
    title: 'Home heating fuel',
    description: 'Average residential price per gallon of propane delivered to homes, weekly.',
    chartType: 'line',
    series: [{ dataKey: 'price', label: 'Propane ($/gal)', color: METRIC_COLORS.heating, type: 'monotone' }],
    size: 'medium',
    order: 5,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '$/gal',
    formatValue: (v) => `$${v.toFixed(2)}`,
    sourceLabel: 'EIA Heating Oil and Propane Update',
    sourceUrl: 'https://www.eia.gov/petroleum/heatingoilpropane/',
    geoLevel: 'State',
    showNationalToggle: true,
  },
}
