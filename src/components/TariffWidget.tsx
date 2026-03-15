'use client'
import { motion } from 'framer-motion'
import { estimateTariffCost, formatDollars } from '@/lib/tariff'

interface TariffWidgetProps {
  medianIncome: number
}

export function TariffWidget({ medianIncome }: TariffWidgetProps) {
  const cost = estimateTariffCost(medianIncome)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mt-8"
      data-testid="tariff-widget"
    >
      <h3 className="text-sm font-inter font-medium text-muted uppercase tracking-widest mb-3">
        Estimated Tariff Impact
      </h3>
      <p className="text-lg font-inter text-zinc-300 leading-relaxed">
        Based on your area&apos;s median income of{' '}
        <span className="text-white font-semibold">{formatDollars(medianIncome)}</span>,
        tariffs are estimated to cost your household{' '}
        <span className="text-electric-amber font-bebas text-3xl align-middle">
          ~{formatDollars(cost)}
        </span>{' '}
        this year.
      </p>
      <div className="mt-4 pt-3 border-t border-zinc-800 space-y-1">
        <p className="text-xs text-zinc-500 font-inter">
          ⚠️ Rough estimate — not a precise local calculation. We apply the{' '}
          <a href="https://budgetlab.yale.edu/research/where-we-stand-fiscal-economic-and-distributional-effects-all-us-tariffs" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
            Yale Budget Lab&apos;s national tariff cost estimate
          </a>{' '}
          (~2% of income) to your area&apos;s{' '}
          <a href="https://www.census.gov/programs-surveys/acs" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
            Census median income
          </a>.
          Actual impact varies by household spending patterns.
        </p>
      </div>
    </motion.div>
  )
}
