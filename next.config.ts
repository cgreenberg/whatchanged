import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Transpile ESM-only packages that Jest (via next/jest) needs to handle
  transpilePackages: ['until-async'],
  // The share image reads the bundled fonts and the county rent series from public/ at runtime
  outputFileTracingIncludes: {
    '/api/card-image': ['./public/fonts/**', './public/data/county/**'],
    '/api/share/[zip]': ['./public/fonts/**', './public/data/county/**'],
  },
}

export default nextConfig
