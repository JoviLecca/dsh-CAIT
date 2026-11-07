/**
 * Terminology candidates, found by counting rather than by asking a model to
 * read a document. Models are good at judging a short list ("is this a domain
 * term? what does it translate to?") and bad at enumerating one: without
 * frequency evidence a long list cannot be reviewed and gets abandoned, which
 * is exactly what happened the first time.
 *
 * So this module only proposes candidates with evidence — occurrences, length,
 * boundary entropy, containment — and the model (or the human) picks.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'as', 'it', 'its', 'we', 'you', 'they', 'he', 'she', 'i', 'not', 'no', 'do',
  'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'have', 'has',
  'had', 'there', 'here', 'when', 'where', 'which', 'who', 'what', 'how', 'all', 'any', 'some',
  'more', 'most', 'other', 'into', 'over', 'under', 'about', 'after', 'before', 'also', 'just',
  'only', 'very', 'so', 'such', 'use', 'used', 'using', 'one', 'two', 'new', 'get', 'set', 'see',
])

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

const WORD = /[A-Za-z][A-Za-z0-9'’.-]*/g

export function splitSentencesForTerms(text) {
  return String(text ?? '')
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function wordsOf(sentence) {
  return (sentence.match(WORD) || []).map((word) => word.replace(/[.'’-]+$/, ''))
}

function normalizedTerm(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

/** Latin candidates are word n-grams (1–4) without a stopword at either edge. */
export function latinCandidates(sentences, options = {}) {
  const maxN = options.maxN ?? 4
  const counts = new Map()
  const examples = new Map()
  const display = new Map()
  for (const sentence of sentences) {
    const words = wordsOf(sentence)
    for (let n = 1; n <= maxN; n += 1) {
      for (let start = 0; start + n <= words.length; start += 1) {
        const slice = words.slice(start, start + n)
        if (STOPWORDS.has(slice[0].toLocaleLowerCase())) continue
        if (STOPWORDS.has(slice[n - 1].toLocaleLowerCase())) continue
        const term = slice.join(' ')
        // A single token has to look like a name or a compound; plain everyday
        // words are noise.
        if (n === 1 && !/^[A-Z][A-Za-z0-9]*$|[-_]|[a-z][A-Z]/.test(slice[0])) continue
        const key = normalizedTerm(term)
        counts.set(key, (counts.get(key) || 0) + 1)
        if (!display.has(key)) display.set(key, term)
        if (!examples.has(key)) examples.set(key, [])
        const bucket = examples.get(key)
        if (bucket.length < 2 && !bucket.includes(sentence)) bucket.push(sentence)
      }
    }
  }
  return [...counts.entries()].map(([key, count]) => ({
    term: display.get(key) ?? key,
    key,
    count,
    kind: 'latin',
    examples: examples.get(key) ?? [],
  }))
}

function entropy(values) {
  if (!values.length) return 0
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  let value = 0
  for (const amount of counts.values()) {
    const p = amount / values.length
    value -= p * Math.log2(p)
  }
  return value
}

/**
 * Chinese, Japanese and Korean have no spaces, so candidates are repeated
 * substrings. Left/right neighbour entropy filters out fragments that are
 * merely the middle of a longer word: a real term appears after many different
 * characters, a fragment appears after the same one.
 */
export function cjkCandidates(text, options = {}) {
  const min = options.min ?? 2
  const max = options.max ?? 6
  const limit = options.limit ?? 400
  const body = String(text ?? '').replace(/\s+/g, ' ')
  const counts = new Map()
  const left = new Map()
  const right = new Map()
  for (let start = 0; start < body.length; start += 1) {
    if (!CJK.test(body[start])) continue
    for (let size = min; size <= max; size += 1) {
      const end = start + size
      if (end > body.length) break
      const piece = body.slice(start, end)
      if (!CJK.test(piece[0]) || !CJK.test(piece[size - 1])) continue
      counts.set(piece, (counts.get(piece) || 0) + 1)
      if (!left.has(piece)) left.set(piece, [])
      if (!right.has(piece)) right.set(piece, [])
      left.get(piece).push(body[start - 1] ?? '')
      right.get(piece).push(body[end] ?? '')
    }
  }
  const candidates = []
  for (const [term, count] of counts) {
    if (count < 2) continue
    const boundary = Math.min(entropy(left.get(term) || []), entropy(right.get(term) || []))
    if (boundary < 0.5) continue
    candidates.push({ term, count, kind: 'cjk', boundary, examples: [] })
  }
  return candidates.sort((a, b) => b.count - a.count).slice(0, limit)
}

/**
 * C-value in spirit: frequent, long candidates win, and a string that is only
 * ever contained in a longer candidate loses to that longer one.
 */
export function rankCandidates(candidates) {
  for (const item of candidates) {
    let contained = 0
    let longerCount = 0
    for (const other of candidates) {
      if (other === item) continue
      if (other.term.length > item.term.length && other.term.includes(item.term)) {
        contained += 1
        longerCount += other.count
      }
    }
    const lengthBonus = Math.log2(2 + Array.from(item.term).length)
    const cvalue = item.count * lengthBonus - (contained ? longerCount / contained : 0)
    item.score = Math.round(Math.max(0, cvalue) * 1000) / 1000
  }
  // A fragment that only ever shows up inside a longer term is part of that
  // term, not a term of its own ("design" next to "Design System").
  const covered = new Set()
  for (const item of candidates) {
    for (const other of candidates) {
      if (other === item) continue
      if (other.term.length > item.term.length && other.term.includes(item.term) && other.count >= item.count) {
        covered.add(item)
        break
      }
    }
  }
  const seen = new Set()
  const unique = []
  for (const item of candidates.filter((candidate) => !covered.has(candidate)).sort((a, b) => b.score - a.score || b.count - a.count)) {
    // Fold case and a trailing plural: "Mode"/"modes" are one concept.
    const fold = normalizedTerm(item.term).replace(/(\w)s$/, '$1')
    if (seen.has(fold)) continue
    seen.add(fold)
    unique.push(item)
  }
  return unique
}

/**
 * Candidates for one text, annotated against the terms already in memory.
 */
export function extractTerms(text, options = {}) {
  const sentences = splitSentencesForTerms(text)
  const latin = latinCandidates(sentences, options)
  const cjk = cjkCandidates(text, options)
  const ranked = rankCandidates([...latin, ...cjk])
  const known = new Set((options.knownTerms ?? []).map(normalizedTerm))
  const limit = options.limit ?? 60
  const minimumCount = options.minCount ?? 2
  return ranked
    .filter((item) => item.count >= minimumCount)
    .map((item) => ({
      ...item,
      inLibrary: known.has(normalizedTerm(item.term)),
    }))
    .slice(0, limit)
}
