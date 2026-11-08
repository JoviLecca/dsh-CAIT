/**
 * Dependency-free DOCX reader/writer.
 *
 * A .docx is a ZIP whose `word/document.xml` holds the body. Import keeps the
 * original package as a template; export patches only the text nodes of the
 * paragraphs that produced CAIT segments, so paragraph, run, style, numbering
 * and embedded objects from the source file stay intact.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { decodeXml, escapeXml } from './xml.js'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset
  }
  return -1
}

function readZipEntry(buffer, wanted) {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new Error('DOCX 文件不是有效的 ZIP 容器')

  const entries = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) break

    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')

    if (name === wanted) {
      if (buffer.readUInt32LE(localOffset) !== LOCAL) throw new Error('DOCX ZIP 本地头损坏')
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const data = buffer.subarray(start, start + compressedSize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`DOCX 使用了不支持的压缩方式 (${method})`)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  return null
}

function readZipEntries(buffer, label = 'DOCX') {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new Error(`${label} 文件不是有效的 ZIP 容器`)
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) {
      throw new Error(`${label} ZIP 中央目录损坏`)
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')

    if (buffer.readUInt32LE(localOffset) !== LOCAL) throw new Error(`${label} ZIP 本地头损坏`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(start, start + compressedSize)
    let data
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) data = inflateRawSync(compressed)
    else throw new Error(`${label} 使用了不支持的压缩方式 (${method})`)

    entries.push({ name, data, method })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

const CRC_TABLE = (() => {
  const table = new Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

function writeZip(entries) {
  const { time, date } = dosDateTime()
  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    // EPUB requires the `mimetype` entry to be stored (method 0) and first.
    const stored = entry.store === true
    const method = stored ? 0 : 8
    const compressed = stored ? data : deflateRawSync(data)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localChunks.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralChunks.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localChunks, ...centralChunks, end])
}

/**
 * Remove complete `<w:tbl>` blocks before looking for paragraphs. Table cell
 * text is stored in ordinary `<w:p>` elements, so matching the whole document
 * would silently turn table rows into body paragraphs.
 */
function withoutTables(xml) {
  const parts = []
  let depth = 0
  let keepFrom = 0
  let closed = true
  const tags = /<(\/?)w:tbl\b[^>]*>/gi
  let tag

  while ((tag = tags.exec(xml)) !== null) {
    if (tag[1] === '/') {
      if (depth > 0) depth -= 1
      if (depth === 0) {
        keepFrom = tags.lastIndex
        closed = true
      }
    } else {
      if (depth === 0) {
        parts.push(xml.slice(keepFrom, tag.index))
        keepFrom = tags.lastIndex
        closed = false
      }
      depth += 1
    }
  }

  // An unclosed table is malformed; keep only the text before it.
  if (closed) parts.push(xml.slice(keepFrom))
  return parts.join('')
}

function paragraphText(paragraph) {
  let out = ''
  const tokens = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>/g
  let token
  while ((token = tokens.exec(paragraph)) !== null) {
    if (token[1] !== undefined) out += decodeXml(token[1])
    else if (token[0].startsWith('<w:tab')) out += '\t'
    else if (token[0].startsWith('<w:noBreakHyphen')) out += '-'
    else out += '\n'
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Like parseDocx, but also returns the zero-based body paragraph ordinal for
 * every non-empty paragraph. The ordinal counts all `<w:p>` elements outside
 * tables, including empty paragraphs, so it matches the patch traversal.
 */
export function parseDocxDetailed(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error('DOCX 内容为空')
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('DOCX 文件头不是 ZIP')

  const xml = readZipEntry(buffer, 'word/document.xml')
  if (!xml) throw new Error('DOCX 中缺少 word/document.xml')

  const document = xml.toString('utf8')
  const body = document.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i)?.[1] ?? document
  const content = withoutTables(body)
  const paragraphs = []
  const pattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi
  let match
  let paragraphIndex = 0

  while ((match = pattern.exec(content)) !== null) {
    const text = paragraphText(match[1])
    if (text) paragraphs.push({ text, index: paragraphIndex })
    paragraphIndex += 1
  }

  if (!paragraphs.length) {
    const fallback = content.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n')
    const text = decodeXml(fallback.replace(/<[^>]*>/g, '')).replace(/\n{3,}/g, '\n\n').trim()
    if (text) paragraphs.push({ text, index: 0 })
  }

  if (!paragraphs.length) throw new Error('DOCX 中未找到可翻译的文本')
  return {
    text: paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    paragraphs,
  }
}

export function parseDocx(buffer) {
  return parseDocxDetailed(buffer).text
}

/** Read `word/document.xml` as text; used by the export tests. */
export function readDocxXml(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml')
  return xml ? xml.toString('utf8') : null
}

function patchParagraph(paragraph, text) {
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  const matches = [...paragraph.matchAll(token)]
  const chunks = String(text).split(/\r?\n/)
  const content = chunks
    .map((chunk, index) => {
      const run = `<w:t xml:space="preserve">${escapeXml(chunk)}</w:t>`
      return index === 0 ? run : `<w:br/>${run}`
    })
    .join('')

  if (!matches.length) {
    return paragraph.replace(/<\/w:p>\s*$/, `<w:r>${content}</w:r></w:p>`)
  }

  let first = true
  return paragraph.replace(token, () => {
    if (first) {
      first = false
      return content
    }
    return '<w:t xml:space="preserve"></w:t>'
  })
}

function patchBody(body, replacements) {
  const pattern = /<w:tbl\b[^>]*>|<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi
  const parts = []
  let depth = 0
  let paragraphIndex = 0
  let cursor = 0
  let match

  while ((match = pattern.exec(body)) !== null) {
    const tag = match[0]
    if (/^<w:tbl\b/i.test(tag)) {
      depth += 1
      continue
    }
    if (/^<\/w:tbl>/i.test(tag)) {
      if (depth > 0) depth -= 1
      continue
    }
    if (depth > 0) continue

    const replacement = replacements.get(paragraphIndex)
    if (replacement !== undefined) {
      parts.push(body.slice(cursor, match.index))
      parts.push(patchParagraph(tag, replacement))
      cursor = match.index + tag.length
    }
    paragraphIndex += 1
  }

  parts.push(body.slice(cursor))
  return parts.join('')
}

function patchDocumentXml(xml, replacements) {
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i)
  if (!bodyMatch) throw new Error('DOCX 中缺少 w:body')
  const body = bodyMatch[1]
  const openTagEnd = bodyMatch[0].indexOf('>') + 1
  const start = bodyMatch.index + openTagEnd
  return `${xml.slice(0, start)}${patchBody(body, replacements)}${xml.slice(start + body.length)}`
}

/** Patch translated text into the source package, preserving its formatting. */
export function buildDocx(template, replacements) {
  const entries = readZipEntries(template)
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml')
  if (!documentEntry) throw new Error('DOCX 中缺少 word/document.xml')
  const xml = documentEntry.data.toString('utf8')
  const patched = patchDocumentXml(xml, replacements)
  return writeZip(
    entries.map((entry) =>
      entry.name === 'word/document.xml'
        ? { name: entry.name, data: Buffer.from(patched, 'utf8') }
        : entry,
    ),
  )
}

/** Minimal valid DOCX for text-only documents (no source template available). */
export function buildDocxFromText(paragraphs) {
  const body = paragraphs
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`,
    )
    .join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ])
}

export function buildBilingualDocx(segments, { includeStatus = false, title = '' } = {}) {
  const columns = includeStatus ? 3 : 2
  const width = Math.floor(9000 / columns)
  const cell = (text, shaded = false) => {
    const paragraphs = String(text ?? '')
      .split(/\r?\n/)
      .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
      .join('')
    const shade = shaded ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${paragraphs}</w:tc>`
  }
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Source', true)}${cell('Target', true)}${includeStatus ? cell('Status', true) : ''}</w:tr>`
  const body = segments
    .map(
      (segment) =>
        `<w:tr>${cell(segment.source)}${cell(segment.target || '')}${includeStatus ? cell(segment.status || '') : ''}</w:tr>`,
    )
    .join('')
  const titleXml = title
    ? `<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>`
    : ''
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${titleXml}<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${header}${body}</w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ])
}

export { readZipEntries, writeZip }
