import { timingSafeEqual } from 'crypto'

/**
 * True only when CRON_SECRET is configured and the request carries
 * `Authorization: Bearer ${CRON_SECRET}`. Missing secret → always false.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
