import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CatError } from './errors.js'
import { normalizeText } from './similarity.js'
import { documentFingerprint, DEFAULT_GLOSSARY_ID, DEFAULT_GLOSSARY_NAME, DEFAULT_SETTINGS, DEFAULT_TM_ID, DEFAULT_TM_NAME, MAX_SEGMENTS, MAX_STORE_BYTES, STORE_FILENAME, STORE_VERSION, clamp, clampInt, cleanFormatMeta, cleanName, cleanSegmentMeta, now, restoreLibraries, restoreMountIds, restoreSettings, restoredDate, restoredLang, restoredText } from './store-utils.js'

export const persistenceMethods = {
  load() {
    let raw
    try {
      raw = readFileSync(this.storageFile, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return
      this.reportLoadFailure(error)
      return
    }

    try {
      if (Buffer.byteLength(raw, 'utf8') > MAX_STORE_BYTES) {
        throw new Error(`数据文件超过 ${MAX_STORE_BYTES / 1024 / 1024} MB 上限`)
      }
      this.restore(JSON.parse(raw))
      this.persistence.loaded = true
      this.persistence.error = null
    } catch (error) {
      this.reportLoadFailure(error)
    }
  }
,
  reportLoadFailure(error) {
    const message = error instanceof Error ? error.message : String(error)
    this.docs = new Map()
    this.tm = []
    this.glossary = []
    this.activeDocId = null
    this.openDocIds = []
    this.resetLibraryState()
    this.persistence.loaded = false
    this.persistence.error = message
    this.logger?.warn?.(
      `CAIT: 无法加载持久化数据 (${this.storageFile}): ${message}；已回退到空状态。`,
    )

    try {
      const backup = `${this.storageFile}.corrupt-${Date.now()}`
      renameSync(this.storageFile, backup)
      this.persistence.corruptBackup = backup
      this.logger?.warn?.(`CAIT: 已将无法读取的数据文件备份到 ${backup}`)
    } catch (backupError) {
      if (backupError?.code !== 'ENOENT') {
        this.logger?.warn?.(`CAIT: 备份损坏数据文件失败: ${backupError.message}`)
      }
    }
  }
,
  restore(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('数据文件根节点不是对象')
    }
    if (payload.version !== 1 && payload.version !== STORE_VERSION) {
      throw new Error(`不兼容的数据版本: ${String(payload.version ?? 'missing')}`)
    }
    if (!Array.isArray(payload.documents) || !Array.isArray(payload.tm) || !Array.isArray(payload.glossary)) {
      throw new Error('数据文件缺少 documents/tm/glossary 数组')
    }

    const docs = new Map()
    for (const rawDoc of payload.documents) {
      if (!rawDoc || typeof rawDoc !== 'object') throw new Error('文档记录不是对象')
      if (typeof rawDoc.id !== 'string' || !rawDoc.id) throw new Error('文档缺少 id')
      if (!Array.isArray(rawDoc.segments) || !rawDoc.segments.length) {
        throw new Error(`文档 ${rawDoc.id} 没有句段`)
      }
      if (rawDoc.segments.length > MAX_SEGMENTS) throw new Error(`文档 ${rawDoc.id} 句段数量超限`)

      const sourceLang = restoredLang(rawDoc.sourceLang, 'en')
      const targetLang = restoredLang(rawDoc.targetLang, 'zh-CN')
      const segments = rawDoc.segments.map((rawSegment, index) => {
        if (!rawSegment || typeof rawSegment !== 'object') {
          throw new Error(`文档 ${rawDoc.id} 的第 ${index + 1} 个句段不是对象`)
        }
        const source = restoredText(rawSegment.source, '原文', { required: true })
        const target = restoredText(rawSegment.target ?? '', '译文')
        const status = rawSegment.status === 'confirmed' && target ? 'confirmed' : 'pending'
        const meta = cleanSegmentMeta(rawSegment.meta)
        return {
          id:
            typeof rawSegment.id === 'string' && rawSegment.id
              ? rawSegment.id
              : `s${index + 1}`,
          source,
          target,
          status,
          paragraph: Number.isInteger(rawSegment.paragraph) ? rawSegment.paragraph : index,
          ...(meta ? { meta } : {}),
          confirmedAt: status === 'confirmed' ? restoredDate(rawSegment.confirmedAt) : null,
          updatedAt: restoredDate(rawSegment.updatedAt),
        }
      })

      const doc = {
        id: rawDoc.id,
        name: cleanName(rawDoc.name, '未命名文档'),
        sourceLang,
        targetLang,
        segments,
        cursor: clampInt(rawDoc.cursor, 0, segments.length - 1, 0),
        createdAt: restoredDate(rawDoc.createdAt),
        updatedAt: restoredDate(rawDoc.updatedAt),
        format: typeof rawDoc.format === 'string' ? rawDoc.format.slice(0, 24) : '',
        fingerprint:
          typeof rawDoc.fingerprint === 'string' && rawDoc.fingerprint
            ? rawDoc.fingerprint
            : documentFingerprint(sourceLang, targetLang, segments, rawDoc.format),
      }
      const formatMeta = cleanFormatMeta(rawDoc.formatMeta)
      if (formatMeta) doc.formatMeta = formatMeta
      const sourceDocx = rawDoc.sourceDocx
      if (
        sourceDocx &&
        typeof sourceDocx === 'object' &&
        sourceDocx.kind === 'file' &&
        typeof sourceDocx.asset === 'string' &&
        /^sources\/[A-Za-z0-9_.-]+\.docx$/.test(sourceDocx.asset)
      ) {
        doc.sourceDocx = {
          kind: 'file',
          asset: sourceDocx.asset,
          name: cleanName(sourceDocx.name, 'source.docx'),
        }
      }
      const sourcePptx = rawDoc.sourcePptx
      if (
        sourcePptx &&
        typeof sourcePptx === 'object' &&
        sourcePptx.kind === 'file' &&
        typeof sourcePptx.asset === 'string' &&
        /^sources\/[A-Za-z0-9_.-]+\.pptx$/.test(sourcePptx.asset)
      ) {
        doc.sourcePptx = {
          kind: 'file',
          asset: sourcePptx.asset,
          name: cleanName(sourcePptx.name, 'source.pptx'),
        }
      }
      const sourceEpub = rawDoc.sourceEpub
      if (
        sourceEpub &&
        typeof sourceEpub === 'object' &&
        sourceEpub.kind === 'file' &&
        typeof sourceEpub.asset === 'string' &&
        /^sources\/[A-Za-z0-9_.-]+\.epub$/.test(sourceEpub.asset)
      ) {
        doc.sourceEpub = {
          kind: 'file',
          asset: sourceEpub.asset,
          name: cleanName(sourceEpub.name, 'source.epub'),
        }
      }
      if (docs.has(doc.id)) throw new Error(`文档 id 重复: ${doc.id}`)
      docs.set(doc.id, doc)
    }

    const tm = []
    const tmKeys = new Set()
    for (const rawEntry of payload.tm) {
      if (!rawEntry || typeof rawEntry !== 'object') throw new Error('记忆库记录不是对象')
      const source = restoredText(rawEntry.source, '记忆库原文', { required: true })
      const target = restoredText(rawEntry.target, '记忆库译文', { required: true })
      const sourceLang = restoredLang(rawEntry.sourceLang, 'en')
      const targetLang = restoredLang(rawEntry.targetLang, 'zh-CN')
      const key = normalizeText(source)
      const tmId =
        typeof rawEntry.tmId === 'string' && rawEntry.tmId ? rawEntry.tmId : DEFAULT_TM_ID
      const dedupeKey = `${tmId}\u0000${sourceLang}\u0000${targetLang}\u0000${key}`
      if (tmKeys.has(dedupeKey)) continue
      tmKeys.add(dedupeKey)
      tm.push({
        id: typeof rawEntry.id === 'string' && rawEntry.id ? rawEntry.id : makeId('tm'),
        tmId,
        key,
        source,
        target,
        sourceLang,
        targetLang,
        createdAt: restoredDate(rawEntry.createdAt),
        updatedAt: restoredDate(rawEntry.updatedAt),
      })
    }

    const glossary = []
    for (const rawEntry of payload.glossary) {
      if (!rawEntry || typeof rawEntry !== 'object') throw new Error('术语库记录不是对象')
      glossary.push({
        id: typeof rawEntry.id === 'string' && rawEntry.id ? rawEntry.id : makeId('gl'),
        glossaryId:
          typeof rawEntry.glossaryId === 'string' && rawEntry.glossaryId
            ? rawEntry.glossaryId
            : DEFAULT_GLOSSARY_ID,
        source: restoredText(rawEntry.source, '术语原文', { required: true }),
        target: restoredText(rawEntry.target, '术语译文', { required: true }),
        note: typeof rawEntry.note === 'string' ? rawEntry.note.trim() : '',
        sourceLang: String(rawEntry.sourceLang ?? '').trim()
          ? restoredLang(rawEntry.sourceLang, '')
          : '',
        caseSensitive: Boolean(rawEntry.caseSensitive),
        createdAt: restoredDate(rawEntry.createdAt),
        updatedAt: restoredDate(rawEntry.updatedAt),
      })
    }

    const tmLibraries = restoreLibraries(
      payload.tmLibraries,
      'tmId',
      DEFAULT_TM_ID,
      DEFAULT_TM_NAME,
      tm,
    )
    const glossaryLibraries = restoreLibraries(
      payload.glossaryLibraries,
      'glossaryId',
      DEFAULT_GLOSSARY_ID,
      DEFAULT_GLOSSARY_NAME,
      glossary,
    )
    const rawMounts = payload.mounts && typeof payload.mounts === 'object' ? payload.mounts : {}
    const tmIds = restoreMountIds(rawMounts.tmIds, tmLibraries, 'tmId', DEFAULT_TM_ID)
    const glossaryIds = restoreMountIds(
      rawMounts.glossaryIds,
      glossaryLibraries,
      'glossaryId',
      DEFAULT_GLOSSARY_ID,
    )
    const defaultTmId =
      typeof rawMounts.defaultTmId === 'string' && tmIds.includes(rawMounts.defaultTmId)
        ? rawMounts.defaultTmId
        : tmIds[0]
    const defaultGlossaryId =
      typeof rawMounts.defaultGlossaryId === 'string' &&
      glossaryIds.includes(rawMounts.defaultGlossaryId)
        ? rawMounts.defaultGlossaryId
        : glossaryIds[0]

    this.docs = docs
    this.tm = tm
    this.glossary = glossary
    this.tmLibraries = tmLibraries
    this.glossaryLibraries = glossaryLibraries
    this.mounts = { tmIds, glossaryIds, defaultTmId, defaultGlossaryId }
    const hasOpenDocIds = Array.isArray(payload.openDocIds)
    const openDocIds = []
    for (const id of hasOpenDocIds ? payload.openDocIds : []) {
      if (docs.has(id) && !openDocIds.includes(id)) openDocIds.push(id)
    }
    let activeDocId =
      typeof payload.activeDocId === 'string' && docs.has(payload.activeDocId)
        ? payload.activeDocId
        : hasOpenDocIds
          ? null
          : docs.keys().next().value ?? null
    if (!activeDocId && openDocIds.length) activeDocId = openDocIds[0]
    if (activeDocId && !openDocIds.includes(activeDocId)) openDocIds.push(activeDocId)
    this.activeDocId = activeDocId
    this.openDocIds = openDocIds
    this.settings = restoreSettings(payload.settings)
    this.touch()
  }
,
  settingsForStorage() {
    return {
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang,
      fuzzyThreshold: this.settings.fuzzyThreshold,
      tmLimit: this.settings.tmLimit,
      uiLang: this.settings.uiLang,
      preprocess: {
        normalizeWhitespace: this.settings.preprocess.normalizeWhitespace,
        stripInvisible: this.settings.preprocess.stripInvisible,
        collapseBlankLines: this.settings.preprocess.collapseBlankLines,
      },
      mt: {
        provider: this.settings.mt.provider,
        model: this.settings.mt.model,
        temperature: this.settings.mt.temperature,
      },
    }
  }
,
  persist({ strict = false } = {}) {
    if (!this.storageFile) return { ok: false, skipped: true }

    let temp = ''
    try {
      mkdirSync(this.dataDir, { recursive: true })
      const savedAt = now()
      const payload = {
        version: STORE_VERSION,
        savedAt,
        activeDocId: this.activeDocId,
        openDocIds: this.openDocIds,
        documents: [...this.docs.values()],
        tmLibraries: this.tmLibraries,
        glossaryLibraries: this.glossaryLibraries,
        mounts: this.mountsView(),
        tm: this.tm,
        glossary: this.glossary,
        settings: this.settingsForStorage(),
      }
      const text = JSON.stringify(payload, null, 2)
      temp = `${this.storageFile}.${process.pid}.${randomUUID()}.tmp`
      writeFileSync(temp, text, 'utf8')
      renameSync(temp, this.storageFile)
      this.persistence.loaded = true
      this.persistence.lastSavedAt = savedAt
      this.persistence.error = null
      return { ok: true, file: this.storageFile, bytes: Buffer.byteLength(text, 'utf8') }
    } catch (error) {
      if (temp) {
        try {
          unlinkSync(temp)
        } catch {
          // The temporary file may already have been renamed or removed.
        }
      }
      this.persistence.error = error.message
      this.logger?.error?.(`CAIT: 保存数据失败 (${this.storageFile}): ${error.message}`)
      if (strict) {
        const failure = new CatError(
          'PERSISTENCE_FAILED',
          '数据保存失败，本次操作已回滚；请检查 CAIT 数据目录后重试。',
          503,
        )
        failure.storage = { ok: false, error: error.message }
        throw failure
      }
      return { ok: false, error: error.message }
    }
  }

}
