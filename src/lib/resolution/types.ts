// Types for the source-resolution ladders (src/lib/resolution/ladders.ts).
// Client-safe: no data imports. The API's `trace` and the "Where does this come from?" UI use only these.

/** Geography a rung's series covers. */
export type GeoLevel =
  | 'zip' | 'city' | 'county' | 'metro' | 'state' | 'division' | 'region' | 'padd' | 'national' | 'island' | 'community'

/**
 * Outcome of one rung for one location.
 *  used           – this rung's series is the number shown
 *  stale          – used, but the series is behind schedule (or a last-good copy is served)
 *  unavailable    – the rung applies but its source returned nothing (outage, negative cache, no row)
 *  invalid        – the source answered but the value failed the sanity checks (no number is shown)
 *  over-budget    – the runtime upstream budget is spent and nothing is cached
 *  not-applicable – the source publishes nothing for this place (e.g. EIA has no state series for Maine)
 *  not-needed     – a more local rung above was used
 *  not-tried      – skipped after a failure (e.g. a BLS outage skips the other BLS rungs)
 */
export type TraceStatus =
  | 'used' | 'stale' | 'unavailable' | 'invalid' | 'over-budget' | 'not-applicable' | 'not-needed' | 'not-tried'

/** One row of a metric's trace (compact: undefined fields are omitted in the API response). */
export interface TraceStep {
  rungId: string
  /** Plain-English rung name, e.g. "EIA weekly state average". */
  label: string
  /** Source name, e.g. "EIA weekly retail gasoline". */
  source: string
  /** Link to the exact series page where one exists, else the source's data page. */
  citationUrl?: string
  geography?: { name: string; level: GeoLevel }
  status: TraceStatus
  /** Plain-English reason (why it doesn't apply / failed / stands in). */
  reason?: string
  /** YYYY-MM or YYYY-MM-DD of the latest data point used. */
  asOf?: string
  seriesId?: string
  /** With 'stale': the source is between survey seasons (its normal schedule, e.g. EIA SHOPP in summer), not overdue. */
  seasonal?: boolean
}

/** Metrics resolved on the server and returned as `trace` in /api/data. */
export type TraceMetric = 'gas' | 'rent' | 'groceries' | 'shelter' | 'electricity' | 'heatingOil' | 'propane' | 'rentBase'

export type SnapshotTrace = Partial<Record<TraceMetric, TraceStep[]>>

/** Statuses that mean "this rung's number is the one shown". */
export const isUsedStatus = (s: TraceStatus): boolean => s === 'used' || s === 'stale'
