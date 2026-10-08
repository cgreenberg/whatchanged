import { generateShareCard } from '@/lib/share-card/generate'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ zip: string }> }
) {
  const { zip } = await params
  if (!/^\d{5}$/.test(zip)) return new Response('Invalid zip', { status: 400 })
  // city/state in shared links are ignored: every number comes from the zip alone
  return generateShareCard(zip)
}
