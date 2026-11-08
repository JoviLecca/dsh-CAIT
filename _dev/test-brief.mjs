import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

section('stable segment uid')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'UID',
    text: 'First sentence. Second sentence.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const doc = store.docs.get(created.document.id)
  const uids = doc.segments.map((segment) => segment.uid)
  assert.equal(uids.length, 2)
  assert.ok(uids.every((uid) => /^u_/.test(uid)))
  assert.equal(new Set(uids).size, 2)
  assert.equal(store.segmentView(doc.segments[0], 0).uid, uids[0])
  assert.equal(store.contextForTool({ index: 0 }).segment.uid, uids[0])
}

section('document brief')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Brief',
    text: 'Alpha one. Alpha two.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  assert.equal(store.getBrief().brief, null)

  store.setBrief({
    documentId: id,
    brief: { domain: 'gaming', tone: 'concise', notes: 'Keep item names.' },
  })
  assert.equal(store.getBrief({ documentId: id }).brief.domain, 'gaming')
  assert.equal(store.bootstrap().activeDocument.brief.tone, 'concise')

  store.setBrief({ documentId: id, brief: { tone: '', audience: 'Chinese players' } })
  const merged = store.getBrief({ documentId: id }).brief
  assert.equal(merged.domain, 'gaming')
  assert.equal(merged.audience, 'Chinese players')
  assert.equal(Object.hasOwn(merged, 'tone'), false)

  store.setBrief({ documentId: id, clear: true })
  assert.equal(store.getBrief({ documentId: id }).brief, null)

  assert.throws(() => store.setBrief({ documentId: id, brief: 'nope' }), /brief/)
}

section('context window')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Context',
    text: 'One. Two. Three. Four. Five.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  store.setBrief({ documentId: id, brief: { domain: 'docs' } })
  store.selectSegment({ index: 2 })
  const context = store.contextForTool({ before: 1, after: 1 })
  assert.equal(context.document.id, id)
  assert.equal(context.segment.index, 2)
  assert.equal(context.brief.domain, 'docs')
  assert.equal(context.paragraph.index, 0)
  assert.equal(context.paragraph.count, 1)
  assert.deepEqual(context.before.map((item) => item.index), [1])
  assert.deepEqual(context.after.map((item) => item.index), [3])
  assert.throws(() => store.contextForTool({ index: 99 }), /超出范围/)
}

section('unconfirm keeps TM')
{
  const store = new CatStore()
  store.createDocument({
    name: 'Unconfirm',
    text: 'Computer-aided translation tools help translators.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const submitted = store.submitTranslationForTool({ target: '计算机辅助翻译工具帮助译者。' })
  assert.equal(submitted.confirmed.status, 'confirmed')
  assert.equal(store.tm.length, 1)

  const revoked = store.unconfirmSegment({ index: 0 })
  assert.equal(revoked.segment.status, 'translated')
  assert.equal(revoked.segment.confirmedAt, null)
  assert.equal(store.tm.length, 1, 'unconfirm must not delete TM')
  assert.equal(store.bootstrap().activeDocument.progress.confirmed, 0)

  const again = store.confirmSegment({ index: 0, target: '计算机辅助翻译工具能帮助译者。' })
  assert.equal(again.confirmed.status, 'confirmed')
  assert.equal(store.tm.length, 1, 'reconfirm updates the same TM entry')
  assert.equal(store.tm[0].target, '计算机辅助翻译工具能帮助译者。')
}

section('editing a confirmed segment revokes confirmation')
{
  const store = new CatStore()
  store.createDocument({
    name: 'Edit confirmed',
    text: 'The quick brown fox jumps over the lazy dog.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  store.confirmSegment({ index: 0, target: '敏捷的棕色狐狸跳过了懒狗。' })
  assert.equal(store.tm[0].target, '敏捷的棕色狐狸跳过了懒狗。')

  store.saveDraft({ index: 0, target: '敏捷的棕狐狸跳过了懒狗。' })
  const edited = store.docs.values().next().value.segments[0]
  assert.equal(edited.status, 'translated')
  assert.equal(edited.confirmedAt, null)
  assert.equal(store.tm[0].target, '敏捷的棕色狐狸跳过了懒狗。', 'TM waits for the next confirmation')

  store.confirmSegment({ index: 0, target: edited.target })
  assert.equal(store.tm.length, 1)
  assert.equal(store.tm[0].target, '敏捷的棕狐狸跳过了懒狗。')
}

section('concordance searches source and target')
{
  const store = new CatStore()
  store.createDocument({
    name: 'Concordance',
    text: 'Translation memory helps. A glossary helps.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  store.confirmSegment({ index: 0, target: '翻译记忆库有帮助。' })
  store.confirmSegment({ index: 1, target: '术语库也有帮助。' })

  const bySource = store.concordance({ query: 'translation' })
  assert.equal(bySource.total, 1)
  assert.equal(bySource.entries[0].target, '翻译记忆库有帮助。')
  assert.ok(bySource.entries[0].context)

  const byTarget = store.concordance({ query: '术语库' })
  assert.equal(byTarget.total, 1)
  assert.equal(byTarget.entries[0].source, 'A glossary helps.')

  assert.equal(store.concordance({ query: 'missing' }).total, 0)
  assert.throws(() => store.concordance({ query: '' }), /检索|短语/)
}

section('v4 migration and reload')
{
  const dir = mkdtempSync(join(tmpdir(), 'cait-brief-'))
  const file = join(dir, 'store.json')
  try {
    writeFileSync(
      file,
      JSON.stringify({
        version: 4,
        activeDocId: 'doc_old',
        openDocIds: ['doc_old'],
        documents: [
          {
            id: 'doc_old',
            name: 'Old',
            sourceLang: 'en',
            targetLang: 'zh-CN',
            cursor: 0,
            segments: [{ id: 's1', source: 'Old source.', target: '', status: 'pending', paragraph: 0 }],
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
    assert.ok(doc.segments[0].uid)
    assert.equal(doc.brief, undefined)

    migrated.setBrief({ documentId: 'doc_old', brief: { domain: 'legacy' } })
    migrated.confirmSegment({ index: 0, target: '旧原文。' })
    const reloaded = new CatStore({ dataDir: dir, logger: { warn() {}, error() {} } })
    const again = reloaded.docs.get('doc_old')
    assert.equal(again.brief.domain, 'legacy')
    assert.equal(again.segments[0].uid, doc.segments[0].uid)
    assert.equal(again.segments[0].status, 'confirmed')
    assert.equal(reloaded.tm.length, 1)
    const snapshot = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(snapshot.version, 6)
    assert.equal(snapshot.documents[0].segments[0].uid, doc.segments[0].uid)
    assert.equal(snapshot.documents[0].tmIds, null)
    assert.equal(snapshot.documents[0].glossaryIds, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\nAll brief/uid/unconfirm checks passed.')
