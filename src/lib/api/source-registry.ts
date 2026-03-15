import type { DataSource } from './sources'
import type { UnemploymentData, CpiData, GasPriceData, FederalFundingData } from '@/types'
import { fetchUnemployment } from './bls'
import { fetchCpi } from './bls-cpi'
import { fetchGasPrice } from './eia'
import { fetchFederalFunding } from './usaspending'

export const blsSource: DataSource<UnemploymentData> = {
  id: 'bls-laus',
  name: 'BLS Local Area Unemployment Statistics',
  docsUrl: 'https://www.bls.gov/lau/',
  fetch: fetchUnemployment,
}

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

export const usaSpendingSource: DataSource<FederalFundingData> = {
  id: 'usaspending',
  name: 'USASpending.gov Federal Awards',
  docsUrl: 'https://www.usaspending.gov/',
  fetch: fetchFederalFunding,
}
