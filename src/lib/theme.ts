// Design tokens shared by components that draw with inline colors (Recharts, SVG map, Framer).
// The same values are exposed to Tailwind as CSS variables in src/app/globals.css.

export const DESK = {
  bg: '#111316',
  surface: '#171A1E',
  raised: '#1F2328',
  line: '#2A2F36',
  grid: '#22262C',
  ink: '#F1EFEA',
  ink2: '#B3B8C0',
  ink3: '#8C929B',
  /** Neutral "since the baseline" shading on graphs (no party colors). */
  baselineFill: 'rgba(241, 239, 234, 0.035)',
  baselineRule: '#9AA0A8',
} as const

/** One signal accent per metric (all ≥ 6.5:1 on the card surface). */
export const METRIC_COLORS = {
  gas: '#F2A93B',
  groceries: '#F07D62',
  rent: '#5EA8F2',
  shelter: '#5EA8F2',
  homePrices: '#B394F7',
  electricity: '#3EC4A6',
  /** Home heating fuel (oil, propane): a warm rose, distinct from gas amber and groceries coral (7.1:1 on the surface). */
  heating: '#EE82B4',
} as const
