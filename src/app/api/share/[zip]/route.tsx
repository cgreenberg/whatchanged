import { generateShareCard } from '@/lib/share-card/generate'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params
  if (!/^\d{5}$/.test(zip)) return new Response('Invalid zip', { status: 400 })
  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city') ?? undefined
  const state = searchParams.get('state') ?? undefined
  return generateShareCard(zip, city, state)
}
