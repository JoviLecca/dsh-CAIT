import { CatError } from './errors.js'
import { join, resolve } from 'node:path'
import {
  cleanLang,
  clamp,
  clampInt,
  DEFAULT_SETTINGS,
  STORE_FILENAME,
  UI_LANG_CODES,
} from './store-utils.js'
import { applyMixins } from './store-mixins.js'
import { normalizePreprocessOptions } from './preprocess.js'

// Re-exported so the protocol layer can share these without reaching past the store.
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
    return this.activeDocId ? (this.docs.get(this.activeDocId) ?? null) : null
  }

  requireDocument(documentId) {
    const doc = documentId ? this.docs.get(documentId) : this.activeDocument()
    if (!doc)
      throw new CatError('NO_DOCUMENT', '没有活动文档，请先在 CAIT 工作台创建或导入文档。', 409)
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
      review: {
        provider: this.settings.review?.provider || '',
        model: this.settings.review?.model || '',
        temperature: this.settings.review?.temperature ?? 0,
      },
    }
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
      const uiLang = String(patch.uiLang ?? '')
        .trim()
        .toLowerCase()
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
        this.settings.mt.model = String(mt.model ?? '')
          .trim()
          .slice(0, 200)
      }
      if (mt.temperature !== undefined) {
        this.settings.mt.temperature = clamp(Number(mt.temperature), 0, 2)
      }
    }

    if (patch.review && typeof patch.review === 'object') {
      const review = patch.review
      if (review.provider !== undefined) {
        const provider = String(review.provider ?? '').trim()
        this.settings.review.provider = provider.slice(0, 120)
        // An empty provider explicitly means "inherit the MT route", so the
        // stale override model must not linger.
        if (!provider) this.settings.review.model = ''
      }
      if (review.model !== undefined) {
        this.settings.review.model = String(review.model ?? '')
          .trim()
          .slice(0, 200)
      }
      if (review.temperature !== undefined) {
        this.settings.review.temperature = clamp(Number(review.temperature), 0, 2)
      }
      if (!this.settings.review.provider) this.settings.review.model = ''
    }

    this.touch()
    const storage = this.persist()
    return { settings: this.publicSettings(), storage }
  }
}

applyMixins(CatStore)
