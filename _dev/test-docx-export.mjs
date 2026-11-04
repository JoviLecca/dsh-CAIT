import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CatStore } from '../lib/store.js'
import { parseDocx, readDocxXml } from '../lib/docx.js'

const fixture = readFileSync(new URL('./sample-format.docx', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cait-docx-'))

try {
  const store = new CatStore({ dataDir: dir })
  const imported = store.importFile({
    name: 'sample-format.docx',
    base64: fixture.toString('base64'),
  })
  assert.equal(imported.document.name, 'sample-format.docx')
  const doc = store.docs.get(imported.document.id)
  assert.equal(doc.sourceDocx.kind, 'file')
  assert.equal(existsSync(join(dir, doc.sourceDocx.asset)), true)

  doc.segments.forEach((segment, index) => {
    store.saveDraft({ documentId: doc.id, index, target: `译文 ${index + 1}` })
  })
  store.persist()

  const exported = store.exportDocument({ format: 'docx', documentId: doc.id })
  assert.match(exported.filename, /\.zh-CN\.docx$/)
  assert.ok(Buffer.isBuffer(exported.content))
  assert.match(exported.mime, /wordprocessingml/)
  assert.match(parseDocx(exported.content), /译文 1/)
  assert.match(parseDocx(exported.content), /译文 3/)

  const xml = readDocxXml(exported.content)
  assert.match(xml, /<w:pStyle\b/, 'heading paragraph style should survive')
  assert.match(xml, /<w:b(?:\s|\/|>)/, 'bold run property should survive')
  assert.match(xml, /<w:color\b/, 'color run property should survive')

  const reloaded = new CatStore({ dataDir: dir })
  const afterReload = reloaded.exportDocument({ format: 'docx', documentId: doc.id })
  assert.match(parseDocx(afterReload.content), /译文 1/)
  assert.match(readDocxXml(afterReload.content), /<w:b(?:\s|\/|>)/)

  const tableFixture = readFileSync(new URL('./sample-table.docx', import.meta.url))
  const tableImported = store.importFile({
    name: 'sample-table.docx',
    base64: tableFixture.toString('base64'),
  })
  const tableDoc = store.docs.get(tableImported.document.id)
  tableDoc.segments.forEach((segment, index) => {
    store.saveDraft({ documentId: tableDoc.id, index, target: `表格外译文 ${index + 1}` })
  })
  const tableExport = store.exportDocument({ format: 'docx', documentId: tableDoc.id })
  const tableXml = readDocxXml(tableExport.content)
  assert.match(tableXml, /<w:tbl>/, 'source table should survive export')
  assert.match(tableXml, /Table cell A/, 'table text should remain untouched')
  assert.doesNotMatch(parseDocx(tableExport.content), /Table cell A/)

  const plain = store.createDocument({
    name: 'plain',
    text: 'First plain paragraph.\n\nSecond plain paragraph.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const plainDoc = store.docs.get(plain.document.id)
  plainDoc.segments[0].target = '第一段'
  plainDoc.segments[1].target = '第二段'
  const plainExport = store.exportDocument({ format: 'docx', documentId: plainDoc.id })
  assert.match(parseDocx(plainExport.content), /第一段/)
  assert.match(parseDocx(plainExport.content), /第二段/)

  store.deleteDocument({ documentId: doc.id })
  assert.equal(existsSync(join(dir, 'sources', `${doc.id}.docx`)), false)

  console.log('ALL DOCX EXPORT TESTS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
