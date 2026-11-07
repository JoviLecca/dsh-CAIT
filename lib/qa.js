import { missingInlineTokens } from './formats.js'
import { normalizeText } from './similarity.js'
import { clampInt, DEFAULT_GLOSSARY_ID } from './store-utils.js'

const TOKEN_PATTERN = /\{\d+\}/g
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g

/** Inline tokens are `{0}`, `{1}`… — the only markup CAIT keeps verbatim. */
function tokensIn(text) {
  return String(text ?? '').match(TOKEN_PATTERN) || []
}

/**
 * Numbers are compared as a multiset: "1,200" and "1200" are the same value,
 * while "2024" and "2025" are not. Thousands separators are the only thing we
 * normalise, because that is the one difference translators introduce on purpose.
 */
function numbersIn(text) {
  // `{0}` is a placeholder, not the number zero — strip tokens before scanning.
  const raw = String(text ?? '').replace(/\{\d+\}/g, ' ').match(NUMBER_PATTERN) || []
  return raw.map((value) => value.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1'))
}

function sameMultiset(left, right) {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((value, index) => value === b[index])
}

/**
 * Lightweight QA. Everything here is advisory: it never blocks an export and
 * nothing is stored, so the checks can evolve without a migration.
 */
export const qaMethods = {
  /**
   * Groups of segments that share one source but disagree on the target. The
   * mechanical part of a consistency review; an agent can then judge which
   * variant is right and propose a fix.
   */
  consistencyReport({ documentId, limit = 50 } = {}) {
    const doc = this.requireDocument(documentId)
    const groups = new Map()
    doc.segments.forEach((segment, index) => {
      const key = normalizeText(segment.source)
      if (!key) return
      const bucket = groups.get(key)
      const item = { index, target: String(segment.target ?? '') }
      if (bucket) bucket.push(item)
      else groups.set(key, [item])
    })
    const conflicts = []
    for (const [key, items] of groups) {
      const variants = new Map()
      for (const item of items) {
        const value = normalizeText(item.target)
        if (!value) continue
        if (!variants.has(value)) variants.set(value, [])
        variants.get(value).push(item.index)
      }
      if (variants.size < 2) continue
      conflicts.push({
        source: items[0] ? doc.segments[items[0].index].source : key,
        variants: [...variants.entries()].map(([target, indices]) => ({ target, indices })),
        indices: items.map((item) => item.index),
      })
    }
    return {
      documentId: doc.id,
      conflicts: conflicts.slice(0, clampInt(limit, 1, 200, 50)),
      total: conflicts.length,
    }
  },

  getQaReport({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const mounted = new Set(this.mounts.glossaryIds)
    const terms = this.glossary.filter(
      (entry) =>
        mounted.has(entry.glossaryId || DEFAULT_GLOSSARY_ID) &&
        (!entry.sourceLang || entry.sourceLang === doc.sourceLang),
    )
    const issues = []
    const push = (index, code, message) => issues.push({ index, code, message })
    let checked = 0
    let withText = 0
    // Group by source so a repeated sentence with two different renderings is
    // visible: propagation makes this the most likely mistake after an import.
    const bySource = new Map()

    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      const target = String(segment.target ?? '')
      checked += 1

      if (segment.status !== 'pending' && !target.trim()) {
        push(index, 'EMPTY_TARGET', '句段标记为已翻译/已确认，但译文为空。')
        continue
      }
      if (!target.trim()) continue
      withText += 1

      const missing = missingInlineTokens(segment.meta?.inline, target)
      for (const token of missing) {
        push(index, 'PLACEHOLDER_MISSING', `译文缺少标签占位符 ${token}。`)
      }
      const sourceTokens = new Set(tokensIn(segment.source))
      for (const token of sourceTokens) {
        if (!missing.includes(token) && !target.includes(token)) {
          push(index, 'PLACEHOLDER_MISSING', `译文缺少占位符 ${token}。`)
        }
      }

      if (!sameMultiset(numbersIn(segment.source), numbersIn(target))) {
        push(index, 'NUMBER_MISMATCH', '源文与译文中的数字不一致。')
      }

      for (const entry of terms) {
        const present = entry.caseSensitive
          ? segment.source.includes(entry.source)
          : segment.source.toLocaleLowerCase().includes(entry.source.toLocaleLowerCase())
        if (!present) continue
        const used = entry.caseSensitive
          ? target.includes(entry.target)
          : target.toLocaleLowerCase().includes(entry.target.toLocaleLowerCase())
        if (!used) push(index, 'TERM_NOT_USED', `术语「${entry.source} → ${entry.target}」未在译文中出现。`)
      }

      // Copying the source into the target is the most common disguise for a
      // missed translation. Pure digits or punctuation are identical by nature.
      if (/\p{L}/u.test(segment.source) && normalizeText(target) === normalizeText(segment.source)) {
        push(index, 'UNTRANSLATED_RESIDUE', '译文与源文完全相同，可能是漏译。')
      }

      const sourceKey = normalizeText(segment.source)
      if (sourceKey) {
        const bucket = bySource.get(sourceKey)
        if (bucket) bucket.push({ index, target: normalizeText(target) })
        else bySource.set(sourceKey, [{ index, target: normalizeText(target) }])
      }
    }

    for (const group of bySource.values()) {
      if (group.length < 2) continue
      const variants = new Set(group.map((item) => item.target))
      if (variants.size < 2) continue
      for (const item of group) {
        push(item.index, 'INCONSISTENT_TARGET', `同一源文出现了 ${variants.size} 种不同译文。`)
      }
    }

    const counts = issues.reduce(
      (acc, issue) => ({ ...acc, [issue.code]: (acc[issue.code] || 0) + 1 }),
      { PLACEHOLDER_MISSING: 0, NUMBER_MISMATCH: 0, TERM_NOT_USED: 0, EMPTY_TARGET: 0, UNTRANSLATED_RESIDUE: 0, INCONSISTENT_TARGET: 0 },
    )

    return {
      documentId: doc.id,
      total: doc.segments.length,
      checked,
      withText,
      issueCount: issues.length,
      counts,
      issues,
    }
  },
}
