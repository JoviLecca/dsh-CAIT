import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Pagination is pure arithmetic that decides which slice of the rail or the
// library table is visible. These checks run against the built bundle, so the
// browser executes exactly the functions verified here.

const root = new URL('..', import.meta.url)

function section(name) {
  console.log(`\n# ${name}`)
}

// Values built inside the vm realm carry that realm's prototypes, so compare
// their plain-JSON shape instead of object identity.
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const source = fs.readFileSync(new URL('client.js', root), 'utf8')
let definition
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (value) => {
        definition = value
      },
    },
  },
  document: { createElement: () => ({}), body: { appendChild() {} } },
  console,
}
vm.runInNewContext(source, sandbox, { filename: 'client.js' })

const fakeReact = {
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect() {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
}
const mod = definition.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require: ${name}`)
})

const {
  normalizePageSize,
  readPageSize,
  writePageSize,
  pageCount,
  clampPage,
  pageBounds,
  segmentNumberToIndex,
  pageSizeOptions,
  pageSizeDefault,
  pageSizeStorageKey,
  defaultFuzzyThreshold,
  fuzzyPercent,
} = mod.__test

section('page size options are the four documented sizes')
assert.deepEqual(plain(pageSizeOptions), [20, 50, 100, 200])
assert.equal(pageSizeDefault, 50)
assert.equal(pageSizeStorageKey, 'cait:pageSize')

section('normalizePageSize snaps to the nearest option')
assert.equal(normalizePageSize(20), 20)
assert.equal(normalizePageSize(35), 20)
assert.equal(normalizePageSize(49), 50)
assert.equal(normalizePageSize(51), 50)
assert.equal(normalizePageSize(120), 100)
assert.equal(normalizePageSize(1000), 200)
assert.equal(normalizePageSize('1'), 20)
assert.equal(normalizePageSize('abc'), 50)
assert.equal(normalizePageSize(null), 50)
assert.equal(normalizePageSize(undefined), 50)

section('page size persists through storage and survives a broken store')
function memoryStorage() {
  const data = new Map()
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

const storage = memoryStorage()
assert.equal(readPageSize(storage), 50)
writePageSize(storage, 120)
assert.equal(readPageSize(storage), 100)
assert.equal(storage.getItem('cait:pageSize'), '100')

const broken = {
  getItem() {
    throw new Error('denied')
  },
  setItem() {
    throw new Error('denied')
  },
}
assert.equal(readPageSize(broken), 50, 'a denied read falls back to the default')
assert.equal(
  writePageSize(broken, 200),
  200,
  'a denied write still returns the size to use in memory',
)
assert.equal(readPageSize(null), 50)

section('pageCount and clampPage keep the page inside the data')
assert.equal(pageCount(0, 50), 1, 'an empty list still has one (empty) page')
assert.equal(pageCount(1, 50), 1)
assert.equal(pageCount(50, 50), 1)
assert.equal(pageCount(51, 50), 2)
assert.equal(pageCount(200, 20), 10)
assert.equal(clampPage(0, 200, 20), 1)
assert.equal(clampPage(1, 200, 20), 1)
assert.equal(clampPage(5, 200, 20), 5)
assert.equal(clampPage(99, 200, 20), 10)
assert.equal(clampPage(-3, 0, 50), 1)

section('pageBounds reports a 1-based inclusive window')
assert.deepEqual(plain(pageBounds(1, 120, 20)), {
  page: 1,
  pageSize: 20,
  start: 1,
  end: 20,
  total: 120,
  pages: 6,
})
assert.deepEqual(plain(pageBounds(2, 120, 20)), {
  page: 2,
  pageSize: 20,
  start: 21,
  end: 40,
  total: 120,
  pages: 6,
})
assert.deepEqual(plain(pageBounds(6, 120, 20)), {
  page: 6,
  pageSize: 20,
  start: 101,
  end: 120,
  total: 120,
  pages: 6,
})
assert.deepEqual(plain(pageBounds(3, 121, 50)), {
  page: 3,
  pageSize: 50,
  start: 101,
  end: 121,
  total: 121,
  pages: 3,
})
assert.deepEqual(plain(pageBounds(9, 120, 20)), {
  page: 6,
  pageSize: 20,
  start: 101,
  end: 120,
  total: 120,
  pages: 6,
})
assert.deepEqual(plain(pageBounds(1, 0, 50)), {
  page: 1,
  pageSize: 50,
  start: 0,
  end: 0,
  total: 0,
  pages: 1,
})

section('segmentNumberToIndex converts a typed number to a 0-based index')
assert.equal(segmentNumberToIndex('1', 10), 0)
assert.equal(segmentNumberToIndex('10', 10), 9)
assert.equal(segmentNumberToIndex(' 3 ', 10), 2)
assert.equal(segmentNumberToIndex('0', 10), null)
assert.equal(segmentNumberToIndex('11', 10), null)
assert.equal(segmentNumberToIndex('-1', 10), null)
assert.equal(segmentNumberToIndex('1.5', 10), null)
assert.equal(segmentNumberToIndex('abc', 10), null)
assert.equal(segmentNumberToIndex('', 10), null)
assert.equal(segmentNumberToIndex('1', 0), null)

section('the fuzzy threshold default is 70%, and the reset button keys off it')
assert.equal(defaultFuzzyThreshold, 0.7)
assert.equal(fuzzyPercent(defaultFuzzyThreshold), 70)
assert.equal(fuzzyPercent('0.85'), 85)
assert.equal(fuzzyPercent(0.3), 30)
assert.equal(fuzzyPercent('nonsense'), 70)

console.log('\nALL PAGINATION TESTS PASSED')
