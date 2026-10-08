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
    'flex-1 inline-flex items-center justify-center gap-2 py-3 font-sans font-semibold text-[15px] tracking-tight rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-desk'

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
          className={`${btnBase} bg-ink text-desk hover:bg-white`}
        >
          {!isSharing && (
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 10V2M5 5l3-3 3 3M3 9v4.5h10V9" />
            </svg>
          )}
          {isSharing ? 'Preparing…' : 'Share image'}
        </button>
        <button
          onClick={copyLink}
          data-testid="copy-link-button"
          className={`${btnBase} bg-transparent text-ink border border-line hover:border-ink-3 hover:bg-surface`}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            {copied
              ? <path d="M3 8.5l3 3 7-7" />
              : <path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.8" />}
          </svg>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-groceries text-center break-all" data-testid="share-error">{error}</p>
      )}
    </motion.div>
  )
}
