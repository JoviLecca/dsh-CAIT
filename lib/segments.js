import { CatError } from './errors.js'
import { cleanText, now } from './text-utils.js'
import { normalizeSegmentState } from './segment-state.js'
import { contextOf } from './context.js'
import { missingInlineTokens } from './formats.js'

/**
 * segments: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const documentSegmentMethods = {
  selectSegment({ documentId, index } = {}) {
    const doc = this.requireDocument(documentId)
    const target = Number(index ?? doc.cursor)
    this.findSegment(doc, target)
    doc.cursor = target
    doc.updatedAt = now()
    this.touch()
    this.schedulePersist()
    return { cursor: doc.cursor, current: this.segmentDetail(doc, doc.cursor) }
  },

  saveDraft({ documentId, index, target } = {}) {
    const doc = this.requireDocument(documentId)
    const segmentIndex = Number(index ?? doc.cursor)
    const segment = this.findSegment(doc, segmentIndex)
    const value = cleanText(target, '译文')
    if (segment.locked && value !== segment.target) {
      throw new CatError('SEGMENT_LOCKED', '该句段已锁定，请先解锁再编辑。')
    }
    if (value !== segment.target) {
      // Editing a confirmed segment invalidates the confirmation: the stored
      // TM entry still holds the old wording until the next confirmation.
      // Dropping confirmedAt here is what keeps "confirmed" from lying.
      segment.confirmedAt = null
      segment.target = value
      segment.updatedAt = now()
      doc.updatedAt = segment.updatedAt
      // Typed by a human. A model proposal stays visible next to it for
      // reference until it is adopted or replaced.
      if (value) segment.origin = 'manual'
      // Duplicates of this source follow the human's wording instead of
      // keeping a stale copy. Confirmed siblings are never touched.
      if (value) this.propagateEdit(doc, segmentIndex)
    }
    normalizeSegmentState(segment)
    this.touch()
    this.schedulePersist()
    return {
      segment: this.segmentView(segment, segmentIndex),
      cursor: doc.cursor,
    }
  },

  clearUnconfirmedTranslations({ documentId, confirm = false } = {}) {
    const doc = this.requireDocument(documentId)
    const origins = ['tm', 'mt', 'auto']
    const eligible = doc.segments
      .map((segment, index) => ({ segment, index }))
      .filter(
        ({ segment }) =>
          segment.target &&
          !segment.confirmedAt &&
          !segment.locked &&
          origins.includes(segment.origin),
      )
    const counts = { total: eligible.length, mt: 0, tm: 0, auto: 0 }
    for (const { segment } of eligible) counts[segment.origin] += 1
    const preview = {
      documentId: doc.id,
      documentName: doc.name,
      origins,
      counts,
      requiresConfirmation: !confirm,
    }
    if (!confirm) return preview
    if (!eligible.length) {
      return { ...preview, requiresConfirmation: false, cleared: 0, cursor: doc.cursor }
    }

    const snapshot = {
      cursor: doc.cursor,
      updatedAt: doc.updatedAt,
      revision: this.revision,
      segments: eligible.map(({ segment }) => ({
        segment,
        target: segment.target,
        suggestion: segment.suggestion,
        suggestionReason: segment.suggestionReason,
        origin: segment.origin,
        confirmedAt: segment.confirmedAt,
        updatedAt: segment.updatedAt,
      })),
    }
    const stamp = now()
    try {
      for (const { segment } of eligible) {
        segment.target = ''
        segment.suggestion = ''
        segment.suggestionReason = ''
        segment.origin = null
        segment.confirmedAt = null
        segment.updatedAt = stamp
        normalizeSegmentState(segment)
      }
      doc.cursor = eligible[0].index
      doc.updatedAt = stamp
      this.touch()
      this.persist()
    } catch (error) {
      doc.cursor = snapshot.cursor
      doc.updatedAt = snapshot.updatedAt
      this.revision = snapshot.revision
      for (const item of snapshot.segments) {
        item.segment.target = item.target
        item.segment.suggestion = item.suggestion
        item.segment.suggestionReason = item.suggestionReason
        item.segment.origin = item.origin
        item.segment.confirmedAt = item.confirmedAt
        item.segment.updatedAt = item.updatedAt
        normalizeSegmentState(item.segment)
      }
      throw error
    }

    return {
      ...preview,
      requiresConfirmation: false,
      cleared: eligible.length,
      cursor: doc.cursor,
      progress: this.progress(doc),
    }
  },

  adoptSuggestion({ documentId, index } = {}) {
    const doc = this.requireDocument(documentId)
    const segmentIndex = Number(index ?? doc.cursor)
    const segment = this.findSegment(doc, segmentIndex)
    if (!segment.suggestion) {
      throw new CatError('NO_SUGGESTION', '当前句段没有可供采纳的建议。')
    }
    if (segment.status === 'confirmed') {
      throw new CatError('ALREADY_CONFIRMED', '已确认的句段不能采纳建议，请先撤销确认。')
    }
    segment.target = segment.suggestion
    segment.updatedAt = now()
    doc.updatedAt = segment.updatedAt
    // Adoption must keep the proposal's provenance (mt/agent/tm), not mark it
    // as human-authored.
    normalizeSegmentState(segment)
    this.touch()
    this.persist()
    return {
      segment: this.segmentView(segment, segmentIndex),
      cursor: doc.cursor,
      progress: this.progress(doc),
    }
  },

  proposeTranslation({ documentId, index, target, reason = '' } = {}) {
    const doc = this.requireDocument(documentId)
    const segmentIndex = Number(index ?? doc.cursor)
    const segment = this.findSegment(doc, segmentIndex)
    if (segment.status === 'confirmed') {
      throw new CatError('ALREADY_CONFIRMED', '已确认的句段不能提建议，请先撤销确认。')
    }
    const text = cleanText(target, '建议译文')
    if (!text) throw new CatError('EMPTY_TARGET', '建议译文为空。')
    const before = {
      revision: this.revision,
      updatedAt: doc.updatedAt,
      segment: {
        origin: segment.origin,
        suggestion: segment.suggestion,
        suggestionReason: segment.suggestionReason,
        updatedAt: segment.updatedAt,
      },
    }
    segment.suggestion = text
    segment.suggestionReason = String(reason ?? '').slice(0, 500)
    // A proposal never touches `target`: the human keeps the decision.
    if (!segment.target) segment.origin = 'agent'
    segment.updatedAt = now()
    doc.updatedAt = segment.updatedAt
    normalizeSegmentState(segment)
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      this.revision = before.revision
      doc.updatedAt = before.updatedAt
      Object.assign(segment, before.segment)
      throw error
    }
    return {
      segment: this.segmentView(segment, segmentIndex),
      progress: this.progress(doc),
    }
  },

  confirmSegment({ documentId, index, target, addToTm = true, targetTmId } = {}) {
    const doc = this.requireDocument(documentId)
    const segmentIndex = Number(index ?? doc.cursor)
    const segment = this.findSegment(doc, segmentIndex)
    if (segment.locked) throw new CatError('SEGMENT_LOCKED', '该句段已锁定，请先解锁再确认。')
    const writeTmId = addToTm ? this.documentWriteTmId(doc, targetTmId) : null
    const before = {
      revision: this.revision,
      cursor: doc.cursor,
      updatedAt: doc.updatedAt,
      segment: {
        target: segment.target,
        status: segment.status,
        origin: segment.origin,
        suggestion: segment.suggestion,
        confirmedAt: segment.confirmedAt,
        updatedAt: segment.updatedAt,
      },
    }

    if (target !== undefined) {
      const value = cleanText(target, '译文')
      // Confirming with the proposal's own text is adoption: keep where it came
      // from. Any other text is authored right here.
      if (value !== segment.target && value !== segment.suggestion) segment.origin = 'manual'
      segment.target = value
    }
    if (!segment.target) {
      throw new CatError('EMPTY_TARGET', '译文为空，无法确认句段。')
    }
    const missingInline = missingInlineTokens(segment.meta?.inline, segment.target)
    if (missingInline.length) {
      throw new CatError(
        'PLACEHOLDER_MISMATCH',
        `译文缺少占位符 ${missingInline.join('、')}，请保留源文中的占位符后再确认。`,
        400,
      )
    }

    segment.confirmedAt = now()
    segment.updatedAt = segment.confirmedAt
    normalizeSegmentState(segment)
    doc.updatedAt = segment.confirmedAt

    const tmResult = addToTm
      ? this.upsertTM(
          segment.source,
          segment.target,
          doc.sourceLang,
          doc.targetLang,
          writeTmId,
          contextOf(doc, segmentIndex),
        )
      : null

    const nextIndex = this.findNextUnconfirmed(doc, segmentIndex)
    doc.cursor = nextIndex
    this.propagateFromSegment(doc, segmentIndex)
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      // The TM row is the only other thing this call changed, so undo exactly
      // that row instead of restoring a copy of the whole memory.
      this.undoTMWrite(tmResult)
      this.revision = before.revision
      doc.cursor = before.cursor
      doc.updatedAt = before.updatedAt
      Object.assign(segment, before.segment)
      throw error
    }

    const progress = this.progress(doc)
    // Translated-but-unreviewed segments still have to be visited, so the
    // remaining count is driven by confirmed only.
    const remaining = progress.total - progress.confirmed
    return {
      confirmed: this.segmentView(segment, segmentIndex),
      next: remaining ? this.segmentDetail(doc, doc.cursor) : null,
      cursor: doc.cursor,
      progress,
      done: remaining === 0,
      tm: tmResult
        ? {
            added: tmResult.created ? 1 : 0,
            updated: tmResult.created ? 0 : 1,
            count: this.mountedTmCount(),
            total: this.tm.length,
            tmId: tmResult.entry.tmId,
          }
        : null,
    }
  },

  findNextUnconfirmed(doc, fromIndex) {
    const total = doc.segments.length
    for (let step = 1; step <= total; step += 1) {
      const index = (fromIndex + step) % total
      if (doc.segments[index].status !== 'confirmed') return index
    }
    return fromIndex
  },

  moveSegment({ documentId, delta = 1 } = {}) {
    const doc = this.requireDocument(documentId)
    const total = doc.segments.length
    const amount = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 1
    doc.cursor = (((doc.cursor + amount) % total) + total) % total
    doc.updatedAt = now()
    this.touch()
    return { cursor: doc.cursor, current: this.segmentDetail(doc, doc.cursor) }
  },
}
