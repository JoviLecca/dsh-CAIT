import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

const store = new CatStore()
const a = store.createLibrary({ kind: 'tm', name: 'Source TM' }).library.tmId
const b = store.createLibrary({ kind: 'tm', name: 'Target TM' }).library.tmId
store.addTM({ source: 'One', target: '一', tmId: a })
store.addTM({ source: 'Two', target: '二', tmId: a })
store.addTM({ source: 'One', target: '壹', tmId: b })

const mergePreview = store.tmMaintenancePreview({ action: 'merge', sourceTmId: a, targetTmId: b })
assert.equal(mergePreview.total, 2)
assert.equal(mergePreview.duplicates, 1)
assert.equal(mergePreview.moved, 1)
assert.equal(store.tm.filter((entry) => entry.tmId === a).length, 2)

const merged = store.mergeTmLibraries({ sourceTmId: a, targetTmId: b, confirm: true })
assert.equal(merged.moved, 1)
assert.equal(merged.merged, 1)
assert.equal(store.tm.filter((entry) => entry.tmId === a).length, 0)
assert.equal(store.tm.filter((entry) => entry.tmId === b).length, 2)

// Dedupe is defensive: the normal write path already keeps one entry per key,
// but imports or older snapshots can contain duplicates.
store.tm.push({
  ...store.tm.find((entry) => entry.source === 'Two'),
  id: 'tm_manual_duplicate',
})
assert.equal(store.tm.filter((entry) => entry.tmId === b && entry.source === 'Two').length, 2)
const dedupePreview = store.tmMaintenancePreview({ action: 'dedupe', tmId: b })
assert.equal(dedupePreview.duplicates, 1)
const deduped = store.dedupeTmLibrary({ tmId: b, confirm: true })
assert.equal(deduped.removed, 1)
assert.equal(store.tm.filter((entry) => entry.tmId === b && entry.source === 'Two').length, 1)

const prunePreview = store.tmMaintenancePreview({ action: 'prune', tmId: b, sourceContains: 'one' })
assert.equal(prunePreview.matched, 1)
assert.equal(prunePreview.backup.length, 1)
const pruned = store.pruneTmLibrary({ tmId: b, sourceContains: 'one', confirm: true })
assert.equal(pruned.removed, 1)
assert.equal(store.tm.some((entry) => entry.source === 'One'), false)

console.log('test-tm-maintenance: all assertions passed')
