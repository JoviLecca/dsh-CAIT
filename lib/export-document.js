/**
 * Export adapters, one per format.
 *
 * Every adapter takes the store, the document and the requested format name,
 * and returns the same shape: `{ filename, mime, content, count }`. The
 * dispatcher in `file-ops.js` only looks the adapter up, so adding a
 * format means adding one entry here and nothing else.
 *
 * Formats that need the original file (docx/epub/xlsx/pptx templates) read it
 * from the store and fall back to a generated document when the template is
 * missing or cannot be patched.
 */
import { CatError } from './errors.js'
import { csvCell, mdCell, now, safeBaseName } from './text-utils.js'
import { DOCX_MIME, buildBilingualDocx, buildDocx, buildDocxFromText } from './docx.js'
import { EPUB_MIME, buildEpub, buildEpubFromText } from './epub.js'
import { PPTX_MIME, buildPptx } from './pptx.js'
import { XLSX_MIME, buildXlsx, patchXlsx } from './xlsx.js'
import { buildTmx } from './tmx.js'
import {
  buildHtml,
  buildJson,
  buildPo,
  buildRtf,
  buildSrt,
  buildVtt,
  buildXliff,
  buildXliff2,
  buildXliffReview,
} from './formats.js'
import { LOCALIZATION_EXPORT, buildLocalization } from './localization.js'

const XLIFF_MIME = 'application/x-xliff+xml;charset=utf-8'
const MARKDOWN_MIME = 'text/markdown;charset=utf-8'
const JSON_MIME = 'application/json;charset=utf-8'
const PLAIN_MIME = 'text/plain;charset=utf-8'

const translationJoiner = (doc) => (/^(zh|ja|ko)/i.test(doc.targetLang) ? '' : ' ')

/** Paragraph-grouped text, the shape the plain text and markdown exports want. */
function paragraphsOf(doc, field, joiner) {
  const groups = new Map()
  for (const segment of doc.segments) {
    const key = segment.paragraph ?? 0
    if (!groups.has(key)) groups.set(key, [])
    if (segment[field]) groups.get(key).push(segment[field])
  }
  return [...groups.values()]
    .map((parts) => parts.join(joiner).trim())
    .filter(Boolean)
    .join('\n\n')
}

function output(doc, filename, mime, content) {
  return { filename, mime, content, count: doc.segments.length }
}

function exportDocx(store, doc) {
  const base = safeBaseName(doc.name)
  const joiner = translationJoiner(doc)
  const grouped = new Map()
  const byPart = new Map()
  let hasPartMeta = false
  for (const [index, segment] of doc.segments.entries()) {
    const meta = segment.meta && typeof segment.meta === 'object' ? segment.meta : null
    const part = meta?.docxPart || 'word/document.xml'
    const ordinal = Number.isInteger(meta?.docxParagraph)
      ? meta.docxParagraph
      : Number.isInteger(segment.paragraph)
        ? segment.paragraph
        : index
    if (meta?.docxPart && Number.isInteger(meta?.docxParagraph)) hasPartMeta = true
    const key = `${part}\u0000${ordinal}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(segment)
    if (!byPart.has(part)) byPart.set(part, new Map())
    const partMap = byPart.get(part)
    if (!partMap.has(ordinal)) partMap.set(ordinal, [])
    partMap.get(ordinal).push(segment)
  }
  const combine = (segments) => {
    const translated = segments
      .map((segment) => segment.target)
      .filter(Boolean)
      .join(joiner)
      .trim()
    const fallback = segments
      .map((segment) => segment.source)
      .filter(Boolean)
      .join(' ')
      .trim()
    return translated || fallback
  }
  const replacements = new Map()
  for (const [key, segments] of grouped) {
    const ordinal = Number(key.split('\u0000')[1])
    const text = combine(segments)
    if (text) replacements.set(ordinal, text)
  }
  for (const partMap of byPart.values()) {
    for (const [ordinal, segments] of partMap) {
      const text = combine(segments)
      if (text) partMap.set(ordinal, text)
      else partMap.delete(ordinal)
    }
  }

  let content = null
  const template = store.readDocxSource(doc)
  if (template) {
    try {
      content = hasPartMeta ? buildDocx(template, null, byPart) : buildDocx(template, replacements)
    } catch (error) {
      store.logger?.warn?.(`CAIT: DOCX 模板套用失败，改用纯文本 DOCX: ${error.message}`)
    }
  }
  if (!content) {
    const paragraphs = [...grouped.keys()]
      .sort((left, right) => {
        const [leftPart, leftOrdinal] = left.split('\u0000')
        const [rightPart, rightOrdinal] = right.split('\u0000')
        if (leftPart !== rightPart) return leftPart.localeCompare(rightPart)
        return Number(leftOrdinal) - Number(rightOrdinal)
      })
      .map((key) => replacements.get(Number(key.split('\u0000')[1])))
      .filter(Boolean)
    content = buildDocxFromText(paragraphs)
  }
  return output(doc, `${base}.${doc.targetLang}.docx`, DOCX_MIME, content)
}

function exportBilingualDocx(store, doc) {
  const base = safeBaseName(doc.name)
  const content = buildBilingualDocx(doc.segments, { includeStatus: true, title: doc.name })
  return output(doc, `${base}.bilingual.docx`, DOCX_MIME, content)
}

function exportEpub(store, doc) {
  const base = safeBaseName(doc.name)
  let content = null
  const template = store.readEpubSource(doc)
  if (template) {
    try {
      content = buildEpub(doc, template)
    } catch (error) {
      store.logger?.warn?.(`CAIT: EPUB 模板套用失败，改用纯文本 EPUB: ${error.message}`)
    }
  }
  if (!content) content = buildEpubFromText(doc)
  return output(doc, `${base}.${doc.targetLang}.epub`, EPUB_MIME, content)
}

function exportLocalization(store, doc, format) {
  const target = LOCALIZATION_EXPORT[format]
  const base = safeBaseName(doc.name)
  return output(
    doc,
    `${base}.${doc.targetLang}.${target.extension}`,
    target.mime,
    buildLocalization(doc, format),
  )
}

function exportXliff(store, doc, format) {
  const base = safeBaseName(doc.name)
  const extension = format === 'sdlxliff' ? 'sdlxliff' : 'xliff'
  return output(doc, `${base}.${doc.targetLang}.${extension}`, XLIFF_MIME, buildXliff(doc))
}

function exportXliffReview(store, doc) {
  const base = safeBaseName(doc.name)
  return output(doc, `${base}.review.xliff`, XLIFF_MIME, buildXliffReview(doc))
}

function exportXliff2(store, doc) {
  const base = safeBaseName(doc.name)
  return output(doc, `${base}.${doc.targetLang}.xliff`, XLIFF_MIME, buildXliff2(doc))
}

function exportJsonTree(store, doc) {
  if (!doc.formatMeta?.jsonTemplate) {
    throw new CatError('JSON_TEMPLATE_REQUIRED', '该文档没有 JSON 模板，无法保持 JSON 结构导出。')
  }
  const base = safeBaseName(doc.name)
  return output(doc, `${base}.${doc.targetLang}.json`, JSON_MIME, buildJson(doc))
}

function exportXlsx(store, doc) {
  const base = safeBaseName(doc.name)
  const source = store.readXlsxSource(doc)
  const patched = source ? patchXlsx(doc, source) : null
  return output(
    doc,
    `${base}.${doc.targetLang}.xlsx`,
    XLSX_MIME,
    patched ? patched.buffer : buildXlsx(doc),
  )
}

function exportPptx(store, doc) {
  const template = store.readPptxSource(doc)
  if (!template) {
    throw new CatError(
      'PPTX_SOURCE_REQUIRED',
      '该文档没有保留 PPTX 源文件，无法按原版式导出；请重新导入 PPTX 后再导出。',
      409,
    )
  }
  const replacements = new Map()
  for (const segment of doc.segments) {
    const slide = segment.meta?.pptxSlide
    const paragraph = Number(segment.meta?.pptxParagraph)
    if (!slide || !Number.isInteger(paragraph)) continue
    if (!replacements.has(slide)) replacements.set(slide, new Map())
    replacements.get(slide).set(paragraph, String(segment.target || segment.source || '').trim())
  }
  const base = safeBaseName(doc.name)
  return output(doc, `${base}.${doc.targetLang}.pptx`, PPTX_MIME, buildPptx(template, replacements))
}

function exportTmx(store, doc) {
  const base = safeBaseName(doc.name)
  return output(doc, `${base}.tmx`, 'application/xml;charset=utf-8', buildTmx(doc))
}

function exportDocumentJson(store, doc) {
  const base = safeBaseName(doc.name)
  // Document JSON, not a project backup: only this document's segments are
  // included. Use the snapshot file for libraries/TM/glossary/mounts.
  const content = JSON.stringify(
    {
      format: 'cait-document',
      version: 1,
      exportedAt: now(),
      document: {
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        segments: doc.segments.map((segment, index) => ({
          index: index + 1,
          source: segment.source,
          target: segment.target,
          status: segment.status,
          paragraph: segment.paragraph,
        })),
      },
    },
    null,
    2,
  )
  return output(doc, `${base}.document.json`, JSON_MIME, content)
}

/** One-line builders: same text pipeline, different wrapper and mime type. */
const TEXT_EXPORTS = {
  srt: {
    extension: (doc) => `${doc.targetLang}.srt`,
    mime: 'application/x-subrip;charset=utf-8',
    build: (store, doc) => buildSrt(doc),
  },
  vtt: {
    extension: (doc) => `${doc.targetLang}.vtt`,
    mime: 'text/vtt;charset=utf-8',
    build: (store, doc) => buildVtt(doc),
  },
  po: {
    extension: (doc) => `${doc.targetLang}.po`,
    mime: 'text/x-gettext-translation;charset=utf-8',
    build: (store, doc) => buildPo(doc),
  },
  html: {
    extension: (doc) => `${doc.targetLang}.html`,
    mime: 'text/html;charset=utf-8',
    build: (store, doc) => buildHtml(doc),
  },
  rtf: {
    extension: (doc) => `${doc.targetLang}.rtf`,
    mime: 'application/rtf;charset=utf-8',
    build: (store, doc) => buildRtf(doc),
  },
  'target-txt': {
    extension: (doc) => `${doc.targetLang}.txt`,
    mime: PLAIN_MIME,
    build: (store, doc) => `${paragraphsOf(doc, 'target', translationJoiner(doc))}\n`,
  },
  'source-txt': {
    extension: (doc) => `${doc.sourceLang}.txt`,
    mime: PLAIN_MIME,
    build: (store, doc) => `${paragraphsOf(doc, 'source', ' ')}\n`,
  },
  'target-md': {
    extension: (doc) => `${doc.targetLang}.md`,
    mime: MARKDOWN_MIME,
    build: (store, doc) =>
      `# ${doc.name}\n\n> ${doc.targetLang}\n\n${paragraphsOf(doc, 'target', translationJoiner(doc))}\n`,
  },
  'bilingual-md': {
    extension: () => 'bilingual.md',
    mime: MARKDOWN_MIME,
    build: (store, doc) =>
      [
        `# ${doc.name}`,
        '',
        `> ${doc.sourceLang} → ${doc.targetLang} · ${doc.segments.length} segments · ${store.progress(doc).percent}% confirmed`,
        '',
        '| # | Source | Target | Status |',
        '|---:|---|---|---|',
        ...doc.segments.map(
          (segment, index) =>
            `| ${index + 1} | ${mdCell(segment.source)} | ${mdCell(segment.target)} | ${segment.status} |`,
        ),
        '',
      ].join('\n'),
  },
  'bilingual-csv': {
    extension: () => 'bilingual.csv',
    mime: 'text/csv;charset=utf-8',
    build: (store, doc) => {
      const rows = doc.segments.map((segment, index) =>
        [index + 1, segment.source, segment.target, segment.status].map(csvCell).join(','),
      )
      return `\ufeffIndex,Source,Target,Status\n${rows.join('\n')}\n`
    },
  },
}

function exportText(store, doc, format) {
  const adapter = TEXT_EXPORTS[format]
  const base = safeBaseName(doc.name)
  const name = `${base}.${adapter.extension(doc)}`
  return output(doc, name, adapter.mime, adapter.build(store, doc))
}

/** Format name → adapter. Aliases share one adapter; the adapter sees the name. */
export const EXPORTERS = {
  docx: exportDocx,
  'bilingual-docx': exportBilingualDocx,
  epub: exportEpub,
  xliff: exportXliff,
  xlf: exportXliff,
  sdlxliff: exportXliff,
  'xliff-review': exportXliffReview,
  xliff2: exportXliff2,
  'json-tree': exportJsonTree,
  'json-export': exportJsonTree,
  xlsx: exportXlsx,
  pptx: exportPptx,
  tmx: exportTmx,
  'document-json': exportDocumentJson,
  json: exportDocumentJson,
  ...Object.fromEntries(
    Object.keys(TEXT_EXPORTS).map((format) => [
      format,
      (store, doc) => exportText(store, doc, format),
    ]),
  ),
  ...Object.fromEntries(
    Object.keys(LOCALIZATION_EXPORT).map((format) => [
      format,
      (store, doc) => exportLocalization(store, doc, format),
    ]),
  ),
}

export function exportFormat(store, doc, format) {
  const adapter = EXPORTERS[format]
  if (!adapter) throw new CatError('INVALID_EXPORT_FORMAT', `不支持的导出格式: ${format}`)
  return adapter(store, doc)
}
