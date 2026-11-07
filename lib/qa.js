import { missingInlineTokens } from './formats.js'
import { DEFAULT_GLOSSARY_ID } from './store-utils.js'

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
    }

    const counts = issues.reduce(
      (acc, issue) => ({ ...acc, [issue.code]: (acc[issue.code] || 0) + 1 }),
      { PLACEHOLDER_MISSING: 0, NUMBER_MISMATCH: 0, TERM_NOT_USED: 0, EMPTY_TARGET: 0 },
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
