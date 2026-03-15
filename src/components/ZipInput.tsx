'use client'
import { useState } from 'react'

interface ZipInputProps {
  onSubmit: (zip: string) => void
  isLoading: boolean
}

export function ZipInput({ onSubmit, isLoading }: ZipInputProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 5)
    setValue(v)
    if (error) setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (value.length !== 5) {
      setError('Please enter a 5-digit zip code')
      return
    }
    onSubmit(value)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center gap-3 w-full max-w-sm mx-auto">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={5}
        placeholder="Enter zip code"
        value={value}
        onChange={handleChange}
        disabled={isLoading}
        data-testid="zip-input"
        className="w-full text-center text-3xl tracking-widest bg-zinc-900 border-2 border-zinc-700 focus:border-electric-amber rounded-xl px-6 py-4 text-white placeholder:text-zinc-600 outline-none transition-colors disabled:opacity-50"
        style={{ fontFamily: 'var(--font-bebas, sans-serif)' }}
      />
      {error && (
        <p className="text-danger-red text-sm" style={{ fontFamily: 'var(--font-inter, sans-serif)' }} role="alert">{error}</p>
      )}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-3 px-6 bg-electric-amber text-black font-semibold rounded-xl disabled:opacity-40 opacity-100 transition-opacity"
        style={{ fontFamily: 'var(--font-inter, sans-serif)', opacity: isLoading ? undefined : value.length !== 5 ? 0.4 : 1 }}
      >
        {isLoading ? 'Loading...' : 'See What Changed'}
      </button>
    </form>
  )
}
