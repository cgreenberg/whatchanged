// Writes docs/DATA_RESOLUTION.md from the resolution ladders (src/lib/resolution/ladders.ts).
// Run: npm run docs:ladders. tests/unit/ladder-docs.test.ts fails when the committed file is stale.
import fs from 'fs'
import path from 'path'
import { renderLadderDoc } from '../src/lib/resolution/doc'

const out = path.join(__dirname, '..', 'docs', 'DATA_RESOLUTION.md')
fs.writeFileSync(out, renderLadderDoc())
console.log(`wrote ${path.relative(process.cwd(), out)}`)
