import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatStore } from '../lib/store.js'

const silent = { warn() {}, error() {} }
const roots = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cait-review-'))
  roots.push(dir)
  return dir
}

function section(title) {
  console.log(`\n== ${title} ==`)
}

function makeStore(dataDir) {
  const store = new CatStore({ dataDir, logger: silent })
  const created = store.createDocument({
    name: 'Review report',
    text: 'Alpha one. Beta two. Gamma three.',
    sourceLang: 'en',
    targetLang: 'zh-CN',
  })
  const documentId = created.document.id
  for (const [index, target] of [
    [0, 'A1'],
    [1, 'B1'],
    [2, 'C1'],
  ]) {
    store.saveDraft({ documentId, index, target })
  }
  store.resolveMtRoute = async () => ({
    mock: false,
    provider: 'test-provider',
    model: 'test-model',
    note: '',
  })
  return { store, documentId }
}

function respond(store, issues) {
  store.mtRuntime = {
    stream: async function* stream() {
      yield { type: 'text-delta', text: JSON.stringify(issues) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

try {
  section('the review report lives on the document and is persisted')
  {
    const dataDir = tempDir()
    const { store, documentId } = makeStore(dataDir)
    respond(store, [
      { index: 0, severity: 'high', code: 'MISTRANSLATION', message: 'Meaning changed.' },
      { index: 1, severity: 'medium', code: 'STYLE', message: 'Tone is flat.' },
    ])
    const result = await store.reviewDocument({ documentId, indexes: [0, 1] })
    assert.equal(result.issues.length, 2)

    const view = store.bootstrap().activeDocument
    assert.equal(view.review.issues.length, 2)
    assert.deepEqual(
      view.review.issues.map((issue) => issue.status),
      ['open', 'open'],
    )
    const snapshot = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf8'))
    assert.equal(snapshot.documents[0].review.issues.length, 2)
  }

  section('a status change survives a reload')
  {
    const dataDir = tempDir()
    const { store, documentId } = makeStore(dataDir)
    respond(store, [{ index: 0, severity: 'high', code: 'X', message: 'Needs work.' }])
    await store.reviewDocument({ documentId, indexes: [0] })
    store.setReviewIssueState({ documentId, index: 0, status: 'applied' })

    const reloaded = new CatStore({ dataDir, logger: silent })
    const issue = reloaded.bootstrap().activeDocument.review.issues[0]
    assert.equal(issue.status, 'applied')
    assert.equal(issue.message, 'Needs work.')
  }

  section('confirming a segment marks its open issue handled')
  {
    const { store, documentId } = makeStore()
    respond(store, [
      { index: 0, severity: 'high', code: 'X', message: 'Needs work.' },
      { index: 1, severity: 'low', code: 'Y', message: 'Ignored on purpose.' },
    ])
    await store.reviewDocument({ documentId, indexes: [0, 1] })
    store.setReviewIssueState({ documentId, index: 1, status: 'ignored' })
    store.confirmSegment({ documentId, index: 0, addToTm: false })
    store.confirmSegment({ documentId, index: 1, addToTm: false })

    const issues = store.bootstrap().activeDocument.review.issues
    assert.equal(issues[0].status, 'applied')
    assert.equal(issues[1].status, 'ignored', 'an explicit decision is not overwritten')
  }

  section('re-running keeps the decision for the same finding')
  {
    const { store, documentId } = makeStore()
    respond(store, [{ index: 0, severity: 'high', code: 'X', message: 'Needs work.' }])
    await store.reviewDocument({ documentId, indexes: [0] })
    store.setReviewIssueState({ documentId, index: 0, status: 'ignored' })
    await store.reviewDocument({ documentId, indexes: [0] })
    assert.equal(store.bootstrap().activeDocument.review.issues[0].status, 'ignored')

    respond(store, [{ index: 0, severity: 'high', code: 'Z', message: 'A new problem.' }])
    await store.reviewDocument({ documentId, indexes: [0] })
    const issues = store.bootstrap().activeDocument.review.issues
    assert.equal(issues.length, 1, 'one row per segment')
    assert.equal(issues[0].status, 'open')
    assert.equal(issues[0].message, 'A new problem.')
  }

  section('the report exports as csv and markdown')
  {
    const { store, documentId } = makeStore()
    respond(store, [
      { index: 0, severity: 'high', code: 'X', message: 'Needs, "quotes"', suggestion: 'Fixed.' },
    ])
    await store.reviewDocument({ documentId, indexes: [0] })

    const csv = store.exportReview({ documentId, format: 'csv' })
    assert.match(csv.filename, /\.review\.csv$/)
    assert.equal(csv.count, 1)
    const lines = csv.content.trim().split('\n')
    assert.equal(lines[0], 'index,severity,status,code,message,suggestion,source,target')
    assert.ok(lines[1].startsWith('1,high,open,X,"Needs, ""quotes""",Fixed.,Alpha one.,A1'))
    assert.equal(lines[1].split(',A1').length, 2)

    const markdown = store.exportReview({ documentId, format: 'markdown' })
    assert.match(markdown.filename, /\.review\.md$/)
    assert.match(markdown.content, /^# Review report — AI review/)
    assert.match(markdown.content, /\| 1 \| high \| open \| X \|/)
    assert.match(markdown.content, /Needs, "quotes"/)

    assert.throws(
      () => store.exportReview({ documentId, format: 'pdf' }),
      (error) => error.code === 'REVIEW_FORMAT_INVALID',
    )
  }

  section('exporting without a report fails with a code')
  {
    const { store, documentId } = makeStore()
    assert.throws(
      () => store.exportReview({ documentId, format: 'csv' }),
      (error) => error.code === 'REVIEW_NOT_FOUND',
    )
  }

  section('clearing the report empties it for good')
  {
    const dataDir = tempDir()
    const { store, documentId } = makeStore(dataDir)
    respond(store, [{ index: 0, severity: 'low', code: 'X', message: 'Style.' }])
    await store.reviewDocument({ documentId, indexes: [0] })
    assert.equal(store.clearReview({ documentId }).cleared, 1)
    assert.equal(store.bootstrap().activeDocument.review.issues.length, 0)

    const reloaded = new CatStore({ dataDir, logger: silent })
    assert.equal(reloaded.bootstrap().activeDocument.review.issues.length, 0)
  }

  section('restore drops malformed rows instead of failing the load')
  {
    const dataDir = tempDir()
    const { store, documentId } = makeStore(dataDir)
    respond(store, [{ index: 2, severity: 'low', code: 'X', message: 'Style.' }])
    await store.reviewDocument({ documentId, indexes: [2] })

    const file = join(dataDir, 'store.json')
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    payload.documents[0].review = {
      updatedAt: 'not-a-date',
      issues: [
        { index: 'zero', message: 'Bad index.' },
        { index: 0, message: '   ' },
        { index: 2, severity: 'weird', message: 'Kept.', status: 'bogus' },
        { index: 1, severity: 'high', message: 'Kept too.', status: 'ignored' },
      ],
    }
    writeFileSync(file, JSON.stringify(payload), 'utf8')

    const reloaded = new CatStore({ dataDir, logger: silent })
    const review = reloaded.bootstrap().activeDocument.review
    assert.equal(review.issues.length, 2)
    assert.equal(review.issues[0].index, 1)
    assert.equal(review.issues[0].status, 'ignored')
    assert.equal(review.issues[1].severity, 'medium')
    assert.equal(review.issues[1].status, 'open')
    assert.ok(!Number.isNaN(Date.parse(review.updatedAt)))
  }

  console.log('\nok review report')
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}
