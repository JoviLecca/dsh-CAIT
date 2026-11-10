import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// The workbench scales as one piece: every fixed length in styles.js is
// rewritten to `calc(<n>px * var(--cait-u))` and the unit follows the panel
// size. These tests cover the pure math and the CSS rewrite.

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

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

const { computeCaitUnit, scaleCssLengths, caitUiBase, caitUiMaxUnit, caitUiDamping, cssScaled } =
  mod.__test || {}

assert.equal(typeof computeCaitUnit, 'function')
assert.equal(typeof scaleCssLengths, 'function')
assert.equal(caitUiBase.width, 1100)
assert.equal(caitUiBase.height, 680)
assert.equal(caitUiMaxUnit, 1.45)
assert.equal(caitUiDamping, 0.6)
assert.equal(typeof cssScaled, 'string')

// --- computeCaitUnit -------------------------------------------------------
assert.equal(computeCaitUnit({ width: 1320, height: 800 }), 1.106)
assert.equal(computeCaitUnit({ width: 900, height: 600 }), 1, 'never shrinks below the design size')
assert.equal(computeCaitUnit({ width: 0, height: 800 }), 1)
assert.equal(computeCaitUnit({}), 1)
assert.equal(computeCaitUnit(), 1)
assert.equal(computeCaitUnit({ width: Number.NaN, height: 800 }), 1)
assert.equal(computeCaitUnit({ width: 4000, height: 2400 }), caitUiMaxUnit, 'cap')
assert.equal(computeCaitUnit({ width: 1000, height: 2400 }), 1, 'width guard')
assert.equal(
  computeCaitUnit({ width: 4000, height: 700 }),
  1.018,
  'short/wide windows follow height',
)

const mid = computeCaitUnit({ width: 1700, height: 900 })
assert.equal(mid, 1.194)
assert.equal((mid * 1000) % 1, 0, 'unit is rounded to three decimals')

// The fallback from 1.8x: a 1920x1080 panel must stay under the 1.38 ceiling
// that lets the three-column review view fit its 1390px horizontal budget.
const hd = computeCaitUnit({ width: 1920, height: 1080 })
assert.equal(hd, 1.353)
assert.ok(1920 / hd >= 1390, `1920 panel must leave room for three columns, got ${1920 / hd}`)
assert.equal(computeCaitUnit({ width: 2560, height: 1440 }), caitUiMaxUnit)
assert.equal(computeCaitUnit({ width: 3840, height: 2160 }), caitUiMaxUnit)

// Growth is damped rather than linear, so large panels stop outgrowing the
// surrounding DSH chrome.
const linear = Math.min(2200 / 1100, 1500 / 680)
assert.ok(
  computeCaitUnit({ width: 2200, height: 1500 }) < linear,
  'damped growth stays below linear',
)

const wideGrows = [1300, 1500, 1700, 1900].map((width) => computeCaitUnit({ width, height: 1000 }))
assert.deepEqual(
  wideGrows,
  [...wideGrows].sort((a, b) => a - b),
  'unit is monotonic in width',
)

const tallGrows = [700, 800, 900, 1000].map((height) => computeCaitUnit({ width: 2400, height }))
assert.deepEqual(
  tallGrows,
  [...tallGrows].sort((a, b) => a - b),
  'unit is monotonic in height',
)

// --- scaleCssLengths -------------------------------------------------------
assert.equal(
  scaleCssLengths('.a{padding:11px 16px;font-size:13px}', '--cait-u'),
  '.a{padding:calc(11px * var(--cait-u, 1)) calc(16px * var(--cait-u, 1));font-size:calc(13px * var(--cait-u, 1))}',
)

// Hairlines must stay exact so borders keep rendering crisply.
assert.equal(scaleCssLengths('.a{border:1px solid}', '--cait-u'), '.a{border:1px solid}')

// Decimals and negatives are handled; 1.5px scales because it is not a hairline.
assert.equal(
  scaleCssLengths('.a{margin:-2px .5px 1.5px}', '--cait-u'),
  '.a{margin:calc(-2px * var(--cait-u, 1)) .5px calc(1.5px * var(--cait-u, 1))}',
)

// Breakpoint preludes stay in viewport pixels, but the block body still scales.
assert.equal(
  scaleCssLengths('@media(max-width:1180px){.a{padding:10px}}', '--cait-u'),
  '@media(max-width:1180px){.a{padding:calc(10px * var(--cait-u, 1))}}',
)
assert.equal(
  scaleCssLengths('@keyframes x{to{transform:translateY(2px)}}', '--cait-u'),
  '@keyframes x{to{transform:translateY(calc(2px * var(--cait-u, 1)))}}',
)

// --- generated stylesheet --------------------------------------------------
assert.ok(cssScaled.length > 0, 'scaled stylesheet should be exported to __test')
assert.ok(cssScaled.includes('--cait-u:1'), 'root must define the unit before JS measures it')
assert.ok(
  cssScaled.includes('font-size:calc(13px * var(--cait-u, 1))'),
  'the 13px base font must scale',
)
assert.ok(
  cssScaled.includes('grid-template-columns:calc(246px * var(--cait-u, 1)) minmax(0,1fr)'),
  'the rail width must scale',
)
assert.ok(
  cssScaled.includes('padding:calc(22px * var(--cait-u, 1)) calc(26px * var(--cait-u, 1))'),
  'editor padding must scale',
)
assert.equal(cssScaled.includes('@media(max-width:1180px)'), true)
assert.equal(cssScaled.includes('@media(max-width:940px)'), true)
assert.equal(cssScaled.includes('@media(max-width:700px)'), true)
assert.equal(/1180px\s*\*/.test(cssScaled), false, 'breakpoint must not become a calc()')

const calcCount = (cssScaled.match(/calc\(/g) || []).length
const unitTailCount = (cssScaled.match(/\* var\(--cait-u, 1\)\)/g) || []).length
assert.ok(calcCount > 300, `expected many scaled lengths, got ${calcCount}`)
assert.equal(calcCount, unitTailCount, 'every calc() must be a unit conversion')
assert.equal(cssScaled.includes('calc(calc('), false, 'no double wrapping')

// Remove every calc(...) with balanced parentheses, then make sure the only
// remaining lengths above one pixel are the three media-query breakpoints.
function stripCalc(css) {
  let output = ''
  let index = 0
  while (index < css.length) {
    const at = css.indexOf('calc(', index)
    if (at === -1) {
      output += css.slice(index)
      break
    }
    output += css.slice(index, at)
    let depth = 0
    let cursor = at + 4
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '(') depth += 1
      else if (css[cursor] === ')') {
        depth -= 1
        if (depth === 0) {
          cursor += 1
          break
        }
      }
    }
    output += 'X'
    index = cursor
  }
  return output
}

const leftover = [...stripCalc(cssScaled).matchAll(/(-?(?:\d+\.?\d*|\.\d+))px/g)]
  .map((match) => Number(match[1]))
  .filter((value) => Math.abs(value) > 1)
const leftoverKinds = [...new Set(leftover)].sort((a, b) => a - b)
// 700/940/1180 are media query breakpoints: they are measured in real viewport
// pixels, so they must stay unscaled even though lengths inside scale with
// --cait-u.
assert.deepEqual(
  leftoverKinds,
  [700, 940, 1180],
  `unscaled lengths should only be breakpoints, got ${leftoverKinds}`,
)

// --- wiring checks ---------------------------------------------------------
// client.js is a build artifact: esbuild re-prints it, so source-level wiring is
// asserted on the authored modules and only behaviour is asserted on the bundle.
const wiring = ['styles.js', 'components.js']
  .map((name) => fs.readFileSync(new URL(`../client/${name}`, import.meta.url), 'utf8'))
  .join('\n')
assert.ok(wiring.includes('const CSS_SCALED = scaleCssLengths(CSS, CAIT_UNIT_VAR)'))
assert.equal(wiring.includes("h('style', null, CSS)"), false, 'renders must use CSS_SCALED')
assert.equal((wiring.match(/h\('style', null, CSS_SCALED\)/g) || []).length, 3)
assert.equal(
  (wiring.match(/ref: rootRef/g) || []).length,
  3,
  'all three root branches share the ref',
)
assert.ok(wiring.includes('new ResizeObserver(measure)'), 'panel resizes must re-measure')
assert.ok(wiring.includes('element.style.setProperty(CAIT_UNIT_VAR, String(unit))'))
assert.ok(
  wiring.includes('calc(${value}px * var(${CAIT_UNIT_VAR}, 1))'),
  'inline icon sizes must use the same unit',
)

console.log(
  `ui-scale ok: ${calcCount} scaled lengths, unit ${computeCaitUnit({ width: 1700, height: 900 })} at 1700x900`,
)
