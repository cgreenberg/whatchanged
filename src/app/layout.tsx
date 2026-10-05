import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'

// Display: a condensed grotesk for headlines and big figures (tabular figures via font-variant-numeric)
const display = IBM_Plex_Sans_Condensed({
  weight: ['500', '600', '700'],
  variable: '--nf-display',
  subsets: ['latin'],
  display: 'swap',
})

const sans = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  variable: '--nf-sans',
  subsets: ['latin'],
  display: 'swap',
})

// Mono for quiet metadata: kickers, sources, dates
const mono = IBM_Plex_Mono({
  weight: ['400', '500'],
  variable: '--nf-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://whatchanged.us'),
  title: 'What Changed | See how your town has changed since January 2025',
  description: 'Enter your zip code to see how local gas, rent, home and grocery prices changed since January 20, 2025, and how electricity prices compare with the year centered on January 2025.',
  openGraph: {
    title: 'What Changed In Your Town?',
    description: 'Enter your zip code. See what changed since January 2025.',
    url: 'https://whatchanged.us',
    siteName: 'What Changed',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'What Changed - Local Economic Snapshot',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'What Changed In Your Town?',
    description: 'Enter your zip code. See what changed since January 2025.',
    images: ['/api/og'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
