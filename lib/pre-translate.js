import { CatError } from './errors.js'
import { DEFAULT_TM_ID, MT_BATCH_MAX } from './limits.js'
import { clampInt } from './similarity.js'
import { normalizeSegmentState } from './segment-state.js'
import { now } from './text-utils.js'
import { normalizeText } from './similarity.js'
import { contextHashOf, contextOf } from './context.js'

export const PRETRANSLATE_BLOCK_MAX = 32
export const PRETRANSLATE_DEFAULT_COUNT = 8

export const preTranslateMethods = {
  /**
   * Exact TM lookup by key, for pre-filling a block without scoring every entry.
   * Mounted libraries only, matching the document's language pair. Each key gets
   * one generic entry (no context) plus its context variants, so a segment can
   * be resolved as ICE first and as a plain 100% match second.
   */
  tmExactIndex(doc) {
    const mounted = new Set(this.effectiveTmIds(doc))
    const index = new Map()
    for (const entry of this.tm) {
      if (!mounted.has(entry.tmId || DEFAULT_TM_ID)) continue
      if (entry.sourceLang !== doc.sourceLang || entry.targetLang !== doc.targetLang) continue
      if (!entry.key) continue
      let slot = index.get(entry.key)
      if (!slot) {
        slot = { generic: null, byContext: new Map(), latest: null }
        index.set(entry.key, slot)
      }
      if (!slot.latest || entry.updatedAt > slot.latest.updatedAt) slot.latest = entry
      if (!entry.contextHash) {
        if (!slot.generic) slot.generic = entry
      } else if (!slot.byContext.has(entry.contextHash)) {
        slot.byContext.set(entry.contextHash, entry)
      }
    }
    return index
  },
  /**
   * Resolve one segment against the exact index: context match first, then the
   * generic entry, then any variant of the same text. A text match with a
   * different context is still worth 100%, so it must not be dropped.
   */
  tmEntryForSegment(index, doc, segmentIndex, segment) {
    const slot = index.get(normalizeText(segment.source))
    if (!slot) return { entry: null, ice: false }
    const hash = contextHashOf(contextOf(doc, segmentIndex))
    if (hash) {
      const ice = slot.byContext.get(hash)
      if (ice) return { entry: ice, ice: true }
    }
    return { entry: slot.generic ?? slot.latest, ice: false }
  },
  /**
   * Pre-translate one block of segments: TM exact matches first, then machine
   * translation. Never overwrites a segment that already has a target, so
   * human work and earlier passes survive. Returns the next block offset so the
   * client can drive progress and cancellation by looping.
   */
  async preTranslate({
    documentId,
    from = 0,
    count = PRETRANSLATE_DEFAULT_COUNT,
    mode = 'mt',
    overwrite = false,
  } = {}) {
    const doc = this.requireDocument(documentId)
    const total = doc.segments.length
    if (!total) throw new CatError('NO_SEGMENTS', '当前文档没有句段。', 409)

    const translationMode = String(mode ?? 'mt').trim() || 'mt'
    if (!['mt', 'tm'].includes(translationMode)) {
      throw new CatError('INVALID_PRETRANSLATE_MODE', '预翻译模式必须是 mt 或 tm。')
    }

    const start = clampInt(from, 0, Math.max(0, total - 1), 0)
    const size = clampInt(count, 1, PRETRANSLATE_BLOCK_MAX, PRETRANSLATE_DEFAULT_COUNT)
    const end = Math.min(total, start + size)
    const tmIndex = this.tmExactIndex(doc)
    const skipped = []
    const work = []

    for (let index = start; index < end; index += 1) {
      const segment = doc.segments[index]
      if (segment.locked) {
        skipped.push({ index, reason: 'locked' })
        continue
      }
      if (segment.status === 'confirmed') {
        skipped.push({ index, reason: 'confirmed' })
        continue
      }
      if (segment.target && !overwrite) {
        skipped.push({ index, reason: 'translated' })
        continue
      }
      work.push({ index, segment })
    }

    const failed = []
    const filled = []
    const mtWork = []

    const apply = (segment, text, origin) => {
      segment.target = text
      // Keep the baseline the machine produced: the review pane shows it in
      // the suggestion column so the human can compare against their edit.
      segment.suggestion = text
      segment.origin = origin
      segment.updatedAt = now()
      normalizeSegmentState(segment)
    }

    // Resolve exact TM matches first. Only the remaining segments go to the
    // provider, and those are sent in one JSON batch so they share the brief
    // and the same terminology decisions.
    for (const item of work) {
      const match = this.tmEntryForSegment(tmIndex, doc, item.index, item.segment)
      if (match.entry && match.entry.target.trim()) {
        const text = match.entry.target
        apply(item.segment, text, 'tm')
        filled.push({
          index: item.index,
          status: item.segment.status,
          origin: 'tm',
          ice: match.ice,
        })
      } else if (translationMode === 'tm') {
        filled.push({ index: item.index, reason: 'no-tm-match' })
      } else {
        mtWork.push({ ...item, match })
      }
    }

    for (let offset = 0; offset < mtWork.length; offset += MT_BATCH_MAX) {
      const chunk = mtWork.slice(offset, offset + MT_BATCH_MAX)
      let batch = new Map()
      try {
        const result = await this.mtSuggestBatch({
          documentId: doc.id,
          items: chunk.map(({ index, segment }) => ({ index, text: segment.source })),
        })
        batch = new Map((result?.items ?? []).map((item) => [item.index, item.text]))
      } catch (error) {
        // A malformed or failed batch must not lose the whole block: retry the
        // affected segments one by one below.
        this.logger?.warn?.(
          `CAIT: pre-translate batch failed document=${doc.id} block=${offset}: ${
            error?.code || 'UNKNOWN'
          } ${error?.message || error}`,
        )
      }

      for (const { index, segment } of chunk) {
        const batched = String(batch.get(index) ?? '').trim()
        if (batched) {
          apply(segment, batched, 'mt')
          filled.push({ index, status: segment.status, origin: 'mt', ice: false })
          continue
        }
        try {
          const result = await this.mtSuggest({
            text: segment.source,
            documentId: doc.id,
            index,
            sourceLang: doc.sourceLang,
            targetLang: doc.targetLang,
          })
          const text = String(result?.text ?? '').trim()
          if (!text) throw new CatError('MT_EMPTY', '机器翻译没有返回译文。', 502)
          apply(segment, text, 'mt')
          filled.push({ index, status: segment.status, origin: 'mt', ice: false })
        } catch (error) {
          failed.push({
            index,
            code: error?.code || 'PRETRANSLATE_FAILED',
            message: error?.message || String(error),
          })
        }
      }
    }

    const segments = filled.filter(Boolean)
    const unchanged = segments.filter((item) => item.reason)
    if (segments.length || unchanged.length) {
      this.touch()
      this.persist()
    }

    return {
      documentId: doc.id,
      from: start,
      to: end,
      count: end - start,
      mode: translationMode,
      filled: segments.filter((item) => !item.reason).length,
      noMatch: unchanged.map((item) => item.index),
      skipped,
      failed,
      progress: this.progress(doc),
      next: end < total ? end : null,
      segments: segments
        .filter((item) => !item.reason)
        .map((item) => ({
          index: item.index,
          status: item.status,
          origin: item.origin,
          ice: Boolean(item.ice),
        })),
    }
  },
  /** Segment listing for agents: bounded, status-filterable, cursor-free. */
  segmentsForTool({ documentId, from = 0, count = 20, status } = {}) {
    const doc = this.requireDocument(documentId)
    const total = doc.segments.length
    const start = clampInt(from, 0, Math.max(0, total - 1), 0)
    const size = clampInt(count, 1, 50, 20)
    const wanted = String(status ?? '').trim()
    const rows = []
    for (let index = start; index < total && rows.length < size; index += 1) {
      const segment = doc.segments[index]
      if (wanted && segment.status !== wanted) continue
      rows.push({
        index,
        id: segment.id,
        source: segment.source,
        target: segment.target,
        status: segment.status,
        origin: segment.origin,
        suggestion: segment.suggestion || '',
      })
    }
    return {
      document: {
        id: doc.id,
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        total,
        cursor: doc.cursor,
      },
      from: start,
      segments: rows,
      next: start + size < total ? start + size : null,
      progress: this.progress(doc),
    }
  },
  /**
   * Batch confirm. Segments without a target are reported, not invented; each
   * confirmed pair goes through the normal confirmSegment path so the TM write
   * and the strict persistence rollback keep working per segment.
   */
  confirmSegmentsForTool({ documentId, indices, from = 0, count = 20, status } = {}) {
    const doc = this.requireDocument(documentId)
    const total = doc.segments.length
    let targets
    if (Array.isArray(indices) && indices.length) {
      targets = [...new Set(indices.map((index) => Math.trunc(Number(index))))].filter(
        (index) => Number.isInteger(index) && index >= 0 && index < total,
      )
    } else if (status === 'translated') {
      // "Confirm everything awaiting review" — the bulk action behind the
      // review pane. Bounded so one click cannot confirm an enormous document
      // without the user seeing a count first.
      targets = []
      for (let index = 0; index < total && targets.length < 500; index += 1) {
        if (doc.segments[index].status === 'translated') targets.push(index)
      }
    } else {
      const start = clampInt(from, 0, Math.max(0, total - 1), 0)
      const size = clampInt(count, 1, 50, 20)
      targets = []
      for (let index = start; index < total && targets.length < size; index += 1)
        targets.push(index)
    }

    const confirmed = []
    const skipped = []
    for (const index of targets) {
      const segment = doc.segments[index]
      if (segment.status === 'confirmed') {
        skipped.push({ index, reason: 'confirmed' })
        continue
      }
      if (!segment.target) {
        skipped.push({ index, reason: 'no-target' })
        continue
      }
      this.confirmSegment({ documentId: doc.id, index, target: segment.target })
      confirmed.push(index)
    }

    return {
      documentId: doc.id,
      confirmed,
      skipped,
      progress: this.progress(doc),
      done: this.progress(doc).pending === 0 && this.progress(doc).translated === 0,
    }
  },
}
