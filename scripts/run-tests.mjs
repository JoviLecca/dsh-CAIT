import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 测试入口。
 *
 * 每个 `_dev/test-*.mjs` 都是独立进程，靠退出码判定成败。这里刻意把子进程
 * 输出写到临时文件而不是管道：沙箱环境下管道会被拒绝（EPERM），而且失败时
 * 我们本来就只需要看最后几十行。
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const devDir = join(root, '_dev')
const filter = process.argv[2] || ''
const names = readdirSync(devDir)
  .filter((name) => /^test-.*\.mjs$/.test(name))
  .filter((name) => !filter || name.includes(filter))
  .sort()

if (!names.length) {
  console.error(`没有找到匹配的测试：_dev/test-*.mjs${filter ? ` (filter: ${filter})` : ''}`)
  process.exit(1)
}

const logDir = mkdtempSync(join(tmpdir(), 'cait-tests-'))
const failures = []
const startedAt = Date.now()

for (const [index, name] of names.entries()) {
  const logPath = join(logDir, `${name}.log`)
  const fd = openSync(logPath, 'w')
  const result = spawnSync(process.execPath, [join(devDir, name)], {
    cwd: root,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)

  if (result.status === 0) {
    console.log(`ok   ${name} (${index + 1}/${names.length})`)
  } else {
    failures.push({ name, logPath, error: result.error })
    console.log(`FAIL ${name} (${index + 1}/${names.length})`)
  }
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
if (failures.length) {
  for (const failure of failures) {
    console.error(`\n===== ${failure.name} =====`)
    if (failure.error) console.error(failure.error.message)
    else console.error(readFileSync(failure.logPath, 'utf8').split('\n').slice(-40).join('\n'))
  }
  console.error(`\n${failures.length} 个套件失败（共 ${names.length} 个，${seconds}s）`)
  process.exit(1)
}

console.log(`\n全部通过：${names.length} 个套件，${seconds}s`)
