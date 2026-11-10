/**
 * Import readers, one per file kind.
 *
 * `importFile` used to be one 220-line `if (extension === ...)` chain in which
 * four branches repeated the same "parse → resolve languages → createDocument →
 * add units/warnings" tail. Each kind now has a reader that returns the same
 * shape, and `pickReader` is the only place that decides which one runs.
 */
import { CatError } from './errors.js'
import { MAX_DOCX_BASE64, MAX_IMPORT_CHARS, cleanLang, cleanName } from './store-utils.js'
import { stripMarkdown } from './markdown.js'
import { parseDocxDetailed } from './docx.js'
import { parseEpub } from './epub.js'
import { parsePptxDetailed } from './pptx.js'
import { parseXlsx } from './xlsx.js'
import {
  parseCsv,
  parseHtml,
  parseJson,
  parsePo,
  parseRtf,
  parseSrt,
  parseVtt,
  parseXliff,
} from './formats.js'
import { LOCALIZATION_EXTENSIONS, parseLocalization } from './localization.js'
import { decodeXml } from './xml.js'

/** Extensions whose payload arrives base64-encoded and needs its own parser. */
const BINARY_READERS = {
  docx: readDocx,
  epub: readEpub,
  xlsx: (store, context) => readOffice(store, context, 'xlsx'),
  pptx: (store, context) => readOffice(store, context, 'pptx'),
}

/** Text formats that parse into segments rather than a paragraph of prose. */
const STRUCTURED_FORMATS = {
  csv: { parser: parseCsv, format: 'csv' },
  srt: { parser: parseSrt, format: 'srt' },
  vtt: { parser: parseVtt, format: 'vtt' },
  po: { parser: parsePo, format: 'po' },
  pot: { parser: parsePo, format: 'po' },
  html: { parser: parseHtml, format: 'html' },
  htm: { parser: parseHtml, format: 'html' },
  json: { parser: parseJson, format: 'json' },
  rtf: { parser: parseRtf, format: 'rtf' },
  xliff: { parser: parseXliff, format: 'xliff' },
  xlf: { parser: parseXliff, format: 'xliff' },
  sdlxliff: { parser: parseXliff, format: 'xliff' },
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

/** Every extension `importFile` can read. Guarded against the UI accept lists. */
export const SUPPORTED_IMPORT_EXTENSIONS = new Set([
  ...Object.keys(BINARY_READERS),
  'tmx',
  ...Object.keys(LOCALIZATION_EXTENSIONS),
  'xml',
  ...Object.keys(STRUCTURED_FORMATS),
  ...MARKDOWN_EXTENSIONS,
  // Anything unrecognised falls through to the plain-text reader.
  'txt',
])

function decodeUpload(context, label) {
  if (!context.base64) throw new CatError('EMPTY_FILE', `${label} 文件内容为空。`)
  if (context.base64.length > MAX_DOCX_BASE64)
    throw new CatError('FILE_TOO_LARGE', `${label} 文件过大。`)
  return Buffer.from(context.base64, 'base64')
}

/** Text payload guard shared by every reader that parses text. */
function requireText(context) {
  const sourceText = String(context.text ?? '')
  if (!sourceText.trim()) throw new CatError('EMPTY_FILE', '文件内容为空。')
  if (sourceText.length > MAX_IMPORT_CHARS) throw new CatError('FILE_TOO_LARGE', '文件过大。')
  return sourceText
}

function parseOrFail(parse, code, label) {
  try {
    return parse()
  } catch (error) {
    if (error instanceof CatError) throw error
    throw new CatError(code, `${label} 解析失败: ${error?.message ?? error}`)
  }
}

/** The tail every segment-producing reader shares: languages, then the doc. */
function createFromParsed(store, context, parsed, format, extra = {}) {
  const src = cleanLang(
    context.sourceLang || parsed.sourceLang || store.settings.sourceLang,
    store.settings.sourceLang,
  )
  const tgt = cleanLang(
    context.targetLang || parsed.targetLang || store.settings.targetLang,
    store.settings.targetLang,
  )
  const created = store.createDocument({
    name: context.fileName,
    segments: parsed.segments,
    sourceLang: src,
    targetLang: tgt,
    format,
    ...extra,
  })
  return {
    ...created,
    sourceLang: src,
    targetLang: tgt,
    units: parsed.segments.length,
    warnings: parsed.warnings ?? [],
  }
}

function readDocx(store, context) {
  const buffer = decodeUpload(context, 'DOCX')
  const content = parseOrFail(() => parseDocxDetailed(buffer), 'DOCX_PARSE', 'DOCX')
  return store.createDocument({
    name: context.fileName,
    text: content.text,
    paragraphMap: content.paragraphs.map((paragraph) => paragraph.index),
    paragraphMeta: Object.fromEntries(
      content.paragraphs.map((paragraph) => [paragraph.index, paragraph.meta]),
    ),
    docxSource: buffer,
    docxName: context.fileName,
    sourceLang: context.sourceLang,
    targetLang: context.targetLang,
    format: 'docx',
    formatMeta: content.formatMeta,
  })
}

function readEpub(store, context) {
  const buffer = decodeUpload(context, 'EPUB')
  const parsed = parseOrFail(() => parseEpub(buffer), 'EPUB_PARSE', 'EPUB')
  const created = store.createDocument({
    name: context.fileName,
    segments: parsed.segments,
    sourceLang: context.sourceLang || parsed.language,
    targetLang: context.targetLang,
    format: 'epub',
    epubSource: buffer,
    epubName: context.fileName,
  })
  return {
    ...created,
    sourceLang: created.document.sourceLang,
    targetLang: created.document.targetLang,
    units: parsed.segments.length,
    warnings: parsed.warnings ?? [],
  }
}

function readOffice(store, context, kind) {
  const label = kind.toUpperCase()
  const buffer = decodeUpload(context, label)
  const parsed = parseOrFail(
    () => (kind === 'xlsx' ? parseXlsx(buffer) : parsePptxDetailed(buffer)),
    `${label}_PARSE`,
    label,
  )
  const created = store.createDocument({
    name: context.fileName,
    segments: parsed.segments,
    sourceLang: context.sourceLang,
    targetLang: context.targetLang,
    format: kind,
    ...(kind === 'pptx'
      ? { pptxSource: buffer, pptxName: context.fileName }
      : { xlsxSource: buffer, xlsxName: context.fileName }),
  })
  return {
    ...created,
    sourceLang: created.document.sourceLang,
    targetLang: created.document.targetLang,
    units: parsed.segments.length,
    warnings: parsed.warnings ?? [],
  }
}

function readTmx(store, context) {
  return store.importTmx({
    text: context.text,
    name: context.fileName,
    sourceLang: context.sourceLang,
    targetLang: context.targetLang,
    importAs: context.importAs || 'document',
  })
}

function readLocalization(store, context) {
  const kind = LOCALIZATION_EXTENSIONS[context.extension] || 'android'
  const sourceText = requireText(context)
  const parsed = parseOrFail(
    () => parseLocalization(sourceText, kind),
    `${kind.toUpperCase()}_PARSE`,
    kind,
  )
  return createFromParsed(store, context, parsed, parsed.format || kind, {
    formatMeta: parsed.formatMeta,
  })
}

function readStructured(store, context) {
  const structured = STRUCTURED_FORMATS[context.extension]
  const sourceText = requireText(context)
  const parsed = parseOrFail(
    () =>
      context.extension === 'csv'
        ? parseCsv(sourceText, {
            sourceColumn: context.csvSourceColumn,
            targetColumn: context.csvTargetColumn,
          })
        : structured.parser(sourceText),
    `${structured.format.toUpperCase()}_PARSE`,
    structured.format.toUpperCase(),
  )
  const formatMeta = {
    ...(parsed.formatMeta || {}),
    ...(parsed.obsolete?.length ? { poObsolete: parsed.obsolete } : {}),
  }
  return createFromParsed(store, context, parsed, parsed.format || structured.format, {
    formatMeta: Object.keys(formatMeta).length ? formatMeta : undefined,
  })
}

function readPlain(store, context) {
  let content = requireText(context)
  if (MARKDOWN_EXTENSIONS.has(context.extension)) content = stripMarkdown(content)
  else if (context.extension === 'html' || context.extension === 'htm') {
    content = content
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
    content = decodeXml(content)
  }
  return store.createDocument({
    name: context.fileName,
    text: content,
    sourceLang: context.sourceLang,
    targetLang: context.targetLang,
  })
}

function pickReader(context) {
  const { extension, text } = context
  if (BINARY_READERS[extension]) return BINARY_READERS[extension]
  if (extension === 'tmx') return readTmx
  if (LOCALIZATION_EXTENSIONS[extension]) return readLocalization
  if (extension === 'xml' && /<resources\b/i.test(String(text ?? ''))) return readLocalization
  if (STRUCTURED_FORMATS[extension]) return readStructured
  return readPlain
}

export function importFile(store, input = {}) {
  const fileName = cleanName(input.name, '导入文档')
  const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const context = {
    fileName,
    extension,
    text: input.text,
    base64: input.base64,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    importAs: input.importAs,
    csvSourceColumn: input.csvSourceColumn,
    csvTargetColumn: input.csvTargetColumn,
  }
  return pickReader(context)(store, context)
}
