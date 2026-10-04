// URL builders shared by the page, share button, page metadata and OG image.
// City/state are kept so a reload or shared link shows the same (city-level) income
// and tariff figure; the server validates them against the zip.

export const SITE_ORIGIN = 'https://whatchanged.us'

export interface PlaceQuery {
  zip: string
  city?: string | null
  state?: string | null
}

function query({ zip, city, state }: PlaceQuery, extra?: Record<string, string>): string {
  const p = new URLSearchParams()
  p.set('zip', zip)
  if (city && state) {
    p.set('city', city)
    p.set('state', state)
  }
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v)
  return p.toString()
}

/** "/?zip=78701&city=austin&state=tx" */
export function pagePath(q: PlaceQuery): string {
  return `/?${query(q)}`
}

export function pageUrl(q: PlaceQuery): string {
  return `${SITE_ORIGIN}${pagePath(q)}`
}

/** Square share image (downloaded / shared via the Web Share API). */
export function shareImagePath({ zip, city, state }: PlaceQuery): string {
  const p = new URLSearchParams()
  if (city && state) {
    p.set('city', city)
    p.set('state', state)
  }
  const qs = p.toString()
  return `/api/share/${zip}${qs ? `?${qs}` : ''}`
}

/** Open Graph image; `v` only busts social-crawler caches. */
export function ogImagePath(q: PlaceQuery, v?: string): string {
  return `/api/og?${query(q, v ? { v } : undefined)}`
}

/** Reads zip/city/state from a query string; invalid zips → null. */
export function parsePlaceQuery(search: string): PlaceQuery | null {
  const p = new URLSearchParams(search)
  const zip = p.get('zip')
  if (!zip || !/^\d{5}$/.test(zip)) return null
  const city = p.get('city')?.slice(0, 100) || undefined
  const state = p.get('state')?.slice(0, 2) || undefined
  return city && state ? { zip, city, state } : { zip }
}

/**
 * Next.js page `searchParams` values are `string | string[] | undefined`
 * (`?city=a&city=b` → ['a','b']). Normalize to the first string, like
 * URLSearchParams.get() does.
 */
export function firstParam(v: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined
  return typeof v === 'string' ? v : undefined
}
