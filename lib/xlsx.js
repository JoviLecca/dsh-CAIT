import { readZipEntries, writeZip } from './docx.js'
import { CatError } from './errors.js'
import { decodeXml, escapeXml } from './xml.js'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const SOURCE_HEADERS = new Set(['source', 'src', 'original', '原文', '源文', '源文本'])
const TARGET_HEADERS = new Set(['target', 'tgt', 'translation', '译文', '目标', '目标文本'])

function fail(code, message) {
  return new CatError(code, message)
}

function zipText(entries, name) {
  const entry = entries.find((item) => item.name === name)
  return entry ? entry.data.toString('utf8') : ''
}

function attributes(raw) {
  const attrs = {}
  for (const match of String(raw).matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2])
  }
  return attrs
}

function sharedStringTable(xml) {
  if (!xml) return []
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => (
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((text) => decodeXml(text[1]))
      .join('')
  ))
}

function workbookSheets(entries) {
  const workbook = zipText(entries, 'xl/workbook.xml')
  const rels = zipText(entries, 'xl/_rels/workbook.xml.rels')
  const relationMap = new Map(
    [...rels.matchAll(/<Relationship\b([^>]*)\/?>/gi)]
      .map((match) => attributes(match[1]))
      .filter((item) => item.Id && item.Target)
      .map((item) => [item.Id, item.Target]),
  )
  const sheets = []
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const attrs = attributes(match[1])
    const id = attrs['r:id']
    const target = relationMap.get(id)
    if (!target) continue
    const path = target.replace(/^\/+/, '')
    sheets.push({
      name: attrs.name || `Sheet${sheets.length + 1}`,
      path: path.startsWith('xl/') ? path : `xl/${path}`,
    })
  }
  if (sheets.length) return sheets
  return entries
    .map((entry) => entry.name)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/(\d+)\.xml$/)[1]) - Number(right.match(/(\d+)\.xml$/)[1]))
    .map((path, index) => ({ name: `Sheet${index + 1}`, path }))
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let value = 0
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64)
  return value - 1
}

function cellValue(attrs, body, shared) {
  const type = attrs.t || ''
  const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)
  if (type === 'inlineStr' || inline) {
    const source = inline ? inline[1] : body
    return [...source.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((match) => decodeXml(match[1]))
      .join('')
  }
  const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)
  if (!value) return ''
  if (type === 's') return shared[Number(value[1])] ?? ''
  if (type === 'b') return value[1] === '1' ? 'TRUE' : 'FALSE'
  return decodeXml(value[1])
}

function parseRows(xml, shared) {
  const rows = new Map()
  for (const rowMatch of String(xml).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowAttrs = attributes(rowMatch[1])
    const rowNumber = Number(rowAttrs.r) || rows.size + 1
    const cells = new Map()
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = attributes(cellMatch[1])
      if (!attrs.r) continue
      const body = cellMatch[2] ?? ''
      cells.set(columnIndex(attrs.r), {
        cell: attrs.r,
        value: cellValue(attrs, body, shared),
        formula: /<f\b/i.test(body),
      })
    }
    if (cells.size) rows.set(rowNumber, cells)
  }
  return [...rows.entries()].sort((left, right) => left[0] - right[0])
}

export function parseXlsx(buffer) {
  let entries
  try {
    entries = readZipEntries(buffer)
  } catch (error) {
    throw fail('XLSX_PARSE', `XLSX 文件不是有效的 ZIP/Excel 包: ${error.message}`)
  }
  const shared = sharedStringTable(zipText(entries, 'xl/sharedStrings.xml'))
  const sheets = workbookSheets(entries)
  if (!sheets.length) throw fail('XLSX_PARSE', 'XLSX 中找不到工作表。')

  const segments = []
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const sheetXml = zipText(entries, sheet.path)
    if (!sheetXml) continue
    const rows = parseRows(sheetXml, shared)
    if (!rows.length) continue

    const maxColumns = rows.reduce((max, [, cells]) => Math.max(max, ...cells.keys(), -1), -1) + 1
    const first = rows[0][1]
    const header = (index) => String(first.get(index)?.value ?? '').trim().toLowerCase()
    let sourceIndex = -1
    let targetIndex = -1
    for (let index = 0; index < maxColumns; index += 1) {
      if (SOURCE_HEADERS.has(header(index))) sourceIndex = index
      if (TARGET_HEADERS.has(header(index))) targetIndex = index
    }
    const hasHeader = sourceIndex >= 0 && targetIndex >= 0
    if (!hasHeader) {
      sourceIndex = 0
      targetIndex = maxColumns > 1 ? 1 : -1
    }

    for (const [rowNumber, cells] of rows) {
      if (hasHeader && rowNumber === rows[0][0]) continue
      const sourceCell = cells.get(sourceIndex)
      if (!sourceCell || sourceCell.formula) continue
      const source = String(sourceCell.value ?? '').trim()
      if (!source) continue
      const targetCell = targetIndex >= 0 ? cells.get(targetIndex) : null
      const target = targetCell ? String(targetCell.value ?? '').trim() : ''
      segments.push({
        source,
        target,
        paragraph: segments.length,
        meta: {
          format: 'xlsx',
          xlsxRow: rowNumber,
          sheet: sheetIndex + 1,
          sheetName: sheet.name,
          cell: sourceCell.cell,
          ...(targetCell?.cell ? { targetCell: targetCell.cell } : {}),
        },
      })
    }
  }
  if (!segments.length) throw fail('XLSX_NO_UNITS', 'XLSX 中没有可用的源文行。')
  return { format: 'xlsx', segments, warnings: [] }
}

function inlineCell(reference, value) {
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function columnName(index) {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function sheetXml(rows) {
  const sheetData = rows
    .map((cells, index) => `    <row r="${index + 1}">${cells.join('')}</row>`)
    .join('\n')
  const lastRow = Math.max(rows.length, 1)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>
${sheetData}
  </sheetData>
</worksheet>`
}

function safeSheetName(name, used) {
  let base = String(name ?? '').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let candidate = base
  let index = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${index}`
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`
    index += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function replaceCellText(xml, reference, value) {
  const escaped = escapeXml(value)
  const pattern = new RegExp(
    `<c\\b([^>]*\\br="${reference}"[^>]*?)(?:/>|>([\\s\\S]*?)<\\/c>)`,
    'i',
  )
  let found = false
  const output = String(xml).replace(pattern, (all, rawAttrs, body = '') => {
    if (/<f\b/i.test(body)) return all
    found = true
    const attrs = rawAttrs.replace(/\s+t="[^"]*"/gi, '').replace(/\s*\/\s*$/g, '')
    return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`
  })
  return { xml: output, found }
}

/**
 * Write target text back into the original workbook. Rebuilding a workbook
 * drops styles, column widths and merged ranges; patching the source zip keeps
 * everything except the translated cell content intact.
 */
export function patchXlsx(doc, template) {
  let entries
  try {
    entries = readZipEntries(template)
  } catch (error) {
    throw fail('XLSX_SOURCE_INVALID', `XLSX 源文件不是有效的 ZIP/Excel 包: ${error.message}`)
  }
  const sheetPaths = new Map(workbookSheets(entries).map((sheet) => [sheet.name, sheet.path]))
  const bySheet = new Map()
  for (const segment of doc.segments) {
    const sheetName = segment.meta?.sheetName
    const cell = segment.meta?.targetCell
    if (!sheetName || !cell) continue
    if (!bySheet.has(sheetName)) bySheet.set(sheetName, new Map())
    bySheet.get(sheetName).set(cell, String(segment.target || segment.source || ''))
  }

  let patched = 0
  let missing = 0
  const next = entries.map((entry) => {
    const sheetName = [...sheetPaths.entries()].find(([, path]) => path === entry.name)?.[0]
    const replacements = sheetName ? bySheet.get(sheetName) : null
    if (!replacements?.size) return entry
    let xml = entry.data.toString('utf8')
    for (const [cell, text] of replacements) {
      const result = replaceCellText(xml, cell, text)
      xml = result.xml
      if (result.found) patched += 1
      else missing += 1
    }
    return { ...entry, data: Buffer.from(xml, 'utf8') }
  })
  return { buffer: writeZip(next), patched, missing }
}

export function buildXlsx(doc) {
  const groups = new Map()
  for (const segment of doc.segments) {
    const key = segment.meta?.sheetName || `Sheet ${Number(segment.meta?.sheet) || 1}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(segment)
  }
  if (!groups.size) groups.set('Sheet 1', [])

  const used = new Set()
  const sheets = [...groups.entries()].map(([name, segments], index) => ({
    name: safeSheetName(name, used),
    path: `xl/worksheets/sheet${index + 1}.xml`,
    rows: [
      [inlineCell('A1', 'Source'), inlineCell('B1', 'Target')],
      ...segments.map((segment, rowIndex) => [
        inlineCell(`A${rowIndex + 2}`, segment.source || ''),
        inlineCell(`B${rowIndex + 2}`, segment.target || ''),
      ]),
    ],
  }))

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((sheet) => `  <Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((sheet, index) => `  <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    ...sheets.map((sheet) => ({ name: sheet.path, data: Buffer.from(sheetXml(sheet.rows), 'utf8') })),
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') },
  ])
}
