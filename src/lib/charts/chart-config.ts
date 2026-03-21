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

// ORDER KEY:
// Row 1: gas (1) + groceries (2) — side by side (medium)
// Row 2: shelter (3) — full width (large)
// Row 3: energy (4) + unemployment (5) — side by side (medium)
// Mobile: stacked in same order

export const chartConfigs: ChartConfig[] = [
  {
    id: 'gas',
    title: 'Gas Prices',
    description: 'Average retail price per gallon for regular gasoline in your state, updated weekly.',
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
    formatValue: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
    sourceLabel: 'BLS Consumer Price Index',
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SAF11',
    geoLevel: 'Metro area (when available)',
    showNationalToggle: true,
  },
  {
    id: 'cpi-shelter',
    title: 'Shelter Costs',
    description: 'BLS index tracking rent, homeowner costs, and lodging. Covers what people pay for housing.',
    chartType: 'line',
    series: [
      { dataKey: 'shelter', label: 'Shelter', color: '#3B82F6', type: 'monotone' },
    ],
    size: 'large',
    order: 3,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '% change',
    normalizeToBaseline: true,
    formatValue: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
    sourceLabel: 'BLS Consumer Price Index',
    geoLevel: 'Metro area (when available)',
    showNationalToggle: true,
  },
  {
    id: 'cpi-energy',
    title: 'Energy Costs',
    description: 'BLS index tracking electricity, natural gas, and fuel oil prices for households.',
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
    formatValue: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
    sourceLabel: 'BLS Consumer Price Index',
    geoLevel: 'Metro area (when available)',
    showNationalToggle: true,
  },
  {
    id: 'unemployment',
    title: 'Unemployment Rate',
    description: 'Percentage of the labor force that is jobless and actively seeking work, measured at the county level.',
    chartType: 'area',
    series: [
      { dataKey: 'rate', label: 'Unemployment Rate', color: '#F59E0B', type: 'monotone' },
    ],
    size: 'medium',
    order: 5,
    defaultTimeframe: 'Jan 2025',
    eraShading: true,
    yAxisLabel: '%',
    formatValue: (v) => `${v.toFixed(1)}%`,
    sourceLabel: 'BLS Local Area Unemployment Statistics',
    sourceUrl: 'https://data.bls.gov/lausmap/',
    geoLevel: 'County-level',
    showNationalToggle: true,
  },
]
