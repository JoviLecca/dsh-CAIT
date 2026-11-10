import assert from 'node:assert/strict'

import { buildXlsx, parseXlsx, patchXlsx } from '../lib/xlsx.js'
import { parsePptxDetailed } from '../lib/pptx.js'
import { readZipEntries, writeZip } from '../lib/docx.js'

const workbook = buildXlsx({
  segments: [
    { source: 'Alpha', target: '阿尔法', meta: { sheetName: 'Terms', sheet: 1, xlsxRow: 2 } },
    { source: 'Beta', target: '贝塔', meta: { sheetName: 'Terms', sheet: 1, xlsxRow: 3 } },
    { source: 'Gamma', target: '伽马', meta: { sheetName: 'UI', sheet: 2, xlsxRow: 2 } },
  ],
})
const parsed = parseXlsx(workbook)
assert.equal(parsed.segments.length, 3)
assert.deepEqual(
  parsed.segments.map((segment) => segment.meta.sheetName),
  ['Terms', 'Terms', 'UI'],
)
assert.deepEqual(
  parsed.segments.map((segment) => segment.target),
  ['阿尔法', '贝塔', '伽马'],
)
assert.equal(parsed.segments[2].meta.sheet, 2)

const styledSheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1">
    <c r="A1" t="inlineStr"><is><t>Hello</t></is></c>
    <c r="B1" s="3" t="inlineStr"><is><t>Old</t></is></c>
  </row></sheetData>
  <mergeCells count="1"><mergeCell ref="B1:C1"/></mergeCells>
</worksheet>`
const styledWorkbook = writeZip([
  {
    name: 'xl/workbook.xml',
    data: Buffer.from(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
  },
  {
    name: 'xl/_rels/workbook.xml.rels',
    data: Buffer.from(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
  },
  { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(styledSheet) },
])
const styledParsed = parseXlsx(styledWorkbook)
assert.equal(styledParsed.segments[0].meta.cell, 'A1')
assert.equal(styledParsed.segments[0].meta.targetCell, 'B1')
const patched = patchXlsx(
  {
    segments: [
      {
        source: 'Hello',
        target: 'Bonjour',
        meta: { sheetName: 'Sheet1', cell: 'A1', targetCell: 'B1' },
      },
    ],
  },
  styledWorkbook,
)
assert.equal(patched.patched, 1)
const patchedSheet = readZipEntries(patched.buffer)
  .find((entry) => entry.name === 'xl/worksheets/sheet1.xml')
  .data.toString('utf8')
assert.match(patchedSheet, /<c r="B1" s="3" t="inlineStr">/)
assert.match(patchedSheet, /Bonjour/)
assert.match(patchedSheet, /<mergeCell ref="B1:C1"\/>/)

const notesSlide = `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Speaker note.</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`
const slide = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Slide body.</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
const pptx = writeZip([
  { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide, 'utf8') },
  { name: 'ppt/notesSlides/notesSlide1.xml', data: Buffer.from(notesSlide, 'utf8') },
])
const presentation = parsePptxDetailed(pptx)
assert.equal(presentation.segments.length, 2)
assert.equal(presentation.segments[0].source, 'Slide body.')
assert.equal(presentation.segments[1].source, 'Speaker note.')
assert.equal(presentation.segments[1].meta.context, 'notes')
assert.equal(presentation.segments[1].meta.pptxSlide, 'ppt/notesSlides/notesSlide1.xml')
assert.match(presentation.warnings[0], /备注/)

console.log('ALL OFFICE 1.7 TESTS PASSED')
