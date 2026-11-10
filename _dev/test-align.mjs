import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { alignBlock, alignTexts, confidenceOf, lengthFit, scorePair } from '../lib/aligner.js'

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-align-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

function seg(source, paragraph = 0) {
  return { source, paragraph }
}

try {
  section('readUploadText returns text without creating a document')
  {
    const store = new CatStore({ logger: silent })
    const result = store.readUploadText({ name: 'notes.md', text: '# Title\n\nHello **world**.' })
    assert.equal(result.name, 'notes.md')
    assert.match(result.text, /Title/)
    assert.match(result.text, /Hello world\./)
    assert.equal(store.docs.size, 0)
    assert.throws(
      () => store.readUploadText({ name: 'empty.txt', text: '   ' }),
      /没有可用文本|内容为空/,
    )
  }

  section('confidence tiers')
  {
    assert.equal(confidenceOf(0.75), 'high')
    assert.equal(confidenceOf(0.6), 'high')
    assert.equal(confidenceOf(0.5), 'medium')
    assert.equal(confidenceOf(0.35), 'medium')
    assert.equal(confidenceOf(0.2), 'low')
  }

  section('length hypothesis is language independent')
  {
    // English 180 chars vs Chinese 100 chars: each against its own median is
    // a perfect ratio, so the fit is 1 rather than "one is shorter".
    assert.equal(lengthFit(180, 100, 180, 100), 1)
    assert.ok(lengthFit(18, 100, 180, 100) < 0.2)
  }

  section('anchors carry the score across languages')
  {
    const medians = { left: 18, right: 12 }
    const withAnchor = scorePair(seg('It has 12 modes.'), seg('它有 12 种模式。'), medians)
    const without = scorePair(seg('It is fine.'), seg('它很不错。'), medians)
    assert.ok(withAnchor.score > without.score, `${withAnchor.score} should beat ${without.score}`)
    assert.equal(withAnchor.anchor, 1)
    assert.equal(without.anchor, 0.5)
  }

  section('DP moves: 1:1, 1:0, 0:1 and 2:1')
  {
    const medians = { left: 18, right: 12 }
    assert.equal(alignBlock([seg('Alpha beta.')], [seg('阿尔法贝塔。')], medians).length, 1)
    const onlySource = alignBlock([seg('Alpha beta.')], [], medians)
    assert.equal(onlySource.length, 1)
    assert.equal(onlySource[0].target, null)
    const onlyTarget = alignBlock([], [seg('阿尔法。')], medians)
    assert.equal(onlyTarget.length, 1)
    assert.equal(onlyTarget[0].source, null)
    const merged = alignBlock(
      [seg('It has 12 modes.'), seg('Use it daily.')],
      [seg('它有 12 种模式。每天使用。')],
      medians,
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0].left, 2)
    assert.equal(merged[0].right, 1)
  }

  section('alignTexts pairs a clean document')
  {
    const result = alignTexts(
      'Nova is a tool. It has 12 modes. Use it daily.',
      'Nova 是一个工具。它有 12 种模式。每天都用它。',
    )
    assert.equal(result.sourceSegments, 3)
    assert.equal(result.targetSegments, 3)
    assert.equal(result.pairs.length, 3)
    // The number anchor makes two rows certain; a plain sentence without any
    // anchor lands in "medium" and is left unchecked in the UI.
    assert.equal(result.high, 2)
    assert.equal(result.medium, 1)
    assert.equal(result.unpairedSource, 0)
    assert.deepEqual(
      result.pairs.map((row) => row.confidence),
      ['high', 'high', 'medium'],
    )
  }

  section('alignTexts reports missing translations instead of guessing')
  {
    const result = alignTexts('Alpha one. Beta two. Gamma three.', '阿尔法一。伽马三。')
    assert.equal(result.pairs.length, 2)
    assert.equal(result.unpairedSource, 1)
  }

  section('writeAlignment writes once and skips what is already stored')
  {
    const store = new CatStore({ logger: silent })
    const pairs = [
      { source: 'Nova is a tool.', target: 'Nova 是一个工具。' },
      { source: 'It has 12 modes.', target: '它有 12 种模式。' },
      { source: 'Empty target.', target: '   ' },
    ]
    const first = store.writeAlignment({ pairs })
    assert.equal(first.written, 2)
    assert.equal(first.skipped, 1)
    assert.equal(store.docs.size, 0)

    const again = store.writeAlignment({ pairs })
    assert.equal(again.written, 0)
    assert.equal(again.skipped, 3)

    const changed = store.writeAlignment({
      pairs: [{ source: 'Nova is a tool.', target: 'Nova 是个工具。' }],
    })
    assert.equal(changed.updated, 1)

    const localized = store.writeAlignment({
      pairs: [{ source: 'Bonjour le monde.', target: 'Hallo Welt.' }],
      sourceLang: 'fr',
      targetLang: 'de',
    })
    assert.equal(localized.written, 1)
    const entry = store.tm.find((item) => item.source === 'Bonjour le monde.')
    assert.equal(entry.sourceLang, 'fr')
    assert.equal(entry.targetLang, 'de')
  }

  section('a translated document survives a round-trip through the store')
  {
    const dir = tempDir()
    const store = new CatStore({ dataDir: dir, logger: silent })
    store.writeAlignment({
      pairs: [{ source: 'Round trip.', target: '往返。' }],
    })
    const reopened = new CatStore({ dataDir: dir, logger: silent })
    const entry = reopened.tm.find((item) => item.source === 'Round trip.')
    assert.ok(entry)
    assert.equal(entry.target, '往返。')
    assert.equal(entry.contextHash, null)
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

console.log('\nALL ALIGN TESTS PASSED')
