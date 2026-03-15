export type ChartType = 'area' | 'line' | 'bar'
export type Timeframe = '1Y' | '3Y' | '5Y' | '10Y'
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
}

export const chartConfigs: ChartConfig[] = [
  {
    id: 'unemployment',
    title: 'Unemployment Rate',
    chartType: 'area',
    series: [
      { dataKey: 'rate', label: 'Unemployment Rate', color: '#F59E0B', type: 'monotone' },
    ],
    size: 'large',
    order: 1,
    defaultTimeframe: '5Y',
    eraShading: true,
    yAxisLabel: '%',
    formatValue: (v) => `${v.toFixed(1)}%`,
    sourceLabel: 'BLS Local Area Unemployment Statistics',
    sourceUrl: 'https://data.bls.gov/lausmap/',
    geoLevel: 'County-level',
  },
  {
    id: 'cpi',
    title: 'Consumer Prices (Index)',
    chartType: 'line',
    series: [
      { dataKey: 'groceries', label: 'Groceries', color: '#EF4444', type: 'monotone' },
      { dataKey: 'shelter', label: 'Shelter', color: '#3B82F6', type: 'monotone' },
      { dataKey: 'energy', label: 'Energy', color: '#10B981', type: 'monotone' },
    ],
    size: 'large',
    order: 2,
    defaultTimeframe: '5Y',
    eraShading: true,
    yAxisLabel: 'Index',
    sourceLabel: 'BLS Consumer Price Index',
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SAF11',
    geoLevel: 'National (not local)',
  },
  {
    id: 'gas',
    title: 'Gas Prices',
    chartType: 'line',
    series: [
      { dataKey: 'price', label: 'Regular Gas ($/gal)', color: '#F59E0B', type: 'monotone' },
    ],
    size: 'medium',
    order: 3,
    defaultTimeframe: '5Y',
    eraShading: true,
    yAxisLabel: '$/gal',
    formatValue: (v) => `$${v.toFixed(2)}`,
    sourceLabel: 'EIA Weekly Retail Gasoline Prices',
    sourceUrl: 'https://www.eia.gov/petroleum/gasdiesel/',
    geoLevel: 'State-level',
  },
]
