'use client'
import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import type { EconomicSnapshot } from '@/types'

interface ShareButtonProps {
  snapshot: EconomicSnapshot
}

export function ShareButton({ snapshot }: ShareButtonProps) {
  const [isSharing, setIsSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  const zip = snapshot.zip
  const city = snapshot.census.data?.isCityLevel ? snapshot.census.data?.cityName : undefined
  const state = city ? snapshot.location.stateAbbr : undefined
  const shareUrl = city && state
    ? `/api/share/${zip}?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`
    : `/api/share/${zip}`

  const shareImage = useCallback(async () => {
    if (isSharing) return
    setIsSharing(true)

    try {
      const response = await fetch(shareUrl)
      if (!response.ok) throw new Error('Failed to generate image')
      const blob = await response.blob()
      const file = new File([blob], `whatchanged-${zip}.png`, { type: 'image/png' })

      const isMobile = 'ontouchstart' in window && window.innerWidth <= 1024
      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `whatchanged-${zip}.png`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
    } finally {
      setIsSharing(false)
    }
  }, [isSharing, zip, shareUrl])

  async function copyLink() {
    const url = `https://whatchanged.us/?zip=${zip}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore clipboard errors
    }
  }

  const btnBase =
    'flex-1 py-4 font-inter font-bold text-lg rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="mt-8 flex gap-3 justify-center max-w-md mx-auto w-full"
    >
      <button
        onClick={shareImage}
        disabled={isSharing}
        data-testid="share-button"
        className={`${btnBase} bg-electric-amber text-black hover:bg-amber-400`}
      >
        {isSharing ? 'Preparing...' : '↗ Share Image'}
      </button>
      <button
        onClick={copyLink}
        className={`${btnBase} bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-white`}
      >
        {copied ? 'Copied! ✓' : '🔗 Copy Link'}
      </button>
    </motion.div>
  )
}
