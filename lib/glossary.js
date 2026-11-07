import { CatError } from './errors.js'
import { DEFAULT_GLOSSARY_ID, DEFAULT_GLOSSARY_NAME, MAX_SEGMENTS, canonicalLanguage, cleanLang, cleanText, escapeRegExp, makeId, now, parseGlossaryCsv } from './store-utils.js'
import { normalizeText } from './similarity.js'

export const glossaryMethods = {
  findGlossaryHits(text, sourceLang) {
    const haystack = String(text ?? '')
    if (!haystack) return []
    const lower = haystack.toLowerCase()
    const lang = sourceLang ? canonicalLanguage(sourceLang) : ''
    const hits = []
    const mountedGlossary = new Set(this.mounts.glossaryIds)

    for (const entry of this.glossary) {
      if (!mountedGlossary.has(entry.glossaryId || DEFAULT_GLOSSARY_ID)) continue
      if (entry.sourceLang && lang && entry.sourceLang !== lang) continue
      const needle = entry.source
      if (!needle) continue
      const index = entry.caseSensitive ? haystack.indexOf(needle) : lower.indexOf(needle.toLowerCase())
      if (index < 0) continue

      let count = 0
      const pattern = new RegExp(escapeRegExp(needle), entry.caseSensitive ? 'g' : 'gi')
      while (pattern.exec(haystack) !== null && count < 99) count += 1

      hits.push({
        id: entry.id,
        glossaryId: entry.glossaryId || DEFAULT_GLOSSARY_ID,
        term: entry.source,
        target: entry.target,
        note: entry.note || '',
        count,
      })
    }

    return hits.sort((a, b) => b.term.length - a.term.length)
  }
,
  addGlossary({ source, target, note, sourceLang, caseSensitive, glossaryId } = {}) {
    const term = cleanText(source, '术语')
    const translation = cleanText(target, '术语译文')
    if (!term || !translation) throw new CatError('EMPTY_TERM', '术语和译文都不能为空。')
    const lang = sourceLang ? cleanLang(sourceLang, '') : ''
    const libraryId = this.requireGlossaryLibrary(glossaryId)
    const existing = this.glossary.find(
      (entry) =>
        (entry.glossaryId || DEFAULT_GLOSSARY_ID) === libraryId &&
        normalizeText(entry.source) === normalizeText(term) &&
        entry.sourceLang === lang,
    )
    if (existing) {
      existing.source = term
      existing.target = translation
      existing.note = String(note ?? '').trim()
      existing.caseSensitive = Boolean(caseSensitive)
      existing.updatedAt = now()
      this.touch()
      this.persist()
      return { entry: { ...existing }, created: false }
    }
    const entry = {
      id: makeId('gl'),
      glossaryId: libraryId,
      source: term,
      target: translation,
      note: String(note ?? '').trim(),
      sourceLang: lang,
      caseSensitive: Boolean(caseSensitive),
      createdAt: now(),
      updatedAt: now(),
    }
    this.glossary.push(entry)
    this.touch()
    this.persist()
    return { entry: { ...entry }, created: true }
  }
,
  updateGlossary({ id, source, target, note, caseSensitive } = {}) {
    const entry = this.glossary.find((item) => item.id === id)
    if (!entry) throw new CatError('TERM_NOT_FOUND', '术语不存在。', 404)
    // The library page manages every library, mounted or not; only the target
    // library has to exist.
    this.requireGlossaryLibrary(entry.glossaryId || DEFAULT_GLOSSARY_ID)
    if (source !== undefined) {
      const value = cleanText(source, '术语')
      if (!value) throw new CatError('EMPTY_TERM', '术语不能为空。')
      entry.source = value
    }
    if (target !== undefined) {
      const value = cleanText(target, '术语译文')
      if (!value) throw new CatError('EMPTY_TERM', '术语译文不能为空。')
      entry.target = value
    }
    if (note !== undefined) entry.note = String(note ?? '').trim()
    if (caseSensitive !== undefined) entry.caseSensitive = Boolean(caseSensitive)
    entry.updatedAt = now()
    this.touch()
    this.persist()
    return { entry: { ...entry } }
  }
,
  deleteGlossary({ id } = {}) {
    const index = this.glossary.findIndex((item) => item.id === id)
    if (index < 0) throw new CatError('TERM_NOT_FOUND', '术语不存在。', 404)
    this.requireGlossaryLibrary(this.glossary[index].glossaryId || DEFAULT_GLOSSARY_ID)
    const [removed] = this.glossary.splice(index, 1)
    this.touch()
    this.persist()
    return { removed: removed.id }
  }
,
  importGlossary({ text, entries, glossaryId } = {}) {
    const list = Array.isArray(entries) ? entries : parseGlossaryCsv(text)
    if (!list.length) throw new CatError('EMPTY_GLOSSARY_IMPORT', '没有解析到有效术语。')
    if (list.length > MAX_SEGMENTS) throw new CatError('TOO_MANY_TERMS', `一次最多导入 ${MAX_SEGMENTS} 条术语。`)
    const libraryId = this.requireGlossaryLibrary(glossaryId)

    let added = 0
    let updated = 0
    for (const item of list) {
      if (!item || !String(item.source ?? '').trim() || !String(item.target ?? '').trim()) continue
      const lang = item.sourceLang ? cleanLang(item.sourceLang, '') : ''
      const existing = this.glossary.find(
        (entry) =>
          (entry.glossaryId || DEFAULT_GLOSSARY_ID) === libraryId &&
          normalizeText(entry.source) === normalizeText(item.source) &&
          entry.sourceLang === lang,
      )
      if (existing) {
        existing.target = String(item.target).trim()
        existing.note = String(item.note ?? '').trim()
        existing.updatedAt = now()
        updated += 1
      } else {
        this.glossary.push({
          id: makeId('gl'),
          glossaryId: libraryId,
          source: String(item.source).trim(),
          target: String(item.target).trim(),
          note: String(item.note ?? '').trim(),
          sourceLang: lang,
          caseSensitive: Boolean(item.caseSensitive),
          createdAt: now(),
          updatedAt: now(),
        })
        added += 1
      }
    }
    if (added || updated) this.touch()
    this.persist()
    return { added, updated, total: this.glossary.length }
  }
,
  clearGlossary({ glossaryIds, all = false } = {}) {
    let targets
    let scope
    if (all === true) {
      targets = new Set(this.glossaryLibraries.map((library) => library.glossaryId))
      scope = 'all'
    } else if (Array.isArray(glossaryIds) && glossaryIds.length) {
      targets = new Set(glossaryIds.map((id) => this.requireMountedGlossaryLibrary(id)))
      scope = 'explicit'
    } else {
      targets = new Set(this.mounts.glossaryIds)
      scope = 'mounted'
    }

    const before = this.glossary.length
    this.glossary = this.glossary.filter(
      (entry) => !targets.has(entry.glossaryId || DEFAULT_GLOSSARY_ID),
    )
    const removed = before - this.glossary.length
    this.touch()
    this.persist()
    return { removed, scope, glossaryIds: [...targets] }
  }

}
