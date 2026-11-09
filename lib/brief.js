import { CatError } from './errors.js'
import { canonicalLanguage, cleanText, clampInt, normalizeSegmentState, now } from './store-utils.js'

/**
 * A document brief is deliberately small: the facts a translator would ask
 * before starting. Project-level metadata (client, deadline, billing) belongs
 * to the project layer in 1.1.5, not to every document.
 */
export const BRIEF_FIELDS = ['domain', 'audience', 'tone', 'notes', 'doNotTranslate', 'styleSample']

const BRIEF_LIMITS = {
  domain: 120,
  audience: 200,
  tone: 200,
  notes: 2000,
  doNotTranslate: 2000,
  styleSample: 4000,
}

const BRIEF_LABELS = {
  domain: 'Domain',
  audience: 'Audience',
  tone: 'Tone',
  notes: 'Notes',
  doNotTranslate: 'Do not translate',
  styleSample: 'Style sample',
}

export function cleanBriefValue(field, value) {
  const limit = BRIEF_LIMITS[field]
  if (!limit) return ''
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, limit)
}

/** Keep only known, non-empty fields. Used for new and restored documents. */
export function normalizeBrief(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const brief = {}
  for (const field of BRIEF_FIELDS) {
    const text = cleanBriefValue(field, value[field])
    if (text) brief[field] = text
  }
  if (!Object.keys(brief).length) return null
  if (typeof value.updatedAt === 'string' && value.updatedAt) brief.updatedAt = value.updatedAt
  return brief
}

function clip(text, max) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** The prompt block shared by single-segment MT and batch MT. */
export function briefPromptBlock(brief) {
  if (!brief) return ''
  const rows = []
  for (const field of BRIEF_FIELDS) {
    if (!brief[field]) continue
    rows.push(`- ${BRIEF_LABELS[field]}: ${clip(brief[field], field === 'styleSample' ? 800 : 400)}`)
  }
  return rows.length ? `Document brief:\n${rows.join('\n')}\n` : ''
}

/** Bounded neighbours for prompts and the context tool. */
export function neighborContext(doc, index, { before = 2, after = 2 } = {}) {
  const total = doc.segments.length
  const safeIndex = clampInt(index, 0, total - 1, 0)
  const beforeCount = clampInt(before, 0, 5, 2)
  const afterCount = clampInt(after, 0, 5, 2)
  const start = Math.max(0, safeIndex - beforeCount)
  const end = Math.min(total, safeIndex + afterCount + 1)
  const view = (segment, at) => ({
    index: at,
    source: segment.source,
    target: segment.target || '',
    status: segment.status,
  })
  return {
    before: doc.segments.slice(start, safeIndex).map((segment, offset) => view(segment, start + offset)),
    after: doc.segments.slice(safeIndex + 1, end).map((segment, offset) => view(segment, safeIndex + 1 + offset)),
  }
}

export function contextPromptBlock(doc, index) {
  const { before, after } = neighborContext(doc, index)
  if (!before.length && !after.length) return ''
  const lines = ['Surrounding segments (for context only, do not translate them):']
  for (const item of before) lines.push(`[previous] ${clip(item.source, 500)}`)
  for (const item of after) lines.push(`[next] ${clip(item.source, 500)}`)
  return `${lines.join('\n')}\n`
}

export const briefMethods = {
  getBrief({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    return {
      documentId: doc.id,
      brief: doc.brief ? { ...doc.brief } : null,
    }
  },

  /**
   * Merge a patch into the document brief. Empty strings clear a field; an
   * explicit null or `clear: true` removes the whole brief. A failed strict
   * persist rolls the previous brief back.
   */
  setBrief({ documentId, brief, clear = false } = {}) {
    const doc = this.requireDocument(documentId)
    const previous = doc.brief
    const previousUpdatedAt = doc.updatedAt
    if (clear === true || brief === null) {
      delete doc.brief
    } else {
      if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
        throw new CatError('INVALID_BRIEF', 'brief 必须是对象。')
      }
      const next = { ...(doc.brief || {}) }
      for (const field of BRIEF_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(brief, field)) continue
        const text = cleanBriefValue(field, brief[field])
        if (text) next[field] = text
        else delete next[field]
      }
      delete next.updatedAt
      if (Object.keys(next).length) {
        next.updatedAt = now()
        doc.brief = next
      } else {
        delete doc.brief
      }
    }
    doc.updatedAt = now()
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      if (previous === undefined) delete doc.brief
      else doc.brief = previous
      doc.updatedAt = previousUpdatedAt
      throw error
    }
    return { documentId: doc.id, brief: doc.brief ? { ...doc.brief } : null }
  },

  /**
   * Everything an agent needs before translating or reviewing one segment:
   * the brief, the segment, and a bounded window of its neighbours.
   */
  contextForTool({ documentId, index, before = 2, after = 2 } = {}) {
    const doc = this.requireDocument(documentId)
    const at = index === undefined || index === null ? doc.cursor : index
    if (!Number.isInteger(at)) throw new CatError('SEGMENT_OUT_OF_RANGE', `句段索引不是整数: ${at}`)
    const segment = this.findSegment(doc, at)
    const window = neighborContext(doc, at, { before, after })
    const paragraphCount =
      doc.segments.reduce(
        (max, item) => Math.max(max, Number.isInteger(item.paragraph) ? item.paragraph : 0),
        0,
      ) + 1
    return {
      document: {
        id: doc.id,
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        total: doc.segments.length,
        cursor: doc.cursor,
      },
      paragraph: {
        index: Number.isInteger(segment.paragraph) ? segment.paragraph : 0,
        count: paragraphCount,
        // Paragraph headings are ordinary segments in CAIT; showing the
        // document name is the one stable title every format provides.
        title: doc.name,
      },
      brief: doc.brief ? { ...doc.brief } : null,
      segment: {
        index: at,
        uid: segment.uid,
        id: segment.id,
        source: segment.source,
        target: segment.target || '',
        status: segment.status,
        origin: segment.origin,
        paragraph: segment.paragraph,
      },
      before: window.before,
      after: window.after,
    }
  },

  /** Substring search over every mounted TM entry, not just the active pair. */
  concordance({ query, sourceLang, targetLang, limit = 20, documentId } = {}) {
    const text = String(query ?? '').trim()
    if (!text) throw new CatError('EMPTY_QUERY', '请输入要检索的词或短语。')
    if (text.length > 200) throw new CatError('QUERY_TOO_LONG', '检索词最多 200 个字符。')
    const doc = documentId ? this.requireDocument(documentId) : null
    const src = sourceLang ? canonicalLanguage(sourceLang) : doc?.sourceLang || ''
    const tgt = targetLang ? canonicalLanguage(targetLang) : doc?.targetLang || ''
    const mounted = new Set(this.mounts.tmIds)
    const needle = text.toLowerCase()
    const max = clampInt(limit, 1, 50, 20)
    const matches = []
    for (const entry of this.tm) {
      if (!mounted.has(entry.tmId)) continue
      if (src && entry.sourceLang !== src) continue
      if (tgt && entry.targetLang !== tgt) continue
      if (!entry.source.toLowerCase().includes(needle) && !entry.target.toLowerCase().includes(needle)) {
        continue
      }
      matches.push(entry)
    }
    matches.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    const libraries = new Map(this.tmLibraries.map((library) => [library.tmId, library.name]))
    return {
      query: text,
      total: matches.length,
      entries: matches.slice(0, max).map((entry) => ({
        source: entry.source,
        target: entry.target,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        context: entry.context || null,
        tmId: entry.tmId,
        library: libraries.get(entry.tmId) || entry.tmId,
        updatedAt: entry.updatedAt,
      })),
    }
  },

  /**
   * Revoke a confirmation without touching TM. TM is a reusable asset, and
   * mainstream CAT tools also keep it when a segment is unconfirmed; a later
   * confirmation updates the same entry.
   */
  unconfirmSegment({ documentId, index } = {}) {
    const doc = this.requireDocument(documentId)
    const at = index === undefined || index === null ? doc.cursor : index
    if (!Number.isInteger(at)) throw new CatError('SEGMENT_OUT_OF_RANGE', `句段索引不是整数: ${at}`)
    const segment = this.findSegment(doc, at)
    if (segment.locked) throw new CatError('SEGMENT_LOCKED', '该句段已锁定，请先解锁再撤销确认。')
    // Older stores may carry status=confirmed without a confirmedAt stamp.
    if (segment.status !== 'confirmed' && !segment.confirmedAt) {
      throw new CatError('NOT_CONFIRMED', '该句段还没有确认，不能撤销确认。', 409)
    }
    const previous = {
      confirmedAt: segment.confirmedAt,
      origin: segment.origin,
      status: segment.status,
      updatedAt: segment.updatedAt,
    }
    segment.confirmedAt = null
    if (!segment.origin) segment.origin = 'manual'
    segment.updatedAt = now()
    normalizeSegmentState(segment)
    doc.cursor = at
    doc.updatedAt = now()
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      Object.assign(segment, previous)
      throw error
    }
    return {
      segment: this.segmentView(segment, at),
      progress: this.progress(doc),
      documentId: doc.id,
      index: at,
    }
  },
}
