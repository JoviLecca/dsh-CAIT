import { CatError } from './errors.js'
import { DEFAULT_TM_ID, MAX_SEGMENTS, canonicalLanguage, cleanLang, clamp, clampInt, makeId, now } from './store-utils.js'
import { classifyMatchType, normalizeSource, normalizeText, similarity } from './similarity.js'

export const tmMethods = {
  mountedTmCount() {
    const mounted = new Set(this.mounts.tmIds)
    return this.tm.filter((entry) => mounted.has(entry.tmId || DEFAULT_TM_ID)).length
  }
,
  upsertTM(source, target, sourceLang, targetLang, tmId) {
    const cleanSource = normalizeSource(source)
    const cleanTarget = String(target ?? '').trim()
    if (!cleanSource || !cleanTarget) {
      throw new CatError('EMPTY_TM_ENTRY', '记忆库条目不能为空。')
    }
    const libraryId = this.requireTmLibrary(tmId)
    const key = normalizeText(cleanSource)
    const existing = this.tm.find(
      (entry) =>
        (entry.tmId || DEFAULT_TM_ID) === libraryId &&
        entry.key === key &&
        entry.sourceLang === sourceLang &&
        entry.targetLang === targetLang,
    )
    if (existing) {
      existing.source = cleanSource
      existing.target = cleanTarget
      existing.updatedAt = now()
      return { entry: existing, created: false }
    }
    const entry = {
      id: makeId('tm'),
      tmId: libraryId,
      key,
      source: cleanSource,
      target: cleanTarget,
      sourceLang,
      targetLang,
      createdAt: now(),
      updatedAt: now(),
    }
    this.tm.push(entry)
    return { entry, created: true }
  }
,
  lookupTM({ query, threshold, limit, sourceLang, targetLang } = {}) {
    const text = normalizeText(query)
    const defaultThreshold = this.settings.fuzzyThreshold
    const scoreFloor = clamp(Number(threshold ?? defaultThreshold), 0, 1)
    const max = clampInt(limit ?? this.settings.tmLimit, 1, 30, 5)
    const src = canonicalLanguage(sourceLang || this.settings.sourceLang)
    const tgt = canonicalLanguage(targetLang || this.settings.targetLang)

    if (!text) return { query: String(query ?? ''), matches: [] }

    const mountedTm = new Set(this.mounts.tmIds)
    const matches = this.tm
      .filter(
        (entry) =>
          mountedTm.has(entry.tmId || DEFAULT_TM_ID) &&
          entry.sourceLang === src &&
          entry.targetLang === tgt,
      )
      .map((entry) => {
        const exact = entry.key === text
        const score = exact ? 1 : similarity(text, entry.key)
        return { entry, exact, score }
      })
      .filter((item) => item.score >= scoreFloor)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(0, max)
      .map(({ entry, exact, score }) => ({
        id: entry.id,
        tmId: entry.tmId || DEFAULT_TM_ID,
        source: entry.source,
        target: entry.target,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        score,
        percent: Math.round(score * 100),
        exact,
        matchType: classifyMatchType({ exact, score, query: text, source: entry.key }),
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
