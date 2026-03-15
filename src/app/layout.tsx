import type { Metadata } from 'next'
import { Bebas_Neue, Inter } from 'next/font/google'
import './globals.css'

const bebasNeue = Bebas_Neue({
  weight: '400',
  variable: '--font-bebas',
  subsets: ['latin'],
})

const inter = Inter({
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'What Changed | See how your town has changed since January 2025',
  description: 'Enter your zip code to see local unemployment, prices, and federal funding changes since January 20, 2025.',
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
      </body>
    </html>
  )
}
