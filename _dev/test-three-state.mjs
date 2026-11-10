import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { STORE_VERSION } from '../lib/limits.js'
import { normalizeSegmentState, segmentStatus } from '../lib/segment-state.js'

const silent = { warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-three-'))
  roots.push(dir)
  return dir
}

function section(name) {
  console.log(`\n# ${name}`)
}

try {
  section('status is derived from the facts, never stored independently')
  {
    assert.equal(segmentStatus({}), 'pending')
    assert.equal(segmentStatus({ target: 'x' }), 'translated')
    assert.equal(segmentStatus({ suggestion: 'x' }), 'translated')
    assert.equal(
      segmentStatus({ target: 'x', confirmedAt: '2026-01-01T00:00:00.000Z' }),
      'confirmed',
    )
    // A confirmation without text is not a confirmation.
    assert.equal(segmentStatus({ confirmedAt: '2026-01-01T00:00:00.000Z' }), 'pending')

    const cleared = normalizeSegmentState({
      target: '',
      suggestion: '',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      origin: 'mt',
    })
    assert.equal(cleared.status, 'pending')
    assert.equal(cleared.origin, null)
    assert.equal(cleared.confirmedAt, null)

    const kept = normalizeSegmentState({ target: 'x', suggestion: 'y', origin: 'agent' })
    assert.equal(kept.status, 'translated')
    assert.equal(kept.origin, 'agent')

    const fallbackOrigin = normalizeSegmentState({ target: 'x', origin: 'bogus' })
    assert.equal(fallbackOrigin.origin, 'manual')
  }

  section('a new document starts empty and moves pending -> translated -> confirmed')
  {
    const store = new CatStore({ logger: silent })
    const { document } = store.createDocument({
      name: 'Three',
      text: 'One. Two.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const doc = store.docs.get(document.id)
    assert.deepEqual(
      doc.segments.map((s) => s.status),
      ['pending', 'pending'],
    )
    assert.deepEqual(
      doc.segments.map((s) => s.origin),
      [null, null],
    )
    assert.deepEqual(
      doc.segments.map((s) => s.suggestion),
      ['', ''],
    )
    assert.deepEqual(store.progress(doc), {
      total: 2,
      confirmed: 0,
      translated: 0,
      pending: 2,
      percent: 0,
    })

    const drafted = store.saveDraft({ documentId: doc.id, index: 0, target: '一。' })
    assert.equal(drafted.segment.status, 'translated')
    assert.equal(drafted.segment.origin, 'manual')
    assert.deepEqual(store.progress(doc), {
      total: 2,
      confirmed: 0,
      translated: 1,
      pending: 1,
      percent: 0,
    })

    const confirmed = store.confirmSegment({ documentId: doc.id, index: 0 })
    assert.equal(confirmed.confirmed.status, 'confirmed')
    assert.equal(confirmed.progress.confirmed, 1)
    assert.equal(confirmed.progress.translated, 0)
    // One translated draft still needs review, so the work is not "done".
    assert.equal(confirmed.done, false)

    store.saveDraft({ documentId: doc.id, index: 1, target: '二。' })
    const final = store.confirmSegment({ documentId: doc.id, index: 1 })
    assert.equal(final.done, true)
    assert.deepEqual(final.progress, {
      total: 2,
      confirmed: 2,
      translated: 0,
      pending: 0,
      percent: 100,
    })
  }

  section('clearing a draft returns the segment to pending')
  {
    const store = new CatStore({ logger: silent })
    const doc = store.docs.get(
      store.createDocument({ text: 'Only one.', sourceLang: 'en' }).document.id,
    )
    store.saveDraft({ documentId: doc.id, index: 0, target: '只有一个。' })
    const cleared = store.saveDraft({ documentId: doc.id, index: 0, target: '' })
    assert.equal(cleared.segment.status, 'pending')
    assert.equal(cleared.segment.origin, null)
  }

  section('adopting a proposal keeps its provenance')
  {
    const store = new CatStore({ logger: silent })
    const doc = store.docs.get(
      store.createDocument({ text: 'Hello there.', sourceLang: 'en' }).document.id,
    )
    const segment = doc.segments[0]
    segment.suggestion = '你好。'
    segment.origin = 'mt'
    normalizeSegmentState(segment)
    assert.equal(segment.status, 'translated')
    assert.equal(doc.segments[0].target, '')

    const adopted = store.adoptSuggestion({ documentId: doc.id, index: 0 })
    assert.equal(adopted.segment.target, '你好。')
    assert.equal(adopted.segment.origin, 'mt', 'adoption must not look human-authored')
    assert.equal(adopted.segment.status, 'translated')
    assert.equal(adopted.segment.suggestion, '你好。', 'the proposal stays beside the adopted text')

    // Adoption is idempotent: the proposal is still there to compare against.
    assert.equal(store.adoptSuggestion({ documentId: doc.id, index: 0 }).segment.target, '你好。')

    // Confirming without an explicit target adopts the proposal too.
    store.saveDraft({ documentId: doc.id, index: 0, target: '' })
    segment.suggestion = '你好呀。'
    segment.origin = 'agent'
    normalizeSegmentState(segment)
    const confirmed = store.confirmSegment({ documentId: doc.id, index: 0, target: '你好呀。' })
    assert.equal(confirmed.confirmed.origin, 'agent')
  }

  section('confirmed segments refuse adoption')
  {
    const store = new CatStore({ logger: silent })
    const doc = store.docs.get(store.createDocument({ text: 'Hi.', sourceLang: 'en' }).document.id)
    store.saveDraft({ documentId: doc.id, index: 0, target: '嗨。' })
    store.confirmSegment({ documentId: doc.id, index: 0, addToTm: false })
    doc.segments[0].suggestion = '您好。'
    assert.throws(
      () => store.adoptSuggestion({ documentId: doc.id, index: 0 }),
      /ALREADY_CONFIRMED|已确认/,
    )
  }

  section('v2 stores migrate into the three-state model')
  {
    const dataDir = tempDir()
    const file = join(dataDir, 'store.json')
    const legacy = {
      version: 2,
      savedAt: '2026-01-01T00:00:00.000Z',
      activeDocId: 'doc_legacy',
      openDocIds: ['doc_legacy'],
      documents: [
        {
          id: 'doc_legacy',
          name: 'Legacy',
          sourceLang: 'en',
          targetLang: 'zh-CN',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          segments: [
            {
              id: 's1',
              source: 'Confirmed one.',
              target: '已确认。',
              status: 'confirmed',
              paragraph: 0,
            },
            { id: 's2', source: 'Draft one.', target: '草稿。', status: 'pending', paragraph: 1 },
            { id: 's3', source: 'Empty one.', target: '', status: 'pending', paragraph: 2 },
          ],
        },
      ],
      tmLibraries: [],
      glossaryLibraries: [],
      tm: [],
      glossary: [],
      settings: {},
    }
    writeFileSync(file, JSON.stringify(legacy), 'utf8')

    const store = new CatStore({ dataDir, logger: silent })
    assert.equal(store.persistence.loaded, true)
    const segments = store.docs.get('doc_legacy').segments
    assert.deepEqual(
      segments.map((s) => s.status),
      ['confirmed', 'translated', 'pending'],
    )
    assert.deepEqual(
      segments.map((s) => s.origin),
      ['manual', 'manual', null],
    )
    assert.deepEqual(
      segments.map((s) => s.suggestion),
      ['', '', ''],
    )
    assert.equal(store.progress(store.docs.get('doc_legacy')).translated, 1)

    // Drafts stay in memory by design; confirming writes the upgraded file.
    store.saveDraft({ documentId: 'doc_legacy', index: 2, target: '空。' })
    store.confirmSegment({ documentId: 'doc_legacy', index: 2, addToTm: false })
    const snapshot = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(snapshot.version, STORE_VERSION)
    assert.equal(snapshot.documents[0].segments[1].status, 'translated')
  }

  section('suggestions and origins survive a save/load round trip')
  {
    const dataDir = tempDir()
    const store = new CatStore({ dataDir, logger: silent })
    const doc = store.docs.get(
      store.createDocument({ text: 'Round trip.', sourceLang: 'en' }).document.id,
    )
    doc.segments[0].suggestion = '往返。'
    doc.segments[0].origin = 'mt'
    normalizeSegmentState(doc.segments[0])
    store.confirmSegment({ documentId: doc.id, index: 0, target: '往返。' })

    const reloaded = new CatStore({ dataDir, logger: silent })
    const segment = reloaded.docs.get(doc.id).segments[0]
    assert.equal(segment.target, '往返。')
    assert.equal(segment.suggestion, '往返。')
    assert.equal(segment.origin, 'mt')
    assert.equal(segment.status, 'confirmed')
  }

  console.log('\nALL THREE-STATE TESTS PASSED')
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}
