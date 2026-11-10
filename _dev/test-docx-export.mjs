import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CatStore } from '../lib/store.js'
import { parseDocx, readDocxXml, writeZip } from '../lib/docx.js'

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
  assert.match(tableXml, /表格外译文 2/, 'table cell should be translated in place')
  assert.doesNotMatch(tableXml, /Table cell A/, 'table cell source should be replaced')
  assert.match(parseDocx(tableExport.content), /表格外译文/)

  const partTemplate = writeZip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body text.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>After table.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
      ),
    },
    {
      name: 'word/header1.xml',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text.</w:t></w:r></w:p></w:hdr>'),
    },
    {
      name: 'word/footer1.xml',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text.</w:t></w:r></w:p></w:ftr>'),
    },
    {
      name: 'word/footnotes.xml',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Footnote text.</w:t></w:r></w:p></w:footnote></w:footnotes>'),
    },
  ])
  const partImported = store.importFile({
    name: 'parts.docx',
    base64: partTemplate.toString('base64'),
  })
  const partDoc = store.docs.get(partImported.document.id)
  assert.equal(partDoc.segments.length, 7)
  assert.equal(partDoc.segments.every((segment) => segment.meta?.docxPart), true)
  partDoc.segments.forEach((segment, index) => {
    store.saveDraft({ documentId: partDoc.id, index, target: `译:${segment.source}` })
  })
  const partExport = store.exportDocument({ format: 'docx', documentId: partDoc.id })
  const documentXml = readDocxXml(partExport.content)
  const headerXml = readDocxXml(partExport.content, 'word/header1.xml')
  const footerXml = readDocxXml(partExport.content, 'word/footer1.xml')
  const footnotesXml = readDocxXml(partExport.content, 'word/footnotes.xml')
  assert.match(documentXml, /译:Body text\./)
  assert.match(documentXml, /译:Cell A/)
  assert.match(documentXml, /译:After table\./)
  assert.match(headerXml, /译:Header text\./)
  assert.match(footerXml, /译:Footer text\./)
  assert.match(footnotesXml, /译:Footnote text\./)

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
