import { clamp, clampInt } from './similarity.js'
import { DEFAULT_PREPROCESS, normalizePreprocessOptions } from './preprocess.js'
import { restoredLang } from './lang.js'

// UI languages the workbench can switch between; 'auto' follows the DSH locale.
export const UI_LANG_CODES = ['auto', 'zh', 'en', 'ja']

// Below ~70% a fuzzy match usually shares little more than function words, so
// showing it costs review time without saving any. Mainstream CAT tools sit in
// the 70–75% range for the same reason.
export const DEFAULT_FUZZY_THRESHOLD = 0.7

export const DEFAULT_SETTINGS = {
  sourceLang: 'en',
  targetLang: 'zh-CN',
  fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
  tmLimit: 5,
  uiLang: 'auto',
  preprocess: { ...DEFAULT_PREPROCESS },
  mt: {
    provider: 'mock',
    model: 'cait-mock',
    temperature: 0.2,
  },
  // Empty provider/model means "inherit the MT route". A separate route lets
  // review use a stronger model without slowing down bulk pre-translation.
  review: {
    provider: '',
    model: '',
    temperature: 0,
  },
}

export function restoreSettings(raw) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings
  try {
    if (String(raw.sourceLang ?? '').trim()) {
      settings.sourceLang = restoredLang(raw.sourceLang, settings.sourceLang)
    }
    if (String(raw.targetLang ?? '').trim()) {
      settings.targetLang = restoredLang(raw.targetLang, settings.targetLang)
    }
    const threshold = Number(raw.fuzzyThreshold)
    if (Number.isFinite(threshold)) settings.fuzzyThreshold = clamp(threshold, 0, 1)
    const limit = Number(raw.tmLimit)
    if (Number.isFinite(limit)) settings.tmLimit = clampInt(limit, 1, 20, settings.tmLimit)
    const uiLang = String(raw.uiLang ?? '')
      .trim()
      .toLowerCase()
    if (UI_LANG_CODES.includes(uiLang)) settings.uiLang = uiLang
    settings.preprocess = normalizePreprocessOptions(raw.preprocess)

    if (raw.mt && typeof raw.mt === 'object' && !Array.isArray(raw.mt)) {
      const provider = String(raw.mt.provider ?? '').trim()
      if (provider) settings.mt.provider = provider.slice(0, 120)
      if (raw.mt.model !== undefined)
        settings.mt.model = String(raw.mt.model ?? '')
          .trim()
          .slice(0, 200)
      const temperature = Number(raw.mt.temperature)
      if (Number.isFinite(temperature)) settings.mt.temperature = clamp(temperature, 0, 2)
    }
    if (raw.review && typeof raw.review === 'object' && !Array.isArray(raw.review)) {
      settings.review.provider = String(raw.review.provider ?? '')
        .trim()
        .slice(0, 120)
      settings.review.model = String(raw.review.model ?? '')
        .trim()
        .slice(0, 200)
      const temperature = Number(raw.review.temperature)
      if (Number.isFinite(temperature)) settings.review.temperature = clamp(temperature, 0, 2)
    }
    return settings
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}
