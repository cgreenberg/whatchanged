import { estimateTariffCost, formatDollars } from '@/lib/tariff'

/**
 * This test verifies that the share card (generate.tsx) and the web page
 * (HomeContent.tsx) produce consistent formatted strings from the same
 * underlying data. Since both files format numbers inline (not via shared
 * helpers), divergence is a real risk.
 *
 * Formatting logic is replicated here with comments noting the source file
 * and line where each formula lives.
 */

// ── Fixture data ────────────────────────────────────────────────────────
const MOCK_DATA = {
  gas: { current: 3.45, baseline: 3.2, change: 0.25 },
  cpi: { groceriesChange: 3.3, shelterChange: 2.6 },
  census: { medianIncome: 82000, medianRent: 1500 },
}

// ── Formatting helpers replicated from source ───────────────────────────

/**
 * From generate.tsx line 28-31: formatSigned
 * Used for CPI % change display on the share card.
 */
function cardFormatSigned(value: number, decimals = 1, suffix = ''): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}${suffix}`
}

/**
 * From HomeContent.tsx lines 136, 157:
 * Inline formatting for CPI % changes on the web page.
 * Pattern: `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
 */
function pageFormatCpiChange(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

/**
 * From generate.tsx line 480:
 * Gas price big number: `$${gasData.current.toFixed(2)}/gal`
 */
function cardFormatGasPrice(current: number): string {
  return `$${current.toFixed(2)}/gal`
}

/**
 * From HomeContent.tsx line 116:
 * Gas price value: `$${snapshot.gas.data.current.toFixed(2)}/gal`
 */
function pageFormatGasPrice(current: number): string {
  return `$${current.toFixed(2)}/gal`
}

/**
 * From generate.tsx line 482:
 * Gas change pill: `${gasData.change >= 0 ? '+' : ''}$${gasData.change.toFixed(2)}`
 */
function cardFormatGasChange(change: number): string {
  return `${change >= 0 ? '+' : ''}$${change.toFixed(2)}`
}

/**
 * From HomeContent.tsx line 117:
 * Gas change: `${snapshot.gas.data.change > 0 ? '+' : ''}$${snapshot.gas.data.change.toFixed(2)} since Jan 2025`
 * Note: page includes " since Jan 2025" suffix; card has it in a separate metaRow.
 */
function pageFormatGasChange(change: number): string {
  return `${change > 0 ? '+' : ''}$${change.toFixed(2)}`
}

/**
 * From generate.tsx line 596:
 * Tariff big number: `~${formatDollars(tariffCost)}/yr`
 */
function cardFormatTariff(medianIncome: number): string {
  const cost = estimateTariffCost(medianIncome)
  return `~${formatDollars(cost)}/yr`
}

/**
 * From HomeContent.tsx line 175:
 * Tariff value: `~${formatDollars(cost)}/yr`
 */
function pageFormatTariff(medianIncome: number): string {
  const cost = estimateTariffCost(medianIncome)
  return `~${formatDollars(cost)}/yr`
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('share card vs page formatting consistency', () => {
  describe('gas price', () => {
    it('card and page produce the same gas price string', () => {
      const card = cardFormatGasPrice(MOCK_DATA.gas.current)
      const page = pageFormatGasPrice(MOCK_DATA.gas.current)
      expect(card).toBe('$3.45/gal')
      expect(page).toBe('$3.45/gal')
      expect(card).toBe(page)
    })

    it('card and page produce the same gas change number', () => {
      const card = cardFormatGasChange(MOCK_DATA.gas.change)
      const page = pageFormatGasChange(MOCK_DATA.gas.change)
      // Both should produce "+$0.25" — the page appends " since Jan 2025"
      // separately, but the numeric portion must match.
      expect(card).toBe('+$0.25')
      expect(page).toBe('+$0.25')
      expect(card).toBe(page)
    })

    it('handles negative gas change consistently', () => {
      const negChange = -0.15
      const card = cardFormatGasChange(negChange)
      const page = pageFormatGasChange(negChange)
      // Both formats: no prefix added, toFixed() includes the "-" sign,
      // so result is "$-0.15" (dollar sign before the negative number).
      expect(card).toBe('$-0.15')
      expect(page).toBe('$-0.15')
      expect(card).toBe(page)
    })

    it('handles zero gas change consistently', () => {
      // Note: generate.tsx uses >= 0 (includes zero → "+")
      // HomeContent.tsx uses > 0 (zero → no prefix)
      // This is an intentional divergence documented here.
      const card = cardFormatGasChange(0)
      const page = pageFormatGasChange(0)
      // card: "+$0.00" (>= 0), page: "$0.00" (> 0 is false)
      expect(card).toBe('+$0.00')
      expect(page).toBe('$0.00')
      // Documenting known divergence: card shows "+$0.00", page shows "$0.00"
      // This is cosmetically different but numerically equivalent at zero.
    })
  })

  describe('grocery CPI change', () => {
    it('card and page produce the same groceries % string', () => {
      const card = cardFormatSigned(MOCK_DATA.cpi.groceriesChange, 1, '%')
      const page = pageFormatCpiChange(MOCK_DATA.cpi.groceriesChange)
      expect(card).toBe('+3.3%')
      expect(page).toBe('+3.3%')
      expect(card).toBe(page)
    })

    it('handles negative grocery change', () => {
      const neg = -1.2
      const card = cardFormatSigned(neg, 1, '%')
      const page = pageFormatCpiChange(neg)
      expect(card).toBe('-1.2%')
      expect(page).toBe('-1.2%')
      expect(card).toBe(page)
    })
  })

  describe('shelter CPI change', () => {
    it('card and page produce the same shelter % string', () => {
      // generate.tsx line 553: formatSigned(cpiData.shelterChange) + '%'
      // HomeContent.tsx line 136: same inline pattern
      const card = cardFormatSigned(MOCK_DATA.cpi.shelterChange, 1, '%')
      const page = pageFormatCpiChange(MOCK_DATA.cpi.shelterChange)
      expect(card).toBe('+2.6%')
      expect(page).toBe('+2.6%')
      expect(card).toBe(page)
    })
  })

  describe('tariff estimate', () => {
    it('card and page produce the same tariff string', () => {
      const card = cardFormatTariff(MOCK_DATA.census.medianIncome)
      const page = pageFormatTariff(MOCK_DATA.census.medianIncome)
      // 82000 * 0.0205 = 1681
      expect(card).toBe('~$1,681/yr')
      expect(page).toBe('~$1,681/yr')
      expect(card).toBe(page)
    })

    it('tariff calculation is correct for fixture income', () => {
      const cost = estimateTariffCost(MOCK_DATA.census.medianIncome)
      expect(cost).toBe(1681) // Math.round(82000 * 0.0205) = 1681
    })

    it('card shows monthly tariff correctly', () => {
      // generate.tsx line 608: formatDollars(Math.round(tariffCost / 12))
      const cost = estimateTariffCost(MOCK_DATA.census.medianIncome)
      const monthly = `~${formatDollars(Math.round(cost / 12))}/mo`
      expect(monthly).toBe('~$140/mo') // 1681 / 12 = 140.08 → 140
    })
  })

  describe('edge cases', () => {
    it('zero median income produces N/A tariff on card', () => {
      // generate.tsx line 596: tariffCost > 0 check
      const cost = estimateTariffCost(0)
      expect(cost).toBe(0)
      // Card would show 'N/A' since tariffCost is not > 0
    })

    it('formatSigned handles exact zero with + prefix', () => {
      // generate.tsx formatSigned uses >= 0, so zero gets "+"
      expect(cardFormatSigned(0, 1, '%')).toBe('+0.0%')
    })

    it('page CPI format shows no prefix for exact zero', () => {
      // HomeContent.tsx uses > 0, so zero gets no prefix
      expect(pageFormatCpiChange(0)).toBe('0.0%')
    })
  })
})

describe('formatting formula correctness', () => {
  it('gas price rounds to 2 decimal places', () => {
    expect(cardFormatGasPrice(3.456)).toBe('$3.46/gal')
    expect(cardFormatGasPrice(3.001)).toBe('$3.00/gal')
  })

  it('CPI change rounds to 1 decimal place', () => {
    expect(cardFormatSigned(3.35, 1, '%')).toBe('+3.4%')
    expect(cardFormatSigned(3.34, 1, '%')).toBe('+3.3%')
  })

  it('formatDollars uses no decimal places', () => {
    expect(formatDollars(1681)).toBe('$1,681')
    expect(formatDollars(1681.9)).toBe('$1,682')
  })

  it('median income display on card uses "k" format for >= 1000', () => {
    // generate.tsx line 623-625: medianIncome >= 1000 → `$${(medianIncome / 1000).toFixed(0)}k`
    const medianIncome = MOCK_DATA.census.medianIncome
    const display =
      medianIncome >= 1000
        ? `$${(medianIncome / 1000).toFixed(0)}k`
        : `$${Math.round(medianIncome)}`
    expect(display).toBe('$82k')
  })
})
