'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { EconomicSnapshot } from '@/types'

interface ShareButtonProps {
  snapshot: EconomicSnapshot
  trigger?: number
}

export function ShareButton({ snapshot, trigger }: ShareButtonProps) {
  const [isSharing, setIsSharing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const cityName = snapshot.location.cityName || snapshot.location.countyName
  const zip = snapshot.zip

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?zip=${zip}`
      : `https://whatchanged.us/?zip=${zip}`

  const shareText = `Here's how the cost of living has changed in ${cityName} since Jan. 20, 2025 📈📈📈 Check your zip too:`

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const shareCard = useCallback(async () => {
    if (isSharing) return
    setIsSharing(true)

    try {
      // 1. Fetch the card image from the server
      const response = await fetch(`/api/share/${zip}`)
      if (!response.ok) throw new Error('Failed to generate image')
      const blob = await response.blob()
      const file = new File([blob], `whatchanged-${zip}.png`, { type: 'image/png' })

      // 2. Try native share sheet first (mobile)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `What changed in ${cityName} since Jan. 20, 2025?`,
            text: shareText,
            url: shareUrl,
          })
          return
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return // user cancelled
          // fall through to download
        }
      }

      // 3. Fallback: download the image on desktop
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `whatchanged-${zip}.png`
      a.click()
      URL.revokeObjectURL(url)
      showToast('Image downloaded — share it on your favorite platform! 📲')
    } catch {
      showToast('Something went wrong — please try again')
    } finally {
      setIsSharing(false)
    }
  }, [isSharing, zip, cityName, shareText, shareUrl])

  // Support external trigger (e.g. from parent component)
  useEffect(() => {
    if (trigger && trigger > 0) {
      shareCard()
    }
  }, [trigger]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 text-center"
      >
        <button
          onClick={shareCard}
          disabled={isSharing}
          data-testid="share-button"
          className="px-8 py-4 bg-electric-amber text-black font-inter font-bold text-lg rounded-xl hover:bg-amber-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSharing ? '⏳ Preparing...' : '↗ Share'}
        </button>
      </motion.div>

      {/* Toast notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 text-zinc-200 px-5 py-3 rounded-xl shadow-lg text-sm border border-zinc-700"
            style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
