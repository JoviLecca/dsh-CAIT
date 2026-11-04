import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const stylesSource = fs.readFileSync(new URL('../client/styles.js', import.meta.url), 'utf8')
const localesSource = fs.readFileSync(new URL('../client/locales.js', import.meta.url), 'utf8')

// The UI label is user-facing; the provider id stays 'mock' for compatibility.
assert.ok(localesSource.includes("'mt.mock': '术语替换（离线）'"))
assert.ok(localesSource.includes("'mt.mock': 'Glossary substitution (offline)'"))
assert.equal(localesSource.includes('占位示例'), false)

// Regression: the generic button reset must not set color, otherwise it wins
// by specificity over .cait-btn-primary and the save label becomes black-on-black.
const buttonReset = stylesSource.match(/\.cait-root button\{([^}]*)\}/)
assert.ok(buttonReset, 'button reset should exist')
assert.equal(buttonReset[1].includes('color:'), false, 'button reset must not override button color')
assert.match(
  stylesSource,
  /\.cait-btn-primary\{[^}]*color:var\(--dsw-alias-bg-base\)/,
  'primary button needs an explicit contrasting label color',
)
assert.ok(
  source.includes('.cait-root button{font:inherit;cursor:pointer}'),
  'generated client must include the rebuilt button reset',
)

let definition
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  },
  document: {
    createElement() {
      return {}
    },
    body: { appendChild() {} },
  },
  console,
}
vm.runInNewContext(source, sandbox, { filename: 'client.js' })
assert.ok(definition, 'client.js should register a module definition')
assert.equal(definition.id, 'dsh-cait')

const fakeReact = {
  createElement() {
    return null
  },
  useState(initial) {
    return [initial, () => {}]
  },
  useEffect() {},
  useMemo(fn) {
    return fn()
  },
  useRef(value) {
    return { current: value }
  },
}

const mod = definition.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require: ${name}`)
})

const {
  isMountToggleDisabled,
  computeNextMountIds,
  shouldAdoptRemote,
  syncPollMs,
  computeCaitUnit,
  scaleCssLengths,
  caitUiBase,
  caitUiMaxUnit,
  makeTranslator,
  uiLangCodes,
} = mod.__test || {}
assert.equal(typeof isMountToggleDisabled, 'function')
assert.equal(typeof computeNextMountIds, 'function')
assert.equal(typeof shouldAdoptRemote, 'function')
assert.equal(syncPollMs, 2000)

// Interface language: the explicit choice uses its own dictionary, 'auto' defers
// to the DSH-bound translator first, unknown languages fall back to English, and
// placeholders are interpolated.
assert.equal(uiLangCodes.join(','), 'auto,zh,en,ja')
assert.equal(makeTranslator('ja', null)('nav.new'), '新規')
assert.equal(makeTranslator('zh', null)('modal.settings.uiLanguage'), '界面语言')
assert.equal(makeTranslator('en', null)('toast.docsCleared', { count: 3 }), 'Cleared 3 closed documents')
assert.equal(makeTranslator('auto', (key) => (key === 'nav.new' ? 'DSH-NEW' : key))('nav.new'), 'DSH-NEW')
assert.equal(makeTranslator('auto', null)('nav.new'), 'New', 'auto without a DSH translator falls back to English')
assert.equal(makeTranslator('fr', null)('nav.new'), 'New', 'unsupported languages fall back to English')
assert.equal(makeTranslator('ja', null)('definitely.missing.key'), 'definitely.missing.key')

// Fullscreen windows need more than the old 1.4× cap; short windows must
// still stay at the designed density instead of shrinking.
assert.equal(caitUiBase.width, 1100)
assert.equal(caitUiBase.height, 680)
assert.equal(caitUiMaxUnit, 1.8)
assert.equal(computeCaitUnit({ width: 1100, height: 680 }), 1)
assert.equal(computeCaitUnit({ width: 1600, height: 900 }), 1.324)
assert.equal(computeCaitUnit({ width: 1280, height: 720 }), 1.059)
assert.equal(computeCaitUnit({ width: 2560, height: 1440 }), 1.8)
assert.equal(computeCaitUnit({ width: 3840, height: 2160 }), 1.8)
assert.equal(computeCaitUnit({ width: 800, height: 600 }), 1, 'tiny windows must not shrink below 1×')

const scaled = scaleCssLengths('.x{font-size:13px;border:1px solid red}@media (max-width:600px){.x{gap:10px}}', '--u')
assert.match(scaled, /font-size:calc\(13px \* var\(--u, 1\)\)/)
assert.match(scaled, /border:1px solid red/)
assert.match(scaled, /@media \(max-width:600px\)/)
assert.match(scaled, /gap:calc\(10px \* var\(--u, 1\)\)/)

// The reported blocker: one library is mounted and the second is not.
assert.equal(
  isMountToggleDisabled({ mounted: false, mountedCount: 1, busy: false }),
  false,
  'an unmounted library must remain selectable when only one is mounted',
)
assert.equal(
  isMountToggleDisabled({ mounted: true, mountedCount: 1, busy: false }),
  true,
  'the last mounted library must not be unmounted',
)
assert.equal(
  isMountToggleDisabled({ mounted: true, mountedCount: 2, busy: false }),
  false,
  'a mounted library may be unmounted when another is mounted',
)
assert.equal(
  isMountToggleDisabled({ mounted: false, mountedCount: 2, busy: false }),
  false,
  'unmounted libraries stay selectable',
)
assert.equal(
  isMountToggleDisabled({ mounted: false, mountedCount: 1, busy: true }),
  true,
  'busy state disables all mount controls',
)

assert.deepEqual(
  Array.from(computeNextMountIds(['tm_default'], 'tm_extra', true)),
  ['tm_default', 'tm_extra'],
  'checking a second library adds it to the mount set',
)
assert.equal(
  computeNextMountIds(['tm_default'], 'tm_default', false),
  null,
  'the last mounted library cannot be unchecked',
)
assert.deepEqual(Array.from(computeNextMountIds(['a', 'b'], 'a', false)), ['b'])
assert.deepEqual(Array.from(computeNextMountIds(['a'], 'a', true)), ['a'], 'mounting is idempotent')

assert.equal(
  shouldAdoptRemote({ currentRevision: 1, nextRevision: 2, dirty: false }),
  true,
  'a clean workbench adopts a newer revision',
)
assert.equal(
  shouldAdoptRemote({ currentRevision: 1, nextRevision: 2, dirty: true }),
  false,
  'a dirty draft must not be replaced by a remote revision',
)
assert.equal(
  shouldAdoptRemote({ currentRevision: 2, nextRevision: 2, dirty: false }),
  false,
  'an unchanged revision does not trigger a refresh',
)

// Client/UI smoke test: apply() must register the sidebar entry and main panel
// without throwing, and the locale binding must be used for labels.
let sidebar
let main
const ctx = {
  locale: {
    register() {},
    bind() {
      return (key) => key
    },
  },
  slots: {
    inject(name, factory) {
      factory()
    },
    register(registration) {
      if (registration.name === 'sidebar.panellist') sidebar = registration
      if (registration.name === 'main') main = registration
      return () => {}
    },
  },
}
mod.apply(ctx)
assert.equal(sidebar.id, 'dsh-cait')
assert.equal(sidebar.order, 25)
assert.equal(main.key, 'dsh-cait')

console.log('ALL MOUNT TESTS PASSED')
