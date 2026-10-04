'use client'
import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import type { EconomicSnapshot } from '@/types'
import { pageUrl, shareImagePath, type PlaceQuery } from '@/lib/share-url'

interface ShareButtonProps {
  snapshot: EconomicSnapshot
  /** The zip/city/state the user asked for (keeps city-level income in shared links). */
  place?: PlaceQuery | null
}

export function ShareButton({ snapshot, place }: ShareButtonProps) {
  const [isSharing, setIsSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const zip = snapshot.zip
  const q: PlaceQuery = place && place.zip === zip ? place : { zip }
  const imagePath = shareImagePath(q)
  const link = pageUrl(q)

  const shareImage = useCallback(async () => {
    if (isSharing) return
    setIsSharing(true)
    setError(null)

    try {
      const response = await fetch(imagePath)
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
        document.body.appendChild(a)
        a.click()
        a.remove()
        // Safari starts the download asynchronously; revoking immediately can cancel it.
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return // user closed the share sheet
      setError("Couldn't create the share image. Please try again.")
    } finally {
      setIsSharing(false)
    }
  }, [isSharing, zip, imagePath])

  async function copyLink() {
    setError(null)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(`Couldn't copy automatically. Link: ${link}`)
    }
  }

  const btnBase =
    'flex-1 py-4 font-inter font-bold text-lg rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="mt-8 max-w-md mx-auto w-full"
    >
      <div className="flex gap-3 justify-center">
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
          data-testid="copy-link-button"
          className={`${btnBase} bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-white`}
        >
          {copied ? 'Copied! ✓' : '🔗 Copy Link'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400 text-center break-all" data-testid="share-error">{error}</p>
      )}
    </motion.div>
  )
}
