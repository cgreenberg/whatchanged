'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import type { EconomicSnapshot } from '@/types'
import { ShareModal } from '@/components/ShareModal'

interface ShareButtonProps {
  snapshot: EconomicSnapshot
}

export function ShareButton({ snapshot }: ShareButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const cityName = snapshot.location.cityName || snapshot.location.countyName
  const stateAbbr = snapshot.location.stateAbbr

  const unemployment = snapshot.unemployment.data
    ? `${snapshot.unemployment.data.change > 0 ? '+' : ''}${snapshot.unemployment.data.change.toFixed(1)} pts`
    : undefined

  const groceries = snapshot.cpi.data
    ? `${snapshot.cpi.data.groceriesChange > 0 ? '+' : ''}${snapshot.cpi.data.groceriesChange.toFixed(1)}%`
    : undefined

  const shelter =
    snapshot.cpi.data?.shelterChange != null
      ? `${snapshot.cpi.data.shelterChange > 0 ? '+' : ''}${snapshot.cpi.data.shelterChange.toFixed(1)}%`
      : undefined

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 text-center"
      >
        <button
          onClick={() => setIsModalOpen(true)}
          data-testid="share-button"
          className="px-8 py-4 bg-electric-amber text-black font-inter font-bold text-lg rounded-xl hover:bg-amber-400 transition-colors"
        >
          ↗ Share Your Results
        </button>
      </motion.div>

      <ShareModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        zip={snapshot.zip}
        cityName={cityName}
        stateAbbr={stateAbbr}
        unemployment={unemployment}
        groceries={groceries}
        shelter={shelter}
      />
    </>
  )
}
