import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preprocessSegments, preprocessText } from '../lib/preprocess.js'
import { CatStore } from '../lib/store.js'

console.log('CAIT preprocess test')

const messy = '  Hello\u00a0world  \n\n\n\n  Second\t\tparagraph\u200b  '
assert.equal(preprocessText(messy), 'Hello world\n\nSecond paragraph')
assert.equal(preprocessText('a\u200Bb\u202Ec\uFEFFd'), 'abcd')
assert.equal(preprocessText('Line one\r\n\r\n\r\nLine two   '), 'Line one\n\nLine two')

// Inline placeholder tokens and meaningful punctuation survive untouched.
const tokenized = 'Alpha {1}beta{2} gamma.'
assert.equal(preprocessText(tokenized), tokenized)
assert.equal(preprocessText('A\u00a0B {1} C'), 'A B {1} C')

// Segment preprocessing clones and only touches source text.
const segments = [{ index: 0, source: '  One  ', target: 'Un', inline: [{ token: '{1}', xml: '<em>' }] }]
const cleaned = preprocessSegments(segments, { normalizeWhitespace: true, stripInvisible: true, collapseBlankLines: true })
assert.equal(cleaned[0].source, 'One')
assert.equal(cleaned[0].target, 'Un')
assert.deepEqual(cleaned[0].inline, segments[0].inline)
assert.equal(segments[0].source, '  One  ')

// Disabling every step leaves the source as-is.
assert.equal(
  preprocessText('  A\u00a0 B  ', { normalizeWhitespace: false, stripInvisible: false, collapseBlankLines: false }),
  '  A\u00a0 B  ',
)

const dir = mkdtempSync(join(tmpdir(), 'cait-preprocess-'))
try {
  const store = new CatStore({ dataDir: dir })
  assert.deepEqual(store.settings.preprocess, {
    normalizeWhitespace: true,
    stripInvisible: true,
    collapseBlankLines: true,
  })
  const created = store.createDocument({
    name: 'messy.txt',
    text: '  Alpha\u00a0 beta  \n\n\n\n  Gamma\u200b  ',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const doc = store.requireDocument(created.document.id)
  assert.deepEqual(doc.segments.map((segment) => segment.source), ['Alpha beta', 'Gamma'])

  const saved = store.saveSettings({ preprocess: { normalizeWhitespace: false, stripInvisible: true, collapseBlankLines: true } })
  assert.equal(saved.settings.preprocess.normalizeWhitespace, false)
  assert.equal(saved.settings.preprocess.stripInvisible, true)

  const reloaded = new CatStore({ dataDir: dir })
  assert.equal(reloaded.settings.preprocess.normalizeWhitespace, false)
  const kept = reloaded.createDocument({
    name: 'spaces.txt',
    text: 'Alpha   beta\u200b',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(reloaded.requireDocument(kept.document.id).segments[0].source, 'Alpha beta')

  reloaded.saveSettings({ preprocess: { normalizeWhitespace: true } })
  assert.equal(reloaded.settings.preprocess.normalizeWhitespace, true)
  assert.equal(reloaded.settings.preprocess.collapseBlankLines, true)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('ALL PREPROCESS TESTS PASSED')
