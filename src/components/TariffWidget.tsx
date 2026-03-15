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
      <div className="mt-4 pt-3 border-t border-zinc-800">
        <p className="text-xs text-zinc-500 font-inter">
          ⚠️ Estimated — not measured · Based on Yale Budget Lab projections applied to local income data ·
          Actual costs may vary
        </p>
      </div>
    </motion.div>
  )
}
