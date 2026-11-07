/**
 * Library browsing and export. `lookupTM` answers "what matches this segment",
 * which is a query, not a catalogue: it only looks at mounted libraries, scores
 * fuzzily and caps at 30 rows. The library page needs the opposite shape —
 * every entry of a chosen set of libraries, filtered by substring and paged.
 * These methods are read-only, so `lib/api.js` must not list them in MUTATIONS.
 */

import { CatError } from './errors.js'
import { DEFAULT_GLOSSARY_ID, DEFAULT_TM_ID, canonicalLanguage, clampInt } from './store-utils.js'
import { normalizeText } from './similarity.js'
import { buildTmxForEntries } from './tmx.js'
import { glossaryToCsv, glossaryToJson, glossaryToTbx } from './library-export.js'

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
export const PAGE_SIZE_DEFAULT = 50

const EXPORT_FORMATS = {
  tm: ['tmx'],
  glossary: ['tbx', 'csv', 'json'],
}

function dateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function fileStem(name, fallback) {
  const stem = String(name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stem || fallback
}

function pageSizeOf(value) {
  const size = Number(value)
  if (!Number.isFinite(size) || size <= 0) return PAGE_SIZE_DEFAULT
  // The UI only offers four sizes; snapping keeps the total page count honest
  // if a stale localStorage value ever reaches the server.
  return PAGE_SIZE_OPTIONS.reduce(
    (best, option) => (Math.abs(option - size) < Math.abs(best - size) ? option : best),
    PAGE_SIZE_OPTIONS[0],
  )
}

function pageOf(page, pageSize, total) {
  const size = pageSizeOf(pageSize)
  const totalPages = Math.max(1, Math.ceil(total / size))
  const current = clampInt(page ?? 1, 1, totalPages, 1)
  return { page: current, pageSize: size, totalPages, offset: (current - 1) * size }
}

function matchesQuery(entry, query) {
  if (!query) return true
  const needle = normalizeText(query)
  if (!needle) return true
  return normalizeText(entry.source).includes(needle) || normalizeText(entry.target).includes(needle)
}

function languageFacet(entries) {
  const source = new Set()
  const target = new Set()
  for (const entry of entries) {
    if (entry.sourceLang) source.add(entry.sourceLang)
    if (entry.targetLang) target.add(entry.targetLang)
  }
  return { source: [...source].sort(), target: [...target].sort() }
}

function wantedIds(kind, ids, store) {
  const clean = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : []
  if (!clean.length) {
    return new Set(
      kind === 'tm'
        ? store.tmLibraries.map((library) => library.tmId)
        : store.glossaryLibraries.map((library) => library.glossaryId),
    )
  }
  const scoped = new Set()
  for (const id of clean) {
    scoped.add(kind === 'tm' ? store.requireTmLibrary(id) : store.requireGlossaryLibrary(id))
  }
  return scoped
}

export const libraryViewMethods = {
  listTmEntries({ tmIds, query, page, pageSize, sourceLang, targetLang } = {}) {
    const scoped = wantedIds('tm', tmIds, this)
    const src = sourceLang ? canonicalLanguage(sourceLang) : ''
    const tgt = targetLang ? canonicalLanguage(targetLang) : ''

    const inScope = this.tm.filter((entry) => scoped.has(entry.tmId || DEFAULT_TM_ID))
    const languages = languageFacet(inScope)
    const filtered = inScope
      .filter((entry) => !src || entry.sourceLang === src)
      .filter((entry) => !tgt || entry.targetLang === tgt)
      .filter((entry) => matchesQuery(entry, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const paging = pageOf(page, pageSize, filtered.length)
    return {
      kind: 'tm',
      scopeIds: [...scoped],
      query: String(query ?? ''),
      sourceLang: src,
      targetLang: tgt,
      total: filtered.length,
      languages,
      ...paging,
      entries: filtered.slice(paging.offset, paging.offset + paging.pageSize).map((entry) => ({
        id: entry.id,
        tmId: entry.tmId || DEFAULT_TM_ID,
        source: entry.source,
        target: entry.target,
        note: entry.note || '',
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        context: entry.context ?? null,
        contextHash: entry.contextHash ?? null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    }
  }
,
  listGlossaryEntries({ glossaryIds, query, page, pageSize, sourceLang } = {}) {
    const scoped = wantedIds('glossary', glossaryIds, this)
    const src = sourceLang ? canonicalLanguage(sourceLang) : ''

    const inScope = this.glossary.filter((entry) =>
      scoped.has(entry.glossaryId || DEFAULT_GLOSSARY_ID),
    )
    const languages = languageFacet(inScope)
    const filtered = inScope
      .filter((entry) => !src || entry.sourceLang === src)
      .filter((entry) => matchesQuery(entry, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const paging = pageOf(page, pageSize, filtered.length)
    return {
      kind: 'glossary',
      scopeIds: [...scoped],
      query: String(query ?? ''),
      sourceLang: src,
      total: filtered.length,
      languages,
      ...paging,
      entries: filtered.slice(paging.offset, paging.offset + paging.pageSize).map((entry) => ({
        id: entry.id,
        glossaryId: entry.glossaryId || DEFAULT_GLOSSARY_ID,
        source: entry.source,
        target: entry.target,
        note: entry.note || '',
        sourceLang: entry.sourceLang,
        caseSensitive: Boolean(entry.caseSensitive),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    }
  }
,
  exportTM({ tmId, format = 'tmx' } = {}) {
    const libraryId = this.requireTmLibrary(tmId)
    const cleanFormat = String(format ?? 'tmx').trim().toLowerCase()
    if (!EXPORT_FORMATS.tm.includes(cleanFormat)) {
      throw new CatError('INVALID_EXPORT_FORMAT', `记忆库不支持导出为 ${cleanFormat || '(empty)'}。`)
    }
    const library = this.tmLibraries.find((item) => item.tmId === libraryId)
    const entries = this.tm
      .filter((entry) => (entry.tmId || DEFAULT_TM_ID) === libraryId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const sourceLang = entries[0]?.sourceLang || this.settings.sourceLang
    const targetLang = entries[0]?.targetLang || this.settings.targetLang
    return {
      filename: `cait-tm-${fileStem(library?.name, libraryId)}-${dateStamp()}.${cleanFormat}`,
      mime: 'application/xml; charset=utf-8',
      format: cleanFormat,
      count: entries.length,
      content: buildTmxForEntries(entries, { sourceLang, targetLang }),
    }
  }
,
  exportGlossary({ glossaryId, format = 'tbx' } = {}) {
    const libraryId = this.requireGlossaryLibrary(glossaryId)
    const cleanFormat = String(format ?? 'tbx').trim().toLowerCase()
    if (!EXPORT_FORMATS.glossary.includes(cleanFormat)) {
      throw new CatError('INVALID_EXPORT_FORMAT', `术语库不支持导出为 ${cleanFormat || '(empty)'}。`)
    }
    const library = this.glossaryLibraries.find((item) => item.glossaryId === libraryId)
    const entries = this.glossary
      .filter((entry) => (entry.glossaryId || DEFAULT_GLOSSARY_ID) === libraryId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const sourceLang = entries[0]?.sourceLang || this.settings.sourceLang
    const targetLang = this.settings.targetLang
    const content = cleanFormat === 'csv'
      ? glossaryToCsv(entries)
      : cleanFormat === 'json'
        ? glossaryToJson(entries)
        : glossaryToTbx(entries, { sourceLang, targetLang })
    const mime = cleanFormat === 'csv'
      ? 'text/csv; charset=utf-8'
      : cleanFormat === 'json'
        ? 'application/json; charset=utf-8'
        : 'application/xml; charset=utf-8'
    return {
      filename: `cait-glossary-${fileStem(library?.name, libraryId)}-${dateStamp()}.${cleanFormat}`,
      mime,
      format: cleanFormat,
      count: entries.length,
      content,
    }
  },
}
