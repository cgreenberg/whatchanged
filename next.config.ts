import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Transpile ESM-only packages that Jest (via next/jest) needs to handle
  transpilePackages: ['until-async'],
}

export default nextConfig
