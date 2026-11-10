import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatError } from './errors.js'
import {
  MAX_DOCX_BASE64,
  MAX_IMPORT_CHARS,
  cleanLang,
  cleanName,
  normalizeSegmentState,
} from './store-utils.js'
import { stripMarkdown } from './markdown.js'
import { parseDocxDetailed } from './docx.js'
import { parseEpub } from './epub.js'
import { parsePptxDetailed } from './pptx.js'
import { parseXlsx } from './xlsx.js'
import { parseTmx } from './tmx.js'
import {
  parseCsv,
  parseJson,
  parsePo,
  parseRtf,
  parseSrt,
  parseVtt,
  parseXliff,
} from './formats.js'
import { exportFormat } from './export-document.js'
import { importFile as readImportedFile } from './import-file.js'

const BINARY_SOURCES = {
  docx: { label: 'DOCX', fallback: 'source.docx' },
  pptx: { label: 'PPTX', fallback: 'source.pptx' },
  xlsx: { label: 'XLSX', fallback: 'source.xlsx' },
  epub: { label: 'EPUB', fallback: 'source.epub' },
}

const ALIGN_TEXT_PARSERS = {
  csv: parseCsv,
  srt: parseSrt,
  vtt: parseVtt,
  po: parsePo,
  pot: parsePo,
  json: parseJson,
  rtf: parseRtf,
  xliff: parseXliff,
  xlf: parseXliff,
  sdlxliff: parseXliff,
}

/**
 * Text of an uploaded file, without creating a document. The aligner works on
 * two files and only needs their paragraphs, so this path must not consume the
 * segment budget or appear in the document list.
 */
function readUploadBody(fileName, extension, text, base64) {
  if (
    extension === 'docx' ||
    extension === 'epub' ||
    extension === 'xlsx' ||
    extension === 'pptx'
  ) {
    if (!base64) throw new CatError('EMPTY_FILE', `${fileName} 内容为空。`)
    if (base64.length > MAX_DOCX_BASE64) throw new CatError('FILE_TOO_LARGE', `${fileName} 过大。`)
    const buffer = Buffer.from(base64, 'base64')
    if (extension === 'docx') return parseDocxDetailed(buffer).text
    if (extension === 'epub')
      return parseEpub(buffer)
        .segments.map((segment) => segment.source)
        .join('\n')
    const parsed = extension === 'xlsx' ? parseXlsx(buffer) : parsePptxDetailed(buffer)
    return parsed.segments.map((segment) => segment.source).join('\n')
  }
  const raw = String(text ?? '')
  if (!raw.trim()) throw new CatError('EMPTY_FILE', `${fileName} 内容为空。`)
  if (raw.length > MAX_IMPORT_CHARS) throw new CatError('FILE_TOO_LARGE', `${fileName} 过大。`)
  if (extension === 'md' || extension === 'markdown') return stripMarkdown(raw)
  if (ALIGN_TEXT_PARSERS[extension]) {
    return ALIGN_TEXT_PARSERS[extension](raw)
      .segments.map((segment) => segment.source)
      .join('\n')
  }
  return raw
}

function sourceField(kind) {
  return `source${kind[0].toUpperCase()}${kind.slice(1)}`
}

/**
 * Keep the original binary package so exporting can patch translated text into
 * the source layout. Persisted stores use a small sidecar file; transient
 * in-memory stores keep the bytes in the document object only.
 */
function attachSource(store, doc, kind, buffer, name) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return
  const config = BINARY_SOURCES[kind]
  const fileName = cleanName(name, config.fallback)
  if (store.dataDir) {
    const asset = `sources/${doc.id}.${kind}`
    try {
      mkdirSync(join(store.dataDir, 'sources'), { recursive: true })
      writeFileSync(join(store.dataDir, asset), buffer)
    } catch (error) {
      throw new CatError(
        `${kind.toUpperCase()}_SOURCE_WRITE_FAILED`,
        `无法保存 ${config.label} 源文件，无法保留源格式: ${error.message}`,
        500,
      )
    }
    doc[sourceField(kind)] = { kind: 'file', asset, name: fileName }
    return
  }
  doc[sourceField(kind)] = { kind: 'base64', data: buffer.toString('base64'), name: fileName }
}

function removeSource(store, doc, kind) {
  const field = sourceField(kind)
  const source = doc?.[field]
  if (!source) return
  if (source.kind === 'file' && store.dataDir) {
    try {
      unlinkSync(join(store.dataDir, source.asset))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        store.logger?.warn?.(
          `CAIT: 删除 ${BINARY_SOURCES[kind].label} 源文件失败: ${error.message}`,
        )
      }
    }
  }
  delete doc[field]
}

function readSource(store, doc, kind) {
  const source = doc?.[sourceField(kind)]
  if (!source) return null
  try {
    if (source.kind === 'base64' && source.data) {
      return Buffer.from(source.data, 'base64')
    }
    if (source.kind === 'file' && store.dataDir && source.asset) {
      return readFileSync(join(store.dataDir, source.asset))
    }
  } catch (error) {
    store.logger?.warn?.(`CAIT: 读取 ${BINARY_SOURCES[kind].label} 源文件失败: ${error.message}`)
  }
  return null
}

export const importExportMethods = {
  attachDocxSource(doc, buffer, name = 'source.docx') {
    attachSource(this, doc, 'docx', buffer, name)
  },

  removeDocxSource(doc) {
    removeSource(this, doc, 'docx')
  },

  readDocxSource(doc) {
    return readSource(this, doc, 'docx')
  },

  attachPptxSource(doc, buffer, name = 'source.pptx') {
    attachSource(this, doc, 'pptx', buffer, name)
  },

  removePptxSource(doc) {
    removeSource(this, doc, 'pptx')
  },

  readPptxSource(doc) {
    return readSource(this, doc, 'pptx')
  },

  attachXlsxSource(doc, buffer, name = 'source.xlsx') {
    attachSource(this, doc, 'xlsx', buffer, name)
  },

  removeXlsxSource(doc) {
    removeSource(this, doc, 'xlsx')
  },

  readXlsxSource(doc) {
    return readSource(this, doc, 'xlsx')
  },

  attachEpubSource(doc, buffer, name = 'source.epub') {
    attachSource(this, doc, 'epub', buffer, name)
  },

  removeEpubSource(doc) {
    removeSource(this, doc, 'epub')
  },

  readEpubSource(doc) {
    return readSource(this, doc, 'epub')
  },

  importTmx({ text, name, sourceLang, targetLang, importAs = 'tm', tmId } = {}) {
    if (!String(text ?? '').trim()) throw new CatError('EMPTY_FILE', 'TMX 内容为空。')
    const parsed = parseTmx(text)
    const src = cleanLang(
      sourceLang || parsed.sourceLang || this.settings.sourceLang,
      this.settings.sourceLang,
    )
    const detectedTarget = parsed.units
      .flat()
      .map((variant) => variant.lang)
      .find((lang) => lang && lang !== src)
    const tgt = cleanLang(
      targetLang || detectedTarget || this.settings.targetLang,
      this.settings.targetLang,
    )
    const pairs = []
    const segments = []

    parsed.units.forEach((variants, index) => {
      const source =
        variants.find((variant) => variant.lang === src) ??
        variants.find((variant) => variant.lang !== tgt) ??
        variants[0]
      if (!source?.text) return
      const target = variants.find((variant) => variant.lang === tgt)
      pairs.push({
        source: source.text,
        target: target?.text || '',
        sourceLang: src,
        targetLang: tgt,
        context: parsed.contexts?.[index] ?? null,
      })
      segments.push({ source: source.text, target: target?.text || '', paragraph: segments.length })
    })

    if (!pairs.length) throw new CatError('TMX_NO_UNITS', 'TMX 中没有可用的翻译单元。')

    if (importAs === 'document') {
      const created = this.createDocument({
        name: cleanName(name, 'TMX 导入'),
        sourceLang: src,
        targetLang: tgt,
        segments,
        format: 'tmx',
      })
      return {
        ...created,
        sourceLang: src,
        targetLang: tgt,
        units: pairs.length,
        warnings: parsed.warnings,
      }
    }

    const imported = this.importTM({ pairs, sourceLang: src, targetLang: tgt, tmId })
    return {
      ...imported,
      sourceLang: src,
      targetLang: tgt,
      units: pairs.length,
      warnings: parsed.warnings,
    }
  },
  readUploadText({ name, text, base64 } = {}) {
    const fileName = cleanName(name, '文件')
    const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
    let body
    try {
      body = readUploadBody(fileName, extension, text, base64)
    } catch (error) {
      if (error instanceof CatError) throw error
      throw new CatError('ALIGN_PARSE', `${fileName} 解析失败: ${error?.message ?? error}`, 400)
    }
    const content = String(body ?? '').trim()
    if (!content) throw new CatError('EMPTY_FILE', `${fileName} 没有可用文本。`)
    return {
      name: fileName,
      format: extension || 'txt',
      text: content,
      chars: Array.from(content).length,
    }
  },

  applyXliffReview({ documentId, text, overwrite = false } = {}) {
    const doc = this.requireDocument(documentId)
    if (!text || !String(text).trim()) throw new CatError('EMPTY_FILE', '审校包内容为空。')
    const parsed = parseXliff(String(text))
    const normalize = (value) =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    const byUid = new Map(
      doc.segments.filter((segment) => segment.uid).map((segment) => [segment.uid, segment]),
    )
    const byId = new Map(doc.segments.map((segment) => [segment.id, segment]))
    const byXliffId = new Map(
      doc.segments
        .filter((segment) => segment.meta?.xliffId)
        .map((segment) => [String(segment.meta.xliffId), segment]),
    )
    const bySource = new Map()
    for (const segment of doc.segments) {
      const key = normalize(segment.source)
      if (!bySource.has(key)) bySource.set(key, [])
      bySource.get(key).push(segment)
    }

    let applied = 0
    let changed = 0
    let unmatched = 0
    let sourceMismatch = 0
    const now = new Date().toISOString()
    for (const incoming of parsed.segments) {
      const uid = incoming.meta?.caitUid
      const xliffId = incoming.meta?.xliffId
      let segment = uid ? byUid.get(uid) : null
      if (!segment && xliffId) segment = byXliffId.get(String(xliffId))
      if (!segment && xliffId) segment = byId.get(String(xliffId))
      if (!segment) {
        const matches = bySource.get(normalize(incoming.source)) || []
        if (matches.length === 1) segment = matches[0]
      }
      if (!segment) {
        unmatched += 1
        continue
      }
      if (normalize(segment.source) !== normalize(incoming.source)) {
        sourceMismatch += 1
        continue
      }
      const target = String(incoming.target ?? '').trim()
      if (!target) continue
      if (!overwrite && segment.target === target) continue
      segment.target = target
      segment.suggestion = null
      segment.suggestionReason = null
      segment.origin = 'manual'
      segment.confirmedAt = ['final', 'signed-off'].includes(incoming.meta?.targetState)
        ? now
        : null
      segment.updatedAt = now
      normalizeSegmentState(segment)
      applied += 1
      changed += 1
    }
    if (changed) {
      this.touch()
      this.persist()
    }
    return {
      documentId: doc.id,
      documentName: doc.name,
      total: parsed.segments.length,
      applied,
      changed,
      unmatched,
      sourceMismatch,
    }
  },

  importFile(input = {}) {
    return readImportedFile(this, input)
  },
  exportDocument({ format = 'bilingual-md', documentId } = {}) {
    const doc = this.requireDocument(documentId)
    return exportFormat(this, doc, format)
  },
}
