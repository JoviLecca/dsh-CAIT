/**
 * Text normalisation + fuzzy similarity used by the translation memory.
 * Deliberately dependency-free: character Dice gives robust short-segment
 * scoring, token Jaccard keeps word order changes from overstating a match.
 */

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function normalizeSource(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Near-exact comparison key: numbers, punctuation and whitespace are ignored.
 * This is intentionally separate from `similarity()`: punctuation-only edits can
 * score 1.0 while a digit-only edit can score below 0.7, so no score cutoff can
 * identify this class reliably.
 */
export function nearExactKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{N}\p{P}\s]+/gu, '')
}

/**
 * memoQ-style match grades for TM results.
 *
 * Boundaries are based on the observed score distribution:
 *   - one word / word-order edits land around 0.85-0.93;
 *   - a changed word or inflection lands around 0.75-0.85;
 *   - larger rewrites fall below 0.75.
 * The default TM retrieval floor is 0.55, so low_fuzzy is normally the
 * 0.55-0.7499 band rather than the whole range.
 *
 * `near_exact` is gated by `nearExactKey()` equality, never by `score`.
 */
export function classifyMatchType({ exact = false, score = 0, query = '', source = '' } = {}) {
  if (exact) return 'exact'
  const queryKey = nearExactKey(query)
  if (queryKey && queryKey === nearExactKey(source)) return 'near_exact'
  if (score >= 0.85) return 'high_fuzzy'
  if (score >= 0.75) return 'medium_fuzzy'
  return 'low_fuzzy'
}

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

export function similarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const score = 0.72 * diceCoefficient(left, right) + 0.28 * jaccard(left, right)
  return Math.round(Math.min(1, Math.max(0, score)) * 10000) / 10000
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.round(clamp(number, min, max))
}
