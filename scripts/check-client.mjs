import { readFileSync } from 'node:fs'
import { buildClientSource, clientBundlePath } from './lib/client-source.mjs'

const expected = await buildClientSource()

try {
  new Function(expected)
} catch (error) {
  console.error(`client/ 构建产物语法不合法: ${error.message}`)
  process.exit(1)
}

const actual = readFileSync(clientBundlePath, 'utf8')
if (actual === expected) {
  console.log('client.js 与 client/ 源码一致')
  process.exit(0)
}

const expectedLines = expected.split('\n')
const actualLines = actual.split('\n')
let index = 0
while (
  index < expectedLines.length &&
  index < actualLines.length &&
  expectedLines[index] === actualLines[index]
) {
  index += 1
}

console.error('client.js 已过期：请运行 npm run build:client 并提交结果')
console.error(`首个差异在第 ${index + 1} 行`)
console.error(`  期望: ${JSON.stringify((expectedLines[index] ?? '').slice(0, 120))}`)
console.error(`  实际: ${JSON.stringify((actualLines[index] ?? '').slice(0, 120))}`)
console.error(`行数：期望 ${expectedLines.length}，实际 ${actualLines.length}`)
process.exit(1)
