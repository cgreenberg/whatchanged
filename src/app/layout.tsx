import type { Metadata } from 'next'
import { Bebas_Neue, Inter } from 'next/font/google'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'

const bebasNeue = Bebas_Neue({
  weight: '400',
  variable: '--font-bebas',
  subsets: ['latin'],
  display: 'swap',
})

const inter = Inter({
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://whatchanged.us'),
  title: 'What Changed | See how your town has changed since January 2025',
  description: 'Enter your zip code to see local unemployment, prices, and federal funding changes since January 20, 2025.',
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
    <html lang="en" className={`${bebasNeue.variable} ${inter.variable}`}>
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
