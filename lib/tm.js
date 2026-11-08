import { CatError } from './errors.js'
import { DEFAULT_TM_ID, MAX_SEGMENTS, canonicalLanguage, cleanLang, clamp, clampInt, makeId, now } from './store-utils.js'
import { classifyMatchType, normalizeSource, normalizeText, similarity } from './similarity.js'
import { contextHashOf, contextOf, normalizeContext } from './context.js'

/** Upper bound of context variants kept per (library, language pair, key). */
export const MAX_CONTEXT_VARIANTS = 8

export const tmMethods = {
  mountedTmCount() {
    const mounted = new Set(this.mounts.tmIds)
    return this.tm.filter((entry) => mounted.has(entry.tmId || DEFAULT_TM_ID)).length
  }
,
  upsertTM(source, target, sourceLang, targetLang, tmId, context = null) {
    const cleanSource = normalizeSource(source)
    const cleanTarget = String(target ?? '').trim()
    if (!cleanSource || !cleanTarget) {
      throw new CatError('EMPTY_TM_ENTRY', '记忆库条目不能为空。')
    }
    const libraryId = this.requireTmLibrary(tmId)
    const key = normalizeText(cleanSource)
    const normalizedContext = normalizeContext(context)
    const contextHash = contextHashOf(normalizedContext)
    const existing = this.tm.find(
      (entry) =>
        (entry.tmId || DEFAULT_TM_ID) === libraryId &&
        entry.key === key &&
        entry.sourceLang === sourceLang &&
        entry.targetLang === targetLang &&
        (entry.contextHash ?? null) === contextHash,
    )
    if (existing) {
      existing.source = cleanSource
      existing.target = cleanTarget
      existing.context = normalizedContext
      existing.contextHash = contextHash
      existing.updatedAt = now()
      return { entry: existing, created: false, evicted: null }
    }
    const entry = {
      id: makeId('tm'),
      tmId: libraryId,
      key,
      source: cleanSource,
      target: cleanTarget,
      sourceLang,
      targetLang,
      context: normalizedContext,
      contextHash,
      createdAt: now(),
      updatedAt: now(),
    }
    this.tm.push(entry)
    const evicted = contextHash
      ? this.evictContextVariants(libraryId, key, sourceLang, targetLang)
      : null
    return { entry, created: true, evicted }
  }
,
  /**
   * Context variants are what make ICE possible, but they are also the only
   * part of the memory that can grow without bound for one ambiguous string.
   * Past the cap the oldest variant is dropped; the generic (no-context) entry
   * is never a candidate for eviction.
   */
  evictContextVariants(tmId, key, sourceLang, targetLang) {
    const variants = this.tm.filter(
      (entry) =>
        (entry.tmId || DEFAULT_TM_ID) === tmId &&
        entry.key === key &&
        entry.sourceLang === sourceLang &&
        entry.targetLang === targetLang &&
        entry.contextHash,
    )
    if (variants.length <= MAX_CONTEXT_VARIANTS) return null
    variants.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    const doomed = variants.slice(0, variants.length - MAX_CONTEXT_VARIANTS)
    const ids = new Set(doomed.map((entry) => entry.id))
    this.tm = this.tm.filter((entry) => !ids.has(entry.id))
    return doomed[0] ?? null
  }
,
  updateTM({ id, source, target, note } = {}) {
    const entry = this.tm.find((item) => item.id === String(id ?? '').trim())
    if (!entry) throw new CatError('TM_ENTRY_NOT_FOUND', '记忆库条目不存在。', 404)
    const cleanSource = source === undefined ? entry.source : normalizeSource(source)
    const cleanTarget = target === undefined ? entry.target : String(target ?? '').trim()
    if (!cleanSource || !cleanTarget) {
      throw new CatError('EMPTY_TM_ENTRY', '记忆库条目不能为空。')
    }
    const key = normalizeText(cleanSource)
    const libraryId = entry.tmId || DEFAULT_TM_ID
    const clash = this.tm.find(
      (item) =>
        item !== entry &&
        (item.tmId || DEFAULT_TM_ID) === libraryId &&
        item.key === key &&
        item.sourceLang === entry.sourceLang &&
        item.targetLang === entry.targetLang &&
        (item.contextHash ?? null) === (entry.contextHash ?? null),
    )
    if (clash) {
      throw new CatError('DUPLICATE_TM_ENTRY', '同一个记忆库里已经有这条原文。', 409)
    }
    entry.source = cleanSource
    entry.target = cleanTarget
    entry.key = key
    if (note !== undefined) entry.note = String(note ?? '').trim().slice(0, 500)
    entry.updatedAt = now()
    this.touch()
    this.persist()
    return {
      entry: {
        id: entry.id,
        tmId: libraryId,
        source: entry.source,
        target: entry.target,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        context: entry.context ?? null,
        contextHash: entry.contextHash ?? null,
        updatedAt: entry.updatedAt,
      },
      total: this.tm.length,
    }
  }
,
  deleteTM({ id } = {}) {
    const entryId = String(id ?? '').trim()
    const index = this.tm.findIndex((item) => item.id === entryId)
    if (index < 0) throw new CatError('TM_ENTRY_NOT_FOUND', '记忆库条目不存在。', 404)
    const [removed] = this.tm.splice(index, 1)
    this.touch()
    this.persist()
    return { removed: removed.id, total: this.tm.length }
  }
,
  lookupTM({ query, threshold, limit, sourceLang, targetLang, context, documentId, index } = {}) {
    const text = normalizeText(query)
    const defaultThreshold = this.settings.fuzzyThreshold
    const scoreFloor = clamp(Number(threshold ?? defaultThreshold), 0, 1)
    const max = clampInt(limit ?? this.settings.tmLimit, 1, 30, 5)
    const src = canonicalLanguage(sourceLang || this.settings.sourceLang)
    const tgt = canonicalLanguage(targetLang || this.settings.targetLang)

    if (!text) return { query: String(query ?? ''), matches: [] }

    // Callers that already know which segment they are on let the server derive
    // the context, so the client never has to ship neighbour text around.
    let resolvedContext = context ?? null
    if (!resolvedContext && documentId !== undefined && index !== undefined) {
      resolvedContext = contextOf(this.requireDocument(documentId), index)
    }
    const queryHash = contextHashOf(resolvedContext)

    const scopedDoc = documentId ? this.requireDocument(documentId) : null
    const mountedTm = new Set(
      scopedDoc ? this.effectiveTmIds(scopedDoc) : this.mounts.tmIds,
    )
    const matches = this.tm
      .filter(
        (entry) =>
          mountedTm.has(entry.tmId || DEFAULT_TM_ID) &&
          entry.sourceLang === src &&
          entry.targetLang === tgt,
      )
      .map((entry) => {
        const exact = entry.key === text
        const ice = Boolean(exact && queryHash && entry.contextHash === queryHash)
        const score = exact ? 1 : similarity(text, entry.key)
        return { entry, exact, ice, score }
      })
      .filter((item) => item.ice || item.score >= scoreFloor)
      .sort(
        (a, b) =>
          Number(b.ice) - Number(a.ice) ||
          Number(b.exact) - Number(a.exact) ||
          b.score - a.score ||
          b.entry.updatedAt.localeCompare(a.entry.updatedAt),
      )
      .slice(0, max)
      .map(({ entry, exact, ice, score }) => ({
        id: entry.id,
        tmId: entry.tmId || DEFAULT_TM_ID,
        source: entry.source,
        target: entry.target,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        context: entry.context ?? null,
        contextHash: entry.contextHash ?? null,
        contextMatch: ice ? 'ice' : null,
        score,
        // ICE is the one grade above 100%: the text and both neighbours match.
        percent: ice ? 101 : Math.round(score * 100),
        exact,
        matchType: ice ? 'context' : classifyMatchType({ exact, score, query: text, source: entry.key }),
        updatedAt: entry.updatedAt,
      }))

    return { query: String(query ?? ''), matches }
  }
,
  addTM({ source, target, sourceLang, targetLang, tmId } = {}) {
    const src = cleanLang(sourceLang || this.settings.sourceLang, this.settings.sourceLang)
    const tgt = cleanLang(targetLang || this.settings.targetLang, this.settings.targetLang)
    const result = this.upsertTM(source, target, src, tgt, tmId)
    this.touch()
    this.persist()
    return {
      entry: {
        id: result.entry.id,
        tmId: result.entry.tmId,
        source: result.entry.source,
        target: result.entry.target,
        sourceLang: result.entry.sourceLang,
        targetLang: result.entry.targetLang,
      },
      created: result.created,
      count: this.tm.length,
    }
  }
,
  importTM({ pairs, sourceLang, targetLang, tmId } = {}) {
    if (!Array.isArray(pairs)) throw new CatError('INVALID_TM_IMPORT', '记忆库导入数据格式不正确。')
    if (pairs.length > MAX_SEGMENTS) throw new CatError('TOO_MANY_TM', `一次最多导入 ${MAX_SEGMENTS} 条记忆。`)

    const src = cleanLang(sourceLang || this.settings.sourceLang, this.settings.sourceLang)
    const tgt = cleanLang(targetLang || this.settings.targetLang, this.settings.targetLang)
    const libraryId = this.requireTmLibrary(tmId)
    let added = 0
    let updated = 0

    for (const pair of pairs) {
      if (!pair || !String(pair.source ?? '').trim() || !String(pair.target ?? '').trim()) continue
      const result = this.upsertTM(
        pair.source,
        pair.target,
        pair.sourceLang || src,
        pair.targetLang || tgt,
        libraryId,
        pair.context ?? null,
      )
      if (result.created) added += 1
      else updated += 1
    }

    if (added || updated) this.touch()
    this.persist()
    return { added, updated, total: this.tm.length }
  }
,
  clearTM({ tmIds, all = false } = {}) {
    let targets
    let scope
    if (all === true) {
      targets = new Set(this.tmLibraries.map((library) => library.tmId))
      scope = 'all'
    } else if (Array.isArray(tmIds) && tmIds.length) {
      targets = new Set(tmIds.map((id) => this.requireMountedTmLibrary(id)))
      scope = 'explicit'
    } else {
      targets = new Set(this.mounts.tmIds)
      scope = 'mounted'
    }

    const before = this.tm.length
    this.tm = this.tm.filter((entry) => !targets.has(entry.tmId || DEFAULT_TM_ID))
    const removed = before - this.tm.length
    this.touch()
    this.persist()
    return { removed, scope, tmIds: [...targets] }
  }

}
