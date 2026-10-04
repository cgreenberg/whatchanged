import { generateShareCard } from '@/lib/share-card/generate'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params
  if (!/^\d{5}$/.test(zip)) return new Response('Invalid zip', { status: 400 })
  const { searchParams } = new URL(request.url)
  // Same caps as /api/og and the page metadata: never pass unbounded free text downstream
  const city = searchParams.get('city')?.slice(0, 100) || undefined
  const state = searchParams.get('state')?.slice(0, 2) || undefined
  return generateShareCard(zip, city, state)
}
