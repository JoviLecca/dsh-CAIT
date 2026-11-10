/**
 * 把 Workbench 真正挂到一个 jsdom 里跑。
 *
 * 为什么值得这么重：客户端此前只有 4 个「读 bundle 文本 / 跑纯函数」的契约测试，
 * 一旦重构状态层或 RPC 协议，没有任何东西能证明界面还在正常工作。这里用
 * `lib/api.js` 的真实 handler 顶掉 HTTP，用真实的 `CatStore` 顶掉宿主存储，
 * 于是「点一下按钮 → rpc → store 变更 → 重渲染」整条链都能在 Node 里跑完。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { createHandlers, MUTATIONS } from '../../lib/api.js'
import { CatStore } from '../../lib/store.js'
import { clientBundlePath } from '../../scripts/lib/client-source.mjs'

const require = createRequire(import.meta.url)
const React = require('react')
// react-dom 在 import 期就探测 window/document 决定事件系统是否启用，
// 所以只能在 jsdom 的全局装好之后再 require（见 mountWorkbench）。
const act = React.act || React.unstable_act
const flush = () => act(async () => {})

// Node 26 把 navigator 定义成只读 getter，直接赋值会抛；统一用描述符写入并原样还原。
const sandbox = new Map()
const setGlobal = (name, value) => {
  if (!sandbox.has(name)) sandbox.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}
const restoreGlobals = () => {
  for (const [name, descriptor] of sandbox) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  sandbox.clear()
}

export async function mountWorkbench({ prepare } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'cait-ui-'))
  const store = new CatStore({ dataDir, logger: { warn() {}, error() {}, log() {} } })
  const handlers = createHandlers(store)
  const calls = []

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  // jsdom 没实现滚动与布局 API，补成空实现即可；界面逻辑只用到「滚到当前句段」。
  window.Element.prototype.scrollIntoView = function scrollIntoView() {}
  window.Element.prototype.scrollTo = function scrollTo() {}
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
  setGlobal('window', window)
  setGlobal('document', window.document)
  setGlobal('navigator', window.navigator)
  setGlobal('localStorage', window.localStorage)
  setGlobal('MutationObserver', window.MutationObserver)
  setGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  setGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0))
  setGlobal('cancelAnimationFrame', (handle) => clearTimeout(handle))
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  // HTTP 层直接短路到真实 handler：请求体与响应体都保持线上形状，
  // 所以 rpc() 的解析、错误分支、base64 解码都还会被执行。
  const fetchStub = async (_url, init) => {
    const { method, params } = JSON.parse(init.body)
    calls.push({ method, params })
    const handler = handlers[method]
    let body
    if (!handler) {
      body = { ok: false, error: { code: 'UNKNOWN_METHOD', message: `未知方法 ${method}` } }
    } else {
      try {
        // 有些 store 方法是 async 的（审校、预翻译），HTTP 层会 await，
        // 这里也必须等，否则读到的 state 还是调用前的快照。
        const result = await handler(params)
        // 与 registerCatApi 保持一致：写操作成功后附上整份 state。
        const data = MUTATIONS.has(method)
          ? { ...(result ?? {}), state: store.bootstrap() }
          : result
        body = { ok: true, data }
      } catch (error) {
        body = { ok: false, error: { code: error?.code || 'ERROR', message: error?.message } }
      }
    }
    // 走一遍序列化，否则客户端拿到的是 store 内部对象的引用：
    // 服务端就地改一个字段，客户端就会「没有 re-render 却看到新值」。
    const wire = JSON.parse(JSON.stringify(body))
    return { ok: wire.ok, status: 200, json: async () => wire }
  }
  setGlobal('fetch', fetchStub)

  const source = readFileSync(clientBundlePath, 'utf8')
  let definition = null
  window.__ModuleLoader__ = { load: (loaded) => (definition = loaded) }
  new Function('window', 'document', 'fetch', 'navigator', 'localStorage', source)(
    window,
    globalThis.document,
    fetchStub,
    globalThis.navigator,
    globalThis.localStorage,
  )

  const components = new Map()
  const context = {
    locale: {
      register() {},
      bind: () => (key) => key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh' }),
    },
    effect() {},
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(meta, component) {
        components.set(meta.name, component)
        return () => {}
      },
    },
  }
  const entry = definition.factory(require)
  entry.apply(context)

  if (prepare) await prepare({ store, handlers })

  const container = globalThis.document.getElementById('root')
  const { createRoot } = require('react-dom/client')
  const root = createRoot(container)
  const Main = components.get('main')
  await act(async () => root.render(React.createElement(Main)))
  await flush()
  await flush()

  const text = () => container.textContent || ''
  const query = (selector) => container.querySelector(selector)
  const queryAll = (selector) => [...container.querySelectorAll(selector)]
  const byText = (label) => {
    const target = String(label)
    return queryAll('button, [role="button"], a, li, div').find(
      (element) => (element.textContent || '').trim() === target,
    )
  }
  const click = async (target) => {
    const element = typeof target === 'string' ? byText(target) || query(target) : target
    if (!element) throw new Error(`找不到可点击元素：${target}`)
    await act(async () => {
      element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await flush()
    return element
  }
  const type = async (element, value) => {
    // React 的受控输入靠 value tracker 判断「变了吗」，必须走原生 setter 再派发 input。
    const prototype =
      element instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    await act(async () => {
      setter?.call(element, value)
      element.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await flush()
  }

  const unmount = async () => {
    await act(async () => root.unmount())
    store.flushPersist?.()
    window.close()
    rmSync(dataDir, { recursive: true, force: true })
    restoreGlobals()
  }

  // 等待一次 RPC 的 promise 链跑完并刷新 DOM。
  const settle = async () => {
    await flush()
    await flush()
    await flush()
  }

  return {
    store,
    handlers,
    calls,
    container,
    text,
    query,
    queryAll,
    byText,
    click,
    type,
    settle,
    unmount,
  }
}
