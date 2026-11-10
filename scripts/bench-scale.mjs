// Read-only scale benchmark for the paths that grow with document size and TM
// size. It exists to answer one question before changing the wire protocol:
// is the full-snapshot response actually the thing that hurts at 20k segments?
//
//   node scripts/bench-scale.mjs                    # 20k segments, 10k TM entries
//   node scripts/bench-scale.mjs --segments 500 --tm 2000   # a typical document
//
// Everything runs in a temporary data dir with persistence enabled, so the
// write path includes JSON.stringify plus the atomic file write. The read path
// is measured twice — before and after the TM is filled — because
// `segmentDetail` scans the whole memory and that cost otherwise hides inside
// the bootstrap number.
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'
import { MUTATIONS, createHandlers } from '../lib/api.js'
import { DEFAULT_TM_ID } from '../lib/limits.js'
import { makeId, now } from '../lib/text-utils.js'
import { normalizeText } from '../lib/similarity.js'

const argv = process.argv.slice(2)
function argOf(name, fallback) {
  const index = argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(argv[index + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const SEGMENTS = argOf('--segments', 20000)
const TM_ENTRIES = argOf('--tm', 10000)
const BULK_PROBE = Math.min(2000, TM_ENTRIES)

const dataDir = mkdtempSync(join(tmpdir(), 'cait-bench-'))
const store = new CatStore({ dataDir, logger: { error() {}, warn() {}, log() {} } })
const handlers = createHandlers(store)

const rows = []
function record(group, label, ms, size) {
  rows.push({ group, label, ms, size })
}
function time(fn) {
  const start = process.hrtime.bigint()
  const value = fn()
  return { value, ms: Number(process.hrtime.bigint() - start) / 1e6 }
}
function median(fn, repeat = 3) {
  const samples = []
  let value
  for (let index = 0; index < repeat; index += 1) {
    const sample = time(fn)
    samples.push(sample.ms)
    value = sample.value
  }
  samples.sort((a, b) => a - b)
  return { value, ms: samples[Math.floor(samples.length / 2)] }
}
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value))

// ---------------------------------------------------------------- setup

const sources = Array.from({ length: SEGMENTS }, (_, index) => ({
  source: `The quick brown fox jumps over the lazy dog while the diligent translator reviews sentence ${index + 1}.`,
}))
const created = time(() => store.createDocument({ segments: sources }))
const documentId = created.value.document.id
record('setup', `create document (${SEGMENTS} segments)`, created.ms)

// ------------------------------------------------------------ read, no TM yet

const doc = store.activeDocument()
const middle = Math.floor(SEGMENTS / 2)
const at = (offset) => Math.min(offset, SEGMENTS - 1)

function measureReadPath(group) {
  const state = store.bootstrap()
  record(
    group,
    `bootstrap() ${SEGMENTS} segments`,
    median(() => store.bootstrap()).ms,
    mb(jsonBytes(state)),
  )
  record(
    group,
    'JSON.stringify(state) (wire cost)',
    median(() => JSON.stringify(state)).ms,
    mb(jsonBytes(state)),
  )
  record(group, 'documentView() (bootstrap body)', median(() => store.documentView(doc)).ms)
  record(group, 'segmentDetail()', median(() => store.segmentDetail(doc, at(middle + 1))).ms)
  record(group, 'selectSegment() (click)', median(() => store.selectSegment({ index: middle })).ms)
}

measureReadPath('read/TM=0')

// ---------------------------------------------------------------- fill the TM

const pairs = Array.from({ length: BULK_PROBE }, (_, index) => ({
  source: `Bulk memory source line ${index + 1}`,
  target: `批量记忆库译文第 ${index + 1} 行`,
}))
const imported = time(() => store.importTM({ pairs, sourceLang: 'en', targetLang: 'zh-CN' }))
record('setup', `importTM (${BULK_PROBE} pairs, identity index)`, imported.ms)
const perPair = imported.ms / BULK_PROBE

// Pushing the remaining rows straight into `this.tm` keeps the probe above
// honest: filling through `upsertTM` would also pay one persist per call.
// Rows below are pushed directly so the measured paths start from a realistic
// table size instead of paying setup cost.
const stamp = now()
for (let index = store.tm.length; index < TM_ENTRIES; index += 1) {
  const source = `Bulk memory source line ${index + 1}`
  store.tm.push({
    id: makeId('tm'),
    tmId: DEFAULT_TM_ID,
    key: normalizeText(source),
    source,
    target: `批量记忆库译文第 ${index + 1} 行`,
    sourceLang: 'en',
    targetLang: 'zh-CN',
    context: null,
    contextHash: null,
    createdAt: stamp,
    updatedAt: stamp,
  })
}
store.touch()

measureReadPath(`read/TM=${TM_ENTRIES}`)

// ---------------------------------------------------------------- write path

const confirmed = time(() =>
  store.confirmSegment({ index: at(100), target: '人工确认的译文。', addToTm: true }),
)
record('write', 'confirmSegment() (undo record + persist)', confirmed.ms)

const apiConfirmed = time(() => {
  const result = handlers.confirmSegment({ index: at(101), target: '人工确认的译文。' })
  // registerCatApi appends the full bootstrap state to every mutation.
  const body = MUTATIONS.has('confirmSegment') ? { ...result, state: store.bootstrap() } : result
  return JSON.stringify(body)
})
record('write', 'API confirmSegment + state', apiConfirmed.ms, mb(apiConfirmed.value.length))

const draft = time(() => handlers.saveDraft({ index: at(102), target: '草稿' }))
record('write', 'API saveDraft (debounced path)', draft.ms)

const persisted = time(() => store.persist({ strict: true }))
record('storage', 'persist() full store', persisted.ms)

// ---------------------------------------------------------------- report

const pad = (value, width) => String(value).padEnd(width)
console.log('')
console.log(
  `CAIT scale benchmark — ${SEGMENTS.toLocaleString()} segments, ${TM_ENTRIES.toLocaleString()} TM entries`,
)
console.log(`node ${process.version}, ${process.platform}, document ${documentId}`)
console.log('')
console.log(`${pad('', 12)}${pad('path', 40)}${pad('median', 12)}payload`)
console.log('-'.repeat(82))
for (const row of rows) {
  console.log(
    `${pad(row.group, 12)}${pad(row.label, 40)}${pad(`${row.ms.toFixed(1)} ms`, 12)}${row.size || ''}`,
  )
}
console.log('')
console.log(`store.json on disk: ${mb(statSync(join(dataDir, 'store.json')).size)}`)
console.log(
  `importTM cost at ${BULK_PROBE.toLocaleString()} existing entries: ${perPair.toFixed(2)} ms/pair ` +
    `(identity index; the linear-update path is gone)`,
)
console.log(
  `budget check: write ${apiConfirmed.ms.toFixed(0)} ms / ${(apiConfirmed.value.length / 1024 / 1024).toFixed(2)} MB ` +
    `(target: under 200 ms and 2 MB per write)`,
)
console.log('')

rmSync(dataDir, { recursive: true, force: true })
