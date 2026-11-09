import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

function section(title) {
  console.log(`\n== ${title} ==`)
}

section('lock blocks edits, confirmation and replacement')
{
  const store = new CatStore()
  const created = store.createDocument({
    name: 'Lock',
    text: 'Alpha term. Beta term.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const id = created.document.id
  store.saveDraft({ documentId: id, index: 0, target: '阿尔法' })
  store.saveDraft({ documentId: id, index: 1, target: '贝塔' })
  store.docs.get(id).segments[1].origin = 'mt'

  const locked = store.setSegmentLocked({ documentId: id, index: 0, locked: true })
  assert.equal(locked.locked, true)
  assert.equal(store.segmentView(store.docs.get(id).segments[0], 0).locked, true)
  assert.throws(
    () => store.saveDraft({ documentId: id, index: 0, target: '改掉' }),
    /已锁定/,
  )
  assert.throws(
    () => store.confirmSegment({ documentId: id, index: 0 }),
    /已锁定/,
  )

  const preview = store.replaceInDocument({ documentId: id, query: 'term', scope: 'source', replacement: 'TERM', apply: false })
  assert.equal(preview.matches.some((item) => item.index === 0), false)
  assert.equal(preview.matches.some((item) => item.index === 1), true)

  const cleared = store.clearUnconfirmedTranslations({ documentId: id, confirm: true })
  assert.equal(cleared.cleared, 1, 'only the unlocked pretranslated segment is cleared')
  assert.equal(store.docs.get(id).segments[0].target, '阿尔法')
  assert.equal(store.docs.get(id).segments[1].target, '')

  store.setSegmentLocked({ documentId: id, index: 0, locked: false })
  store.saveDraft({ documentId: id, index: 0, target: '阿尔法二号' })
  assert.equal(store.docs.get(id).segments[0].target, '阿尔法二号')
}

section('locked survives persistence')
{
  const dir = mkdtempSync(join(tmpdir(), 'cait-lock-'))
  try {
    const store = new CatStore({ dataDir: dir })
    const created = store.createDocument({
      name: 'Persist',
      text: 'One segment.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    store.setSegmentLocked({ documentId: created.document.id, index: 0, locked: true })
    store.persist()
    const reloaded = new CatStore({ dataDir: dir })
    assert.equal(reloaded.docs.get(created.document.id).segments[0].locked, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\nALL LOCK TESTS PASSED')
