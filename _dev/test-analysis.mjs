import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

const store = new CatStore()
const tm = store.createLibrary({ kind: 'tm', name: 'Analysis TM' }).library.tmId
store.upsertTM('Before', '之前', 'en', 'zh-CN', tm)
store.upsertTM('Hello world', '你好，世界', 'en', 'zh-CN', tm, { prev: 'Before', next: 'After' })
store.upsertTM('After', '之后', 'en', 'zh-CN', tm)
store.upsertTM('Unique new sentence today', '今天的新句子', 'en', 'zh-CN', tm)

const doc = store.createDocument({
  name: 'Analysis',
  text: 'Before\n\nHello world\n\nAfter\n\nUnique new sentence.\n\nBefore',
  sourceLang: 'en',
  targetLang: 'zh-CN',
  tmIds: [tm],
  defaultWriteTmId: tm,
}).document

const report = store.analyzeDocument({ documentId: doc.id })
assert.equal(report.segments, 5)
assert.equal(report.buckets.ice, 1)
assert.equal(report.buckets.exact, 3)
assert.equal(report.buckets.new, 0)
assert.equal(report.buckets.fuzzy70, 1)
assert.equal(report.buckets.fuzzy85, 0)
assert.equal(report.duplicates.groups, 1)
assert.equal(report.duplicates.segments, 2)
assert.ok(report.words > 0)
assert.ok(report.characters > report.words)
assert.equal(report.matched.segments, 5)
assert.ok(report.leverage.percent > 0 && report.leverage.percent <= 101)

console.log('test-analysis: all assertions passed')
