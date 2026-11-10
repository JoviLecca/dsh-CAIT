/**
 * Shared-constant guard.
 *
 * The browser bundle cannot import from `lib/`, so a few values are written
 * twice: once for the server and once for the client. That is fine as long as
 * the copies agree; this check is the wire that keeps them agreeing.
 */
import assert from 'node:assert/strict'
import * as clientHelpers from '../client/helpers.js'
import { PAGE_SIZE_OPTIONS, PAGE_SIZE_DEFAULT } from '../lib/library-view.js'
import { DEFAULT_FUZZY_THRESHOLD as SERVER_FUZZY_THRESHOLD } from '../lib/settings.js'

const pairs = [
  ['PAGE_SIZE_OPTIONS', clientHelpers.PAGE_SIZE_OPTIONS, PAGE_SIZE_OPTIONS],
  ['PAGE_SIZE_DEFAULT', clientHelpers.PAGE_SIZE_DEFAULT, PAGE_SIZE_DEFAULT],
  ['DEFAULT_FUZZY_THRESHOLD', clientHelpers.DEFAULT_FUZZY_THRESHOLD, SERVER_FUZZY_THRESHOLD],
]

const problems = []
for (const [name, clientValue, serverValue] of pairs) {
  if (JSON.stringify(clientValue) !== JSON.stringify(serverValue)) {
    problems.push(
      `${name}: 客户端 ${JSON.stringify(clientValue)} ≠ 服务端 ${JSON.stringify(serverValue)}`,
    )
  }
}

if (problems.length) {
  for (const line of problems) console.error(`error: ${line}`)
  process.exit(1)
}

assert.ok(clientHelpers.PAGE_SIZE_OPTIONS.includes(PAGE_SIZE_DEFAULT))
console.log(`共享常量一致：${pairs.map(([name]) => name).join('、')}`)
