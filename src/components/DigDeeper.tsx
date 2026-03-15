'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { EconomicSnapshot } from '@/types'
import { formatDollars } from '@/lib/tariff'

interface DigDeeperProps {
  snapshot: EconomicSnapshot
}

export function DigDeeper({ snapshot }: DigDeeperProps) {
  const [isOpen, setIsOpen] = useState(false)

  const items = [
    snapshot.gas.data && {
      label: 'Gas Prices',
      value: `$${snapshot.gas.data.current.toFixed(2)}/gal`,
      change: `${snapshot.gas.data.change > 0 ? '+' : ''}$${snapshot.gas.data.change.toFixed(2)} since Jan 2025`,
      source: 'EIA Weekly',
      sourceUrl: 'https://www.eia.gov/petroleum/gasdiesel/',
    },
    snapshot.federal.data && {
      label: 'Federal Contracts Cut',
      value: `${snapshot.federal.data.contractsCut} contracts`,
      change: `${formatDollars(snapshot.federal.data.amountCut)} total`,
      source: 'USASpending.gov',
      sourceUrl: 'https://www.usaspending.gov/',
    },
    snapshot.census.data && {
      label: 'Median Rent',
      value: `${formatDollars(snapshot.census.data.medianRent)}/mo`,
      change: `Median income: ${formatDollars(snapshot.census.data.medianIncome)}`,
      source: `Census ACS ${snapshot.census.data.year}`,
      sourceUrl: 'https://www.census.gov/programs-surveys/acs',
    },
  ].filter(Boolean) as Array<{ label: string; value: string; change: string; source: string; sourceUrl: string }>

  if (items.length === 0) return null

  return (
    <div className="mt-8" data-testid="dig-deeper">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 font-inter text-sm hover:text-zinc-200 transition-colors"
        data-testid="dig-deeper-toggle"
      >
        <span>Dig Deeper</span>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              {items.map(item => (
                <div
                  key={item.label}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                >
                  <p className="text-xs font-inter text-muted uppercase tracking-widest">{item.label}</p>
                  <p className="text-2xl font-bebas text-white mt-1">{item.value}</p>
                  <p className="text-sm font-inter text-zinc-400 mt-1">{item.change}</p>
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-500 mt-2 underline hover:text-zinc-300">
                    {item.source}
                  </a>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
