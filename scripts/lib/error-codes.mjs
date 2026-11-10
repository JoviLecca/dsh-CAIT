// The single place that answers "which error codes can the server raise?".
// Both the coverage check and its test read from here, so the two can never
// disagree about what counts as a code.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './client-source.mjs'

// `new CatError('CODE', …)` plus every local helper that takes the code as its
// first argument (`fail('CODE')`, `editError('CODE')`, `parseOrFail(parse, 'CODE')`).
// Codes are the only all-caps literals passed in that position, so new helpers
// are picked up without maintaining a list of them.
const RAISE_PATTERN = /\b[A-Za-z_$][\w$]*\(\s*'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g

function collectErrorCodes() {
  const directory = join(projectRoot, 'lib')
  const codes = new Set()
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(join(directory, file), 'utf8')
    for (const match of text.matchAll(RAISE_PATTERN)) codes.add(match[1])
  }
  return [...codes].sort()
}

export { RAISE_PATTERN, collectErrorCodes }
