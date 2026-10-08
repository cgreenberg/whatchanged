import type { DataSource } from './sources'
import type { CpiData, GasPriceData } from '@/types'
import { fetchCpi } from './bls-cpi'
import { fetchGasPrice } from './eia'
import { fetchElectricitySeries, type ElectricitySeriesData } from './eia-electricity'

export const blsCpiSource: DataSource<CpiData> = {
  id: 'bls-cpi',
  name: 'BLS Consumer Price Index',
  docsUrl: 'https://www.bls.gov/cpi/',
  fetch: fetchCpi,
}

export const eiaSource: DataSource<GasPriceData> = {
  id: 'eia-gas',
  name: 'EIA Weekly Retail Gasoline Prices',
  docsUrl: 'https://www.eia.gov/opendata/documentation.php',
  fetch: fetchGasPrice,
}

export const eiaElectricitySource: DataSource<ElectricitySeriesData> = {
  id: 'eia-electricity',
  name: 'EIA Average Residential Electricity Price (state)',
  docsUrl: 'https://www.eia.gov/opendata/browser/electricity/retail-sales',
  fetch: fetchElectricitySeries,
}
