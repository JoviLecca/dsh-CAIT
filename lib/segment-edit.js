import { CatError } from './errors.js'
import { makeId, normalizeSegmentState, now } from './store-utils.js'

// Merging and splitting rewrite the segment list. Office formats carry a source
// package whose paragraph/cell mapping cannot be rebuilt from segment text, so
// the first version only offers this for plain text documents. Other formats
// stay import/export only until their mapping layer grows a segment identity.
const TEXT_EDIT_FORMATS = new Set(['txt', 'md', 'markdown'])

function editError(code, message) {
  return new CatError(code, message, 400)
}

function editableDocument(store, documentId) {
  const doc = store.requireDocument(documentId)
  if (!TEXT_EDIT_FORMATS.has(String(doc.format || 'txt').toLowerCase())) {
    throw editError(
      'SEGMENT_EDIT_FORMAT_UNSUPPORTED',
      '当前格式不支持合并或拆分句段；请先在 TXT / Markdown 文档中操作。',
    )
  }
  return doc
}

function renumber(segments) {
  segments.forEach((segment, index) => {
    segment.id = `s${index + 1}`
  })
}

function snapshotDoc(doc) {
  return {
    segments: doc.segments.map((segment) => ({
      ...segment,
      notes: Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : [],
      meta: segment.meta ? { ...segment.meta } : segment.meta,
    })),
    cursor: doc.cursor,
    updatedAt: doc.updatedAt,
    revision: doc.revision,
  }
}

function restoreDoc(doc, snapshot) {
  doc.segments = snapshot.segments
  doc.cursor = snapshot.cursor
  doc.updatedAt = snapshot.updatedAt
  doc.revision = snapshot.revision
}

function targetStatus(target) {
  return String(target || '').trim() ? 'translated' : 'pending'
}

export const segmentEditMethods = {
  mergeSegments({ documentId, index, count = 2 } = {}) {
    const doc = editableDocument(this, documentId)
    const start = Number(index)
    const size = Number(count)
    if (!Number.isInteger(start) || start < 0 || start >= doc.segments.length - 1) {
      throw editError('MERGE_RANGE_INVALID', '合并范围无效：至少需要当前句段和下一句段。')
    }
    if (!Number.isInteger(size) || size < 2 || start + size > doc.segments.length) {
      throw editError('MERGE_RANGE_INVALID', '合并范围无效：句段数量不足。')
    }
    const group = doc.segments.slice(start, start + size)
    if (group.some((segment) => segment.locked)) {
      throw editError('SEGMENT_LOCKED', '锁定的句段不能合并。')
    }
    const paragraph = group[0].paragraph
    if (group.some((segment) => segment.paragraph !== paragraph)) {
      throw editError('MERGE_PARAGRAPH_MISMATCH', '不能跨段落合并句段。')
    }

    const before = snapshotDoc(doc)
    try {
      const target = group
        .map((segment) => String(segment.target || '').trim())
        .filter(Boolean)
        .join(' ')
      const firstOrigin = group.find((segment) => segment.origin)?.origin || (target ? 'mt' : null)
      const origin = target
        ? group.some((segment) => segment.origin === 'manual')
          ? 'manual'
          : firstOrigin
        : null
      const source = group.map((segment) => String(segment.source || '').trim()).join(' ')
      const notes = group.flatMap((segment) =>
        Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : [],
      )
      const merged = {
        ...group[0],
        id: group[0].id,
        uid: makeId('u'),
        source,
        target,
        status: targetStatus(target),
        origin,
        suggestion: '',
        suggestionReason: '',
        notes,
        locked: false,
        confirmedAt: null,
        updatedAt: now(),
        meta: {
          ...(group[0].meta || {}),
          mergedFrom: group.map((segment) => segment.uid).filter(Boolean),
        },
      }
      normalizeSegmentState(merged)
      doc.segments.splice(start, size, merged)
      renumber(doc.segments)
      doc.cursor = start
      this.touch()
      this.persist()
      return {
        index: start,
        segment: this.segmentView(merged, start),
        mergedFrom: merged.meta.mergedFrom,
      }
    } catch (error) {
      restoreDoc(doc, before)
      throw error
    }
  },

  splitSegment({ documentId, index, at } = {}) {
    const doc = editableDocument(this, documentId)
    const position = Number(index)
    if (!Number.isInteger(position) || position < 0 || position >= doc.segments.length) {
      throw editError('SPLIT_RANGE_INVALID', '拆分位置无效。')
    }
    const segment = doc.segments[position]
    if (segment.locked) throw editError('SEGMENT_LOCKED', '锁定的句段不能拆分。')
    const source = String(segment.source || '')
    const offset = Number(at)
    if (!Number.isInteger(offset) || offset <= 0 || offset >= source.length) {
      throw editError('SPLIT_RANGE_INVALID', '拆分位置必须落在源文中间。')
    }
    const leftSource = source.slice(0, offset).trim()
    const rightSource = source.slice(offset).trim()
    if (!leftSource || !rightSource) {
      throw editError('SPLIT_RANGE_INVALID', '拆分后两侧都必须有内容。')
    }

    const target = String(segment.target || '')
    let targetOffset = 0
    if (target) {
      targetOffset = Math.round(target.length * (offset / source.length))
      targetOffset = Math.max(0, Math.min(target.length, targetOffset))
    }
    const leftTarget = target.slice(0, targetOffset).trim()
    const rightTarget = target.slice(targetOffset).trim()
    const notes = Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : []
    const parentUid = segment.uid
    const makePart = (partSource, partTarget, withNotes) => {
      const part = {
        ...segment,
        id: '',
        uid: makeId('u'),
        source: partSource,
        target: partTarget,
        status: targetStatus(partTarget),
        origin: partTarget ? 'manual' : null,
        suggestion: '',
        suggestionReason: '',
        notes: withNotes ? notes : [],
        locked: false,
        confirmedAt: null,
        updatedAt: now(),
        meta: {
          ...(segment.meta || {}),
          splitFrom: parentUid,
        },
      }
      normalizeSegmentState(part)
      return part
    }

    const before = snapshotDoc(doc)
    try {
      const left = makePart(leftSource, leftTarget, true)
      const right = makePart(rightSource, rightTarget, false)
      doc.segments.splice(position, 1, left, right)
      renumber(doc.segments)
      doc.cursor = position
      this.touch()
      this.persist()
      return {
        index: position,
        segments: [this.segmentView(left, position), this.segmentView(right, position + 1)],
        splitFrom: parentUid,
      }
    } catch (error) {
      restoreDoc(doc, before)
      throw error
    }
  },
}
