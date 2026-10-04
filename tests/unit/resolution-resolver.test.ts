/**
 * The generic ladder walker (src/lib/resolution/resolve.ts): rung order, first used wins, every
 * outcome recorded, the rest marked not needed, and the three onUnavailable modes.
 */
import {
  defineRung, resolveLadder, resolveLadderSync, firstApplicable, outcomeFromError,
  type Ladder, type RungOutcome, type OnUnavailable,
} from '@/lib/resolution/resolve'

interface Loc { here: string[] }
type Outcomes = Record<string, RungOutcome<string> | Error>
interface Ctx { outcomes: Outcomes; calls: string[] }

function rung(id: string, source: string, onUnavailable?: OnUnavailable) {
  return defineRung<Loc, string, string, Ctx>({
    id, label: `Rung ${id}`, source, sourceName: `${source} source`, level: 'state', frequency: 'monthly',
    license: 'PD', pipeline: 'live', covers: id, homepage: `https://example.org/${source}`,
    applies: (l) => l.here.includes(id) || `${id} has nothing here`,
    target: () => `T-${id}`,
    geography: (t) => `geo ${t}`,
    place: () => ({ name: 'Somewhere', level: 'county' }),
    citationUrl: (t) => `https://example.org/series/${t}`,
    seriesId: (t) => `S-${t}`,
    resolve: async (t, ctx) => {
      ctx.calls.push(id)
      const o = ctx.outcomes[id]
      if (o instanceof Error) throw o
      return o ?? { status: 'used', value: `v-${id}`, asOf: '2026-08' }
    },
    onUnavailable,
  })
}

const ladder = (...rungs: ReturnType<typeof rung>[]): Ladder<Loc, string, Ctx> => ({ metric: 't', title: 'Test', rungs })
const run = async (l: Ladder<Loc, string, Ctx>, here: string[], outcomes: Outcomes = {}) => {
  const ctx: Ctx = { outcomes, calls: [] }
  const r = await resolveLadder(l, { here }, ctx)
  return { ...r, calls: ctx.calls, summary: r.steps.map((s) => `${s.rungId}:${s.status}`) }
}

describe('resolveLadder', () => {
  const L = ladder(rung('a', 'X'), rung('b', 'X'), rung('c', 'Y'), rung('d', 'Y'))

  test('rungs are visited in order; non-applicable ones are recorded with their reason', async () => {
    const r = await run(L, ['c', 'd'])
    expect(r.summary).toEqual(['a:not-applicable', 'b:not-applicable', 'c:used', 'd:not-needed'])
    expect(r.steps[0]).toMatchObject({ reason: 'a has nothing here', geography: { name: 'Somewhere', level: 'county' }, citationUrl: 'https://example.org/X' })
    expect(r.calls).toEqual(['c'])
  })

  test('first used wins: later rungs are not resolved and are marked not needed (short rows)', async () => {
    const r = await run(L, ['a', 'b', 'c', 'd'])
    expect(r.summary).toEqual(['a:used', 'b:not-needed', 'c:not-needed', 'd:not-needed'])
    expect(r.calls).toEqual(['a'])
    expect(r.winner).toMatchObject({ index: 0, target: 'T-a', outcome: { value: 'v-a' } })
    expect(r.afterFailure).toBe(false)
    expect(r.steps[0]).toEqual({
      rungId: 'a', label: 'Rung a', source: 'X source', citationUrl: 'https://example.org/series/T-a',
      geography: { name: 'geo T-a', level: 'state' }, status: 'used', asOf: '2026-08', seriesId: 'S-T-a',
    })
    // not-needed rows carry no link or reason (compact), but keep the geography they would have used
    expect(r.steps[1]).toEqual({ rungId: 'b', label: 'Rung b', source: 'X source', geography: { name: 'geo T-b', level: 'state' }, status: 'not-needed' })
  })

  test('every attempted outcome is recorded, with the error mapped to a status and reason', async () => {
    const budget = Object.assign(new Error('Upstream bls budget exhausted'), { name: 'BudgetExceededError' })
    const r = await run(L, ['a', 'b', 'c'], { a: new Error('boom'), b: budget })
    expect(r.summary).toEqual(['a:unavailable', 'b:over-budget', 'c:used', 'd:not-needed'])
    expect(r.steps[2].reason).toBe('Used because the source above was unavailable.')
    expect(r.afterFailure).toBe(true)
  })

  test("stale counts as used (the walk stops) and keeps its reason", async () => {
    const r = await run(L, ['a', 'b'], { a: { status: 'stale', value: 'old', reason: 'behind', asOf: '2025-02' } })
    expect(r.summary).toEqual(['a:stale', 'b:not-needed', 'c:not-needed', 'd:not-needed'])
    expect(r.winner?.outcome.value).toBe('old')
    expect(r.steps[0]).toMatchObject({ reason: 'behind', asOf: '2025-02' })
  })

  test("'not-applicable' from resolve (static source has no row) moves on without counting as an outage", async () => {
    const r = await run(L, ['a', 'b'], { a: { status: 'not-applicable', reason: 'no series' } })
    expect(r.summary).toEqual(['a:not-applicable', 'b:used', 'c:not-needed', 'd:not-needed'])
    expect(r.afterFailure).toBe(false)
    expect(r.steps[1].reason).toBeUndefined()
  })

  test("a final outcome ends the walk; its value is still available as `last`", async () => {
    const r = await run(L, ['a', 'b'], { a: { status: 'invalid', final: true, value: 'bad', reason: 'out of range' } })
    expect(r.summary).toEqual(['a:invalid', 'b:not-tried', 'c:not-tried', 'd:not-tried'])
    expect(r.winner).toBeUndefined()
    expect(r.last?.outcome.value).toBe('bad')
    expect(r.calls).toEqual(['a'])
  })

  test("onUnavailable 'last' jumps to the last rung; rungs in between are not tried (or not applicable)", async () => {
    const J = ladder(rung('a', 'X', 'last'), rung('b', 'X'), rung('c', 'Y'), rung('d', 'Y'))
    const r = await run(J, ['a', 'b', 'd'], { a: new Error('down') })
    expect(r.summary).toEqual(['a:unavailable', 'b:not-tried', 'c:not-applicable', 'd:used'])
    expect(r.calls).toEqual(['a', 'd'])
    expect(r.winner?.index).toBe(3)
  })

  test("onUnavailable 'next-source' skips the other rungs of the failed source", async () => {
    const N = ladder(rung('a', 'X', 'next-source'), rung('b', 'X'), rung('c', 'Y'), rung('d', 'Y'))
    const r = await run(N, ['a', 'b', 'c', 'd'], { a: new Error('down') })
    expect(r.summary).toEqual(['a:unavailable', 'b:not-tried', 'c:used', 'd:not-needed'])
    expect(r.calls).toEqual(['a', 'c'])
  })

  test("onUnavailable 'next' (default) tries the very next applicable rung", async () => {
    const r = await run(L, ['a', 'b', 'c'], { a: new Error('down') })
    expect(r.calls).toEqual(['a', 'b'])
    expect(r.summary.slice(0, 2)).toEqual(['a:unavailable', 'b:used'])
  })

  test('nothing applies or everything fails → no winner', async () => {
    expect((await run(L, [])).winner).toBeUndefined()
    const r = await run(L, ['a', 'd'], { a: new Error('x'), d: new Error('y') })
    expect(r.summary).toEqual(['a:unavailable', 'b:not-applicable', 'c:not-applicable', 'd:unavailable'])
    expect(r.winner).toBeUndefined()
    expect(r.last?.outcome.value).toBeUndefined()
  })
})

describe('resolveLadderSync / firstApplicable / outcomeFromError', () => {
  const syncRung = (id: string, ok: boolean) => defineRung<Loc, string, string, null>({
    id, label: id, source: 'S', sourceName: 'S', level: 'county', frequency: 'monthly', license: 'PD', pipeline: 'static',
    covers: id, homepage: 'https://example.org', applies: () => true, target: () => id, geography: (t) => t,
    resolve: () => (ok ? { status: 'used', value: id } : { status: 'not-applicable', reason: 'none' }),
  })

  test('sync walk over static rungs', () => {
    const r = resolveLadderSync({ metric: 's', title: 'S', rungs: [syncRung('x', false), syncRung('y', true)] }, { here: [] }, null)
    expect(r.steps.map((s) => s.status)).toEqual(['not-applicable', 'used'])
    expect(r.winner?.outcome.value).toBe('y')
  })

  test('sync walk refuses an async rung', () => {
    expect(() => resolveLadderSync(ladder(rung('a', 'X')), { here: ['a'] }, { outcomes: {}, calls: [] })).toThrow(/asynchronously/)
  })

  test('firstApplicable = the static pick (optionally filtered)', () => {
    const L = ladder(rung('a', 'X'), rung('b', 'Y'), rung('c', 'Y'))
    expect(firstApplicable(L, { here: ['a', 'c'] })?.target).toBe('T-a')
    expect(firstApplicable(L, { here: ['a', 'c'] }, (r) => r.source === 'Y')?.target).toBe('T-c')
    expect(firstApplicable(L, { here: [] })).toBeNull()
  })

  test('kv errors map to trace statuses', () => {
    expect(outcomeFromError(Object.assign(new Error('x'), { name: 'ValidationError' })).status).toBe('invalid')
    expect(outcomeFromError(new Error('Negative cache hit for k')).reason).toMatch(/retry shortly/)
    expect(outcomeFromError(new Error('Negative cache hit for k (no upstream data at last refresh)')).reason).toMatch(/no usable data/)
    expect(outcomeFromError('weird').status).toBe('unavailable')
  })
})
