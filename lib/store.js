import { CatError } from './errors.js'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { splitIntoSegments } from './segmenter.js'
import { canonicalLanguage, cleanFormatMeta, cleanLang, cleanName, cleanSegmentMeta, cleanText, clamp, clampInt, countWords, documentFingerprint, DEFAULT_SETTINGS, DEFAULT_GLOSSARY_ID, DEFAULT_GLOSSARY_NAME, DEFAULT_TM_ID, DEFAULT_TM_NAME, escapeRegExp, MAX_IMPORT_CHARS, MAX_SEGMENTS, MAX_SEGMENT_CHARS, normalizeSegmentState, now, makeId, parseGlossaryCsv, restoredDate, restoredLang, restoredText, restoreSettings, safeBaseName, SEGMENT_ORIGINS, STORE_FILENAME, UI_LANG_CODES } from './store-utils.js'
import { libraryMethods } from './libraries.js'
import { tmMethods } from './tm.js'
import { glossaryMethods } from './glossary.js'
import { persistenceMethods } from './persistence.js'
import { importExportMethods } from './import-export.js'
import { preTranslateMethods } from './pre-translate.js'
import { qaMethods } from './qa.js'
import { libraryViewMethods } from './library-view.js'
import { classifyMatchType, normalizeSource, normalizeText, similarity } from './similarity.js'
import { contextOf } from './context.js'
import { MOCK_MODEL, MOCK_PROVIDER, NO_MODEL_MESSAGE, NO_ROUTE_MESSAGE, collectStreamText } from './mt.js'
import { buildTmx } from './tmx.js'
import { missingInlineTokens } from './formats.js'
import { normalizePreprocessOptions, preprocessSegments } from './preprocess.js'

export { CatError } from './errors.js'
export { canonicalLanguage } from './store-utils.js'

export class CatStore {

  constructor({ dataDir = '', logger = console, mtRuntime = null } = {}) {
    this.docs = new Map()
    this.activeDocId = null
    this.openDocIds = []
    this.tm = []
    this.glossary = []
    this.settings = structuredClone(DEFAULT_SETTINGS)
    this.revision = 0
    this.logger = logger
    this.mtRuntime = mtRuntime
    this.resetLibraryState()
    this.dataDir = String(dataDir ?? '').trim() ? resolve(String(dataDir)) : ''
    this.storageFile = this.dataDir ? join(this.dataDir, STORE_FILENAME) : ''
    this.saveTimer = null
    this.persistence = {
      enabled: Boolean(this.storageFile),
      file: this.storageFile || null,
      loaded: false,
      lastSavedAt: null,
      error: null,
      corruptBackup: null,
    }
    if (this.storageFile) this.load()
  }

  touch() {
    this.revision += 1
  }

  activeDocument() {
    return this.activeDocId ? this.docs.get(this.activeDocId) ?? null : null
  }

  requireDocument(documentId) {
    const doc = documentId ? this.docs.get(documentId) : this.activeDocument()
    if (!doc) throw new CatError('NO_DOCUMENT', '没有活动文档，请先在 CAIT 工作台创建或导入文档。', 409)
    return doc
  }

  findSegment(doc, index) {
    if (!Number.isInteger(index) || index < 0 || index >= doc.segments.length) {
      throw new CatError('SEGMENT_OUT_OF_RANGE', `句段索引超出范围: ${index}`)
    }
    return doc.segments[index]
  }

  publicSettings() {
    return {
      ...this.settings,
      mt: {
        provider: this.settings.mt.provider,
        model: this.settings.mt.model,
        temperature: this.settings.mt.temperature,
      },
    }
  }

  async listMtRoutes(options = {}) {
    if (this.mtRuntime && typeof this.mtRuntime.listRoutes === 'function') {
      return this.mtRuntime.listRoutes(options)
    }
    return { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
  }

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
  }

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
    }
  }

  segmentView(segment, index) {
    return {
      id: segment.id,
      index,
      source: segment.source,
      target: segment.target,
      status: segment.status,
      origin: segment.origin ?? null,
      suggestion: segment.suggestion ?? '',
      paragraph: segment.paragraph,
      confirmedAt: segment.confirmedAt,
    }
  }

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
      glossaryHits: this.findGlossaryHits(segment.source, doc.sourceLang),
    }
  }

  documentView(doc) {
    return {
      ...this.documentSummary(doc),
      segments: doc.segments.map((segment, index) => this.segmentView(segment, index)),
      current: this.segmentDetail(doc, doc.cursor),
    }
  }

  bootstrap() {
    const doc = this.activeDocument()
    const mountedTm = new Set(this.mounts.tmIds)
    const mountedGlossary = new Set(this.mounts.glossaryIds)
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
          (sum, item) => sum + item.segments.filter((segment) => segment.status === 'confirmed').length,
          0,
        ),
        translated: [...this.docs.values()].reduce(
          (sum, item) => sum + item.segments.filter((segment) => segment.status === 'translated').length,
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
      tm: {
        count: mountedTmEntries.length,
        total: this.tm.length,
        entries: tmEntries,
      },
      glossary: glossary.map((entry) => ({ ...entry })),
    }
  }

  createDocument(input = {}) {
    const sourceLang = cleanLang(input.sourceLang || this.settings.sourceLang, this.settings.sourceLang)
    const targetLang = cleanLang(input.targetLang || this.settings.targetLang, this.settings.targetLang)
    let rawSegments = []

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
    const segments = rawSegments.map((raw, index) => {
      const source = cleanText(raw.source, '原文')
      const target = cleanText(raw.target, '译文')
      if (!source) throw new CatError('EMPTY_SEGMENT', `第 ${index + 1} 句原文为空`)
      const paragraph = paragraphMap && Number.isInteger(paragraphMap[raw.paragraph])
        ? paragraphMap[raw.paragraph]
        : Number.isInteger(raw.paragraph)
          ? raw.paragraph
          : index
      const meta = cleanSegmentMeta(raw.meta)
      const segment = {
        id: `s${index + 1}`,
        source,
        target,
        status: target ? 'confirmed' : 'pending',
        origin: target ? 'manual' : null,
        suggestion: '',
        paragraph,
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
      if (input.epubSource) this.attachEpubSource(existing, input.epubSource, input.epubName)
      if (input.format) existing.format = String(input.format).slice(0, 24)
      if (formatMeta) existing.formatMeta = cleanFormatMeta({ ...(existing.formatMeta || {}), ...formatMeta })
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
    }
    if (doc.cursor < 0) doc.cursor = 0
    if (input.docxSource) this.attachDocxSource(doc, input.docxSource, input.docxName)
    if (input.pptxSource) this.attachPptxSource(doc, input.pptxSource, input.pptxName)
    if (input.epubSource) this.attachEpubSource(doc, input.epubSource, input.epubName)

    this.docs.set(doc.id, doc)
    this.activeDocId = doc.id
    if (!this.openDocIds.includes(doc.id)) this.openDocIds.push(doc.id)
    this.settings.sourceLang = sourceLang
    this.settings.targetLang = targetLang

    for (const segment of segments) {
      if (segment.target) this.upsertTM(segment.source, segment.target, sourceLang, targetLang)
    }
    this.touch()
    this.persist()

    return { document: this.documentSummary(doc) }
  }

  deleteDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const tabIndex = this.openDocIds.indexOf(doc.id)
    this.removeDocxSource(doc)
    this.removePptxSource(doc)
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
  }

  openDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    this.activeDocId = doc.id
    if (!this.openDocIds.includes(doc.id)) this.openDocIds.push(doc.id)
    this.settings.sourceLang = doc.sourceLang
    this.settings.targetLang = doc.targetLang
    this.touch()
    this.persist()
    return { document: this.documentSummary(doc) }
  }

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
  }

  selectSegment({ documentId, index } = {}) {
    const doc = this.requireDocument(documentId)
    const target = Number(index ?? doc.cursor)
    this.findSegment(doc, target)
    doc.cursor = target
    doc.updatedAt = now()
    this.touch()
    this.schedulePersist()
    return { cursor: doc.cursor, current: this.segmentDetail(doc, doc.cursor) }
  }

  saveDraft({ documentId, index, target } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, Number(index ?? doc.cursor))
    const value = cleanText(target, '译文')
    if (value !== segment.target) {
      segment.target = value
      segment.updatedAt = now()
      doc.updatedAt = segment.updatedAt
      // Typed by a human. A model proposal stays visible next to it for
      // reference until it is adopted or replaced.
      if (value) segment.origin = 'manual'
    }
    normalizeSegmentState(segment)
    this.touch()
    this.schedulePersist()
    return {
      segment: this.segmentView(segment, doc.segments.indexOf(segment)),
      cursor: doc.cursor,
    }
  }

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
  }

  confirmSegment({ documentId, index, target, addToTm = true, targetTmId } = {}) {
    const doc = this.requireDocument(documentId)
    const segmentIndex = Number(index ?? doc.cursor)
    const segment = this.findSegment(doc, segmentIndex)
    const writeTmId = addToTm ? this.requireMountedTmLibrary(targetTmId) : null
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
      tm: addToTm ? this.tm.map((entry) => ({ ...entry })) : null,
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
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      if (before.tm) this.tm = before.tm
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
  }

  findNextUnconfirmed(doc, fromIndex) {
    const total = doc.segments.length
    for (let step = 1; step <= total; step += 1) {
      const index = (fromIndex + step) % total
      if (doc.segments[index].status !== 'confirmed') return index
    }
    return fromIndex
  }

  moveSegment({ documentId, delta = 1 } = {}) {
    const doc = this.requireDocument(documentId)
    const total = doc.segments.length
    const amount = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 1
    doc.cursor = ((doc.cursor + amount) % total + total) % total
    doc.updatedAt = now()
    this.touch()
    return { cursor: doc.cursor, current: this.segmentDetail(doc, doc.cursor) }
  }

  saveSettings(patch = {}) {
    if (patch.sourceLang !== undefined) {
      this.settings.sourceLang = cleanLang(patch.sourceLang, this.settings.sourceLang)
    }
    if (patch.targetLang !== undefined) {
      this.settings.targetLang = cleanLang(patch.targetLang, this.settings.targetLang)
    }
    if (patch.fuzzyThreshold !== undefined) {
      this.settings.fuzzyThreshold = clamp(Number(patch.fuzzyThreshold), 0, 1)
    }
    if (patch.tmLimit !== undefined) {
      this.settings.tmLimit = clampInt(patch.tmLimit, 1, 20, this.settings.tmLimit)
    }
    if (patch.uiLang !== undefined) {
      const uiLang = String(patch.uiLang ?? '').trim().toLowerCase()
      if (!UI_LANG_CODES.includes(uiLang)) {
        throw new CatError('INVALID_UI_LANG', '界面语言无效，可选 auto / zh / en / ja。')
      }
      this.settings.uiLang = uiLang
    }

    if (patch.preprocess && typeof patch.preprocess === 'object') {
      this.settings.preprocess = normalizePreprocessOptions({
        ...this.settings.preprocess,
        ...patch.preprocess,
      })
    }

    if (patch.mt && typeof patch.mt === 'object') {
      const mt = patch.mt
      if (mt.provider !== undefined) {
        const provider = String(mt.provider ?? '').trim()
        if (!provider) throw new CatError('INVALID_PROVIDER', '请选择 MT provider 路由。')
        this.settings.mt.provider = provider.slice(0, 120)
      }
      if (mt.model !== undefined) {
        this.settings.mt.model = String(mt.model ?? '').trim().slice(0, 200)
      }
      if (mt.temperature !== undefined) {
        this.settings.mt.temperature = clamp(Number(mt.temperature), 0, 2)
      }
    }

    this.touch()
    const storage = this.persist()
    return { settings: this.publicSettings(), storage }
  }

  mockSuggestion(sourceText, hits, started, note) {
    let output = sourceText
    for (const hit of hits) {
      output = output.replace(new RegExp(escapeRegExp(hit.term), 'gi'), hit.target)
    }
    if (output === sourceText) output = `【机器翻译示例 · 术语替换】${sourceText}`
    return {
      text: output,
      provider: MOCK_PROVIDER,
      model: MOCK_MODEL,
      latencyMs: Date.now() - started,
      note,
    }
  }

  async mtSuggest({ text, documentId, index, sourceLang, targetLang } = {}) {
    let doc = null
    if (documentId !== undefined && documentId !== null) {
      if (typeof documentId !== 'string' || !documentId.trim()) {
        throw new CatError('DOCUMENT_NOT_FOUND', '文档不存在。', 404)
      }
      doc = this.docs.get(documentId)
      if (!doc) throw new CatError('DOCUMENT_NOT_FOUND', `文档不存在: ${documentId}`, 404)
    } else {
      doc = this.activeDocument()
    }

    let segment = null
    if (index !== undefined && index !== null) {
      if (!doc) throw new CatError('NO_DOCUMENT', '没有活动文档，无法定位句段。', 409)
      if (!Number.isInteger(index)) {
        throw new CatError('SEGMENT_OUT_OF_RANGE', `句段索引不是整数: ${index}`)
      }
      segment = this.findSegment(doc, index)
    }

    const fallbackSource = segment?.source ?? (doc ? doc.segments[doc.cursor]?.source : undefined)
    if (text === undefined && fallbackSource === undefined) {
      throw new CatError('NO_DOCUMENT', '没有活动文档，无法生成译文建议。', 409)
    }
    const sourceText = cleanText(text === undefined ? fallbackSource : text, '原文')
    if (!sourceText) throw new CatError('EMPTY_SOURCE', '没有可翻译的原文。')

    const src = canonicalLanguage(sourceLang || doc?.sourceLang || this.settings.sourceLang)
    const tgt = canonicalLanguage(targetLang || doc?.targetLang || this.settings.targetLang)
    const started = Date.now()
    const provider = this.settings.mt.provider
    const hits = this.findGlossaryHits(sourceText, src)

    let routes
    try {
      routes = await this.listMtRoutes()
    } catch {
      routes = { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
    }
    const providers = Array.isArray(routes?.providers) ? routes.providers : []
    const selectedRoute = providers.find((route) => route.id === provider)

    if (provider === MOCK_PROVIDER) {
      return this.mockSuggestion(
        sourceText,
        hits,
        started,
        providers.length ? '术语替换（离线）：当前未调用 DSH 模型。' : NO_ROUTE_MESSAGE,
      )
    }
    if (!selectedRoute) {
      return this.mockSuggestion(sourceText, hits, started, NO_ROUTE_MESSAGE)
    }

    const models = Array.isArray(selectedRoute.models) ? selectedRoute.models : []
    const model = models.some((item) => item.id === this.settings.mt.model)
      ? this.settings.mt.model
      : models[0]?.id
    if (!model) {
      return this.mockSuggestion(sourceText, hits, started, NO_MODEL_MESSAGE)
    }

    const glossaryRule = hits.length
      ? `\nUse this terminology consistently: ${hits.map((hit) => `${hit.term} => ${hit.target}`).join('; ')}.`
      : ''
    const systemText =
      'You are a professional translator. Preserve meaning, numbers, markup and tone. Return only the translation, without quotes or explanations.'
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Translate from ${src} to ${tgt}.${glossaryRule}\n\n${sourceText}`,
          },
        ],
      },
    ]

    let output
    try {
      const stream = await this.mtRuntime.stream({
        provider,
        model,
        messages,
        system: systemText,
        temperature: this.settings.mt.temperature,
        purpose: 'cait-mt',
        signal: AbortSignal.timeout(45000),
      })
      output = await collectStreamText(stream)
      if (!output) {
        const empty = new Error('DSH 模型路由没有返回译文')
        empty.code = 'MT_EMPTY'
        throw empty
      }
    } catch (error) {
      this.logger?.warn?.(
        `CAIT: DSH MT 路由调用失败 provider=${provider} model=${model} code=${
          error?.code || 'UNKNOWN'
        } status=${error?.status ?? '-'}: ${error?.message || error}`,
      )
      throw new CatError(
        'MT_PROVIDER_FAILED',
        '机器翻译调用失败，请检查 DSH 模型路由配置。',
        502,
      )
    }

    return {
      text: output,
      provider,
      model,
      latencyMs: Date.now() - started,
    }
  }

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
  }

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
  }

  loadDemo() {
    const text = [
      'Computer-aided translation tools help translators work faster and more consistently. A translation memory stores previously translated sentences, so repetitive passages can be reused with a single click.',
      'Terminology databases keep product names and technical terms consistent across documents. Every confirmed segment can be written back to the translation memory, building a reusable knowledge base for the next project.',
      'A good CAT workbench brings the source text, the target editor, translation memory matches, glossary hits, and machine translation suggestions into one focused workspace.',
    ].join('\n\n')

    const created = this.createDocument({
      name: 'CAIT 演示 · 产品简介',
      text,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })

    const terms = [
      ['computer-aided translation', '计算机辅助翻译', 'CAT 的全称'],
      ['translation memory', '翻译记忆库', '存储已翻译句段'],
      ['terminology database', '术语库', '维护术语一致性'],
      ['segment', '句段', 'CAT 的基本翻译单位'],
      ['workspace', '工作台', '译者的操作界面'],
    ]
    for (const [source, target, note] of terms) {
      if (!this.glossary.some((entry) => normalizeText(entry.source) === normalizeText(source))) {
        this.addGlossary({ source, target, note, sourceLang: 'en' })
      }
    }

    const memories = [
      ['A translation memory stores previously translated sentences.', '翻译记忆库存储以前翻译过的句子。'],
      ['Computer-aided translation tools help translators work faster and more consistently.', '计算机辅助翻译工具帮助译者更快、更一致地工作。'],
      ['Terminology databases keep product names and technical terms consistent.', '术语库让产品名称和技术术语保持一致。'],
    ]
    for (const [source, target] of memories) {
      this.upsertTM(source, target, 'en', 'zh-CN')
    }
    this.touch()
    this.persist()

    return created
  }
}

Object.assign(CatStore.prototype, libraryMethods, tmMethods, glossaryMethods, persistenceMethods, importExportMethods, preTranslateMethods, qaMethods, libraryViewMethods)
