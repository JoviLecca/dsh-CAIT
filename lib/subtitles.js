import { CatError } from './errors.js'
import { makeId, normalizeSegmentState } from './store-utils.js'

const SUBTITLE_FORMATS = new Set(['srt', 'vtt'])

function fail(code, message) {
  return new CatError(code, message)
}

function subtitleDocument(store, documentId) {
  const doc = store.docs?.get(documentId)
  if (!doc) throw fail('DOCUMENT_NOT_FOUND', '文档不存在。')
  if (!SUBTITLE_FORMATS.has(doc.format)) {
    throw fail('SUBTITLE_FORMAT_UNSUPPORTED', '时间轴编辑只支持 SRT/VTT 字幕。')
  }
  return doc
}

function requireUnlocked(segment) {
  if (segment.locked) throw fail('SEGMENT_LOCKED', '句段已锁定，先解锁再编辑。')
}

function timingOf(segment) {
  const start = Number(segment.meta?.start)
  const end = Number(segment.meta?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw fail('SUBTITLE_TIMING_INVALID', `第 ${Number(segment.meta?.index ?? 0) + 1} 条字幕时间码无效。`)
  }
  return { start, end }
}

function splitTextAtRatio(text, ratio) {
  const value = String(text ?? '')
  if (!value.trim()) return ['', '']
  const target = Math.max(0, Math.min(value.length, Math.round(value.length * ratio)))
  let index = value.indexOf(' ', target)
  if (index < 0) index = value.lastIndexOf(' ', target)
  if (index <= 0 || index >= value.length - 1) index = target
  const left = value.slice(0, index).trim()
  const right = value.slice(index).trim()
  if (!left || !right) return null
  return [left, right]
}

function snapshot(doc) {
  return {
    segments: doc.segments.map((segment) => ({
      ...segment,
      meta: segment.meta ? { ...segment.meta } : segment.meta,
      notes: Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : segment.notes,
    })),
    cursor: doc.cursor,
  }
}

function restore(doc, state) {
  doc.segments = state.segments
  doc.cursor = state.cursor
}

export const subtitleMethods = {
  mergeCues({ documentId, index, count = 2 } = {}) {
    const doc = subtitleDocument(this, documentId)
    const startIndex = Number(index)
    const size = Number(count)
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= doc.segments.length) {
      throw fail('MERGE_RANGE_INVALID', '合并起始句段无效。')
    }
    if (!Number.isInteger(size) || size < 2 || startIndex + size > doc.segments.length) {
      throw fail('MERGE_RANGE_INVALID', '合并范围无效。')
    }
    const segments = doc.segments.slice(startIndex, startIndex + size)
    for (const segment of segments) requireUnlocked(segment)
    const first = segments[0]
    const last = segments[segments.length - 1]
    const before = timingOf(first)
    const after = timingOf(last)
    const merged = {
      ...first,
      uid: makeId('u'),
      source: segments.map((segment) => segment.source).join('\n'),
      target: segments.some((segment) => segment.target)
        ? segments.map((segment) => segment.target || '').join('\n').trim()
        : '',
      status: segments.some((segment) => segment.target) ? 'translated' : 'pending',
      origin: segments.some((segment) => segment.origin === 'manual') ? 'manual' : (first.origin || null),
      suggestion: null,
      suggestionReason: null,
      confirmedAt: null,
      updatedAt: new Date().toISOString(),
      meta: {
        ...first.meta,
        start: before.start,
        end: after.end,
        identifier: first.meta?.identifier || '',
        mergedFrom: segments.map((segment) => segment.uid),
      },
    }
    normalizeSegmentState(merged)
    const state = snapshot(doc)
    try {
      doc.segments.splice(startIndex, size, merged)
      doc.segments.forEach((segment, at) => {
        segment.id = `s${at + 1}`
      })
      doc.cursor = startIndex
      this.touch()
      this.persist()
    } catch (error) {
      restore(doc, state)
      throw error
    }
    return { documentId, index: startIndex, count: size, segment: this.segmentView(merged, startIndex) }
  },

  splitCue({ documentId, index, at } = {}) {
    const doc = subtitleDocument(this, documentId)
    const position = Number(index)
    const splitAt = Number(at)
    if (!Number.isInteger(position) || position < 0 || position >= doc.segments.length) {
      throw fail('SPLIT_RANGE_INVALID', '拆分句段无效。')
    }
    const segment = doc.segments[position]
    requireUnlocked(segment)
    const { start, end } = timingOf(segment)
    if (!Number.isFinite(splitAt) || splitAt <= start || splitAt >= end) {
      throw fail('SPLIT_RANGE_INVALID', '拆分钟点必须落在该条字幕的时间范围内。')
    }
    const ratio = (splitAt - start) / (end - start)
    const source = splitTextAtRatio(segment.source, ratio)
    if (!source) throw fail('SPLIT_RANGE_INVALID', '源文字幕太短，无法在此时点拆分。')
    const target = segment.target ? splitTextAtRatio(segment.target, ratio) : null
    if (segment.target && !target) throw fail('SPLIT_RANGE_INVALID', '译文字幕太短，无法在此时点拆分。')
    const state = snapshot(doc)
    const left = {
      ...segment,
      uid: makeId('u'),
      source: source[0],
      target: target?.[0] || '',
      status: target?.[0] ? 'translated' : 'pending',
      origin: target?.[0] ? 'manual' : null,
      suggestion: null,
      suggestionReason: null,
      confirmedAt: null,
      updatedAt: new Date().toISOString(),
      meta: { ...segment.meta, end: splitAt, splitFrom: segment.uid },
    }
    const right = {
      ...segment,
      uid: makeId('u'),
      source: source[1],
      target: target?.[1] || '',
      status: target?.[1] ? 'translated' : 'pending',
      origin: target?.[1] ? 'manual' : null,
      suggestion: null,
      suggestionReason: null,
      confirmedAt: null,
      updatedAt: new Date().toISOString(),
      meta: {
        ...segment.meta,
        start: splitAt,
        identifier: segment.meta?.identifier ? `${segment.meta.identifier}-2` : '',
        splitFrom: segment.uid,
      },
    }
    normalizeSegmentState(left)
    normalizeSegmentState(right)
    try {
      doc.segments.splice(position, 1, left, right)
      doc.segments.forEach((item, atIndex) => {
        item.id = `s${atIndex + 1}`
      })
      doc.cursor = position
      this.touch()
      this.persist()
    } catch (error) {
      restore(doc, state)
      throw error
    }
    return {
      documentId,
      index: position,
      segments: [this.segmentView(left, position), this.segmentView(right, position + 1)],
    }
  },

  shiftSubtitles({ documentId, offsetMs } = {}) {
    const doc = subtitleDocument(this, documentId)
    const offset = Number(offsetMs)
    if (!Number.isFinite(offset) || !Number.isInteger(offset)) {
      throw fail('SUBTITLE_SHIFT_INVALID', '平移毫秒数必须是整数。')
    }
    if (!offset) return { documentId, offsetMs: 0, shifted: 0 }
    const state = snapshot(doc)
    try {
      for (const segment of doc.segments) {
        requireUnlocked(segment)
        const { start, end } = timingOf(segment)
        if (start + offset < 0) {
          throw fail('SUBTITLE_SHIFT_INVALID', '平移后出现负时间码，请减小平移量。')
        }
        segment.meta = { ...segment.meta, start: start + offset, end: end + offset }
        segment.updatedAt = new Date().toISOString()
      }
      this.touch()
      this.persist()
    } catch (error) {
      restore(doc, state)
      throw error
    }
    return { documentId, offsetMs: offset, shifted: doc.segments.length }
  },
}
