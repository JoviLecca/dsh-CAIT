import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CatStore } from '../lib/store.js'
import { readZipEntries, writeZip } from '../lib/docx.js'

const dir = mkdtempSync(join(tmpdir(), 'cait-xlsx-'))

const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1">
    <c r="A1" t="inlineStr"><is><t>Hello</t></is></c>
    <c r="B1" s="3" t="inlineStr"><is><t>Old</t></is></c>
  </row></sheetData>
  <mergeCells count="1"><mergeCell ref="B1:C1"/></mergeCells>
</worksheet>`
const template = writeZip([
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
  { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
])

try {
  const store = new CatStore({ dataDir: dir })
  const imported = store.importFile({ name: 'book.xlsx', base64: template.toString('base64') })
  const doc = store.docs.get(imported.document.id)
  assert.equal(doc.segments.length, 1)
  assert.equal(doc.segments[0].meta.cell, 'A1')
  assert.equal(doc.segments[0].meta.targetCell, 'B1')
  store.saveDraft({ documentId: doc.id, index: 0, target: 'Bonjour' })

  const out = store.exportDocument({ format: 'xlsx', documentId: doc.id })
  assert.ok(Buffer.isBuffer(out.content))
  const patched = readZipEntries(out.content)
    .find((entry) => entry.name === 'xl/worksheets/sheet1.xml')
    .data.toString('utf8')
  assert.match(patched, /<c r="B1" s="3" t="inlineStr">/)
  assert.match(patched, /Bonjour/)
  assert.match(patched, /<mergeCell ref="B1:C1"\/>/)

  store.persist()
  const reloaded = new CatStore({ dataDir: dir })
  const reloadedDoc = reloaded.docs.get(doc.id)
  assert.ok(reloadedDoc?.sourceXlsx)
  const reloadedOut = reloaded.exportDocument({ format: 'xlsx', documentId: doc.id })
  const reloadedSheet = readZipEntries(reloadedOut.content)
    .find((entry) => entry.name === 'xl/worksheets/sheet1.xml')
    .data.toString('utf8')
  assert.match(reloadedSheet, /Bonjour/)

  console.log('ALL XLSX ROUNDTRIP TESTS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
