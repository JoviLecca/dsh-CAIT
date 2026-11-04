import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseDocx } from '../lib/docx.js'
import { CatStore } from '../lib/store.js'

const buffer = fs.readFileSync(new URL('./sample.docx', import.meta.url))
const parsed = parseDocx(buffer)
console.log(parsed)
assert.ok(parsed.includes('CAIT import test'))
assert.ok(parsed.includes('First paragraph contains two sentences.'))
assert.ok(parsed.includes('translation memory'))

const store = new CatStore()
const base64 = buffer.toString('base64')
const imported = await store.importFile({ name: 'sample.docx', kind: 'docx', base64, sourceLang: 'en', targetLang: 'zh-CN' })
console.log(imported)
const state = store.bootstrap()
assert.equal(state.activeDocument.segments.length >= 3, true)
assert.ok(state.activeDocument.segments.some((segment) => segment.source.includes('CAIT import test')))

const tableBuffer = fs.readFileSync(new URL('./sample-table.docx', import.meta.url))
const tableText = parseDocx(tableBuffer)
console.log(JSON.stringify(tableText))
assert.equal(tableText, 'Before table paragraph.\n\nAfter table paragraph.')
assert.equal(tableText.includes('Table cell'), false, 'table cell paragraphs must be excluded')

const glossary = store.importGlossary({ text: 'translation memory,翻译记忆库,TM\nCAT,计算机辅助翻译,computer-aided translation' })
console.log(glossary)
assert.ok(store.bootstrap().glossary.length >= 2)

const tmxSource = `<?xml version="1.0"?><tmx version="1.4"><header srclang="en"/><body><tu><tuv xml:lang="en"><seg>Hello.</seg></tuv><tuv xml:lang="zh-CN"><seg>你好。</seg></tuv></tu></body></tmx>`
const tmxDoc = await store.importTmx({ text: tmxSource, name: 'pairs.tmx', importAs: 'document', targetLang: 'zh-CN' })
console.log(tmxDoc)
const tmxState = store.bootstrap()
assert.equal(tmxState.activeDocument.segments.length, 1)
assert.equal(tmxState.activeDocument.segments[0].target, '你好。')

const tmxMarkup = `<?xml version="1.0"?><tmx version="1.4"><header srclang="en"/><body><tu><tuv xml:lang="en"><seg>Hello <bpt i="1">&lt;b&gt;</bpt>world<ept i="1">&lt;/b&gt;</ept></seg></tuv></tu></body></tmx>`
const markupDoc = await store.importTmx({ text: tmxMarkup, name: 'markup.tmx', importAs: 'document' })
console.log(markupDoc.warnings)
assert.equal(markupDoc.warnings.length, 1)
assert.equal(markupDoc.warnings[0].code, 'TMX_INLINE_MARKUP_LOST')
assert.ok(markupDoc.warnings[0].count >= 2)

// Failure branches: the import methods are synchronous now, so errors must
// surface immediately instead of becoming unhandled rejections.
assert.throws(() => store.importFile({ name: 'empty.txt', text: '' }), /文件内容为空/)
assert.throws(() => store.importFile({ name: 'broken.docx', base64: 'not-a-zip' }), /DOCX/)
assert.throws(() => store.importTmx({ text: '' }), /TMX 内容为空/)
assert.throws(() => store.importTmx({ text: '<tmx version="1.4"><body></body></tmx>' }), /没有可用/)

console.log('ALL IMPORT TESTS PASSED')
