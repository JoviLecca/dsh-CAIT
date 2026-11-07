import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Theme adaptation is a token discipline, not a colour pass: DSH already maps
// `--dsw-alias-label-primary` (dark text on light, light text on dark) and
// `--dsw-alias-label-primary-inverted` (the opposite). These checks keep that
// discipline from regressing and pin the two things tokens cannot cover:
// `color-scheme` for native widgets, and the host theme marker.

const root = new URL('..', import.meta.url)
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8')

const styles = read('client/styles.js')
const components = read('client/components.js')
const helpers = read('client/helpers.js')

function section(name) {
  console.log(`\n# ${name}`)
}

// Drop `var(--token, #fallback)` fallbacks: those literals are allowed because
// they only apply when DSH has not loaded its tokens.
function stripVarFallbacks(css) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('var(', i)
    if (at === -1) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, at) + 'VAR'
    let depth = 0
    let cursor = at + 3
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '(') depth += 1
      else if (css[cursor] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    i = cursor + 1
  }
  return out
}

section('no hard-coded colours outside var() fallbacks')
{
  const bare = stripVarFallbacks(styles)
  const hex = bare.match(/#[0-9a-fA-F]{3,8}/g) ?? []
  const func = bare.match(/\b(?:rgba?|hsla?)\s*\(/g) ?? []
  const named = bare.match(/(?<![\w-])(?:white|black|silver|gray|grey)(?![\w-])/gi) ?? []
  assert.deepEqual(hex, [], 'styles.js must express colours as DSH tokens')
  assert.deepEqual(func, [], 'styles.js must express colours as DSH tokens')
  assert.deepEqual(named, [], 'styles.js must not use colour keywords')
}

section('every colour declaration resolves through a token')
{
  const allowed = /^(?:var\(--dsw-[a-z0-9-]+\)|inherit|transparent|currentColor|none|unset)$/i
  const failures = []
  for (const match of styles.matchAll(/(?:^|[{;])\s*color:([^;{}]+)/g)) {
    const value = match[1].trim()
    // color-mix(...) is fine as long as every part of it is a token.
    if (/^color-mix\(in srgb,/.test(value)) {
      const tokenParts = value.replace(/color-mix\(in srgb,?/g, '').replace(/[\d.]+%?/g, '')
      if (!tokenParts.includes('var(--dsw-')) failures.push(value)
      continue
    }
    if (!allowed.test(value)) failures.push(value)
  }
  assert.deepEqual(failures, [], `unexpected colour values: ${failures.join(' | ')}`)
}

section('primary buttons use the inverted label token, not a surface token')
{
  const primary = styles.match(/\.cait-btn-primary\{([^}]*)\}/)?.[1] ?? ''
  assert.ok(primary, '.cait-btn-primary must exist')
  assert.ok(
    primary.includes('color:var(--dsw-alias-label-primary-inverted)'),
    'filled buttons must use the inverted label token for their text',
  )
  assert.equal(
    /color:var\(--dsw-alias-bg-/.test(primary),
    false,
    'a surface token must never be used as a text colour',
  )
}

section('native widgets follow the host theme through color-scheme')
{
  const rootRule = styles.match(/\.cait-root\{([^}]*)\}/)?.[1] ?? ''
  assert.ok(rootRule.includes('color-scheme:light'), 'the root must declare a color-scheme')
  assert.ok(
    styles.includes('.cait-root[data-cait-theme="dark"]{color-scheme:dark}'),
    'the dark override must switch color-scheme',
  )
  assert.ok(
    styles.includes('.cait-root select option{'),
    'select popups need explicit token colours on platforms that ignore color-scheme',
  )
}

section('the client mirrors the DSH theme marker')
{
  assert.ok(helpers.includes("const CAIT_THEME_ATTR = 'data-cait-theme'"))
  assert.ok(helpers.includes('body?.hasAttribute?.(\'data-ds-dark-theme\')'))
  assert.ok(components.includes('detectThemeKind(document)'))
  assert.ok(components.includes('element.setAttribute(CAIT_THEME_ATTR, kind)'))
  assert.ok(
    components.includes("attributeFilter: ['data-ds-dark-theme', 'data-theme', 'class']"),
    'theme changes on <body> must be observed',
  )
}

section('detectThemeKind reads the host marker')
{
  // Behaviour is checked against the built bundle so the test exercises the
  // same code the browser runs.
  const source = fs.readFileSync(new URL('client.js', root), 'utf8')
  let definition
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value } } },
    document: { createElement: () => ({}), body: { appendChild() {} } },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  const fakeReact = {
    createElement: () => null,
    useState: (initial) => [initial, () => {}],
    useEffect() {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
  }
  const mod = definition.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  const { detectThemeKind, caitThemeAttr } = mod.__test
  assert.equal(caitThemeAttr, 'data-cait-theme')
  const darkBody = { hasAttribute: (name) => name === 'data-ds-dark-theme', getAttribute: () => null }
  const lightBody = { hasAttribute: () => false, getAttribute: () => null }
  assert.equal(detectThemeKind({ body: darkBody, documentElement: { getAttribute: () => null } }), 'dark')
  assert.equal(detectThemeKind({ body: lightBody, documentElement: { getAttribute: () => null } }), 'light')
  assert.equal(
    detectThemeKind({ body: lightBody, documentElement: { getAttribute: (name) => (name === 'data-theme' ? 'dark' : null) } }),
    'dark',
  )
  assert.equal(detectThemeKind({}), 'light')
  assert.equal(detectThemeKind(undefined), 'light')
}

console.log('\nALL THEME TOKEN TESTS PASSED')
