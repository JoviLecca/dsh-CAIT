// Error copy lives in the dictionaries as `error.<CODE>`, but writing one entry
// per server code would be a second registry to keep in sync. Instead the exact
// code wins when it has its own entry, and otherwise the code falls back to the
// family rule below (every `*_PARSE` reads the same in the UI anyway).
//
// scripts/check-errors.mjs enforces the contract: every code raised in lib/ must
// resolve to a family, never straight to `error.generic`. Adding a code that fits
// no family therefore fails `npm run check` until it gets copy or a rule.

/** Codes the client itself raises; they have no server-side counterpart. */
const CLIENT_ERROR_CODES = ['NETWORK', 'HTTP', 'CLIPBOARD']

const ERROR_FAMILIES = [
  { prefix: 'INVALID_', key: 'error.invalid' },
  { prefix: 'MISSING_', key: 'error.required' },
  { prefix: 'TOO_MANY_', key: 'error.tooMany' },
  { suffix: '_PARSE', key: 'error.parse' },
  { suffix: '_NO_UNITS', key: 'error.noUnits' },
  { suffix: '_NOT_FOUND', key: 'error.notFound' },
  { suffix: '_NOT_MOUNTED', key: 'error.notMounted' },
  { suffix: '_BOUND', key: 'error.bound' },
  { suffix: '_TOO_LARGE', key: 'error.tooLarge' },
  { suffix: '_TOO_LONG', key: 'error.tooLong' },
  { suffix: '_TOO_MANY', key: 'error.tooMany' },
  { suffix: '_FAILED', key: 'error.failed' },
  { suffix: '_REQUIRED', key: 'error.required' },
  { suffix: '_UNSUPPORTED', key: 'error.unsupported' },
  { suffix: '_INVALID', key: 'error.invalid' },
  { suffix: '_EMPTY', key: 'error.empty' },
  { suffix: '_MISMATCH', key: 'error.mismatch' },
]

/**
 * Keys to try, most specific first: the code's own entry, then its family rule.
 * An empty list means the code has no copy of its own, which is what
 * scripts/check-errors.mjs refuses to let ship.
 */
function errorKeys(code) {
  const value = String(code || '')
  const keys = []
  if (!value) return keys
  keys.push(`error.${value}`)
  const family = ERROR_FAMILIES.find((rule) =>
    rule.prefix ? value.startsWith(rule.prefix) : value.endsWith(rule.suffix),
  )
  if (family) keys.push(family.key)
  return keys
}

/**
 * Resolves an error to a message in the active UI language. A code the client
 * does not know yet keeps the server's own message (informative, if Chinese)
 * instead of collapsing into the generic line; only a message-less error ends
 * there.
 */
function describeError(error, t, fallback) {
  for (const key of errorKeys(error?.code)) {
    const text = t(key, error?.vars)
    if (text && text !== key) return text
  }
  return error?.message || fallback || t('error.generic')
}

export { CLIENT_ERROR_CODES, ERROR_FAMILIES, errorKeys, describeError }
