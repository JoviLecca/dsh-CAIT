import { cleanText, makeId, now, DEFAULT_GLOSSARY_ID } from './store-utils.js'
import { normalizeText } from './similarity.js'
import { extractTerms, splitSentencesForTerms } from './term-extract.js'

/**
 * Evidence for a candidate: existing translation-memory pairs whose source
 * contains it. A term the user already translated somewhere is far more
 * convincing than a model's guess, and it carries the wording they chose.
 */
function memoryEvidence(entries, term) {
  const needle = normalizeText(term)
  if (!needle) return []
  const found = []
  for (const entry of entries) {
    if (found.length >= 2) break
    if (!entry.target) continue
    if (!normalizeText(entry.source).includes(needle)) continue
    if (found.includes(entry.target)) continue
    found.push(entry.target)
  }
  return found
}

export const termMethods = {
  termCandidates({ documentId, limit = 60, minCount = 2 } = {}) {
    const doc = this.requireDocument(documentId)
    const text = doc.segments.map((segment) => segment.source).join('\n')
    const knownTerms = this.glossary.map((entry) => entry.source)
    const candidates = extractTerms(text, {
      knownTerms,
      limit: Math.max(1, Math.min(200, Number(limit) || 60)),
      minCount: Math.max(1, Number(minCount) || 2),
    })
    return {
      documentId: doc.id,
      total: candidates.length,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        evidence: memoryEvidence(this.tm, candidate.term),
      })),
    }
  },

  /**
   * One mutation for a batch of accepted candidates. Unlike addGlossary it does
   * not decide "update or create": a candidate list only ever adds, and a term
   * already present is reported as skipped so the user keeps their wording.
   */
  addGlossaryEntries({ glossaryId, entries = [] } = {}) {
    const libraryId = this.requireGlossaryLibrary(glossaryId)
    let added = 0
    let skipped = 0
    const inserted = []
    for (const raw of Array.isArray(entries) ? entries : []) {
      let term = ''
      let translation = ''
      try {
        term = cleanText(raw?.source, '术语')
        translation = cleanText(raw?.target, '术语译文')
      } catch {
        skipped += 1
        continue
      }
      if (!term || !translation) {
        skipped += 1
        continue
      }
      const sourceLang = String(raw?.sourceLang ?? '').trim()
      const duplicate = this.glossary.some(
        (entry) =>
          (entry.glossaryId || DEFAULT_GLOSSARY_ID) === libraryId &&
          normalizeText(entry.source) === normalizeText(term) &&
          (entry.sourceLang || '') === sourceLang,
      )
      if (duplicate) {
        skipped += 1
        continue
      }
      const entry = {
        id: makeId('gl'),
        glossaryId: libraryId,
        source: term,
        target: translation,
        note: String(raw?.note ?? '').trim(),
        sourceLang,
        caseSensitive: Boolean(raw?.caseSensitive),
        createdAt: now(),
        updatedAt: now(),
      }
      this.glossary.push(entry)
      inserted.push(entry)
      added += 1
    }
    if (added) {
      this.touch()
      this.persist()
    }
    return { added, skipped, total: added + skipped, entries: inserted.map((entry) => ({ ...entry })) }
  },
}

export { splitSentencesForTerms }
