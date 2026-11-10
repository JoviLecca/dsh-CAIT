import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { log() {}, warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-propagate-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

const REPEATED = 'Nova is a tool.\n\nNova is a tool.\n\nNova is a tool.'

try {
  section('confirming one copy fills the other unconfirmed copies')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Repeat',
      text: REPEATED,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.saveDraft({ documentId: doc.id, index: 0, target: 'Nova 是一个工具。' })
    store.confirmSegment({ documentId: doc.id, index: 0 })

    assert.deepEqual(
      doc.segments.map((segment) => segment.status),
      ['confirmed', 'translated', 'translated'],
    )
    assert.deepEqual(
      doc.segments.map((segment) => segment.origin),
      ['manual', 'auto', 'auto'],
    )
    assert.deepEqual(
      doc.segments.map((segment) => segment.target),
      ['Nova 是一个工具。', 'Nova 是一个工具。', 'Nova 是一个工具。'],
    )
  }

  section('a human edit reaches unconfirmed copies but never a confirmed one')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Repeat edit',
      text: REPEATED,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.saveDraft({ documentId: doc.id, index: 0, target: 'Nova 是一个工具。' })
    store.confirmSegment({ documentId: doc.id, index: 0 })
    store.saveDraft({ documentId: doc.id, index: 1, target: 'Nova 是个工具。' })

    assert.equal(doc.segments[0].target, 'Nova 是一个工具。')
    assert.equal(doc.segments[1].target, 'Nova 是个工具。')
    assert.equal(doc.segments[2].target, 'Nova 是个工具。')
    // The copied text still counts as a propagation, not a human edit, so the
    // review pane can tell the two apart.
    assert.equal(doc.segments[2].origin, 'auto')
    assert.equal(doc.segments[2].status, 'translated')
  }

  section('propagateDocument fills leftovers from one draft')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Fill now',
      text: REPEATED,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.saveDraft({ documentId: doc.id, index: 1, target: 'Nova 是一个工具。' })
    // Undo the automatic propagation so the document is deliberately uneven.
    doc.segments[2].target = ''
    const result = store.propagateDocument({ documentId: doc.id })
    assert.equal(result.filled, 1)
    assert.equal(doc.segments[2].target, 'Nova 是一个工具。')
    assert.equal(doc.segments[2].origin, 'auto')
  }

  section('the auto origin survives a round-trip')
  {
    const dir = tempDir()
    const store = new CatStore({ dataDir: dir, logger: silent })
    const { document } = store.createDocument({
      name: 'Persist',
      text: REPEATED,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    store.saveDraft({ documentId: doc.id, index: 0, target: 'Nova 是一个工具。' })
    store.confirmSegment({ documentId: doc.id, index: 0 })

    const reopened = new CatStore({ dataDir: dir, logger: silent })
    const reloaded = reopened.docs.get(doc.id)
    assert.deepEqual(
      reloaded.segments.map((segment) => segment.origin),
      ['manual', 'auto', 'auto'],
    )
    assert.deepEqual(
      reloaded.segments.map((segment) => segment.status),
      ['confirmed', 'translated', 'translated'],
    )
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

console.log('\nALL PROPAGATE TESTS PASSED')
