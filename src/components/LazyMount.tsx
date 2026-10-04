'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Renders `children` only once the placeholder comes within `rootMargin` of the viewport; stays mounted after. */
export function LazyMount({
  children, placeholder, rootMargin = '150px',
}: { children: ReactNode; placeholder: ReactNode; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (show || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShow(true); io.disconnect() }
    }, { rootMargin })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [show, rootMargin])

  return <div ref={ref}>{show ? children : placeholder}</div>
}
