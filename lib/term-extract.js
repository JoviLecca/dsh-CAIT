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

// Sentence-initial capitals are mostly ordinary nouns ("The", "This"). These
// function words are safe to skip; a name-like capital that is not in this set
// still gets a chance, which is what single-mention characters need.
const COMMON_STARTERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'he', 'she', 'they', 'we', 'you', 'i',
  'one', 'two', 'three', 'four', 'five', 'when', 'where', 'after', 'before', 'if', 'but', 'and',
  'so', 'then', 'there', 'here', 'what', 'why', 'how', 'all', 'some', 'many', 'most', 'no', 'not',
  'every', 'each', 'both', 'few', 'more', 'other', 'another', 'such', 'as', 'at', 'by', 'for',
  'from', 'in', 'of', 'on', 'to', 'with', 'without', 'while', 'because', 'although', 'though',
])

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
 * Proper names often appear once. Frequency alone can never find a character
 * introduced on page one and never named again, so this pass deliberately
 * lowers the bar for names: quoted strings, mid-sentence capitalized phrases,
 * and CJK names next to a dialogue verb are candidates even with count 1.
 */
export function properNounCandidates(sentences) {
  const counts = new Map()
  const display = new Map()
  const examples = new Map()
  const evidenceIndex = new Map()
  const confidence = new Map()
  const add = (raw, sentence, index, score, type = 'other') => {
    const term = String(raw ?? '')
      .replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!term || term.length < 2 || term.length > 60) return
    const words = term.split(/\s+/)
    if (words.length > 6) return
    if (words.every((word) => STOPWORDS.has(word.toLocaleLowerCase().replace(/[^\p{L}']/gu, '')))) return
    if (CJK.test(term) && Array.from(term).length > 12) return
    const key = normalizedTerm(term)
    if (!key) return
    counts.set(key, (counts.get(key) || 0) + 1)
    if (!display.has(key)) display.set(key, term)
    if (!examples.has(key)) examples.set(key, [])
    if (examples.get(key).length < 2 && !examples.get(key).includes(sentence)) examples.get(key).push(sentence)
    if (!evidenceIndex.has(key)) evidenceIndex.set(key, index)
    confidence.set(key, Math.max(confidence.get(key) || 0, score))
    if (!display.has(`${key}:type`)) display.set(`${key}:type`, type)
  }

  sentences.forEach((sentence, index) => {
    // Quoted names survive even when the quote is a full short phrase.
    for (const match of sentence.matchAll(/[“"「『]([^”"」』]{2,40})[”"」』]/g)) {
      add(match[1], sentence, index, 0.55)
    }
    // Capitalised runs not at the start of a sentence are the strongest
    // heuristic for Latin names; at the start, require a compound spelling.
    for (const match of sentence.matchAll(/\b([A-Z][A-Za-z'’\-]*(?:\s+[A-Z][A-Za-z'’\-]*){0,3})\b/g)) {
      const term = match[1]
      const prefix = sentence.slice(0, match.index).trim()
      const atStart = !prefix
      const words = term.split(/\s+/)
      const compound = words.length > 1 || /[a-z][A-Z]|[-'’]|^[A-Z]{2,}$/.test(term)
      if (atStart && !compound && COMMON_STARTERS.has(term.toLocaleLowerCase())) continue
      add(term, sentence, index, compound ? 0.62 : 0.5, words.length === 1 ? 'person' : 'other')
    }
    // Chinese names are usually followed by a speech or action verb. This is a
    // narrow but high-precision signal; repeated CJK terms still come from the
    // counting pass.
    for (const match of sentence.matchAll(/([\u3400-\u9fff]{2,4})(?=说|道|问|喊|笑|答|叫|骂|叹|想|看|走|来|去|站|坐)/g)) {
      add(match[1], sentence, index, 0.6, 'person')
    }
  })

  return [...counts.entries()].map(([key, count]) => ({
    term: display.get(key) ?? key,
    key,
    count,
    kind: 'proper',
    proper: true,
    type: display.get(`${key}:type`) || 'other',
    confidence: Math.round((confidence.get(key) || 0.5) * 100) / 100,
    evidenceIndex: evidenceIndex.get(key) ?? 0,
    examples: examples.get(key) ?? [],
  }))
}

/**
 * Candidates for one text, annotated against the terms already in memory.
 */
export function extractTerms(text, options = {}) {
  const sentences = splitSentencesForTerms(text)
  const latin = latinCandidates(sentences, options)
  const cjk = cjkCandidates(text, options)
  const proper = properNounCandidates(sentences)
  const ranked = rankCandidates([...latin, ...cjk])
  const known = new Set((options.knownTerms ?? []).map(normalizedTerm))
  const limit = options.limit ?? 60
  const minimumCount = options.minCount ?? 2
  const byKey = new Map()
  for (const item of [...ranked, ...(minimumCount <= 1 ? proper : [])]) {
    // Single occurrences are only allowed for the proper-name pass. Ordinary
    // n-grams need at least two sightings, otherwise every phrase becomes a
    // "term" and the list is unusable.
    const floor = item.proper ? minimumCount : Math.max(2, minimumCount)
    if (item.count < floor) continue
    const key = normalizedTerm(item.term)
    if (!key) continue
    const existing = byKey.get(key)
    // A counted candidate has stronger evidence than a one-off proper-name
    // guess, so it wins the duplicate key; proper metadata fills the gaps.
    if (!existing || item.count > existing.count) {
      byKey.set(key, {
        ...existing,
        ...item,
        examples: item.examples?.length ? item.examples : existing?.examples ?? [],
      })
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || (b.proper ? 1 : 0) - (a.proper ? 1 : 0))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      inLibrary: known.has(normalizedTerm(item.term)),
    }))
}
