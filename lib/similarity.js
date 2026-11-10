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

function tokenSet(value) {
  const latin = value.match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || []
  const cjk = value.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []
  return new Set([...latin, ...cjk])
}

function jaccard(left, right) {
  const leftSize = left.size
  const rightSize = right.size
  if (!leftSize || !rightSize) return 0
  let intersection = 0
  const [small, large] = leftSize <= rightSize ? [left, right] : [right, left]
  for (const token of small) if (large.has(token)) intersection += 1
  return intersection / (leftSize + rightSize - intersection)
}

/**
 * The query half of `similarity()`, computed once and reused across candidates.
 * A translation-memory lookup scores one query against thousands of entries, so
 * rebuilding the query's bigrams and token set per entry is the difference
 * between a 10 ms and a 110 ms click.
 */
export function prepare(text) {
  const normalized = normalizeText(text)
  return { text: normalized, grams: bigrams(normalized), tokens: tokenSet(normalized) }
}

/**
 * Cheap, allocation-free shape of a stored key: how many bigrams and tokens it
 * has. Both are upper bounds for the score it can reach against a query, which
 * is what `lookupTM` uses to skip entries that cannot pass the threshold.
 */
export function textStats(value) {
  const normalized = normalizeText(value)
  const chars = Array.from(normalized.replace(/[\s\p{P}\p{S}]+/gu, ''))
  return {
    normalized,
    grams: chars.length <= 1 ? chars.length : chars.length - 1,
    // Must be the real set size: a ceiling built from an overestimated larger
    // side would come out *below* the true score and drop real matches.
    tokens: tokenSet(normalized).size,
  }
}

/**
 * Highest score `candidate` could possibly reach, from counts alone:
 *   dice <= 2 * min(g1, g2) / (g1 + g2)   and   jaccard <= min(t1, t2) / max(t1, t2).
 * Never an estimate: a false negative here would silently drop a real match.
 */
export function scoreCeiling(prepared, stats) {
  const leftGrams = prepared.grams.length
  const rightGrams = stats.grams
  const leftTokens = prepared.tokens.size
  const rightTokens = stats.tokens
  const dice =
    leftGrams && rightGrams ? (2 * Math.min(leftGrams, rightGrams)) / (leftGrams + rightGrams) : 0
  const jac =
    leftTokens && rightTokens
      ? Math.min(leftTokens, rightTokens) / Math.max(leftTokens, rightTokens)
      : 0
  return 0.72 * dice + 0.28 * jac
}

export function scorePrepared(prepared, candidate) {
  const right = normalizeText(candidate)
  if (!prepared.text || !right) return 0
  if (prepared.text === right) return 1
  const score =
    0.72 * diceCoefficientPrepared(prepared, right) +
    0.28 * jaccard(prepared.tokens, tokenSet(right))
  return Math.round(Math.min(1, Math.max(0, score)) * 10000) / 10000
}

function diceCoefficientPrepared(prepared, right) {
  const rightGrams = bigrams(right)
  const left = prepared.grams
  if (!left.length || !rightGrams.length) return 0
  const counts = new Map()
  for (const gram of rightGrams) counts.set(gram, (counts.get(gram) || 0) + 1)
  let overlap = 0
  for (const gram of left) {
    const count = counts.get(gram) || 0
    if (count > 0) {
      overlap += 1
      counts.set(gram, count - 1)
    }
  }
  return (2 * overlap) / (left.length + rightGrams.length)
}

export function similarity(a, b) {
  return scorePrepared(prepare(a), b)
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.round(clamp(number, min, max))
}
