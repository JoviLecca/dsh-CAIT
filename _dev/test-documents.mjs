import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const dir = mkdtempSync(join(tmpdir(), 'cait-documents-'))
const file = join(dir, 'store.json')

try {
  const store = new CatStore({ dataDir: dir, logger: { warn() {}, error() {} } })
  const first = store.createDocument({
    name: 'Alpha',
    text: 'Alpha one. Alpha two.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const firstId = first.document.id

  const duplicate = store.createDocument({
    name: 'Alpha renamed',
    text: 'Alpha one. Alpha two.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(duplicate.reused, true, 'same source content must be reused')
  assert.equal(duplicate.document.id, firstId)
  assert.equal(store.docs.size, 1)
  assert.deepEqual(store.openDocIds, [firstId])
  assert.equal(store.activeDocId, firstId)

  const second = store.createDocument({
    name: 'Beta',
    text: 'Beta one.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const secondId = second.document.id
  assert.deepEqual(store.openDocIds, [firstId, secondId])
  assert.equal(store.activeDocId, secondId)

  store.closeDocument({ documentId: firstId })
  assert.deepEqual(store.openDocIds, [secondId], 'closing an inactive tab keeps the active tab')
  assert.equal(store.activeDocId, secondId)

  store.closeDocument({ documentId: secondId })
  assert.deepEqual(store.openDocIds, [], 'all tabs can be closed')
  assert.equal(store.activeDocId, null)
  assert.equal(store.docs.size, 2, 'closing tabs must not delete saved documents')

  store.openDocument({ documentId: firstId })
  assert.deepEqual(store.openDocIds, [firstId])
  assert.equal(store.activeDocId, firstId)

  assert.equal(store.bootstrap().openDocuments.length, 1)
  assert.equal(store.bootstrap().activeDocument.id, firstId)

  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(snapshot.openDocIds, [firstId])

  store.closeDocument({ documentId: firstId })
  assert.equal(store.activeDocId, null)
  const closedSnapshot = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(closedSnapshot.activeDocId, null)
  assert.deepEqual(closedSnapshot.openDocIds, [])

  const reloaded = new CatStore({ dataDir: dir, logger: { warn() {}, error() {} } })
  assert.equal(reloaded.docs.size, 2)
  assert.equal(reloaded.activeDocId, null)
  assert.deepEqual(reloaded.openDocIds, [])
  assert.equal(reloaded.bootstrap().activeDocument, null)
  assert.equal(reloaded.bootstrap().documents.length, 2)

  reloaded.openDocument({ documentId: secondId })
  const reloadedAgain = new CatStore({ dataDir: dir, logger: { warn() {}, error() {} } })
  assert.equal(reloadedAgain.activeDocId, secondId)
  assert.deepEqual(reloadedAgain.openDocIds, [secondId])

  const imported = reloadedAgain.importFile({
    name: 'Alpha.txt',
    text: 'Alpha one. Alpha two.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  assert.equal(
    imported.reused,
    true,
    're-importing the same file must reopen the existing document',
  )
  assert.equal(imported.document.id, firstId)

  const deleted = reloadedAgain.deleteDocument({ documentId: firstId })
  assert.equal(deleted.deleted, firstId)
  assert.deepEqual(reloadedAgain.openDocIds, [secondId])
  assert.equal(reloadedAgain.activeDocId, secondId)
  reloadedAgain.deleteDocument({ documentId: secondId })
  assert.deepEqual(reloadedAgain.openDocIds, [])
  assert.equal(reloadedAgain.activeDocId, null)

  console.log('test-documents: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
