/**
 * Serialisers for the library page: a TM as TMX and a glossary as TBX, CSV
 * or JSON. They are deliberately dependency-free and mirror what the
 * importers already accept, so a CSV round-trip never loses notes.
 */

import { escapeXml } from './xml.js'
import { csvCell } from './text-utils.js'

const CSV_COLUMNS = [
  'source',
  'target',
  'note',
  'sourceLang',
  'caseSensitive',
  'forbidden',
  'preferred',
]

export function glossaryToCsv(entries) {
  const lines = [CSV_COLUMNS.join(',')]
  for (const entry of entries) {
    lines.push(
      [
        csvCell(entry.source),
        csvCell(entry.target),
        csvCell(entry.note || ''),
        csvCell(entry.sourceLang || ''),
        entry.caseSensitive ? 'true' : 'false',
        entry.forbidden ? 'true' : 'false',
        entry.preferred ? 'true' : 'false',
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

export function glossaryToJson(entries) {
  return `${JSON.stringify(
    entries.map((entry) => ({
      source: entry.source,
      target: entry.target,
      note: entry.note || '',
      sourceLang: entry.sourceLang || '',
      caseSensitive: Boolean(entry.caseSensitive),
      forbidden: Boolean(entry.forbidden),
      preferred: Boolean(entry.preferred),
    })),
    null,
    2,
  )}\n`
}

/**
 * TBX-Basic, minimal shape: one termEntry per glossary entry, a langSet per
 * language with a single tig/term, and the note as a descrip. Not every TBX
 * consumer likes the minimal header, but this is what the round-trip test
 * and the requirements doc agreed on (export only, no TBX import).
 */
export function glossaryToTbx(entries, { sourceLang = 'en', targetLang = 'zh-CN' } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tbx style="dca" type="TBX-Basic" xml:lang="${escapeXml(sourceLang)}" version="3">`,
    '  <header>',
    `    <file original="cait" sourceLang="${escapeXml(sourceLang)}" targetLang="${escapeXml(targetLang)}"/>`,
    '  </header>',
    '  <body>',
  ]
  for (const entry of entries) {
    const entryLang = entry.sourceLang || sourceLang
    lines.push(`    <termEntry id="${escapeXml(entry.id)}">`)
    lines.push(`      <langSet xml:lang="${escapeXml(entryLang)}">`)
    lines.push(`        <tig><term>${escapeXml(entry.source)}</term></tig>`)
    lines.push('      </langSet>')
    lines.push(`      <langSet xml:lang="${escapeXml(targetLang)}">`)
    lines.push(`        <tig><term>${escapeXml(entry.target)}</term></tig>`)
    lines.push('      </langSet>')
    if (entry.note) lines.push(`      <descrip type="note">${escapeXml(entry.note)}</descrip>`)
    if (entry.forbidden) lines.push('      <descrip type="status">forbidden</descrip>')
    else if (entry.preferred) lines.push('      <descrip type="status">preferred</descrip>')
    lines.push('    </termEntry>')
  }
  lines.push('  </body>', '</tbx>', '')
  return lines.join('\n')
}
