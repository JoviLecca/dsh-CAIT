import { CatError } from './errors.js'
import { DEFAULT_TM_ID } from './store-utils.js'

function entryKey(entry) {
  return [
    entry.key || entry.source,
    entry.sourceLang,
    entry.targetLang,
    entry.contextHash ?? '',
  ].join('\u0000')
}

function publicEntry(entry) {
  return {
    id: entry.id,
    tmId: entry.tmId || DEFAULT_TM_ID,
    source: entry.source,
    target: entry.target,
    sourceLang: entry.sourceLang,
    targetLang: entry.targetLang,
    context: entry.context ?? null,
    updatedAt: entry.updatedAt,
  }
}

export const tmMaintenanceMethods = {
  tmMaintenancePreview({ action, sourceTmId, targetTmId, tmId, sourceLang, targetLang, sourceContains, emptyTarget } = {}) {
    if (action === 'merge') {
      const source = this.requireTmLibrary(sourceTmId)
      const target = this.requireTmLibrary(targetTmId)
      if (source === target) throw new CatError('SAME_TM_LIBRARY', '不能把记忆库合并到它自己。')
      const entries = this.tm.filter((entry) => (entry.tmId || DEFAULT_TM_ID) === source)
      let duplicates = 0
      for (const entry of entries) {
        const exists = this.tm.some(
          (candidate) =>
            candidate !== entry &&
            (candidate.tmId || DEFAULT_TM_ID) === target &&
            entryKey(candidate) === entryKey(entry),
        )
        if (exists) duplicates += 1
      }
      return {
        action,
        sourceTmId: source,
        targetTmId: target,
        total: entries.length,
        moved: entries.length - duplicates,
        duplicates,
        backup: entries.map(publicEntry),
      }
    }
    if (action === 'dedupe') {
      const library = this.requireTmLibrary(tmId)
      const groups = new Map()
      for (const entry of this.tm) {
        if ((entry.tmId || DEFAULT_TM_ID) !== library) continue
        const key = entryKey(entry)
        const list = groups.get(key) || []
        list.push(entry)
        groups.set(key, list)
      }
      const duplicateEntries = []
      for (const list of groups.values()) {
        if (list.length < 2) continue
        list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        duplicateEntries.push(...list.slice(1))
      }
      return {
        action,
        tmId: library,
        total: this.tm.filter((entry) => (entry.tmId || DEFAULT_TM_ID) === library).length,
        duplicates: duplicateEntries.length,
        backup: duplicateEntries.map(publicEntry),
      }
    }
    if (action === 'prune') {
      const library = this.requireTmLibrary(tmId)
      const contains = String(sourceContains ?? '').trim().toLowerCase()
      const entries = this.tm.filter((entry) => {
        if ((entry.tmId || DEFAULT_TM_ID) !== library) return false
        if (sourceLang && entry.sourceLang !== sourceLang) return false
        if (targetLang && entry.targetLang !== targetLang) return false
        if (contains && !entry.source.toLowerCase().includes(contains)) return false
        if (emptyTarget === true && String(entry.target ?? '').trim()) return false
        return true
      })
      return {
        action,
        tmId: library,
        total: this.tm.filter((entry) => (entry.tmId || DEFAULT_TM_ID) === library).length,
        matched: entries.length,
        backup: entries.map(publicEntry),
      }
    }
    throw new CatError('INVALID_TM_MAINTENANCE', '未知的记忆库维护操作。')
  },

  mergeTmLibraries({ sourceTmId, targetTmId, deleteSource = false, confirm = false } = {}) {
    const preview = this.tmMaintenancePreview({ action: 'merge', sourceTmId, targetTmId })
    if (confirm !== true) return { ...preview, requiresConfirmation: true }
    const source = preview.sourceTmId
    const target = preview.targetTmId
    let moved = 0
    let merged = 0
    for (const entry of this.tm.filter((item) => (item.tmId || DEFAULT_TM_ID) === source)) {
      const existing = this.tm.find(
        (candidate) =>
          candidate !== entry &&
          (candidate.tmId || DEFAULT_TM_ID) === target &&
          entryKey(candidate) === entryKey(entry),
      )
      if (existing) {
        if (!String(existing.target ?? '').trim() && String(entry.target ?? '').trim()) {
          existing.target = entry.target
          existing.updatedAt = new Date().toISOString()
        }
        merged += 1
      } else {
        entry.tmId = target
        moved += 1
      }
    }
    this.tm = this.tm.filter((entry) => (entry.tmId || DEFAULT_TM_ID) !== source)
    if (deleteSource) this.deleteLibrary({ kind: 'tm', id: source })
    this.touch()
    this.persist()
    return { ...preview, moved, merged, deletedSource: Boolean(deleteSource) }
  },

  dedupeTmLibrary({ tmId, confirm = false } = {}) {
    const preview = this.tmMaintenancePreview({ action: 'dedupe', tmId })
    if (confirm !== true) return { ...preview, requiresConfirmation: true }
    const doomed = new Set(preview.backup.map((entry) => entry.id))
    this.tm = this.tm.filter((entry) => !doomed.has(entry.id))
    this.touch()
    this.persist()
    return { ...preview, removed: doomed.size }
  },

  pruneTmLibrary({ tmId, sourceLang, targetLang, sourceContains, emptyTarget, confirm = false } = {}) {
    const preview = this.tmMaintenancePreview({
      action: 'prune',
      tmId,
      sourceLang,
      targetLang,
      sourceContains,
      emptyTarget,
    })
    if (confirm !== true) return { ...preview, requiresConfirmation: true }
    const doomed = new Set(preview.backup.map((entry) => entry.id))
    this.tm = this.tm.filter((entry) => !doomed.has(entry.id))
    this.touch()
    this.persist()
    return { ...preview, removed: doomed.size }
  },
}
