'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import type { EconomicSnapshot } from '@/types'

interface ShareButtonProps {
  snapshot: EconomicSnapshot
}

function buildOgUrl(snapshot: EconomicSnapshot): string {
  const params = new URLSearchParams()
  params.set('zip', snapshot.zip)
  params.set('location', `${snapshot.location.cityName || snapshot.location.countyName}, ${snapshot.location.stateAbbr}`)

  if (snapshot.unemployment.data) {
    params.set('unemployment', `${snapshot.unemployment.data.current}%`)
    params.set('unemploymentChange', `${snapshot.unemployment.data.change > 0 ? '+' : ''}${snapshot.unemployment.data.change} pts`)
  }
  if (snapshot.cpi.data) {
    params.set('groceries', `${snapshot.cpi.data.groceriesChange.toFixed(1)}%`)
  }
  if (snapshot.federal.data) {
    const millions = (snapshot.federal.data.amountCut / 1_000_000).toFixed(1)
    params.set('federal', `$${millions}M`)
  }

  return `/api/og?${params.toString()}`
}

export function ShareButton({ snapshot }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?zip=${snapshot.zip}`
    : ''

  async function handleShare() {
    // Try native Web Share API first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'What Changed In Your Town?',
          url: shareUrl,
        })
        return
      } catch {
        // User cancelled or API failed — fall through to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Final fallback
      const textArea = document.createElement('textarea')
      textArea.value = shareUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="mt-8 text-center"
    >
      <button
        onClick={handleShare}
        data-testid="share-button"
        className="px-8 py-4 bg-electric-amber text-black font-inter font-bold text-lg rounded-xl hover:bg-amber-400 transition-colors"
      >
        {copied ? 'Link Copied!' : 'Share Your Results'}
      </button>
    </motion.div>
  )
}
