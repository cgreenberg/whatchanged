import { generateShareCard } from '@/lib/share-card/generate'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const zip = searchParams.get('zip') ?? ''
  // v param intentionally ignored — used only for cache-busting by social crawlers

  if (!/^\d{5}$/.test(zip)) {
    return new Response('Invalid zip code', { status: 400 })
  }

  const city = searchParams.get('city') ?? undefined
  const state = searchParams.get('state') ?? undefined
  return generateShareCard(zip, city, state)
}
