import { countWords } from './store-utils.js'
import { normalizeText } from './similarity.js'

/**
 * Translation leverage is a quoting aid, not an accounting system. We keep the
 * buckets aligned with the TM match bands the workbench already shows so a
 * project manager can explain every number from the same lookup result.
 */
export const MATCH_BUCKETS = ['ice', 'exact', 'fuzzy85', 'fuzzy70', 'new']

export function classifyLeverage(match) {
  if (!match) return 'new'
  if (match.contextMatch === 'ice' || match.percent >= 101) return 'ice'
  if (match.exact) return 'exact'
  if (match.percent >= 85) return 'fuzzy85'
  if (match.percent >= 70) return 'fuzzy70'
  return 'new'
}

export const analysisMethods = {
  analyzeDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const buckets = { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 }
    const duplicateMap = new Map()
    let words = 0
    let characters = 0
    let translated = 0
    let confirmed = 0

    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      const source = String(segment.source ?? '')
      words += countWords(source)
      characters += Array.from(source).length
      if (String(segment.target ?? '').trim()) translated += 1
      if (segment.confirmedAt) confirmed += 1
      const key = normalizeText(source)
      if (key) duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1)

      const result = this.lookupTM({
        query: source,
        threshold: 0.7,
        limit: 1,
        documentId: doc.id,
        index,
      })
      const bucket = classifyLeverage(result.matches[0])
      buckets[bucket] += 1
    }

    const total = doc.segments.length
    const duplicateGroups = Array.from(duplicateMap.values()).filter((count) => count > 1)
    const duplicateSegments = duplicateGroups.reduce((sum, count) => sum + count, 0)
    const matched = buckets.ice + buckets.exact + buckets.fuzzy85 + buckets.fuzzy70
    const weighted =
      buckets.ice * 1.01 +
      buckets.exact +
      buckets.fuzzy85 * 0.9 +
      buckets.fuzzy70 * 0.75
    const percent = (value) => (total ? Math.round((value / total) * 1000) / 10 : 0)

    return {
      documentId: doc.id,
      name: doc.name,
      sourceLang: doc.sourceLang,
      targetLang: doc.targetLang,
      segments: total,
      words,
      characters,
      translated,
      confirmed,
      duplicates: {
        groups: duplicateGroups.length,
        segments: duplicateSegments,
      },
      buckets,
      matched: {
        segments: matched,
        percent: percent(matched),
      },
      leverage: {
        weighted: total ? Math.round((weighted / total) * 1000) / 10 : 0,
        percent: percent(weighted),
      },
      generatedAt: new Date().toISOString(),
    }
  },
}
