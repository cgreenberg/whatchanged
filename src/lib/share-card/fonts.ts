import path from 'path'
import fs from 'fs'

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900

interface FontConfig {
  name: string
  data: ArrayBuffer
  weight: FontWeight
  style: 'normal'
}

// Module-scope cache — only read once per Node.js worker lifetime
let cachedFonts: FontConfig[] | null = null

function loadFontFile(filename: string): ArrayBuffer | null {
  try {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', filename)
    const buffer = fs.readFileSync(fontPath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  } catch (err) {
    console.warn(`[share-card/fonts] Failed to load bundled font ${filename}:`, err)
    return null
  }
}

export async function loadShareFonts(): Promise<FontConfig[]> {
  if (cachedFonts !== null) {
    return cachedFonts
  }

  const fonts: FontConfig[] = []

  const bebasData = loadFontFile('BebasNeue-Regular.ttf')
  if (bebasData) {
    fonts.push({ name: 'Bebas Neue', data: bebasData, weight: 400, style: 'normal' })
  }

  const dmMonoData = loadFontFile('DMMono-Regular.ttf')
  if (dmMonoData) {
    fonts.push({ name: 'DM Mono', data: dmMonoData, weight: 400, style: 'normal' })
  }

  const barlowData = loadFontFile('BarlowCondensed-SemiBold.ttf')
  if (barlowData) {
    fonts.push({ name: 'Barlow Condensed', data: barlowData, weight: 600, style: 'normal' })
  }

  cachedFonts = fonts
  return cachedFonts
}
