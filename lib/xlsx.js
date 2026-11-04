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

function firstSheetPath(entries) {
  const workbook = zipText(entries, 'xl/workbook.xml')
  const rels = zipText(entries, 'xl/_rels/workbook.xml.rels')
  if (workbook && rels) {
    const sheet = workbook.match(/<sheet\b([^>]*)\/?>/i)
    const id = sheet ? attributes(sheet[1])['r:id'] : ''
    if (id) {
      const relation = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/gi)]
        .map((match) => attributes(match[1]))
        .find((item) => item.Id === id)
      if (relation?.Target) {
        const target = relation.Target.replace(/^\/+/, '')
        return target.startsWith('xl/') ? target : `xl/${target}`
      }
    }
  }
  const fallback = entries.find((item) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(item.name))
  return fallback?.name ?? 'xl/worksheets/sheet1.xml'
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
      cells.set(columnIndex(attrs.r), cellValue(attrs, cellMatch[2] ?? '', shared))
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
  const sheetPath = firstSheetPath(entries)
  const sheetXml = zipText(entries, sheetPath)
  if (!sheetXml) throw fail('XLSX_PARSE', 'XLSX 中找不到工作表。')
  const rows = parseRows(sheetXml, shared)
  if (!rows.length) throw fail('XLSX_NO_UNITS', 'XLSX 中没有可用的行。')

  const maxColumns = rows.reduce((max, [, cells]) => Math.max(max, ...cells.keys(), -1), -1) + 1
  const first = rows[0][1]
  const header = (index) => String(first.get(index) ?? '').trim().toLowerCase()
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

  const segments = []
  for (const [rowNumber, cells] of rows) {
    if (hasHeader && rowNumber === rows[0][0]) continue
    const source = String(cells.get(sourceIndex) ?? '').trim()
    if (!source) continue
    const target = targetIndex >= 0 ? String(cells.get(targetIndex) ?? '').trim() : ''
    segments.push({
      source,
      target,
      paragraph: segments.length,
      meta: { format: 'xlsx', xlsxRow: rowNumber },
    })
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

export function buildXlsx(doc) {
  const rows = [[
    inlineCell('A1', 'Source'),
    inlineCell('B1', 'Target'),
  ]]
  doc.segments.forEach((segment, index) => {
    const row = index + 2
    rows.push([
      inlineCell(`A${row}`, segment.source || ''),
      inlineCell(`B${row}`, segment.target || ''),
    ])
  })
  const sheetData = rows
    .map((cells, index) => `    <row r="${index + 1}">${cells.join('')}</row>`)
    .join('\n')
  const lastRow = rows.length + 1
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>
${sheetData}
  </sheetData>
</worksheet>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="CAIT" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
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
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') },
  ])
}
