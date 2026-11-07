import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { warn() {}, error() {} }
const dataDir = mkdtempSync(join(tmpdir(), 'cait-library-crud-'))
const file = join(dataDir, 'store.json')

try {
  const store = new CatStore({ dataDir, logger: silent })
  store.createDocument({
    name: 'CRUD test',
    text: 'Alpha sentence.\n\nBeta sentence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })

  // 1. Editing a single TM entry re-targets it in place and survives a reload.
  const added = store.addTM({ source: 'Alpha sentence.', target: '阿尔法。' })
  const entryId = added.entry.id
  const edited = store.updateTM({ id: entryId, target: '阿尔法句。' })
  assert.equal(edited.entry.target, '阿尔法句。')
  assert.equal(edited.entry.source, 'Alpha sentence.')
  assert.equal(store.tm.length, 1, 'editing must not append a second entry')

  const reloaded = new CatStore({ dataDir, logger: silent })
  assert.equal(reloaded.tm[0].target, '阿尔法句。')

  // 2. Re-keying to an existing source in the same library is rejected.
  store.addTM({ source: 'Beta sentence.', target: '贝塔。' })
  const beta = store.tm.find((entry) => entry.source === 'Beta sentence.')
  assert.throws(
    () => store.updateTM({ id: beta.id, source: 'Alpha sentence.' }),
    (error) => error?.code === 'DUPLICATE_TM_ENTRY' && error.status === 409,
  )
  assert.equal(store.tm.find((entry) => entry.id === beta.id).source, 'Beta sentence.')

  // 3. Empty targets and unknown ids are refused without mutating.
  assert.throws(
    () => store.updateTM({ id: entryId, target: '   ' }),
    (error) => error?.code === 'EMPTY_TM_ENTRY',
  )
  assert.throws(
    () => store.updateTM({ id: 'tm_missing', target: 'x' }),
    (error) => error?.code === 'TM_ENTRY_NOT_FOUND' && error.status === 404,
  )
  assert.throws(
    () => store.deleteTM({ id: 'tm_missing' }),
    (error) => error?.code === 'TM_ENTRY_NOT_FOUND',
  )

  // 4. Deleting a single entry removes exactly that one.
  assert.equal(store.deleteTM({ id: beta.id }).removed, beta.id)
  assert.equal(store.tm.length, 1)
  assert.equal(store.tm[0].id, entryId)

  // 5. Renaming a library only touches its name.
  const legal = store.createLibrary({ kind: 'tm', name: 'Legal' })
  const legalId = legal.library.tmId
  store.renameLibrary({ kind: 'tm', id: legalId, name: 'Contracts' })
  assert.equal(store.tmLibraries.find((library) => library.tmId === legalId).name, 'Contracts')

  // 6. Deleting a library drops its entries, unmounts it, and moves the default.
  store.addTM({ source: 'Alpha sentence.', target: '合同阿尔法。', tmId: legalId })
  store.setMounts({ defaultTmId: legalId })
  assert.equal(store.tm.length, 2)
  const removed = store.deleteLibrary({ kind: 'tm', id: legalId })
  assert.equal(removed.deleted, legalId)
  assert.equal(store.tmLibraries.length, 1)
  assert.equal(store.tm.length, 1, 'entries of the deleted library go with it')
  assert.deepEqual(store.mounts.tmIds, ['tm_default'])
  assert.equal(store.mounts.defaultTmId, 'tm_default')

  const afterDelete = new CatStore({ dataDir, logger: silent })
  assert.equal(afterDelete.tmLibraries.length, 1)
  assert.equal(afterDelete.tm.length, 1)
  assert.equal(afterDelete.mounts.defaultTmId, 'tm_default')

  // 7. The last library of a kind cannot be deleted, and unknown ids are refused.
  assert.throws(
    () => store.deleteLibrary({ kind: 'tm', id: 'tm_default' }),
    (error) => error?.code === 'LAST_TM_LIBRARY' && error.status === 409,
  )
  assert.throws(
    () => store.renameLibrary({ kind: 'tm', id: 'tm_missing', name: 'x' }),
    (error) => error?.code === 'TM_NOT_FOUND',
  )
  assert.throws(
    () => store.deleteLibrary({ kind: 'nope', id: 'x' }),
    (error) => error?.code === 'INVALID_LIBRARY_KIND',
  )

  // 8. Everything above is durable, not just in memory.
  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(snapshot.tmLibraries.length, 1)
  assert.equal(snapshot.tm.length, 1)

  console.log('test-library-crud: all assertions passed')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
