'use client'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

function detectNativeShare(): boolean {
  if (typeof navigator === 'undefined') return false
  return typeof navigator.share === 'function'
}

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  zip: string
  cityName: string
  stateAbbr: string
  unemployment?: string
  groceries?: string
  shelter?: string
}

export function ShareModal({
  isOpen,
  onClose,
  zip,
  cityName,
  unemployment,
  groceries,
  shelter,
}: ShareModalProps) {
  const [canNativeShare] = useState<boolean>(detectNativeShare)
  const [linkCopied, setLinkCopied] = useState(false)
  const [instagramToast, setInstagramToast] = useState(false)
  const instagramToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?zip=${zip}`
      : `https://whatchanged.us/?zip=${zip}`

  const shareText = `What changed in ${cityName} since Jan 20 — check your zip too`

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('overflow-hidden')
    } else {
      document.body.classList.remove('overflow-hidden')
    }
    return () => {
      document.body.classList.remove('overflow-hidden')
    }
  }, [isOpen])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (instagramToastTimer.current) clearTimeout(instagramToastTimer.current)
    }
  }, [])

  async function handleNativeShare() {
    try {
      await navigator.share({
        title: `What changed in ${cityName} since Jan 20`,
        text: shareText,
        url: shareUrl,
      })
    } catch {
      // User cancelled or browser denied — do nothing
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // Ignore clipboard errors
    }
  }

  async function handleDownloadAndShare() {
    const caption = `My town since Jan 20 👇\n${[
      unemployment ? `Unemployment ${unemployment}` : null,
      groceries ? `Groceries ${groceries}` : null,
      shelter ? `Shelter ${shelter}` : null,
    ].filter(Boolean).join(' · ')}\nCheck yours → whatchanged.us`

    try {
      await navigator.clipboard.writeText(caption)
    } catch {
      // Ignore clipboard errors
    }

    // Try to share as file (opens native share sheet → save to Photos, Instagram, etc.)
    try {
      const response = await fetch(`/api/share/${zip}`)
      const blob = await response.blob()
      const file = new File([blob], `whatchanged-${zip}.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `What changed in ${cityName} since Jan 20`,
          text: caption,
        })
        if (instagramToastTimer.current) clearTimeout(instagramToastTimer.current)
        setInstagramToast(true)
        instagramToastTimer.current = setTimeout(() => setInstagramToast(false), 3000)
        return
      }
    } catch {
      // User cancelled share or API not supported — fall through to download
    }

    // Fallback: trigger browser download
    const a = document.createElement('a')
    a.href = `/api/share/${zip}`
    a.download = `whatchanged-${zip}.png`
    a.click()

    if (instagramToastTimer.current) clearTimeout(instagramToastTimer.current)
    setInstagramToast(true)
    instagramToastTimer.current = setTimeout(() => setInstagramToast(false), 3000)
  }

  const socialButtonClass =
    'px-3 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors'

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="share-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-md bg-zinc-900 rounded-xl p-6 shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors text-xl leading-none"
            >
              ✕
            </button>

            <h2
              className="text-white font-bold text-lg mb-5"
              style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
            >
              Share Your Results
            </h2>

            {/* Section 1 — Native share (mobile only) */}
            {canNativeShare && (
              <div className="mb-5">
                <button
                  onClick={handleNativeShare}
                  className="w-full px-6 py-3 bg-amber-400 text-black font-bold rounded-xl hover:bg-amber-300 transition-colors"
                  style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
                >
                  Share via…
                </button>
              </div>
            )}

            {/* Section 2 — Share a link */}
            <div className="mb-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
                Share a link
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={socialButtonClass}
                >
                  𝕏 Post
                </a>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={socialButtonClass}
                  onClick={() => {
                    // Facebook doesn't allow pre-populated text — copy it so user can paste
                    navigator.clipboard?.writeText(shareText).catch(() => {})
                  }}
                  title="Caption copied to clipboard — paste into your Facebook post"
                >
                  Facebook
                </a>
                <a
                  href={`https://bsky.app/intent/compose?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={socialButtonClass}
                >
                  Bluesky
                </a>
                <button
                  onClick={handleCopyLink}
                  className={socialButtonClass}
                >
                  {linkCopied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            </div>

            {/* Section 3 — Post to Instagram */}
            <div className="mb-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
                Post to Instagram
              </p>
              <button
                onClick={handleDownloadAndShare}
                className="block w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-3 rounded-lg text-sm transition-colors text-center"
                style={{ fontFamily: 'var(--font-inter, sans-serif)' }}
              >
                Download image + copy caption
              </button>
              <p className="text-xs text-zinc-500 mt-1">
                Opens share sheet → save to Photos or share to Instagram
              </p>
              {instagramToast && (
                <p className="text-sm text-zinc-400 mt-2">
                  Caption copied — share to Instagram!
                </p>
              )}
            </div>

            {/* Section 4 — Image preview */}
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/share/${zip}`}
                alt={`Economic data poster for ${zip}`}
                className="w-full max-w-[200px] mx-auto rounded-lg border border-zinc-700 block"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
