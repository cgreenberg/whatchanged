import { generateShareCard } from '@/lib/share-card/generate'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params
  if (!/^\d{5}$/.test(zip)) return new Response('Invalid zip', { status: 400 })
  return generateShareCard(zip)
}
