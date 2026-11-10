/**
 * Dependency-free EPUB 3 reader/writer.
 *
 * EPUB is a ZIP package of XHTML documents listed in an OPF spine. Import
 * walks the spine, scans each chapter into inline runs and stores the run
 * ordinal in segment metadata. Export re-reads the untouched source package
 * and replaces exactly those runs, so CSS, images, navigation and any chapter
 * without translations survive byte-for-byte.
 *
 * PDF is intentionally not supported: fixed-layout pages have no reliable
 * reading order or text flow, which makes them unsuitable for CAT work.
 */
import { posix } from 'node:path'
import { CatError } from './errors.js'
import { readZipEntries, writeZip } from './docx.js'
import { parseHtmlBlocks, patchHtmlRuns, renderHtmlTokens } from './html.js'
import { decodeXml, escapeXml } from './xml.js'

export const EPUB_MIME = 'application/epub+zip'

function readAttribute(source, name) {
  const match = String(source ?? '').match(
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`, 'i'),
  )
  return match ? decodeXml(match[1]) : ''
}

function lookupEntry(entriesByName, name) {
  const normalized = String(name ?? '').replace(/^\.\//, '')
  let decoded = normalized
  try {
    decoded = decodeURIComponent(normalized)
  } catch {
    // A stray percent sign is not valid URI escaping; keep the literal path.
  }
  return (
    entriesByName.get(normalized) ??
    entriesByName.get(decoded) ??
    [...entriesByName.values()].find(
      (item) => item.name.toLowerCase() === normalized.toLowerCase(),
    ) ??
    null
  )
}

function readTextEntry(entries, name) {
  const entry = lookupEntry(entries, name)
  return entry ? entry.data.toString('utf8') : ''
}

function resolveHref(baseDir, href) {
  let clean = String(href ?? '')
    .split('#')[0]
    .replace(/\\/g, '/')
  try {
    clean = decodeURIComponent(clean)
  } catch {
    // A stray percent sign is not valid URI escaping; keep the literal path.
  }
  clean = clean.replace(/^\.\//, '')
  if (!clean) return ''
  const resolved = baseDir ? posix.join(baseDir, clean) : clean
  return posix.normalize(resolved).replace(/^\.\//, '')
}

function parseContainer(xml) {
  const match = String(xml ?? '').match(
    /<(?:[\w.-]+:)?rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i,
  )
  return match ? decodeXml(match[1]) : ''
}

function parseOpf(xml) {
  const manifest = new Map()
  for (const match of String(xml ?? '').matchAll(/<(?:[\w.-]+:)?item\b([^>]*?)\/?>/gi)) {
    const attrs = match[1]
    const id = readAttribute(attrs, 'id')
    const href = readAttribute(attrs, 'href')
    if (!id || !href) continue
    manifest.set(id, {
      href,
      mediaType: readAttribute(attrs, 'media-type'),
      properties: readAttribute(attrs, 'properties'),
    })
  }

  const spineBlock = String(xml ?? '').match(
    /<(?:[\w.-]+:)?spine\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?spine>/i,
  )
  const spine = []
  if (spineBlock) {
    for (const match of spineBlock[1].matchAll(/<(?:[\w.-]+:)?itemref\b([^>]*?)\/?>/gi)) {
      const idref = readAttribute(match[1], 'idref')
      if (idref) spine.push(idref)
    }
  }

  const titleMatch = String(xml ?? '').match(
    /<(?:[\w.-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?title>/i,
  )
  const languageMatch = String(xml ?? '').match(
    /<(?:[\w.-]+:)?language\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?language>/i,
  )

  return {
    title: titleMatch ? decodeXml(titleMatch[1]).trim() : '',
    language: languageMatch ? decodeXml(languageMatch[1]).trim() : '',
    manifest,
    spine,
  }
}

function readPackage(buffer) {
  let entries
  try {
    entries = readZipEntries(buffer, 'EPUB')
  } catch (error) {
    throw new CatError('EPUB_PARSE', `EPUB 解析失败: ${error?.message ?? error}`)
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const container = readTextEntry(byName, 'META-INF/container.xml')
  if (!container) throw new CatError('EPUB_PARSE', 'EPUB 缺少 META-INF/container.xml。')
  const opfPath = parseContainer(container)
  if (!opfPath) throw new CatError('EPUB_PARSE', 'EPUB 的 container.xml 中没有 rootfile。')
  const opf = readTextEntry(byName, opfPath)
  if (!opf) throw new CatError('EPUB_PARSE', `EPUB 缺少 OPF 文件: ${opfPath}`)
  return {
    entries,
    byName,
    opfPath,
    opfDir: posix.dirname(opfPath) === '.' ? '' : posix.dirname(opfPath),
    package: parseOpf(opf),
  }
}

function chapterHref(baseDir, item) {
  return resolveHref(baseDir, item.href)
}

function isHtmlItem(item) {
  const type = String(item.mediaType || '').toLowerCase()
  if (type) return type === 'application/xhtml+xml' || type === 'text/html'
  return /\.x?html?$/i.test(item.href || '')
}

/**
 * Parse an EPUB package into CAIT segments.
 * Returns title/language so a fresh document inherits the book metadata.
 */
export function parseEpub(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new CatError('EPUB_PARSE', 'EPUB 文件内容为空。')
  }
  const { byName, opfDir, package: pkg } = readPackage(buffer)
  if (!pkg.spine.length) throw new CatError('EPUB_PARSE', 'EPUB 的 OPF 中没有 spine 书脊。')

  const segments = []
  const warnings = []
  const chapters = []

  for (const idref of pkg.spine) {
    const item = pkg.manifest.get(idref)
    if (!item || !isHtmlItem(item)) continue
    if (/\bnav\b/i.test(item.properties || '')) continue
    const href = chapterHref(opfDir, item)
    const html = readTextEntry(byName, href)
    if (!html) {
      warnings.push(`EPUB 章节缺失，已跳过: ${href}`)
      continue
    }
    const parsed = parseHtmlBlocks(html)
    let imported = 0
    for (const run of parsed.runs) {
      segments.push({
        source: run.text,
        target: '',
        paragraph: segments.length,
        meta: {
          format: 'epub',
          epubHref: href.slice(0, 500),
          epubBlock: run.index,
          ...(run.tokens.length ? { inline: run.tokens } : {}),
        },
      })
      imported += 1
    }
    if (imported) chapters.push({ href, units: imported })

    if (!parsed.runs.length) {
      warnings.push(`EPUB 章节没有可翻译的正文，已跳过: ${href}`)
    }
  }

  if (!segments.length) throw new CatError('EPUB_NO_UNITS', 'EPUB 中没有可翻译的正文。')
  return {
    title: pkg.title,
    language: pkg.language,
    segments,
    chapters,
    warnings,
  }
}

function segmentSource(segment) {
  return String(segment?.source ?? '')
}

function translatedHtml(segment) {
  const tokens = Array.isArray(segment?.meta?.inline) ? segment.meta.inline : []
  let value = String(segment?.target ?? '')
  if (!value) value = segmentSource(segment)
  else if (tokens.some((item) => !value.includes(item.token))) value = segmentSource(segment)
  return renderHtmlTokens(value, tokens)
}

/**
 * Patch translated text into the original package. Falls back to the caller
 * when the package no longer matches the stored segment metadata.
 */
export function buildEpub(doc, template) {
  const { entries, byName, opfDir, package: pkg } = readPackage(template)
  const groups = new Map()
  const known = new Map(
    [...pkg.manifest.values()]
      .map((item) => [chapterHref(opfDir, item), item])
      .filter(([href]) => href),
  )

  for (const segment of doc.segments) {
    const href = segment?.meta?.epubHref
    const block = Number(segment?.meta?.epubBlock)
    if (typeof href !== 'string' || !href || !Number.isInteger(block) || block < 0) continue
    if (!known.has(href)) continue
    if (!groups.has(href)) groups.set(href, new Map())
    groups.get(href).set(block, translatedHtml(segment))
  }

  if (!groups.size) throw new Error('EPUB 源文件中没有可回写的章节')

  let patched = 0
  for (const [href, replacements] of groups) {
    const entry = lookupEntry(byName, href)
    if (!entry) continue
    const source = entry.data.toString('utf8')
    entry.data = Buffer.from(patchHtmlRuns(source, replacements), 'utf8')
    patched += 1
  }
  if (!patched) throw new Error('EPUB 源文件中没有可回写的章节')

  return writeZip(
    entries.map((entry) => ({
      ...entry,
      store: entry.name === 'mimetype',
    })),
  )
}

function paragraphText(doc, joiner) {
  const groups = new Map()
  for (const segment of doc.segments) {
    const key = segment.paragraph ?? 0
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(segment)
  }
  return [...groups.values()]
    .map((parts) =>
      parts
        .map((segment) => translatedHtml(segment))
        .filter(Boolean)
        .join(joiner)
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

/** Build a minimal, valid EPUB 3 package when no source package is available. */
export function buildEpubFromText(doc) {
  const lang = escapeXml(doc.targetLang || 'en')
  const title = escapeXml(doc.name || 'CAIT export')
  const identifier = escapeXml(`urn:cait:${doc.id || 'export'}`)
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const body = paragraphText(doc, ' ')
    .split('\n')
    .filter(Boolean)
    .map((paragraph) => `    <p>${paragraph}</p>`)
    .join('\n')

  const chapter = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">`,
    '  <head>',
    '    <meta charset="utf-8"/>',
    `    <title>${title}</title>`,
    '  </head>',
    '  <body>',
    body || '    <p></p>',
    '  </body>',
    '</html>',
    '',
  ].join('\n')

  const nav = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">`,
    '  <head>',
    '    <meta charset="utf-8"/>',
    `    <title>${title}</title>`,
    '  </head>',
    '  <body>',
    '    <nav epub:type="toc" id="toc">',
    '      <h1>Contents</h1>',
    '      <ol>',
    '        <li><a href="chapter.xhtml">1</a></li>',
    '      </ol>',
    '    </nav>',
    '  </body>',
    '</html>',
    '',
  ].join('\n')

  const opf = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="cait-id">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `    <dc:identifier id="cait-id">${identifier}</dc:identifier>`,
    `    <dc:title>${title}</dc:title>`,
    `    <dc:language>${lang}</dc:language>`,
    `    <meta property="dcterms:modified">${modified}</meta>`,
    '  </metadata>',
    '  <manifest>',
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>',
    '  </manifest>',
    '  <spine>',
    '    <itemref idref="chapter"/>',
    '  </spine>',
    '</package>',
    '',
  ].join('\n')

  return writeZip([
    { name: 'mimetype', data: Buffer.from(EPUB_MIME, 'utf8'), store: true },
    {
      name: 'META-INF/container.xml',
      data: Buffer.from(
        [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">',
          '  <rootfiles>',
          '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>',
          '  </rootfiles>',
          '</container>',
          '',
        ].join('\n'),
        'utf8',
      ),
    },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf, 'utf8') },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(nav, 'utf8') },
    { name: 'OEBPS/chapter.xhtml', data: Buffer.from(chapter, 'utf8') },
  ])
}
