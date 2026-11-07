/** TMX 1.4 subset: one `<tu>` per translation unit, one `<tuv>` per language. */

import { decodeXml, escapeXml } from './xml.js'
import { CAIT_VERSION } from './store-utils.js'

function attr(attrs, name) {
  const match = String(attrs ?? '').match(
    new RegExp(`(?:^|\\s)(?:xml:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'),
  )
  return match ? decodeXml(match[2] ?? match[3] ?? '') : ''
}

function segText(raw) {
  const cdata = String(raw ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodeXml(cdata.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseTmx(xml) {
  const text = String(xml ?? '')
  const header = text.match(/<header\b([^>]*)>/i)
  const units = []
  let inlineMarkup = 0
  const tuPattern = /<tu\b[^>]*>([\s\S]*?)<\/tu>/gi
  let tu

  while ((tu = tuPattern.exec(text)) !== null) {
    const variants = []
    const tuvPattern = /<tuv\b([^>]*)>([\s\S]*?)<\/tuv>/gi
    let tuv
    while ((tuv = tuvPattern.exec(tu[1])) !== null) {
      const seg = tuv[2].match(/<seg\b[^>]*>([\s\S]*?)<\/seg>/i)
      if (!seg) continue
      // `<bpt>/<ept>/<ph>` encode inline formatting and placeholders in TMX.
      // This subset intentionally imports plain text, so count the opening tags
      // and warn instead of silently pretending the formatting survived.
      inlineMarkup += (seg[1].match(/<(?:bpt|ept|ph)\b[^>]*>/gi) || []).length
      const lang = attr(tuv[1], 'lang')
      const value = segText(seg[1])
      if (value) variants.push({ lang: lang || '', text: value })
    }
    if (variants.length) units.push(variants)
  }

  const sourceLang = attr(header?.[1], 'srclang') || ''
  const languages = [...new Set(units.flat().map((variant) => variant.lang).filter(Boolean))]
  const warnings = inlineMarkup
    ? [
        {
          code: 'TMX_INLINE_MARKUP_LOST',
          count: inlineMarkup,
          message: `TMX 含 ${inlineMarkup} 个内联占位符/格式标签（bpt/ept/ph），导入时已按纯文本处理，格式信息丢失。`,
        },
      ]
    : []

  return {
    sourceLang,
    targetLang: languages.find((lang) => lang !== sourceLang) || '',
    units,
    warnings,
  }
}

export function buildTmx(doc) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tmx version="1.4">',
    `  <header creationtool="CAIT" creationtoolversion="${CAIT_VERSION}" datatype="plaintext" segtype="sentence" adminlang="en" srclang="${escapeXml(doc.sourceLang)}" o-tmf="CAIT" creationdate="${new Date().toISOString()}"/>`,
    '  <body>',
  ]

  for (const segment of doc.segments) {
    lines.push('    <tu>')
    lines.push(`      <tuv xml:lang="${escapeXml(doc.sourceLang)}"><seg>${escapeXml(segment.source)}</seg></tuv>`)
    if (segment.target) {
      lines.push(`      <tuv xml:lang="${escapeXml(doc.targetLang)}"><seg>${escapeXml(segment.target)}</seg></tuv>`)
    }
    lines.push('    </tu>')
  }

  lines.push('  </body>', '</tmx>', '')
  return lines.join('\n')
}

/**
 * TMX for a translation-memory library rather than a document. The importer
 * dedupes by (library, language pair, normalised source), so entries that
 * differ only by library do not need to be disambiguated here.
 */
export function buildTmxForEntries(entries, { sourceLang = 'en', targetLang = 'zh-CN' } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tmx version="1.4">',
    `  <header creationtool="CAIT" creationtoolversion="${CAIT_VERSION}" datatype="plaintext" segtype="sentence" adminlang="en" srclang="${escapeXml(sourceLang)}" o-tmf="CAIT" creationdate="${new Date().toISOString()}"/>`,
    '  <body>',
  ]

  for (const entry of entries) {
    lines.push('    <tu>')
    lines.push(`      <tuv xml:lang="${escapeXml(entry.sourceLang || sourceLang)}"><seg>${escapeXml(entry.source)}</seg></tuv>`)
    lines.push(`      <tuv xml:lang="${escapeXml(entry.targetLang || targetLang)}"><seg>${escapeXml(entry.target)}</seg></tuv>`)
    lines.push('    </tu>')
  }

  lines.push('  </body>', '</tmx>', '')
  return lines.join('\n')
}
