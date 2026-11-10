import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './lib/client-source.mjs'
import { CatStore } from '../lib/store.js'
import { createHandlers, MUTATIONS } from '../lib/api.js'

/**
 * 接口一致性守卫。
 *
 * RPC 名字在这几处重复出现：`lib/api.js` 的 handler 表、`MUTATIONS` 集合、
 * 以及客户端里的 `rpc('name')` 调用。任何一处漏改都不会报错，只会在运行时
 * 悄悄失效，所以这里用一次静态核对把它们钉在一起。
 */

// 假的 store：任何方法都返回一个「什么都接受」的探针对象。
const sink = new Proxy(function sink() {}, {
  get(_target, property) {
    return property === 'then' ? undefined : sink
  },
  apply() {
    return sink
  },
})
let lastMethod
const store = new Proxy(
  {},
  {
    get(_target, name) {
      return () => {
        lastMethod = String(name)
        return sink
      }
    },
  },
)

const handlers = createHandlers(store)
const names = Object.keys(handlers)
const problems = []

for (const name of names) {
  lastMethod = ''
  try {
    handlers[name]({ confirm: true })
  } catch (error) {
    problems.push(`${name} 调用时抛错：${error.message}`)
    continue
  }
  if (!lastMethod) {
    problems.push(`${name} 没有调用任何 store 方法`)
    continue
  }
  if (typeof CatStore.prototype[lastMethod] !== 'function') {
    problems.push(`${name} 指向不存在的 store.${lastMethod}()`)
  }
}

for (const method of MUTATIONS) {
  if (!names.includes(method)) problems.push(`MUTATIONS 里的 ${method} 没有对应 handler`)
}

const WRITE_VERBS =
  /^(create|delete|open|close|import|apply|load|select|save|replace|undo|add|update|set|merge|split|shift|clear|adopt|propose|write|propagate|preTranslate|confirm|unconfirm|move|rename|dedupe|prune)/
for (const name of names) {
  if (WRITE_VERBS.test(name) && !MUTATIONS.has(name)) {
    problems.push(`${name} 看起来是写操作，但没有登记进 MUTATIONS（前端不会收到新状态）`)
  }
}

const clientText = ['components.js', 'rpc.js', 'index.js']
  .map((name) => readFileSync(join(projectRoot, 'client', name), 'utf8'))
  .join('\n')

// `rpc(...)` 的实参里可能直接写方法名，也可能是三元或变量；只取括号内的字面量。
function rpcArguments(text) {
  const calls = []
  let start = text.indexOf('rpc(')
  while (start !== -1) {
    let depth = 0
    let index = start + 3
    for (; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1
      else if (text[index] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    calls.push(text.slice(start + 4, index))
    start = text.indexOf('rpc(', index)
  }
  return calls
}

// 取第一个实参（方法名表达式），逗号、括号、引号都要按嵌套深度算。
function firstArgument(args) {
  let depth = 0
  let quote = ''
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
    } else if (char === ',' && depth === 0) {
      return args.slice(0, index)
    }
  }
  return args
}

const usedByClient = new Set()
const dynamicCalls = []
for (const args of rpcArguments(clientText)) {
  if (/(^|\s)method\b/.test(args) && args.includes('params')) continue
  const first = firstArgument(args).trim()
  const literals = [...first.matchAll(/(?:^|[?:]\s*)'([A-Za-z0-9_]+)'/g)].map((match) => match[1])
  if (!literals.length) {
    dynamicCalls.push(first.slice(0, 60))
    continue
  }
  for (const literal of literals) usedByClient.add(literal)
}

for (const method of usedByClient) {
  if (!names.includes(method)) problems.push(`客户端调用了不存在的接口 ${method}`)
}
for (const call of dynamicCalls) {
  console.log(`info: 动态方法名无法静态核对：rpc(${call})`)
}

const unusedHandlers = names.filter((name) => !usedByClient.has(name))

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}

console.log(
  `接口一致：${names.length} 个 handler、${MUTATIONS.size} 个写操作、客户端调用 ${usedByClient.size} 个`,
)
if (unusedHandlers.length) {
  console.log(
    `info: 客户端未使用 ${unusedHandlers.length} 个 handler：${unusedHandlers.join(', ')}`,
  )
}
