import { CatError } from './errors.js'
import { splitIntoSegments } from './segmenter.js'
import { cleanFormatMeta, cleanSegmentMeta } from './restore.js'
import { cleanLang } from './lang.js'
import { cleanName, cleanText, documentFingerprint, now, makeId } from './text-utils.js'
import { MAX_IMPORT_CHARS, MAX_SEGMENTS } from './limits.js'
import { normalizeSegmentState } from './segment-state.js'
import { normalizeBrief } from './brief.js'
import { preprocessSegments } from './preprocess.js'

/**
 * documents: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const documentMethods = {
  createDocument(input = {}) {
    const sourceLang = cleanLang(
      input.sourceLang || this.settings.sourceLang,
      this.settings.sourceLang,
    )
    const targetLang = cleanLang(
      input.targetLang || this.settings.targetLang,
      this.settings.targetLang,
    )
    let rawSegments

    if (Array.isArray(input.segments) && input.segments.length) {
      rawSegments = input.segments.map((segment) =>
        typeof segment === 'string' ? { source: segment } : segment,
      )
    } else {
      const text = String(input.text ?? '')
      if (!text.trim()) throw new CatError('EMPTY_SOURCE', '源文本为空，无法创建文档。')
      if (text.length > MAX_IMPORT_CHARS) {
        throw new CatError('SOURCE_TOO_LARGE', `源文本超过 ${MAX_IMPORT_CHARS} 字符上限`)
      }
      rawSegments = splitIntoSegments(text)
    }

    if (!rawSegments.length) throw new CatError('EMPTY_SOURCE', '没有可翻译的句段。')
    rawSegments = preprocessSegments(rawSegments, this.settings.preprocess)
    if (rawSegments.length > MAX_SEGMENTS) {
      throw new CatError('TOO_MANY_SEGMENTS', `句段数量超过 ${MAX_SEGMENTS} 上限`)
    }

    const createdAt = now()
    const paragraphMap = Array.isArray(input.paragraphMap) ? input.paragraphMap : null
    const paragraphMetaMap =
      input.paragraphMeta && typeof input.paragraphMeta === 'object' ? input.paragraphMeta : null
    const segments = rawSegments.map((raw, index) => {
      const source = cleanText(raw.source, '原文')
      const target = cleanText(raw.target, '译文')
      if (!source) throw new CatError('EMPTY_SEGMENT', `第 ${index + 1} 句原文为空`)
      const paragraph =
        paragraphMap && Number.isInteger(paragraphMap[raw.paragraph])
          ? paragraphMap[raw.paragraph]
          : Number.isInteger(raw.paragraph)
            ? raw.paragraph
            : index
      const inheritedMeta = paragraphMetaMap?.[paragraph]
      const meta = cleanSegmentMeta({
        ...(raw.meta && typeof raw.meta === 'object' ? raw.meta : {}),
        ...(inheritedMeta && typeof inheritedMeta === 'object' ? inheritedMeta : {}),
      })
      const segment = {
        id: `s${index + 1}`,
        uid: makeId('u'),
        source,
        target,
        status: target ? 'confirmed' : 'pending',
        origin: target ? 'manual' : null,
        suggestion: '',
        paragraph,
        notes: [],
        locked: false,
        ...(meta ? { meta } : {}),
        confirmedAt: target ? createdAt : null,
        updatedAt: createdAt,
      }
      return normalizeSegmentState(segment)
    })

    const format = typeof input.format === 'string' ? input.format.slice(0, 24) : ''
    const formatMeta = cleanFormatMeta(input.formatMeta)
    const fingerprint = documentFingerprint(sourceLang, targetLang, segments, format)
    const existing = [...this.docs.values()].find((item) => item.fingerprint === fingerprint)
    if (existing) {
      if (input.docxSource) this.attachDocxSource(existing, input.docxSource, input.docxName)
      if (input.pptxSource) this.attachPptxSource(existing, input.pptxSource, input.pptxName)
      if (input.xlsxSource) this.attachXlsxSource(existing, input.xlsxSource, input.xlsxName)
      if (input.epubSource) this.attachEpubSource(existing, input.epubSource, input.epubName)
      if (input.format) existing.format = String(input.format).slice(0, 24)
      if (formatMeta)
        existing.formatMeta = cleanFormatMeta({ ...(existing.formatMeta || {}), ...formatMeta })
      this.activeDocId = existing.id
      if (!this.openDocIds.includes(existing.id)) this.openDocIds.push(existing.id)
      this.settings.sourceLang = sourceLang
      this.settings.targetLang = targetLang
      this.touch()
      this.persist()
      return { document: this.documentSummary(existing), reused: true }
    }

    const doc = {
      id: makeId('doc'),
      name: cleanName(input.name, String(input.name || '').trim() || '未命名文档'),
      sourceLang,
      targetLang,
      segments,
      cursor: segments.findIndex((segment) => segment.status === 'pending'),
      createdAt,
      updatedAt: createdAt,
      fingerprint,
      format,
      ...(formatMeta ? { formatMeta } : {}),
      ...(normalizeBrief(input.brief) ? { brief: normalizeBrief(input.brief) } : {}),
      tmIds: Object.prototype.hasOwnProperty.call(input, 'tmIds')
        ? this.normalizeResourceIds('tm', input.tmIds)
        : null,
      glossaryIds: Object.prototype.hasOwnProperty.call(input, 'glossaryIds')
        ? this.normalizeResourceIds('glossary', input.glossaryIds)
        : null,
      defaultWriteTmId: null,
    }
    if (Object.prototype.hasOwnProperty.call(input, 'defaultWriteTmId') && input.defaultWriteTmId) {
      const requested = this.requireTmLibrary(input.defaultWriteTmId)
      if (!this.effectiveTmIds(doc).includes(requested)) {
        throw new CatError(
          'TM_NOT_BOUND',
          `翻译记忆库未绑定到当前文档: ${requested}，不能设为默认写入库。`,
          409,
        )
      }
      doc.defaultWriteTmId = requested
    }
    if (doc.cursor < 0) doc.cursor = 0
    if (input.docxSource) this.attachDocxSource(doc, input.docxSource, input.docxName)
    if (input.pptxSource) this.attachPptxSource(doc, input.pptxSource, input.pptxName)
    if (input.xlsxSource) this.attachXlsxSource(doc, input.xlsxSource, input.xlsxName)
    if (input.epubSource) this.attachEpubSource(doc, input.epubSource, input.epubName)

    this.docs.set(doc.id, doc)
    this.activeDocId = doc.id
    if (!this.openDocIds.includes(doc.id)) this.openDocIds.push(doc.id)
    this.settings.sourceLang = sourceLang
    this.settings.targetLang = targetLang

    const seedTmId = this.effectiveTmIds(doc).length ? this.documentWriteTmId(doc) : null
    for (const segment of segments) {
      if (segment.target && seedTmId) {
        this.upsertTM(segment.source, segment.target, sourceLang, targetLang, seedTmId)
      }
    }
    this.touch()
    this.persist()

    return { document: this.documentSummary(doc) }
  },

  deleteDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const tabIndex = this.openDocIds.indexOf(doc.id)
    this.removeDocxSource(doc)
    this.removePptxSource(doc)
    this.removeXlsxSource(doc)
    this.removeEpubSource(doc)
    this.docs.delete(doc.id)
    this.openDocIds = this.openDocIds.filter((id) => id !== doc.id)
    if (this.activeDocId === doc.id) {
      const nextId = this.openDocIds[Math.min(tabIndex, this.openDocIds.length - 1)]
      this.activeDocId = nextId && this.docs.has(nextId) ? nextId : null
    }
    this.touch()
    this.persist()
    return { deleted: doc.id }
  },

  openDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    this.activeDocId = doc.id
    if (!this.openDocIds.includes(doc.id)) this.openDocIds.push(doc.id)
    this.settings.sourceLang = doc.sourceLang
    this.settings.targetLang = doc.targetLang
    this.touch()
    this.persist()
    return { document: this.documentSummary(doc) }
  },

  closeDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const tabIndex = this.openDocIds.indexOf(doc.id)
    this.openDocIds = this.openDocIds.filter((id) => id !== doc.id)
    if (this.activeDocId === doc.id) {
      const nextId = this.openDocIds[Math.min(tabIndex, this.openDocIds.length - 1)]
      this.activeDocId = nextId && this.docs.has(nextId) ? nextId : null
    }
    this.touch()
    this.persist()
    return { closed: doc.id }
  },
}
