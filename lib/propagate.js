import { normalizeText } from './similarity.js'
import { normalizeSegmentState } from './store-utils.js'

/**
 * Segments that repeat the same source text inside one document. The map is
 * rebuilt on demand: documents are small (MAX_SEGMENTS 20000) and keeping an
 * index in every document would have to be migrated forever.
 */
function sourceGroups(doc) {
  const groups = new Map()
  doc.segments.forEach((segment, index) => {
    const key = normalizeText(segment.source)
    if (!key) return
    const bucket = groups.get(key)
    if (bucket) bucket.push(index)
    else groups.set(key, [index])
  })
  return groups
}

function groupOf(doc, index) {
  const key = normalizeText(doc.segments[index]?.source)
  if (!key) return []
  return sourceGroups(doc).get(key) ?? []
}

/**
 * The text a repetition should copy: a confirmed segment wins, then a human
 * edit, then anything with text at all.
 */
function referenceOf(doc, indices) {
  let fallback = null
  for (const index of indices) {
    const segment = doc.segments[index]
    if (!segment?.target) continue
    if (segment.status === 'confirmed') return { index, segment }
    if (segment.origin === 'manual') return { index, segment }
    if (!fallback) fallback = { index, segment }
  }
  return fallback
}

export const propagateMethods = {
  sourceGroups(doc) {
    return sourceGroups(doc)
  },

  /**
   * Fill unconfirmed repetitions of `index`'s source with its target. Called
   * right after a confirmation, so one decision settles every duplicate.
   */
  propagateFromSegment(doc, index) {
    const group = groupOf(doc, index)
    if (group.length < 2) return 0
    const reference = referenceOf(doc, group.filter((item) => item !== index)) || {
      index,
      segment: doc.segments[index],
    }
    const source = reference.segment?.target
    if (!source) return 0
    let filled = 0
    for (const item of group) {
      if (item === index) continue
      const segment = doc.segments[item]
      if (segment.status === 'confirmed') continue
      if (segment.target === source) continue
      segment.target = source
      segment.origin = 'auto'
      segment.updatedAt = nowIso(reference.segment.updatedAt)
      normalizeSegmentState(segment)
      filled += 1
    }
    if (filled) doc.updatedAt = doc.segments[index].updatedAt
    return filled
  },

  /**
   * A human rewrote one copy: siblings that nobody has confirmed yet follow,
   * otherwise the document would keep a pile of stale duplicates. Confirmed
   * siblings are never touched.
   */
  propagateEdit(doc, index) {
    const segment = doc.segments[index]
    if (!segment?.target || segment.status === 'confirmed') return 0
    const group = groupOf(doc, index)
    if (group.length < 2) return 0
    let filled = 0
    for (const item of group) {
      if (item === index) continue
      const sibling = doc.segments[item]
      if (sibling.status === 'confirmed') continue
      if (sibling.target === segment.target) continue
      sibling.target = segment.target
      sibling.origin = 'auto'
      sibling.updatedAt = segment.updatedAt
      normalizeSegmentState(sibling)
      filled += 1
    }
    return filled
  },

  propagateDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const groups = sourceGroups(doc)
    let filled = 0
    for (const indices of groups.values()) {
      if (indices.length < 2) continue
      const reference = referenceOf(doc, indices)
      if (!reference?.segment?.target) continue
      for (const index of indices) {
        if (index === reference.index) continue
        const segment = doc.segments[index]
        if (segment.status === 'confirmed') continue
        if (segment.target === reference.segment.target) continue
        segment.target = reference.segment.target
        segment.origin = 'auto'
        segment.updatedAt = reference.segment.updatedAt
        normalizeSegmentState(segment)
        filled += 1
      }
    }
    if (filled) {
      doc.updatedAt = new Date().toISOString()
      this.touch()
      this.persist()
    }
    return { filled, groups: groups.size, progress: this.progress(doc) }
  },
}

function nowIso(value) {
  return typeof value === 'string' && value ? value : new Date().toISOString()
}
