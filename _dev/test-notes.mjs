import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

section('add, update and delete notes')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Notes',
    text: 'First segment. Second segment.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  assert.deepEqual(store.segmentView(store.docs.get(id).segments[0], 0).notes, [])

  const added = store.addSegmentNote({
    documentId: id,
    index: 0,
    text: 'Check the character name.',
  })
  assert.equal(added.notes.length, 1)
  assert.match(added.note.id, /^n_/)
  assert.equal(added.note.author, 'user')
  assert.equal(store.docs.get(id).segments[0].notes.length, 1)
  assert.equal(
    store.segmentView(store.docs.get(id).segments[0], 0).notes[0].text,
    'Check the character name.',
  )

  store.addSegmentNote({ documentId: id, index: 0, text: 'Agent note.', author: 'agent' })
  assert.equal(store.notesForSegment({ documentId: id, index: 0 }).notes.length, 2)

  const updated = store.updateSegmentNote({
    documentId: id,
    index: 0,
    noteId: added.note.id,
    text: 'Check the character name and title.',
  })
  assert.equal(updated.note.text, 'Check the character name and title.')

  const removed = store.deleteSegmentNote({ documentId: id, index: 0, noteId: added.note.id })
  assert.equal(removed.notes.length, 1)
  assert.equal(removed.notes[0].author, 'agent')
  assert.throws(
    () => store.deleteSegmentNote({ documentId: id, index: 0, noteId: added.note.id }),
    (error) => error.code === 'NOTE_NOT_FOUND',
  )
}

section('empty note is rejected')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Empty',
    text: 'One.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.throws(
    () => store.addSegmentNote({ documentId: created.document.id, index: 0, text: '   ' }),
    (error) => error.code === 'EMPTY_NOTE',
  )
}

section('v6 migration and reload')
{
  const dir = mkdtempSync(join(tmpdir(), 'cait-notes-'))
  try {
    writeFileSync(
      join(dir, 'store.json'),
      JSON.stringify({
        version: 6,
        activeDocId: 'doc_old',
        openDocIds: ['doc_old'],
        documents: [
          {
            id: 'doc_old',
            name: 'Old',
            sourceLang: 'en',
            targetLang: 'zh-CN',
            cursor: 0,
            segments: [
              { id: 's1', source: 'Old source.', target: '', status: 'pending', paragraph: 0 },
            ],
            fingerprint: 'old',
          },
        ],
        tm: [],
        glossary: [],
      }),
      'utf8',
    )
    const migrated = new CatStore({ dataDir: dir, logger: { warn() {}, error() {} } })
    const doc = migrated.docs.get('doc_old')
    assert.deepEqual(doc.segments[0].notes, [])
    migrated.addSegmentNote({ documentId: 'doc_old', index: 0, text: 'Migrated note.' })
    const reloaded = new CatStore({ dataDir: dir, logger: { warn() {}, error() {} } })
    assert.equal(reloaded.docs.get('doc_old').segments[0].notes[0].text, 'Migrated note.')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\nALL NOTES TESTS PASSED')
