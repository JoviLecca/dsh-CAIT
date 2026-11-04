import { readZipEntries, writeZip } from './docx.js'
import { CatError } from './errors.js'
import { decodeXml, escapeXml } from './xml.js'

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function fail(code, message) {
  return new CatError(code, message)
}

function slideNames(entries) {
  return entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/(\d+)\.xml$/)[1]) - Number(right.match(/(\d+)\.xml$/)[1]))
}

function paragraphText(paragraph) {
  return [...String(paragraph).matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join('')
}

export function parsePptxDetailed(buffer) {
  let entries
  try {
    entries = readZipEntries(buffer)
  } catch (error) {
    throw fail('PPTX_PARSE', `PPTX 文件不是有效的 ZIP/PowerPoint 包: ${error.message}`)
  }
  const names = slideNames(entries)
  if (!names.length) throw fail('PPTX_PARSE', 'PPTX 中找不到幻灯片。')
  const segments = []
  for (const name of names) {
    const xml = entries.find((entry) => entry.name === name)?.data.toString('utf8') ?? ''
    let index = 0
    for (const match of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi)) {
      const source = paragraphText(match[1]).trim()
      const slideParagraph = index
      index += 1
      if (!source) continue
      segments.push({
        source,
        target: '',
        paragraph: segments.length,
        meta: { format: 'pptx', pptxSlide: name, pptxParagraph: slideParagraph },
      })
    }
  }
  if (!segments.length) throw fail('PPTX_NO_UNITS', 'PPTX 中没有可用的正文文本。')
  return { format: 'pptx', segments, warnings: [] }
}

function patchParagraph(paragraph, text) {
  let replaced = false
  return String(paragraph).replace(/<a:t\b([^>]*)>([\s\S]*?)<\/a:t>/gi, (all, attrs) => {
    if (replaced) return `<a:t${attrs}></a:t>`
    replaced = true
    return `<a:t${attrs}>${escapeXml(text)}</a:t>`
  })
}

function patchSlideXml(xml, replacements) {
  let index = 0
  return String(xml).replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/gi, (paragraph) => {
    const current = index
    index += 1
    if (!replacements.has(current)) return paragraph
    return patchParagraph(paragraph, replacements.get(current))
  })
}

export function buildPptx(template, replacements) {
  let entries
  try {
    entries = readZipEntries(template)
  } catch (error) {
    throw fail('PPTX_TEMPLATE_INVALID', `PPTX 源模板损坏: ${error.message}`)
  }
  const patched = entries.map((entry) => {
    const byParagraph = replacements.get(entry.name)
    if (!byParagraph) return entry
    return {
      ...entry,
      data: Buffer.from(patchSlideXml(entry.data.toString('utf8'), byParagraph), 'utf8'),
    }
  })
  return writeZip(patched)
}
