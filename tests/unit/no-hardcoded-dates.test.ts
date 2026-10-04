/**
 * User-facing strings in src/components and src/lib/county-data.ts must not hard-code a
 * year or month: dates come from the data (API fields, meta.json). The only exception is
 * the Jan 2025 baseline, which lives in named constants (src/lib/baseline.ts) or is a
 * baseline literal such as "Jan 2025" / "2025-01".
 */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'

const ROOT = path.join(__dirname, '..', '..')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
}

const FILES = [...walk(path.join(ROOT, 'src/components')), path.join(ROOT, 'src/lib/county-data.ts')]

/** Baseline references that are allowed to appear verbatim. */
const BASELINE_TOKENS = [
  'January 20, 2025', 'Jan. 20, 2025', 'Jan 20, 2025', 'January 2025', 'Jan 2025', '2025-01-20', '2025-01',
]
/** Constants whose value IS the baseline. */
const BASELINE_CONSTANTS = new Set(['BASELINE_MONTH'])

const YEAR = /\b(19|20)\d{2}\b/
const MONTH_NAME = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+'?\d{2,4}\b/

function stripBaseline(text: string): string {
  return BASELINE_TOKENS.reduce((t, tok) => t.split(tok).join(''), text)
}

function offending(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (node: ts.Node) => {
    let text: string | null = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text
    else if (ts.isJsxText(node)) text = node.text
    if (text != null) {
      // Imports and className/testid-like attributes are not user-facing copy
      const parent = node.parent
      const isImport = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
      const isBaselineConst = ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && BASELINE_CONSTANTS.has(parent.name.text)
      const isAttr = ts.isJsxAttribute(parent) && /^(className|data-testid|key|d|viewBox|style|xmlns|href|src)$/.test(parent.name.getText())
      if (!isImport && !isBaselineConst && !isAttr) {
        const rest = stripBaseline(text)
        if (YEAR.test(rest) || MONTH_NAME.test(rest)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          hits.push(`${path.relative(ROOT, file)}:${line + 1}: ${JSON.stringify(text.trim().slice(0, 80))}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

test('scans the expected files', () => {
  expect(FILES.length).toBeGreaterThan(10)
  expect(FILES.some(f => f.endsWith('HomeContent.tsx'))).toBe(true)
})

test('no hard-coded years or months in user-facing strings (except the Jan 2025 baseline)', () => {
  const hits = FILES.flatMap(offending)
  expect(hits).toEqual([])
})

test('the checker catches a hard-coded as-of date', () => {
  const tmp = path.join(ROOT, 'tests', 'unit', '__tmp_date_probe.tsx')
  fs.writeFileSync(tmp, `export const X = () => <p>BLS · county · Aug 2026</p>\nexport const y = 'as of 2026-08'\n`)
  try {
    expect(offending(tmp)).toHaveLength(2)
  } finally {
    fs.unlinkSync(tmp)
  }
})
