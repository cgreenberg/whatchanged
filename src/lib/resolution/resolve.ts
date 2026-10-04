// Generic ladder walker. A ladder is an ordered list of rungs (most local first); see ladders.ts.
//
// Walk rules (the same for every metric):
//  - Rungs are visited in order. A rung that doesn't apply to the place is recorded as 'not-applicable'.
//  - The first applicable rung is resolved. 'used' or 'stale' wins: every later rung is 'not-needed'.
//  - An outcome marked `final` (e.g. the value failed sanity checks) ends the walk: later rungs are 'not-tried'.
//  - Otherwise the rung failed and the walk continues per the rung's `onUnavailable`:
//      'next'        the next rung (default)
//      'next-source' the next rung from a DIFFERENT source (rungs of the failed source are 'not-tried')
//      'last'        straight to the last rung (the U.S. average); rungs in between are 'not-tried'
//
// Client-safe: no data or cache imports (fetching is injected through the rung's `resolve` context).

import type { GeoLevel, TraceStatus, TraceStep } from './types'

export interface RungOutcome<V = unknown> {
  /**
   * 'not-applicable' from resolve = a static source turns out to publish nothing usable for the place
   * (e.g. no Zillow series for the county): the walk moves on without counting it as an outage.
   */
  status: 'used' | 'stale' | 'unavailable' | 'invalid' | 'over-budget' | 'not-applicable'
  reason?: string
  /** The data behind the outcome (also on 'invalid', so the caller can show what it always showed). */
  value?: V
  /** YYYY-MM or YYYY-MM-DD of the latest data point. */
  asOf?: string
  seriesId?: string
  /** Overrides the rung's own geography / citation (a rung that delegates to another ladder). */
  geography?: { name: string; level: GeoLevel }
  citationUrl?: string
  /** End the walk here even though nothing was used. */
  final?: boolean
}

export type OnUnavailable = 'next' | 'next-source' | 'last'

/**
 * One source + geography a metric can come from.
 * L = the location the ladder resolves for, T = this rung's target (the series it would use),
 * V = the resolved value, C = the fetch context injected by the caller (server cache, client shard…).
 */
export interface Rung<L, T, V, C> {
  /** Stable id, `{metric}.{slug}` (appears in the API trace). */
  id: string
  /** Plain-English name, e.g. "EIA weekly state average". */
  label: string
  /** Source short name (provider): 'EIA' | 'BLS' | 'Zillow' … — also what 'next-source' compares. */
  source: string
  /** Fuller source name for citations, e.g. "EIA weekly retail gasoline (regular)". */
  sourceName: string
  level: GeoLevel
  /** Short pill text for the About page / docs ("City", "HI/AK stand-in"); defaults from `level`. */
  pill?: string
  frequency: string
  license: string
  /** 'live' = fetched at runtime through the cache (BLS, EIA); 'static' = bundled by the data pipeline (Zillow…). */
  pipeline: 'live' | 'static'
  /** Plain-English coverage: where this rung is used. */
  covers: string
  /** The source's data page (citation when no series page applies). */
  homepage: string
  /** true, or a plain-English reason this source publishes nothing for the place. */
  applies(loc: L): true | string
  /** The series this rung uses for the place (only called when `applies` is true). */
  target(loc: L): T
  /** Display name of the target's geography ("New England (PADD 1A)", "Androscoggin County, ME"). */
  geography(target: T, loc: L): string
  /** Level of the target when it varies (a rung delegating to another ladder); defaults to `level`. */
  levelOf?(target: T): GeoLevel
  /** The place a non-applicable rung was checked for ("Maine" / state, "Androscoggin County, ME" / county). */
  place?(loc: L): { name: string; level: GeoLevel } | undefined
  seriesId?(target: T): string | undefined
  /** Citation URL template: the exact series page when one exists. */
  citationUrl?(target: T): string
  /** Fetch / look up the target. May be sync (static data) or async (live sources). */
  resolve(target: T, ctx: C, loc: L): RungOutcome<V> | Promise<RungOutcome<V>>
  onUnavailable?: OnUnavailable
  /** Reason shown when this rung is used (e.g. a stand-in explanation). */
  usedNote?(target: T, loc: L): string | undefined
}

/* eslint-disable @typescript-eslint/no-explicit-any -- a ladder mixes rungs with different targets */
export type AnyRung<L = any, V = any, C = any> = Rung<L, any, V, C>
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface Ladder<L, V, C> {
  metric: string
  /** Metric name as shown to people ("Gas (regular)"). */
  title: string
  /** The U.S. comparison shown next to the local number (same source and method), if any. */
  comparison?: string
  /** One sentence on what happens when no rung has data. */
  noData?: string
  rungs: Array<AnyRung<L, V, C>>
}

/** Erase a rung's target type so rungs with different targets fit one ladder. */
export function defineRung<L, T, V, C>(rung: Rung<L, T, V, C>): AnyRung<L, V, C> {
  return rung as AnyRung<L, V, C>
}

export interface Attempt<V> {
  rung: AnyRung
  index: number
  target: unknown
  outcome: RungOutcome<V>
}

export interface LadderResult<V> {
  steps: TraceStep[]
  /** The rung whose data is shown ('used' or 'stale'). */
  winner?: Attempt<V>
  /** The last rung resolved (the winner, or a final 'invalid' whose value is still passed on). */
  last?: Attempt<V>
  /** true when the winner came after an applicable rung that failed (an outage stand-in). */
  afterFailure: boolean
}

const isUsed = (s: TraceStatus) => s === 'used' || s === 'stale'

function compact(step: TraceStep): TraceStep {
  const out = { ...step } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k]
  return out as unknown as TraceStep
}

/** One ladder walk for one location. Drive it with resolveLadder (async) or resolveLadderSync. */
class Walk<L, V, C> {
  private i = 0
  private readonly steps: TraceStep[] = []
  private readonly skipSources = new Set<string>()
  private failed = false
  private done = false
  private pending: { rung: AnyRung<L, V, C>; target: unknown } | null = null
  private winner?: Attempt<V>
  private last?: Attempt<V>

  constructor(private readonly ladder: Ladder<L, V, C>, private readonly loc: L) {}

  private base(rung: AnyRung<L, V, C>, target: unknown | undefined, status: TraceStatus, reason?: string): TraceStep {
    const applicable = target !== undefined
    // Rows below the winner (or skipped) stay short: no link, and no place for a rung that doesn't apply.
    const brief = status === 'not-needed' || status === 'not-tried'
    return {
      rungId: rung.id,
      label: rung.label,
      source: rung.sourceName,
      citationUrl: brief ? undefined : applicable ? (rung.citationUrl?.(target) ?? rung.homepage) : rung.homepage,
      geography: applicable
        ? { name: rung.geography(target, this.loc), level: rung.levelOf?.(target) ?? rung.level }
        : brief ? undefined : rung.place?.(this.loc),
      status,
      reason,
    }
  }

  /** Target of an applicable rung, else undefined (and the reason). */
  private check(rung: AnyRung<L, V, C>): { target?: unknown; reason?: string } {
    const a = rung.applies(this.loc)
    return a === true ? { target: rung.target(this.loc) } : { reason: a }
  }

  private finishRest(status: 'not-needed' | 'not-tried', reason?: string) {
    const rungs = this.ladder.rungs
    for (let j = this.i + 1; j < rungs.length; j++) {
      const { target } = this.check(rungs[j])
      this.steps.push(compact(this.base(rungs[j], target, status, status === 'not-tried' ? reason : undefined)))
    }
    this.done = true
  }

  /** Next rung to resolve (recording the non-applicable / skipped ones on the way), or null when done. */
  next(): { rung: AnyRung<L, V, C>; target: unknown } | null {
    const rungs = this.ladder.rungs
    while (!this.done && this.i < rungs.length) {
      const rung = rungs[this.i]
      const { target, reason } = this.check(rung)
      if (target === undefined) {
        this.steps.push(compact(this.base(rung, undefined, 'not-applicable', reason)))
        this.i++
        continue
      }
      if (this.skipSources.has(rung.source)) {
        this.steps.push(compact(this.base(rung, target, 'not-tried', `Skipped: ${rung.source} didn't answer for the step above.`)))
        this.i++
        continue
      }
      this.pending = { rung, target }
      return this.pending
    }
    this.done = true
    return null
  }

  record(outcome: RungOutcome<V>): void {
    if (!this.pending) throw new Error('record() without next()')
    const { rung, target } = this.pending
    this.pending = null
    const attempt: Attempt<V> = { rung, index: this.i, target, outcome }
    this.last = attempt
    const used = isUsed(outcome.status)
    const reason = outcome.reason ?? (used
      ? (this.failed ? 'Used because the source above was unavailable.' : rung.usedNote?.(target, this.loc))
      : undefined)
    const step = this.base(rung, target, outcome.status, reason)
    this.steps.push(compact({
      ...step,
      ...(outcome.geography ? { geography: outcome.geography } : {}),
      ...(outcome.citationUrl ? { citationUrl: outcome.citationUrl } : {}),
      asOf: outcome.asOf,
      seriesId: outcome.seriesId ?? rung.seriesId?.(target),
    }))
    if (used) {
      this.winner = attempt
      this.finishRest('not-needed')
      return
    }
    if (outcome.final) {
      this.finishRest('not-tried', 'Not tried: the step above answered, but its value failed our checks.')
      return
    }
    if (outcome.status === 'not-applicable') {
      this.i++
      return
    }
    this.failed = true
    const rungs = this.ladder.rungs
    const mode = rung.onUnavailable ?? 'next'
    if (mode === 'last' && this.i < rungs.length - 2) {
      for (let j = this.i + 1; j < rungs.length - 1; j++) {
        const { target: t, reason: r } = this.check(rungs[j])
        this.steps.push(compact(t === undefined
          ? this.base(rungs[j], undefined, 'not-applicable', r)
          : this.base(rungs[j], t, 'not-tried', 'Skipped after the outage above: we go straight to the U.S. average.')))
      }
      this.i = rungs.length - 1
      return
    }
    if (mode === 'next-source') this.skipSources.add(rung.source)
    this.i++
  }

  result(): LadderResult<V> {
    return { steps: this.steps, winner: this.winner, last: this.last, afterFailure: !!this.winner && this.failed }
  }
}

/** Walk a ladder, resolving rungs one at a time (async: live sources). */
export async function resolveLadder<L, V, C>(ladder: Ladder<L, V, C>, loc: L, ctx: C): Promise<LadderResult<V>> {
  const walk = new Walk(ladder, loc)
  for (let a = walk.next(); a; a = walk.next()) {
    let outcome: RungOutcome<V>
    try {
      outcome = await a.rung.resolve(a.target, ctx, loc)
    } catch (e) {
      outcome = outcomeFromError(e)
    }
    walk.record(outcome)
  }
  return walk.result()
}

/** Walk a ladder whose rungs all resolve synchronously (static data, e.g. a client-side county shard). */
export function resolveLadderSync<L, V, C>(ladder: Ladder<L, V, C>, loc: L, ctx: C): LadderResult<V> {
  const walk = new Walk(ladder, loc)
  for (let a = walk.next(); a; a = walk.next()) {
    const outcome = a.rung.resolve(a.target, ctx, loc)
    if (outcome instanceof Promise) throw new Error(`Rung ${a.rung.id} resolves asynchronously; use resolveLadder`)
    walk.record(outcome)
  }
  return walk.result()
}

/**
 * The first applicable rung (no fetching): the series a place resolves to when every source answers.
 * `accept` narrows the rungs considered (e.g. EIA only, for the BLS-outage fallback plan).
 */
export function firstApplicable<L, V, C>(
  ladder: Ladder<L, V, C>,
  loc: L,
  accept: (rung: AnyRung<L, V, C>) => boolean = () => true,
): { rung: AnyRung<L, V, C>; target: unknown } | null {
  for (const rung of ladder.rungs) {
    if (!accept(rung)) continue
    if (rung.applies(loc) === true) return { rung, target: rung.target(loc) }
  }
  return null
}

/** Map a fetch error to a trace outcome (kv.ts error names; matched by name so this stays client-safe). */
export function outcomeFromError(e: unknown): RungOutcome<never> {
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'BudgetExceededError') {
    return { status: 'over-budget', reason: "Today's budget of live requests to this source is used up and no copy is cached." }
  }
  if (name === 'ValidationError') {
    return { status: 'invalid', reason: 'The source answered, but its numbers failed our sanity checks.' }
  }
  if (msg.startsWith('Negative cache hit')) {
    return {
      status: 'unavailable',
      reason: msg.includes('no upstream data')
        ? 'The source had no usable data for this series at the last refresh.'
        : 'The source failed a few minutes ago; we retry shortly.',
    }
  }
  return { status: 'unavailable', reason: "The source didn't return usable data just now." }
}
