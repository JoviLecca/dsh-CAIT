import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatError } from './errors.js'
import { MAX_DOCX_BASE64, MAX_IMPORT_CHARS, MAX_SEGMENTS, MAX_SEGMENT_CHARS, canonicalLanguage, cleanLang, cleanName, cleanText, csvCell, makeId, mdCell, now, safeBaseName } from './store-utils.js'
import { stripMarkdown } from './markdown.js'
import { DOCX_MIME, buildDocx, buildDocxFromText, parseDocxDetailed } from './docx.js'
import { EPUB_MIME, buildEpub, buildEpubFromText, parseEpub } from './epub.js'
import { PPTX_MIME, buildPptx, parsePptxDetailed } from './pptx.js'
import { XLSX_MIME, buildXlsx, parseXlsx } from './xlsx.js'
import { buildTmx, parseTmx } from './tmx.js'
import { buildHtml, buildJson, buildPo, buildRtf, buildSrt, buildVtt, buildXliff, buildXliff2, parseCsv, parseHtml, parseJson, parsePo, parseRtf, parseSrt, parseVtt, parseXliff } from './formats.js'
import { decodeXml } from './xml.js'

const BINARY_SOURCES = {
  docx: { label: 'DOCX', fallback: 'source.docx' },
  pptx: { label: 'PPTX', fallback: 'source.pptx' },
  epub: { label: 'EPUB', fallback: 'source.epub' },
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
        store.logger?.warn?.(`CAIT: 删除 ${BINARY_SOURCES[kind].label} 源文件失败: ${error.message}`)
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

    for (const variants of parsed.units) {
      const source =
        variants.find((variant) => variant.lang === src) ??
        variants.find((variant) => variant.lang !== tgt) ??
        variants[0]
      if (!source?.text) continue
      const target = variants.find((variant) => variant.lang === tgt)
      pairs.push({ source: source.text, target: target?.text || '', sourceLang: src, targetLang: tgt })
      segments.push({ source: source.text, target: target?.text || '', paragraph: segments.length })
    }

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
  }
,
  importFile({ name, text, base64, sourceLang, targetLang, importAs, csvSourceColumn, csvTargetColumn } = {}) {
    const fileName = cleanName(name, '导入文档')
    const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()

    if (extension === 'docx') {
      if (!base64) throw new CatError('EMPTY_FILE', 'DOCX 文件内容为空。')
      if (base64.length > MAX_DOCX_BASE64) throw new CatError('FILE_TOO_LARGE', 'DOCX 文件过大。')
      const buffer = Buffer.from(base64, 'base64')
      let content
      try {
        content = parseDocxDetailed(buffer)
      } catch (error) {
        throw new CatError('DOCX_PARSE', `DOCX 解析失败: ${error?.message ?? error}`)
      }
      return this.createDocument({
        name: fileName,
        text: content.text,
        paragraphMap: content.paragraphs.map((paragraph) => paragraph.index),
        docxSource: buffer,
        docxName: fileName,
        sourceLang,
        targetLang,
        format: 'docx',
      })
    }

    if (extension === 'epub') {
      if (!base64) throw new CatError('EMPTY_FILE', 'EPUB 文件内容为空。')
      if (base64.length > MAX_DOCX_BASE64) throw new CatError('FILE_TOO_LARGE', 'EPUB 文件过大。')
      const buffer = Buffer.from(base64, 'base64')
      let parsed
      try {
        parsed = parseEpub(buffer)
      } catch (error) {
        if (error instanceof CatError) throw error
        throw new CatError('EPUB_PARSE', `EPUB 解析失败: ${error?.message ?? error}`)
      }
      const created = this.createDocument({
        name: fileName,
        segments: parsed.segments,
        sourceLang: sourceLang || parsed.language,
        targetLang,
        format: 'epub',
        epubSource: buffer,
        epubName: fileName,
      })
      return {
        ...created,
        sourceLang: created.document.sourceLang,
        targetLang: created.document.targetLang,
        units: parsed.segments.length,
        warnings: parsed.warnings ?? [],
      }
    }

    if (extension === 'xlsx' || extension === 'pptx') {
      if (!base64) throw new CatError('EMPTY_FILE', `${extension.toUpperCase()} 文件内容为空。`)
      if (base64.length > MAX_DOCX_BASE64) throw new CatError('FILE_TOO_LARGE', `${extension.toUpperCase()} 文件过大。`)
      const buffer = Buffer.from(base64, 'base64')
      let parsed
      try {
        parsed = extension === 'xlsx' ? parseXlsx(buffer) : parsePptxDetailed(buffer)
      } catch (error) {
        if (error instanceof CatError) throw error
        throw new CatError(
          `${extension.toUpperCase()}_PARSE`,
          `${extension.toUpperCase()} 解析失败: ${error?.message ?? error}`,
        )
      }
      const created = this.createDocument({
        name: fileName,
        segments: parsed.segments,
        sourceLang,
        targetLang,
        format: extension,
        ...(extension === 'pptx' ? { pptxSource: buffer, pptxName: fileName } : {}),
      })
      return {
        ...created,
        sourceLang: created.document.sourceLang,
        targetLang: created.document.targetLang,
        units: parsed.segments.length,
        warnings: parsed.warnings ?? [],
      }
    }

    if (extension === 'tmx') {
      return this.importTmx({
        text,
        name: fileName,
        sourceLang,
        targetLang,
        importAs: importAs || 'document',
      })
    }

    const structured = {
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
    }[extension]
    if (structured) {
      const sourceText = String(text ?? '')
      if (!sourceText.trim()) throw new CatError('EMPTY_FILE', '文件内容为空。')
      if (sourceText.length > MAX_IMPORT_CHARS) throw new CatError('FILE_TOO_LARGE', '文件过大。')
      let parsed
      try {
        parsed = extension === 'csv'
          ? parseCsv(sourceText, { sourceColumn: csvSourceColumn, targetColumn: csvTargetColumn })
          : structured.parser(sourceText)
      } catch (error) {
        if (error instanceof CatError) throw error
        throw new CatError(
          `${structured.format.toUpperCase()}_PARSE`,
          `${structured.format.toUpperCase()} 解析失败: ${error?.message ?? error}`,
        )
      }
      const src = cleanLang(
        sourceLang || parsed.sourceLang || this.settings.sourceLang,
        this.settings.sourceLang,
      )
      const tgt = cleanLang(
        targetLang || parsed.targetLang || this.settings.targetLang,
        this.settings.targetLang,
      )
      const formatMeta = {
        ...(parsed.formatMeta || {}),
        ...(parsed.obsolete?.length ? { poObsolete: parsed.obsolete } : {}),
      }
      const created = this.createDocument({
        name: fileName,
        segments: parsed.segments,
        sourceLang: src,
        targetLang: tgt,
        format: parsed.format || structured.format,
        formatMeta: Object.keys(formatMeta).length ? formatMeta : undefined,
      })
      return {
        ...created,
        sourceLang: src,
        targetLang: tgt,
        units: parsed.segments.length,
        warnings: parsed.warnings,
      }
    }

    let content = String(text ?? '')
    if (!content.trim()) throw new CatError('EMPTY_FILE', '文件内容为空。')
    if (content.length > MAX_IMPORT_CHARS) throw new CatError('FILE_TOO_LARGE', '文件过大。')
    if (extension === 'md' || extension === 'markdown') content = stripMarkdown(content)
    else if (extension === 'html' || extension === 'htm') {
      content = content
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
      content = decodeXml(content)
    }

    return this.createDocument({ name: fileName, text: content, sourceLang, targetLang })
  }
,
  exportDocument({ format = 'bilingual-md', documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const base = safeBaseName(doc.name)
    const targetJoiner = /^(zh|ja|ko)/i.test(doc.targetLang) ? '' : ' '

    const paragraphs = (field, joiner) => {
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

    if (format === 'docx') {
      const grouped = new Map()
      for (const segment of doc.segments) {
        const key = Number.isInteger(segment.paragraph) ? segment.paragraph : 0
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(segment)
      }
      const replacements = new Map()
      for (const [key, segments] of grouped) {
        const translated = segments
          .map((segment) => segment.target)
          .filter(Boolean)
          .join(targetJoiner)
          .trim()
        const fallback = segments
          .map((segment) => segment.source)
          .filter(Boolean)
          .join(' ')
          .trim()
        if (translated || fallback) replacements.set(key, translated || fallback)
      }

      let content = null
      const template = this.readDocxSource(doc)
      if (template) {
        try {
          content = buildDocx(template, replacements)
        } catch (error) {
          this.logger?.warn?.(`CAIT: DOCX 模板套用失败，改用纯文本 DOCX: ${error.message}`)
        }
      }
      if (!content) {
        const paragraphs = [...grouped.keys()]
          .sort((left, right) => left - right)
          .map((key) => replacements.get(key))
          .filter(Boolean)
        content = buildDocxFromText(paragraphs)
      }
      return {
        filename: `${base}.${doc.targetLang}.docx`,
        mime: DOCX_MIME,
        content,
        count: doc.segments.length,
      }
    }

    if (format === 'epub') {
      let content = null
      const template = this.readEpubSource(doc)
      if (template) {
        try {
          content = buildEpub(doc, template)
        } catch (error) {
          this.logger?.warn?.(`CAIT: EPUB 模板套用失败，改用纯文本 EPUB: ${error.message}`)
        }
      }
      if (!content) content = buildEpubFromText(doc)
      return {
        filename: `${base}.${doc.targetLang}.epub`,
        mime: EPUB_MIME,
        content,
        count: doc.segments.length,
      }
    }

    if (format === 'srt') {
      return {
        filename: `${base}.${doc.targetLang}.srt`,
        mime: 'application/x-subrip;charset=utf-8',
        content: buildSrt(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'vtt') {
      return {
        filename: `${base}.${doc.targetLang}.vtt`,
        mime: 'text/vtt;charset=utf-8',
        content: buildVtt(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'po') {
      return {
        filename: `${base}.${doc.targetLang}.po`,
        mime: 'text/x-gettext-translation;charset=utf-8',
        content: buildPo(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'xliff' || format === 'xlf' || format === 'sdlxliff') {
      return {
        filename: `${base}.${doc.targetLang}.${format === 'sdlxliff' ? 'sdlxliff' : 'xliff'}`,
        mime: 'application/x-xliff+xml;charset=utf-8',
        content: buildXliff(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'xliff2') {
      return {
        filename: `${base}.${doc.targetLang}.xliff`,
        mime: 'application/x-xliff+xml;charset=utf-8',
        content: buildXliff2(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'html') {
      return {
        filename: `${base}.${doc.targetLang}.html`,
        mime: 'text/html;charset=utf-8',
        content: buildHtml(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'json-tree' || format === 'json-export') {
      if (!doc.formatMeta?.jsonTemplate) {
        throw new CatError('JSON_TEMPLATE_REQUIRED', '该文档没有 JSON 模板，无法保持 JSON 结构导出。')
      }
      return {
        filename: `${base}.${doc.targetLang}.json`,
        mime: 'application/json;charset=utf-8',
        content: buildJson(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'rtf') {
      return {
        filename: `${base}.${doc.targetLang}.rtf`,
        mime: 'application/rtf;charset=utf-8',
        content: buildRtf(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'xlsx') {
      return {
        filename: `${base}.${doc.targetLang}.xlsx`,
        mime: XLSX_MIME,
        content: buildXlsx(doc),
        count: doc.segments.length,
      }
    }

    if (format === 'pptx') {
      const template = this.readPptxSource(doc)
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
        const byParagraph = replacements.get(slide)
        const text = String(segment.target || segment.source || '').trim()
        byParagraph.set(paragraph, text)
      }
      return {
        filename: `${base}.${doc.targetLang}.pptx`,
        mime: PPTX_MIME,
        content: buildPptx(template, replacements),
        count: doc.segments.length,
      }
    }

    if (format === 'target-txt') {
      return {
        filename: `${base}.${doc.targetLang}.txt`,
        mime: 'text/plain;charset=utf-8',
        content: `${paragraphs('target', targetJoiner)}\n`,
        count: doc.segments.length,
      }
    }

    if (format === 'source-txt') {
      return {
        filename: `${base}.${doc.sourceLang}.txt`,
        mime: 'text/plain;charset=utf-8',
        content: `${paragraphs('source', ' ')}\n`,
        count: doc.segments.length,
      }
    }

    if (format === 'target-md') {
      const content = `# ${doc.name}\n\n> ${doc.targetLang}\n\n${paragraphs('target', targetJoiner)}\n`
      return {
        filename: `${base}.${doc.targetLang}.md`,
        mime: 'text/markdown;charset=utf-8',
        content,
        count: doc.segments.length,
      }
    }

    if (format === 'bilingual-md') {
      const rows = doc.segments.map(
        (segment, index) =>
          `| ${index + 1} | ${mdCell(segment.source)} | ${mdCell(segment.target)} | ${segment.status} |`,
      )
      const content = [
        `# ${doc.name}`,
        '',
        `> ${doc.sourceLang} → ${doc.targetLang} · ${doc.segments.length} segments · ${this.progress(doc).percent}% confirmed`,
        '',
        '| # | Source | Target | Status |',
        '|---:|---|---|---|',
        ...rows,
        '',
      ].join('\n')
      return {
        filename: `${base}.bilingual.md`,
        mime: 'text/markdown;charset=utf-8',
        content,
        count: doc.segments.length,
      }
    }

    if (format === 'bilingual-csv') {
      const rows = doc.segments.map((segment, index) =>
        [index + 1, segment.source, segment.target, segment.status].map(csvCell).join(','),
      )
      return {
        filename: `${base}.bilingual.csv`,
        mime: 'text/csv;charset=utf-8',
        content: `\ufeffIndex,Source,Target,Status\n${rows.join('\n')}\n`,
        count: doc.segments.length,
      }
    }

    if (format === 'tmx') {
      return {
        filename: `${base}.tmx`,
        mime: 'application/xml;charset=utf-8',
        content: buildTmx(doc),
        count: doc.segments.length,
      }
    }

    // Document JSON, not a project backup: only this document's segments are
    // included. Use the snapshot file for libraries/TM/glossary/mounts.
    if (format === 'document-json' || format === 'json') {
      return {
        filename: `${base}.document.json`,
        mime: 'application/json;charset=utf-8',
        content: JSON.stringify(
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
        ),
        count: doc.segments.length,
      }
    }

    throw new CatError('INVALID_EXPORT_FORMAT', `不支持的导出格式: ${format}`)
  }

}
