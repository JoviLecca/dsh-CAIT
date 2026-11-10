// 端到端：挂载 → 选中句段 → 输入译文 → 确认，必须真的落到 store。
// 这条链覆盖 rpc() 的请求体、handler 分发、store 变更、adoptState 重渲染。
import { mountWorkbench } from './lib/workbench-harness.mjs'

const ui = await mountWorkbench({
  prepare({ store }) {
    store.createDocument({ name: 'Demo', text: 'Hello world.\nSecond line.' })
  },
})
try {
  assert(ui.text().includes('Hello world.'), '句段轨道应显示原文')
  assert(ui.text().includes('1 / 2'), `应显示第一句共两句，实际：${ui.text().slice(0, 80)}`)

  const textarea = ui.query('textarea')
  assert(textarea, '应有译文输入框')
  await ui.type(textarea, '你好，世界。')

  const button = ui.byText('确认并写入记忆库')
  assert(button, '应有确认按钮')
  await ui.click(button)

  const methodNames = ui.calls.map((call) => call.method)
  const confirmCall = ui.calls.find((call) => call.method === 'confirmSegment')
  assert(confirmCall, `应调用 confirmSegment，实际：${methodNames.join(',')}`)
  assert(confirmCall.params.target === '你好，世界。', '请求应带上刚输入的译文')

  const doc = ui.store.bootstrap().activeDocument
  assert(doc.segments[0].target === '你好，世界。', `译文未写入：${doc.segments[0].target}`)
  assert(doc.segments[0].status === 'confirmed', `状态应为 confirmed：${doc.segments[0].status}`)
  assert(ui.text().includes('你好，世界。'), '界面应显示新译文')
  console.log('ok test-workbench-flow')
} finally {
  await ui.unmount()
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exit(1)
  }
}
