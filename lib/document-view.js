import { countWords, DEFAULT_GLOSSARY_ID, DEFAULT_TM_ID } from './store-utils.js'

/**
 * documentView: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const documentViewMethods = {
  progress(doc) {
    const total = doc.segments.length
    const confirmed = doc.segments.filter((segment) => segment.status === 'confirmed').length
    const translated = doc.segments.filter((segment) => segment.status === 'translated').length
    return {
      total,
      confirmed,
      // "translated" means a draft or a proposal exists and only review is left;
      // "pending" is everything with no text at all.
      translated,
      pending: total - confirmed - translated,
      percent: total ? Math.round((confirmed / total) * 100) : 0,
    }
  },

  documentSummary(doc) {
    return {
      id: doc.id,
      name: doc.name,
      sourceLang: doc.sourceLang,
      targetLang: doc.targetLang,
      cursor: doc.cursor,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      progress: this.progress(doc),
      brief: doc.brief ? { ...doc.brief } : null,
      resources: this.documentResourcesView(doc),
    }
  },

  segmentView(segment, index) {
    return {
      id: segment.id,
      uid: segment.uid,
      index,
      source: segment.source,
      target: segment.target,
      status: segment.status,
      origin: segment.origin ?? null,
      suggestion: segment.suggestion ?? '',
      suggestionReason: segment.suggestionReason ?? '',
      paragraph: segment.paragraph,
      notes: (segment.notes || []).map((note) => ({ ...note })),
      locked: Boolean(segment.locked),
      meta: segment.meta ? { ...segment.meta } : null,
      confirmedAt: segment.confirmedAt,
    }
  },

  segmentDetail(doc, index) {
    const segment = this.findSegment(doc, index)
    return {
      ...this.segmentView(segment, index),
      chars: Array.from(segment.source).length,
      words: countWords(segment.source),
      tmMatches: this.lookupTM({
        query: segment.source,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        documentId: doc.id,
        index,
      }).matches,
      glossaryHits: this.findGlossaryHits(segment.source, doc.sourceLang, doc.id),
    }
  },

  documentView(doc) {
    return {
      ...this.documentSummary(doc),
      segments: doc.segments.map((segment, index) => this.segmentView(segment, index)),
      current: this.segmentDetail(doc, doc.cursor),
    }
  },

  bootstrap() {
    const doc = this.activeDocument()
    const mountedTm = new Set(doc ? this.effectiveTmIds(doc) : this.mounts.tmIds)
    const mountedGlossary = new Set(doc ? this.effectiveGlossaryIds(doc) : this.mounts.glossaryIds)
    const mountedTmEntries = this.tm
      .filter((entry) => mountedTm.has(entry.tmId || DEFAULT_TM_ID))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const tmEntries = mountedTmEntries.slice(0, 40).map((entry) => ({
      id: entry.id,
      tmId: entry.tmId || DEFAULT_TM_ID,
      source: entry.source,
      target: entry.target,
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      updatedAt: entry.updatedAt,
    }))
    const glossary = this.glossary.filter((entry) =>
      mountedGlossary.has(entry.glossaryId || DEFAULT_GLOSSARY_ID),
    )

    return {
      revision: this.revision,
      settings: this.publicSettings(),
      storage: {
        enabled: this.persistence.enabled,
        file: this.persistence.file,
        loaded: this.persistence.loaded,
        lastSavedAt: this.persistence.lastSavedAt,
        error: this.persistence.error,
      },
      stats: {
        documents: this.docs.size,
        segments: [...this.docs.values()].reduce((sum, item) => sum + item.segments.length, 0),
        confirmed: [...this.docs.values()].reduce(
          (sum, item) =>
            sum + item.segments.filter((segment) => segment.status === 'confirmed').length,
          0,
        ),
        translated: [...this.docs.values()].reduce(
          (sum, item) =>
            sum + item.segments.filter((segment) => segment.status === 'translated').length,
          0,
        ),
        tm: this.tm.length,
        glossary: this.glossary.length,
      },
      documents: [...this.docs.values()].map((item) => this.documentSummary(item)),
      openDocuments: this.openDocIds
        .map((id) => this.docs.get(id))
        .filter(Boolean)
        .map((item) => this.documentSummary(item)),
      activeDocument: doc ? this.documentView(doc) : null,
      libraries: this.librariesView(),
      mounts: this.mountsView(),
      documentResources: doc ? this.documentResourcesView(doc) : null,
      tm: {
        count: mountedTmEntries.length,
        total: this.tm.length,
        entries: tmEntries,
      },
      glossary: glossary.map((entry) => ({ ...entry })),
    }
  },
}
