import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'
import { readZipEntries } from '../lib/docx.js'

const store = new CatStore()
const doc = store.createDocument({
  name: 'Bilingual export',
  text: 'First source.\n\nSecond & <source>.',
  sourceLang: 'en',
  targetLang: 'zh-CN',
}).document
store.saveDraft({ documentId: doc.id, index: 0, target: '第一句。' })
store.saveDraft({ documentId: doc.id, index: 1, target: '第二句 & <译文>。' })

const result = store.exportDocument({ documentId: doc.id, format: 'bilingual-docx' })
assert.equal(result.filename, 'Bilingual-export.bilingual.docx')
assert.ok(Buffer.isBuffer(result.content))
const entries = readZipEntries(result.content)
const documentXml = entries.find((entry) => entry.name === 'word/document.xml').data.toString('utf8')
assert.match(documentXml, /<w:tbl>/)
assert.match(documentXml, /First source\./)
assert.match(documentXml, /第一句。/)
assert.match(documentXml, /Second &amp; &lt;source&gt;\./)
assert.match(documentXml, /第二句 &amp; &lt;译文&gt;。/)
assert.match(documentXml, /<w:tblHeader\/>/)
assert.match(documentXml, /Source/)
assert.match(documentXml, /Status/)
assert.match(documentXml, /confirmed|translated/)

console.log('test-bilingual-docx: all assertions passed')
