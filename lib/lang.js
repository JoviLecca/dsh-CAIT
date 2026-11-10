import { CatError } from './errors.js'

export function canonicalLanguage(value) {
  const lang = String(value ?? '').trim()
  if (!lang) return ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,34}$/.test(lang)) {
    throw new CatError('INVALID_LANGUAGE', `语言代码不合法: ${lang}`)
  }
  try {
    return Intl.getCanonicalLocales(lang.replace(/_/g, '-'))[0]
  } catch {
    throw new CatError('INVALID_LANGUAGE', `语言代码不合法: ${lang}`)
  }
}

export function cleanLang(value, fallback) {
  const lang = String(value ?? '').trim()
  if (!lang) return fallback
  return canonicalLanguage(lang)
}

export function restoredLang(value, fallback) {
  const lang = String(value ?? '').trim()
  if (!lang) return fallback
  try {
    return canonicalLanguage(lang)
  } catch {
    throw new Error(`数据文件中的语言代码不合法: ${lang}`)
  }
}
