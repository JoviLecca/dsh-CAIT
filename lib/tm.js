import { CatError } from './errors.js'
import { DEFAULT_TM_ID, MAX_SEGMENTS } from './limits.js'
import { canonicalLanguage, cleanLang } from './lang.js'
import { clamp, clampInt } from './similarity.js'
import { makeId, now } from './text-utils.js'
import {
  classifyMatchType,
  normalizeSource,
  normalizeText,
  prepare,
  scoreCeiling,
  scorePrepared,
  textStats,
} from './similarity.js'
import { contextHashOf, contextOf, normalizeContext } from './context.js'

/** Upper bound of context variants kept per (library, language pair, key). */
export const MAX_CONTEXT_VARIANTS = 8

/**
 * Scores are rounded to four decimals, so a candidate can only be dropped when
 * its ceiling is below the floor by more than that rounding step.
 */
const SCORE_EPSILON = 0.0001

export const tmMethods = {
  /**
   * Upper bound of the score `entry` can reach against `prepared`, cached on the
   * entry object. Counts only change when `updatedAt` does, so a stored key is
   * measured once per edit instead of once per lookup.
   */
  tmScoreCeiling(prepared, entry) {
    this.tmStats ||= new WeakMap()
    let stats = this.tmStats.get(entry)
    if (!stats || stats.stamp !== entry.updatedAt) {
      stats = { ...textStats(entry.key), stamp: entry.updatedAt }
      this.tmStats.set(entry, stats)
    }
    // `textStats` normalises defensively; a key that does not survive that
    // unchanged would make the counts lie, so such an entry is never skipped.
    if (stats.normalized !== entry.key) return 1
    return scoreCeiling(prepared, stats)
  },

  mountedTmCount() {
    const mounted = new Set(this.mounts.tmIds)
    return this.tm.filter((entry) => mounted.has(entry.tmId || DEFAULT_TM_ID)).length
  },
  /**
   * Identity of a TM row: two rows are the same row when every part matches,
   * which is exactly what `upsertTM` used to test with a linear `find()`.
   */
  tmIdentity(tmId, key, sourceLang, targetLang, contextHash) {
    return [tmId, sourceLang, targetLang, contextHash ?? '', key].join('\u0000')
  },
  upsertTM(source, target, sourceLang, targetLang, tmId, context = null) {
    return this.writeTMEntry({ source, target, sourceLang, targetLang, tmId, context })
  },
  /**
   * The one place that creates or updates a TM row.
   *
   * `index` (identity → entry) lets a bulk import skip the linear scan; the
   * caller that passes one owns keeping it in sync with `this.tm`, which only
   * `importTM` does. `skipEviction` defers the context-variant cap to a single
   * pass at the end of that import instead of scanning the memory per row.
   *
   * The result carries `before` (the previous field values) and `evictedAll`,
   * which is what lets `confirmSegment` undo just this write instead of copying
   * the whole memory.
   */
  writeTMEntry(
    { source, target, sourceLang, targetLang, tmId, context = null },
    { index = null, skipEviction = false } = {},
  ) {
    const cleanSource = normalizeSource(source)
    const cleanTarget = String(target ?? '').trim()
    if (!cleanSource || !cleanTarget) {
      throw new CatError('EMPTY_TM_ENTRY', '记忆库条目不能为空。')
    }
    const libraryId = this.requireTmLibrary(tmId)
    const key = normalizeText(cleanSource)
    const normalizedContext = normalizeContext(context)
    const contextHash = contextHashOf(normalizedContext)
    const identity = index
      ? this.tmIdentity(libraryId, key, sourceLang, targetLang, contextHash)
      : ''
    const existing = index
      ? (index.get(identity) ?? null)
      : this.tm.find(
          (entry) =>
            (entry.tmId || DEFAULT_TM_ID) === libraryId &&
            entry.key === key &&
            entry.sourceLang === sourceLang &&
            entry.targetLang === targetLang &&
            (entry.contextHash ?? null) === contextHash,
        )
    if (existing) {
      const before = {
        source: existing.source,
        target: existing.target,
        context: existing.context ?? null,
        contextHash: existing.contextHash ?? null,
        updatedAt: existing.updatedAt,
      }
      existing.source = cleanSource
      existing.target = cleanTarget
      existing.context = normalizedContext
      existing.contextHash = contextHash
      existing.updatedAt = now()
      return { entry: existing, created: false, evicted: null, evictedAll: [], before }
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
    if (index) index.set(identity, entry)
    const evictedAll =
      contextHash && !skipEviction
        ? this.evictContextVariants(libraryId, key, sourceLang, targetLang)
        : []
    return { entry, created: true, evicted: evictedAll[0] ?? null, evictedAll, before: null }
  },
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
    if (variants.length <= MAX_CONTEXT_VARIANTS) return []
    variants.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    const doomed = variants.slice(0, variants.length - MAX_CONTEXT_VARIANTS)
    const ids = new Set(doomed.map((entry) => entry.id))
    this.tm = this.tm.filter((entry) => !ids.has(entry.id))
    return doomed
  },
  /**
   * Bulk form of `evictContextVariants`: one grouping pass over the memory
   * instead of one scan per inserted row, which is what keeps `importTM` from
   * degrading to quadratic when the import carries context.
   */
  evictAllContextVariants() {
    const groups = new Map()
    for (const entry of this.tm) {
      if (!entry.contextHash) continue
      const groupKey = [
        entry.tmId || DEFAULT_TM_ID,
        entry.sourceLang,
        entry.targetLang,
        entry.key,
      ].join('\u0000')
      const variants = groups.get(groupKey)
      if (variants) variants.push(entry)
      else groups.set(groupKey, [entry])
    }
    const doomed = []
    for (const variants of groups.values()) {
      if (variants.length <= MAX_CONTEXT_VARIANTS) continue
      variants.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      doomed.push(...variants.slice(0, variants.length - MAX_CONTEXT_VARIANTS))
    }
    if (!doomed.length) return []
    const ids = new Set(doomed.map((entry) => entry.id))
    this.tm = this.tm.filter((entry) => !ids.has(entry.id))
    return doomed
  },
  /**
   * Undo one `writeTMEntry` call, using the record that call returned. This is
   * how `confirmSegment` rolls back a failed save without keeping a copy of the
   * whole memory.
   */
  undoTMWrite(result) {
    if (!result) return
    if (result.created) {
      this.tm = this.tm.filter((entry) => entry.id !== result.entry.id)
    } else if (result.before) {
      Object.assign(result.entry, result.before)
    }
    if (result.evictedAll?.length) this.tm.push(...result.evictedAll)
  },
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
    if (note !== undefined)
      entry.note = String(note ?? '')
        .trim()
        .slice(0, 500)
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
  },
  deleteTM({ id } = {}) {
    const entryId = String(id ?? '').trim()
    const index = this.tm.findIndex((item) => item.id === entryId)
    if (index < 0) throw new CatError('TM_ENTRY_NOT_FOUND', '记忆库条目不存在。', 404)
    const [removed] = this.tm.splice(index, 1)
    this.touch()
    this.persist()
    return { removed: removed.id, total: this.tm.length }
  },
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
    const mountedTm = new Set(scopedDoc ? this.effectiveTmIds(scopedDoc) : this.mounts.tmIds)
    // The query half of the score is built once; the per-entry half is only
    // rebuilt for entries whose counts say they could still pass the floor.
    const prepared = prepare(text)
    const matchable = []
    for (const entry of this.tm) {
      if (!mountedTm.has(entry.tmId || DEFAULT_TM_ID)) continue
      if (entry.sourceLang !== src || entry.targetLang !== tgt) continue
      if (entry.key === text) {
        matchable.push({
          entry,
          exact: true,
          ice: Boolean(queryHash && entry.contextHash === queryHash),
        })
        continue
      }
      if (this.tmScoreCeiling(prepared, entry) + SCORE_EPSILON < scoreFloor) continue
      matchable.push({ entry, exact: false, ice: false })
    }
    const matches = matchable
      .map((item) => ({
        ...item,
        score: item.exact ? 1 : scorePrepared(prepared, item.entry.key),
      }))
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
        matchType: ice
          ? 'context'
          : classifyMatchType({ exact, score, query: text, source: entry.key }),
        updatedAt: entry.updatedAt,
      }))

    return { query: String(query ?? ''), matches }
  },
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
  },
  importTM({ pairs, sourceLang, targetLang, tmId } = {}) {
    if (!Array.isArray(pairs)) throw new CatError('INVALID_TM_IMPORT', '记忆库导入数据格式不正确。')
    if (pairs.length > MAX_SEGMENTS)
      throw new CatError('TOO_MANY_TM', `一次最多导入 ${MAX_SEGMENTS} 条记忆。`)

    const src = cleanLang(sourceLang || this.settings.sourceLang, this.settings.sourceLang)
    const tgt = cleanLang(targetLang || this.settings.targetLang, this.settings.targetLang)
    const libraryId = this.requireTmLibrary(tmId)
    let added = 0
    let updated = 0
    let carriesContext = false

    // One identity index for the whole import: `writeTMEntry` finds the row to
    // update by hash lookup instead of scanning the memory per pair.
    const index = new Map()
    for (const entry of this.tm) {
      index.set(
        this.tmIdentity(
          entry.tmId || DEFAULT_TM_ID,
          entry.key,
          entry.sourceLang,
          entry.targetLang,
          entry.contextHash,
        ),
        entry,
      )
    }

    for (const pair of pairs) {
      if (!pair || !String(pair.source ?? '').trim() || !String(pair.target ?? '').trim()) continue
      const result = this.writeTMEntry(
        {
          source: pair.source,
          target: pair.target,
          sourceLang: pair.sourceLang || src,
          targetLang: pair.targetLang || tgt,
          tmId: libraryId,
          context: pair.context ?? null,
        },
        { index, skipEviction: true },
      )
      if (result.created) added += 1
      else updated += 1
      if (result.entry.contextHash) carriesContext = true
    }

    if (carriesContext) this.evictAllContextVariants()
    if (added || updated) this.touch()
    this.persist()
    return { added, updated, total: this.tm.length }
  },
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
  },
}
