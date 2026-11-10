import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { mountWorkbench } from './lib/workbench-harness.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- the probe itself -------------------------------------------------------
const dataDir = mkdtempSync(join(tmpdir(), 'cait-sync-'))
const store = new CatStore({ dataDir })
try {
  store.loadDemo()
  const before = store.revision
  const probe = JSON.stringify(store.currentRevision())
  const full = JSON.stringify(store.bootstrap())
  assert.match(probe, /^\{"revision":\d+\}$/)
  assert.ok(probe.length < 100, `probe should be tiny, got ${probe.length} bytes`)
  assert.ok(
    full.length > probe.length * 10,
    `bootstrap (${full.length}B) should dwarf the probe (${probe.length}B)`,
  )

  store.saveSettings({ fuzzyThreshold: 0.5 })
  assert.notEqual(store.revision, before, 'a mutation must advance the revision')
  assert.equal(store.currentRevision().revision, store.revision)
} finally {
  store.flushPersist()
  rmSync(dataDir, { recursive: true, force: true })
}

// --- idle polling must not refetch the document -----------------------------
const harness = await mountWorkbench()
try {
  const bootstraps = () => harness.calls.filter((call) => call.method === 'bootstrap').length
  const probes = () => harness.calls.filter((call) => call.method === 'currentRevision').length

  const initial = bootstraps()
  assert.equal(initial, 1, 'mounting should bootstrap exactly once')
  await sleep(3000)

  assert.equal(bootstraps(), initial, 'an idle poll must not transfer the document again')
  assert.ok(probes() >= 1, 'the poll should ask for the revision instead')
} finally {
  await harness.unmount()
}

console.log('sync: revision probe and idle poll ok')
