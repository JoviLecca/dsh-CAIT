import { CatError } from './errors.js'
import { cleanText, escapeRegExp, normalizeSegmentState, now } from './store-utils.js'

const FIELDS = ['source', 'target']
const MAX_PREVIEW_MATCHES = 200

function requireScope(scope) {
  const value = String(scope || 'target')
  if (!['source', 'target', 'both'].includes(value)) {
    throw new CatError('INVALID_REPLACE_SCOPE', '替换范围必须是 source、target 或 both。')
  }
  return value
}

function buildPattern(query, regex, matchCase) {
  const text = String(query ?? '')
  if (!text) throw new CatError('EMPTY_REPLACE_QUERY', '查找内容不能为空。')
  try {
    return new RegExp(regex ? text : escapeRegExp(text), matchCase ? 'g' : 'gi')
  } catch (error) {
    throw new CatError('INVALID_REGEX', `正则表达式无效：${error.message}`)
  }
}

function countMatches(text, pattern) {
  // matchAll is the only way to count zero-width matches safely; String.match
  // with /g returns an empty array for a zero-width regex.
  let count = 0
  for (const _ of text.matchAll(pattern)) count += 1
  return count
}

function snippet(text, limit = 140) {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

function replaceField(segment, field, pattern, replacement) {
  const before = String(segment[field] ?? '')
  const count = countMatches(before, pattern)
  if (!count) return { field, count: 0, before, after: before }
  const after = before.replace(pattern, replacement)
  return { field, count, before, after }
}

/**
 * Find/replace is deliberately a document operation, not a global TM edit:
 * replacing text never writes or deletes memory entries. Source edits change
 * only the segment source; target edits invalidate a confirmation the same way
 * a manual draft edit does.
 */
export const replaceMethods = {
  replaceInDocument({
    documentId,
    query,
    replacement = '',
    scope = 'target',
    matchCase = false,
    regex = false,
    apply = false,
  } = {}) {
    const doc = this.requireDocument(documentId)
    const fields = requireScope(scope) === 'both' ? FIELDS : [requireScope(scope)]
    const pattern = buildPattern(query, regex, matchCase)
    const value = String(replacement ?? '')
    const matches = []
    const changes = []
    let total = 0
    const matchedIndexes = new Set()

    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      // A locked segment is a review boundary: preview and apply both skip it.
      if (segment.locked) continue
      const fieldsForSegment = []
      for (const field of fields) {
        const result = replaceField(segment, field, pattern, value)
        if (!result.count) continue
        total += result.count
        matchedIndexes.add(index)
        fieldsForSegment.push(result)
        if (matches.length < MAX_PREVIEW_MATCHES) {
          matches.push({
            index,
            uid: segment.uid,
            field,
            count: result.count,
            before: snippet(result.before),
            after: snippet(result.after),
          })
        }
      }
      if (fieldsForSegment.some((item) => item.after !== item.before)) {
        changes.push({ index, segment, fields: fieldsForSegment })
      }
    }

    if (!apply) {
      return {
        documentId: doc.id,
        documentName: doc.name,
        query: String(query ?? ''),
        replacement: value,
        scope,
        matchCase: Boolean(matchCase),
        regex: Boolean(regex),
        total,
        changed: changes.length,
        matchedSegments: matchedIndexes.size,
        truncated: matches.length >= MAX_PREVIEW_MATCHES && total > matches.length,
        matches,
        requiresConfirmation: true,
      }
    }

    if (!changes.length) {
      return { documentId: doc.id, documentName: doc.name, total, applied: 0, changed: 0, undo: [] }
    }

    const stamp = now()
    const undo = changes.map(({ index, segment }) => ({
      index,
      uid: segment.uid,
      source: segment.source,
      target: segment.target,
      origin: segment.origin ?? null,
      confirmedAt: segment.confirmedAt ?? null,
      updatedAt: segment.updatedAt,
    }))
    const snapshot = {
      cursor: doc.cursor,
      updatedAt: doc.updatedAt,
      revision: this.revision,
    }
    let applied = 0

    try {
      for (const { segment, fields: segmentFields } of changes) {
        for (const item of segmentFields) {
          if (item.after === item.before) continue
          segment[item.field] =
            item.field === 'target' ? cleanText(item.after, '译文') : cleanText(item.after, '原文')
          applied += item.count
        }
        if (segmentFields.some((item) => item.field === 'target' && item.after !== item.before)) {
          segment.confirmedAt = null
          if (segment.target) segment.origin = 'manual'
        }
        segment.updatedAt = stamp
        normalizeSegmentState(segment)
      }
      doc.updatedAt = stamp
      this.touch()
      this.persist()
    } catch (error) {
      for (const item of undo) {
        const segment = doc.segments[item.index]
        if (!segment) continue
        segment.source = item.source
        segment.target = item.target
        segment.origin = item.origin
        segment.confirmedAt = item.confirmedAt
        segment.updatedAt = item.updatedAt
        normalizeSegmentState(segment)
      }
      doc.cursor = snapshot.cursor
      doc.updatedAt = snapshot.updatedAt
      this.revision = snapshot.revision
      throw error
    }

    return {
      documentId: doc.id,
      documentName: doc.name,
      total,
      applied,
      changed: changes.length,
      undo,
    }
  },

  undoReplace({ documentId, undo } = {}) {
    const doc = this.requireDocument(documentId)
    const list = Array.isArray(undo) ? undo : []
    if (!list.length) throw new CatError('EMPTY_REPLACE_UNDO', '没有可撤销的替换。')
    const snapshot = {
      cursor: doc.cursor,
      updatedAt: doc.updatedAt,
      revision: this.revision,
      segments: list.map((item) => {
        const segment = this.findSegment(doc, item.index)
        if (item.uid && segment.uid !== item.uid) {
          throw new CatError('REPLACE_UNDO_MISMATCH', '文档已变化，无法按原记录撤销替换。')
        }
        return {
          segment,
          current: {
            source: segment.source,
            target: segment.target,
            origin: segment.origin ?? null,
            confirmedAt: segment.confirmedAt ?? null,
            updatedAt: segment.updatedAt,
          },
          restore: {
            source: item.source,
            target: item.target,
            origin: item.origin ?? null,
            confirmedAt: item.confirmedAt ?? null,
          },
        }
      }),
    }
    const stamp = now()
    try {
      for (const item of snapshot.segments) {
        item.segment.source = String(item.restore.source ?? '')
        item.segment.target = String(item.restore.target ?? '')
        item.segment.origin = item.restore.origin
        item.segment.confirmedAt = item.restore.confirmedAt
        item.segment.updatedAt = stamp
        normalizeSegmentState(item.segment)
      }
      doc.updatedAt = stamp
      this.touch()
      this.persist()
    } catch (error) {
      for (const item of snapshot.segments) {
        item.segment.source = item.current.source
        item.segment.target = item.current.target
        item.segment.origin = item.current.origin
        item.segment.confirmedAt = item.current.confirmedAt
        item.segment.updatedAt = item.current.updatedAt
        normalizeSegmentState(item.segment)
      }
      doc.cursor = snapshot.cursor
      doc.updatedAt = snapshot.updatedAt
      this.revision = snapshot.revision
      throw error
    }
    return { documentId: doc.id, documentName: doc.name, restored: list.length }
  },
}
