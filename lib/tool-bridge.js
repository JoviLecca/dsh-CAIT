/**
 * toolBridge: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const toolBridgeMethods = {
  getSegmentForTool({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const detail = this.segmentDetail(doc, doc.cursor)
    const progress = this.progress(doc)
    return {
      document: {
        id: doc.id,
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        total: progress.total,
        cursor: doc.cursor,
      },
      segment: {
        id: detail.id,
        index: detail.index,
        source: detail.source,
        target: detail.target,
        status: detail.status,
      },
      progress,
      tmMatches: detail.tmMatches,
      glossaryHits: detail.glossaryHits,
      done: progress.pending === 0,
    }
  },

  submitTranslationForTool({ documentId, index, target, addToTm = true, targetTmId } = {}) {
    const result = this.confirmSegment({ documentId, index, target, addToTm, targetTmId })
    const doc = this.requireDocument(documentId)
    return {
      document: {
        id: doc.id,
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        total: doc.segments.length,
        cursor: doc.cursor,
      },
      confirmed: {
        index: result.confirmed.index,
        source: result.confirmed.source,
        target: result.confirmed.target,
        status: result.confirmed.status,
      },
      next: result.next
        ? {
            index: result.next.index,
            source: result.next.source,
            target: result.next.target,
            status: result.next.status,
          }
        : null,
      progress: result.progress,
      done: result.done,
      tm: {
        ...result.tm,
        count: result.tm?.count ?? this.mountedTmCount(),
        total: this.tm.length,
      },
    }
  },
}
