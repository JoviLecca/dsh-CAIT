// 挂载冒烟：bootstrap 后界面必须进到工作台（而不是停在校验/错误分支）。
import { mountWorkbench } from './lib/workbench-harness.mjs'

const ui = await mountWorkbench()
try {
  const text = ui.text()
  assert(!text.includes('加载失败'), '界面不应显示加载失败')
  assert(
    ui.calls.some((call) => call.method === 'bootstrap'),
    '应当调用 bootstrap',
  )
  assert(text.trim().length > 0, '界面不应是空白')
  console.log('ok test-workbench-mount')
} finally {
  await ui.unmount()
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exit(1)
  }
}
