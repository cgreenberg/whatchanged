import zipCountyData from './zip-county.json'
import type { ZipInfo } from '@/types'

const zipMap = zipCountyData as Record<string, Omit<ZipInfo, 'zip'>>

export function lookupZip(zip: string): ZipInfo | null {
  const cleaned = zip.trim().replace(/\D/g, '').padStart(5, '0').slice(0, 5)
  if (cleaned.length !== 5) return null
  const entry = zipMap[cleaned]
  if (!entry) return null
  return { zip: cleaned, ...entry }
}

export function isValidZip(zip: string): boolean {
  return lookupZip(zip) !== null
}
