import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { DEFAULT_TM_ID } from '../lib/limits.js'
import { contextOf } from '../lib/context.js'
import { classifyMatchType, normalizeText, similarity } from '../lib/similarity.js'

/**
 * Guards the lookup fast path in `lib/tm.js`: it skips entries whose bigram and
 * token counts prove they cannot reach the score floor. The skip is only sound
 * if the ceiling really bounds the score, so this suite replays the original
 * brute-force algorithm and compares every field of every match.
 */

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-tm-index-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- reference implementation, copied from lib/similarity.js before the index ----

function bigrams(value) {
  const chars = Array.from(value.replace(/[\s\p{P}\p{S}]+/gu, ''))
  if (chars.length <= 1) return chars
  const out = []
  for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i] + chars[i + 1])
  return out
}

function diceCoefficient(a, b) {
  const left = bigrams(a)
  const right = bigrams(b)
  if (!left.length || !right.length) return a === b ? 1 : 0
  const counts = new Map()
  for (const gram of left) counts.set(gram, (counts.get(gram) || 0) + 1)
  let overlap = 0
  for (const gram of right) {
    const count = counts.get(gram) || 0
    if (count > 0) {
      overlap += 1
      counts.set(gram, count - 1)
    }
  }
  return (2 * overlap) / (left.length + right.length)
}

function tokenSet(value) {
  const latin = value.match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || []
  const cjk = value.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []
  return new Set([...latin, ...cjk])
}

function jaccard(a, b) {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

function referenceSimilarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const score = 0.72 * diceCoefficient(left, right) + 0.28 * jaccard(left, right)
  return Math.round(Math.min(1, Math.max(0, score)) * 10000) / 10000
}

function referenceMatches(store, { query, threshold, limit = 5, sourceLang, targetLang, mounted }) {
  const text = normalizeText(query)
  const src = sourceLang || store.settings.sourceLang
  const tgt = targetLang || store.settings.targetLang
  if (!text) return []
  return store.tm
    .filter(
      (entry) => mounted.has(entry.tmId) && entry.sourceLang === src && entry.targetLang === tgt,
    )
    .map((entry) => {
      const exact = entry.key === text
      const score = exact ? 1 : referenceSimilarity(text, entry.key)
      return { entry, exact, ice: false, score }
    })
    .filter((item) => item.score >= threshold)
    .sort(
      (a, b) =>
        Number(b.ice) - Number(a.ice) ||
        Number(b.exact) - Number(a.exact) ||
        b.score - a.score ||
        b.entry.updatedAt.localeCompare(a.entry.updatedAt),
    )
    .slice(0, limit)
    .map((item) => ({
      id: item.entry.id,
      score: item.score,
      exact: item.exact,
      matchType: classifyMatchType({
        exact: item.exact,
        score: item.score,
        query: text,
        source: item.entry.key,
      }),
      contextMatch: null,
      percent: Math.round(item.score * 100),
    }))
}

function shape(matches) {
  return matches.map((match) => ({
    id: match.id,
    score: match.score,
    exact: match.exact,
    matchType: match.matchType,
    contextMatch: match.contextMatch,
    percent: match.percent,
  }))
}

function referenceShape(rows) {
  return rows
}

try {
  section('similarity() still returns the brute-force score')
  {
    const random = mulberry32(20261110)
    const alphabet = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'the',
      'quick',
      'brown',
      '狐狸',
      '跳',
      '过',
      '懒',
      '狗',
      '记忆',
      '库',
      '42',
      'naïve',
      "don't",
      '—',
      '…',
      '  ',
    ]
    const text = () => {
      const count = Math.floor(random() * 8)
      const parts = []
      for (let i = 0; i < count; i += 1)
        parts.push(alphabet[Math.floor(random() * alphabet.length)])
      return parts.join(random() < 0.5 ? ' ' : '')
    }
    for (let i = 0; i < 400; i += 1) {
      const a = text()
      const b = random() < 0.2 ? text() : text()
      assert.equal(similarity(a, b), referenceSimilarity(a, b), `mismatch for ${a} / ${b}`)
    }
    for (const [a, b] of [
      ['', ''],
      ['', 'x'],
      ['a', 'a'],
      ['aaaa', 'aaaa'],
      ['abab', 'abab'],
      ['—…', '—…'],
      ['Hello  world', 'hello world'],
      ['MIXED case', 'mixed CASE'],
    ]) {
      assert.equal(similarity(a, b), referenceSimilarity(a, b))
    }
  }

  section('lookupTM drops nothing the brute-force scan would keep')
  {
    const store = new CatStore({ logger: silent, dataDir: tempDir() })
    const random = mulberry32(77)
    const vocabulary = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      '回答',
      '确认',
      '句段',
      '项目',
      '交付',
      'review',
      'approve',
      'deadline',
    ]
    store.mounts.tmIds = [DEFAULT_TM_ID]
    for (let i = 0; i < 180; i += 1) {
      const count = 1 + Math.floor(random() * 12)
      const parts = []
      for (let j = 0; j < count; j += 1)
        parts.push(vocabulary[Math.floor(random() * vocabulary.length)])
      const source = parts.join(random() < 0.3 ? '' : ' ')
      store.tm.push({
        id: `tm_${i}`,
        tmId: DEFAULT_TM_ID,
        key: normalizeText(source),
        source,
        target: `译文 ${i}`,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        context: null,
        contextHash: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      })
    }

    const queries = store.tm.slice(0, 40).map((entry) => entry.source)
    for (let i = 0; i < 20; i += 1) {
      const count = 1 + Math.floor(random() * 10)
      const parts = []
      for (let j = 0; j < count; j += 1)
        parts.push(vocabulary[Math.floor(random() * vocabulary.length)])
      queries.push(parts.join(' '))
    }
    queries.push('', '   ', 'alpha', 'ALPHA')

    const mounted = new Set([DEFAULT_TM_ID])
    let checks = 0
    for (const query of queries) {
      for (const threshold of [0, 0.3, 0.55, 0.7, 0.85, 1]) {
        for (const limit of [1, 5, 30]) {
          const actual = store.lookupTM({ query, threshold, limit })
          const expected = referenceMatches(store, { query, threshold, limit, mounted })
          assert.deepEqual(
            shape(actual.matches),
            referenceShape(expected),
            `${query} @ ${threshold}`,
          )
          checks += 1
        }
      }
    }
    console.log(`  ${checks} lookups match the brute-force scan`)
  }

  section('context variants keep their ICE grade')
  {
    const store = new CatStore({ logger: silent, dataDir: tempDir() })
    const { document } = store.createDocument({
      name: 'Doc',
      text: 'Hello world. Second line. Third line.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.mounts.tmIds = [DEFAULT_TM_ID]
    const context = contextOf(doc, 0)
    store.upsertTM('Hello world.', '你好，世界。', 'en', 'zh-CN', DEFAULT_TM_ID, context)
    store.upsertTM('Hello world.', '你好，世界！', 'en', 'zh-CN', DEFAULT_TM_ID)

    const withContext = store.lookupTM({ query: 'Hello world.', documentId: doc.id, index: 0 })
    const ice = withContext.matches.filter((match) => match.contextMatch === 'ice')
    assert.equal(ice.length, 1)
    assert.equal(ice[0].percent, 101)
    assert.equal(ice[0].matchType, 'context')

    const flat = store.lookupTM({ query: 'Hello world.' })
    assert.equal(flat.matches.filter((match) => match.contextMatch === 'ice').length, 0)
    assert.equal(flat.matches[0].matchType, 'exact')
  }
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}

console.log('\nall tm index checks passed')
