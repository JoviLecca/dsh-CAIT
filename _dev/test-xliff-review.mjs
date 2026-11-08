import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

const store = new CatStore()
const doc = store.createDocument({
  name: 'Review roundtrip',
  text: 'Alpha source.\n\nBeta source.',
  sourceLang: 'en',
  targetLang: 'zh-CN',
}).document
store.saveDraft({ documentId: doc.id, index: 0, target: '阿尔法。' })
store.saveDraft({ documentId: doc.id, index: 1, target: '贝塔。' })
store.confirmSegment({ documentId: doc.id, index: 0 })

const pkg = store.exportDocument({ documentId: doc.id, format: 'xliff-review' })
assert.match(pkg.filename, /\.review\.xliff$/)
assert.match(pkg.content, /x-cait-uid=/)
assert.match(pkg.content, /state="final"/)
assert.match(pkg.content, /state="translated"/)
assert.match(pkg.content, /<note from="cait">confirmed<\/note>/)

const reviewed = pkg.content
  .replace('>阿尔法。<', '>阿尔法审校。<')
  .replace('>贝塔。<', '>贝塔审校。<')
const result = store.applyXliffReview({ documentId: doc.id, text: reviewed })
const current = store.documentView(store.requireDocument(doc.id))
assert.equal(result.applied, 2)
assert.equal(current.segments[0].target, '阿尔法审校。')
assert.equal(current.segments[1].target, '贝塔审校。')
assert.ok(current.segments[0].confirmedAt)
assert.equal(current.segments[1].confirmedAt, null)
assert.equal(current.segments[0].origin, 'manual')

const before = current.segments[0].target
const mismatched = pkg.content.replace('Alpha source.', 'Totally different source.')
const second = store.applyXliffReview({ documentId: doc.id, text: mismatched })
assert.equal(second.sourceMismatch, 1)
assert.equal(store.documentView(store.requireDocument(doc.id)).segments[0].target, before)

console.log('test-xliff-review: all assertions passed')
