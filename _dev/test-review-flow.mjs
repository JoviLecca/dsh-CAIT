/**
 * AI 审校在界面上的实际行为：范围是「当前页」，长于一页的文档按 20 段分批，
 * 结果合并后按 severity/index 排序。这里用真实的 CatStore + 假模型路由跑完整条链。
 */
import assert from 'node:assert/strict'
import { mountWorkbench } from './lib/workbench-harness.mjs'

function section(title) {
  console.log(`\n== ${title} ==`)
}

const sentences = Array.from({ length: 25 }, (_, index) => `Line ${index + 1} is here.`).join(' ')

const openQa = async (ui) => {
  // The tab carries a count badge once rule-based checks find something, so the
  // label is "检查4" rather than "检查".
  const tab = ui
    .queryAll('.cait-tab')
    .find((element) => element.textContent.trim().startsWith('检查'))
  assert.ok(tab, 'the QA tab is present')
  await ui.click(tab)
}

section('review runs the page in 20-segment batches and merges the issues')
{
  const prompts = []
  const ui = await mountWorkbench({
    prepare({ store }) {
      store.createDocument({
        name: 'Review flow',
        text: sentences,
        sourceLang: 'en',
        targetLang: 'zh-CN',
      })
      store.resolveReviewRoute = async () => ({
        mock: false,
        provider: 'test-provider',
        model: 'test-model',
        note: '',
      })
      store.mtRuntime = {
        stream: async function* stream(options) {
          const prompt = options.messages[0].content[0].text
          prompts.push(prompt)
          const first = Number(/\[S(\d+)\]/.exec(prompt)?.[1] ?? 0)
          yield {
            type: 'text-delta',
            text: JSON.stringify([
              {
                index: first,
                severity: 'medium',
                code: 'STYLE',
                message: `Tune ${first}`,
                suggestion: `Better ${first}`,
              },
            ]),
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  })

  try {
    await openQa(ui)
    assert.ok(ui.byText('审校本页'), 'the QA panel offers a page-sized review')
    await ui.click('审校本页')

    const calls = ui.calls.filter((call) => call.method === 'reviewDocument')
    assert.equal(calls.length, 2, `expected two batches, got ${calls.length}`)
    assert.equal(calls[0].params.indexes.length, 20)
    assert.deepEqual(
      calls[1].params.indexes,
      [20, 21, 22, 23, 24],
      'the second batch carries the rest of the page',
    )
    assert.ok(prompts[0].includes('[S0]') && prompts[0].includes('[S19]'))
    assert.ok(!prompts[0].includes('[S20]'), 'the first batch stops at 20 segments')

    const text = ui.text()
    assert.ok(
      text.includes('已审 25/25 段'),
      `progress should read 25/25, got: ${text.slice(0, 400)}`,
    )
    assert.ok(
      text.includes('Tune 0') && text.includes('Tune 20'),
      `both batches are merged, got: ${text.slice(-600)}`,
    )
    assert.equal(ui.queryAll('.cait-reviewrow').length, 2)
  } finally {
    await ui.unmount()
  }
}

section('review only reports the segments it asked about')
{
  const ui = await mountWorkbench({
    prepare({ store }) {
      store.createDocument({
        name: 'Sparse review',
        text: 'Alpha one. Beta two. Gamma three.',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      })
      for (let index = 0; index < 3; index += 1) {
        store.saveDraft({ documentId: store.activeDocument().id, index, target: `T${index}` })
      }
      store.resolveReviewRoute = async () => ({
        mock: false,
        provider: 'test-provider',
        model: 'test-model',
        note: '',
      })
      store.mtRuntime = {
        stream: async function* stream() {
          yield {
            type: 'text-delta',
            text: JSON.stringify([
              { index: 0, severity: 'low', code: 'STYLE', message: 'Not requested.' },
              { index: 2, severity: 'high', code: 'OMISSION', message: 'Requested.' },
            ]),
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  })

  try {
    // 直接走 store：索引 2 单独送审时，模型顺带返回的 0 必须被丢掉。
    const result = await ui.store.reviewDocument({
      documentId: ui.store.activeDocument().id,
      indexes: [2],
    })
    assert.deepEqual(result.indexes, [2])
    assert.deepEqual(
      result.issues.map((issue) => issue.index),
      [2],
    )
  } finally {
    await ui.unmount()
  }
}

section('a stored issue can be ignored and filtered')
{
  const ui = await mountWorkbench({
    prepare({ store }) {
      store.createDocument({
        name: 'Review states',
        text: 'Alpha one. Beta two. Gamma three.',
        sourceLang: 'en',
        targetLang: 'zh-CN',
      })
      for (let index = 0; index < 3; index += 1) {
        store.saveDraft({ documentId: store.activeDocument().id, index, target: `T${index}` })
      }
      store.resolveReviewRoute = async () => ({
        mock: false,
        provider: 'test-provider',
        model: 'test-model',
        note: '',
      })
      store.mtRuntime = {
        stream: async function* stream() {
          yield {
            type: 'text-delta',
            text: JSON.stringify([
              { index: 0, severity: 'high', code: 'OMISSION', message: 'Missing clause.' },
            ]),
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  })

  try {
    await openQa(ui)
    await ui.click('审校本页')
    assert.equal(ui.queryAll('.cait-reviewrow').length, 1)
    assert.ok(ui.text().includes('待处理'), 'a fresh issue starts open')
    assert.ok(ui.byText('待处理 1'), 'the filter chips count the open issue')

    const row = ui.queryAll('.cait-reviewrow')[0]
    const ignore = [...row.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === '忽略',
    )
    assert.ok(ignore, 'each row offers an ignore action')
    await ui.click(ignore)
    await ui.settle()

    assert.equal(
      ui.store.bootstrap().activeDocument.review.issues[0].status,
      'ignored',
      'the decision is persisted on the document',
    )
    assert.ok(ui.byText('已忽略 1'), 'the chips recount after the change')

    await ui.click('已处理 0')
    assert.ok(ui.text().includes('当前筛选下没有条目。'), 'an empty filter says so')

    await ui.click('全部 1')
    assert.ok(ui.text().includes('已忽略'), 'the row shows its stored status')
    assert.equal(ui.queryAll('.cait-reviewrow').length, 1)
  } finally {
    await ui.unmount()
  }
}

console.log('\nALL REVIEW FLOW TESTS PASSED')
