import assert from 'node:assert/strict'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

function makeDoc(store, text = 'Button one. Button two. Done.') {
  const created = store.createDocument({
    name: 'Replace',
    text,
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  return created.document.id
}

section('preview target matches')
{
  const store = new CatStore()
  const id = makeDoc(store)
  store.saveDraft({ documentId: id, index: 0, target: '按钮一' })
  store.saveDraft({ documentId: id, index: 1, target: '按钮二' })
  const preview = store.replaceInDocument({
    documentId: id,
    query: '按钮',
    replacement: '按键',
    scope: 'target',
  })
  assert.equal(preview.total, 2)
  assert.equal(preview.changed, 2)
  assert.equal(preview.matches[0].field, 'target')
  assert.equal(preview.matches[0].after, '按键一')
  assert.equal(store.docs.get(id).segments[0].target, '按钮一')
}

section('apply and undo target replacement')
{
  const store = new CatStore()
  const id = makeDoc(store)
  store.saveDraft({ documentId: id, index: 0, target: '按钮一' })
  store.saveDraft({ documentId: id, index: 1, target: '按钮二' })
  const result = store.replaceInDocument({
    documentId: id,
    query: '按钮',
    replacement: '按键',
    scope: 'target',
    apply: true,
  })
  assert.equal(result.applied, 2)
  assert.equal(result.changed, 2)
  assert.equal(result.undo.length, 2)
  const doc = store.docs.get(id)
  assert.equal(doc.segments[0].target, '按键一')
  assert.equal(doc.segments[1].target, '按键二')
  store.undoReplace({ documentId: id, undo: result.undo })
  assert.equal(doc.segments[0].target, '按钮一')
  assert.equal(doc.segments[1].target, '按钮二')
}

section('target replacement invalidates confirmation')
{
  const store = new CatStore()
  const id = makeDoc(store)
  store.saveDraft({ documentId: id, index: 0, target: '按钮一' })
  store.confirmSegment({ documentId: id, index: 0 })
  const doc = store.docs.get(id)
  assert.equal(doc.segments[0].status, 'confirmed')
  store.replaceInDocument({
    documentId: id,
    query: '按钮',
    replacement: '按键',
    scope: 'target',
    apply: true,
  })
  assert.equal(doc.segments[0].confirmedAt, null)
  assert.equal(doc.segments[0].status, 'translated')
  assert.equal(store.tm.length, 1)
  assert.equal(store.tm[0].target, '按钮一')
}

section('source regex replacement')
{
  const store = new CatStore()
  const id = makeDoc(store, 'Button one. Button two. Done.')
  const result = store.replaceInDocument({
    documentId: id,
    query: 'button',
    replacement: 'Control',
    scope: 'source',
    regex: false,
    matchCase: false,
    apply: true,
  })
  assert.equal(result.applied, 2)
  const doc = store.docs.get(id)
  assert.equal(doc.segments[0].source, 'Control one.')
  assert.equal(doc.segments[1].source, 'Control two.')
  assert.equal(doc.segments[2].source, 'Done.')
}

section('invalid regex is reported')
{
  const store = new CatStore()
  const id = makeDoc(store)
  assert.throws(
    () => store.replaceInDocument({ documentId: id, query: '(', replacement: '', regex: true }),
    (error) => error.code === 'INVALID_REGEX',
  )
}

section('empty query is rejected')
{
  const store = new CatStore()
  const id = makeDoc(store)
  assert.throws(
    () => store.replaceInDocument({ documentId: id, query: '', replacement: 'x' }),
    (error) => error.code === 'EMPTY_REPLACE_QUERY',
  )
}

console.log('\nALL REPLACE TESTS PASSED')
