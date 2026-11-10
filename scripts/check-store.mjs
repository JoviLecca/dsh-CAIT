import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_MIXINS, applyMixins } from '../lib/store-mixins.js'
import { projectRoot } from './lib/client-source.mjs'

const problems = []
const libDir = join(projectRoot, 'lib')

// The class body and `applyMixins` are invisible to each other in source form:
// a mixin method with the same name as a class method would win silently. The
// runtime guard in applyMixins cannot see this after the fact either, because
// store.js decorates CatStore at import time, so parse the class body instead.
const storeSource = readFileSync(join(libDir, 'store.js'), 'utf8')
const classBody = new Set()
for (const line of storeSource.split(/\r?\n/)) {
  const match = line.match(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\([^)]*\) \{$/)
  if (match) classBody.add(match[1])
}

const owner = new Map()
for (const mixin of STORE_MIXINS) {
  const entries = Object.entries(mixin.methods)
  if (!entries.length) problems.push(`${mixin.name} (${mixin.file}) exports no methods`)
  const source = readFileSync(join(libDir, mixin.file), 'utf8')
  if (!source.includes(`export const ${mixin.exportName} =`)) {
    problems.push(`${mixin.file} does not export ${mixin.exportName}`)
  }
  for (const [key, value] of entries) {
    if (typeof value !== 'function') {
      problems.push(`${mixin.name}.${key} is not a function (${typeof value})`)
    }
    if (owner.has(key))
      problems.push(`${key} is exported by both ${owner.get(key)} and ${mixin.name}`)
    if (classBody.has(key))
      problems.push(`${key} is defined by both the CatStore class body and ${mixin.name}`)
    owner.set(key, mixin.name)
  }
}

// A module that exports `fooMethods` but never made it into the table would
// install nothing at all — the one failure the table exists to make impossible.
const registered = new Set(STORE_MIXINS.map((mixin) => mixin.exportName))
for (const file of readdirSync(libDir).filter((name) => name.endsWith('.js'))) {
  const source = readFileSync(join(libDir, file), 'utf8')
  for (const match of source.matchAll(/export const (\w+Methods) = \{/g)) {
    if (!registered.has(match[1])) {
      problems.push(`lib/${file} exports ${match[1]}, which is missing from STORE_MIXINS`)
    }
  }
}

const decorated = applyMixins(class CatStoreProbe {})
const byMixin = new Map()
for (const [key, mixin] of decorated) {
  if (!byMixin.has(mixin)) byMixin.set(mixin, [])
  byMixin.get(mixin).push(key)
}

console.log(`store: ${decorated.size} mixin methods across ${STORE_MIXINS.length} modules`)
console.log(`store: ${classBody.size} methods in the CatStore class body`)
for (const row of STORE_MIXINS.map((mixin) => ({
  mixin: mixin.name,
  file: mixin.file,
  count: (byMixin.get(mixin.name) || []).length,
})).sort((a, b) => b.count - a.count)) {
  console.log(`  ${String(row.count).padStart(3)}  ${row.mixin}  (${row.file})`)
}

if (problems.length) {
  for (const problem of problems) console.error(`error: ${problem}`)
  process.exit(1)
}
console.log('store: ok')
