import { CatError } from './errors.js'
import { canonicalLanguage, cleanText, escapeRegExp, MT_BATCH_MAX } from './store-utils.js'
import { briefPromptBlock, contextPromptBlock, neighborContext } from './brief.js'
import { MOCK_MODEL, MOCK_PROVIDER, collectStreamText } from './mt.js'

/**
 * mtTranslate: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const mtTranslateMethods = {
  glossaryPrompt(hits) {
    if (!hits?.length) return ''
    const usable = hits.filter((hit) => !hit.forbidden)
    const forbidden = hits.filter((hit) => hit.forbidden)
    const blocks = []
    if (usable.length) {
      blocks.push(
        `Use this terminology consistently:\n${usable
          .map((hit) => `- ${hit.term} => ${hit.target}${hit.preferred ? ' (required)' : ''}`)
          .join('\n')}`,
      )
    }
    if (forbidden.length) {
      blocks.push(
        `Never use these translations for the listed source terms:\n${forbidden
          .map((hit) => `- ${hit.term} => ${hit.target}`)
          .join('\n')}`,
      )
    }
    return blocks.join('\n\n')
  },

  mockSuggestion(sourceText, hits, started, note) {
    let output = sourceText
    for (const hit of hits) {
      if (hit.forbidden) continue
      output = output.replace(new RegExp(escapeRegExp(hit.term), 'gi'), hit.target)
    }
    if (output === sourceText) output = `【机器翻译示例 · 术语替换】${sourceText}`
    return {
      text: output,
      provider: MOCK_PROVIDER,
      model: MOCK_MODEL,
      latencyMs: Date.now() - started,
      note,
    }
  },

  async mtSuggest({ text, documentId, index, sourceLang, targetLang } = {}) {
    let doc
    if (documentId !== undefined && documentId !== null) {
      if (typeof documentId !== 'string' || !documentId.trim()) {
        throw new CatError('DOCUMENT_NOT_FOUND', '文档不存在。', 404)
      }
      doc = this.docs.get(documentId)
      if (!doc) throw new CatError('DOCUMENT_NOT_FOUND', `文档不存在: ${documentId}`, 404)
    } else {
      doc = this.activeDocument()
    }

    let segment = null
    if (index !== undefined && index !== null) {
      if (!doc) throw new CatError('NO_DOCUMENT', '没有活动文档，无法定位句段。', 409)
      if (!Number.isInteger(index)) {
        throw new CatError('SEGMENT_OUT_OF_RANGE', `句段索引不是整数: ${index}`)
      }
      segment = this.findSegment(doc, index)
    }

    const fallbackSource = segment?.source ?? (doc ? doc.segments[doc.cursor]?.source : undefined)
    if (text === undefined && fallbackSource === undefined) {
      throw new CatError('NO_DOCUMENT', '没有活动文档，无法生成译文建议。', 409)
    }
    const sourceText = cleanText(text === undefined ? fallbackSource : text, '原文')
    if (!sourceText) throw new CatError('EMPTY_SOURCE', '没有可翻译的原文。')

    const src = canonicalLanguage(sourceLang || doc?.sourceLang || this.settings.sourceLang)
    const tgt = canonicalLanguage(targetLang || doc?.targetLang || this.settings.targetLang)
    const started = Date.now()
    const provider = this.settings.mt.provider
    const hits = this.findGlossaryHits(sourceText, src, doc?.id)
    const route = await this.resolveMtRoute()
    if (route.mock) {
      return this.mockSuggestion(sourceText, hits, started, route.note)
    }
    const model = route.model

    const terms = this.glossaryPrompt(hits)
    const briefBlock = doc ? briefPromptBlock(doc.brief) : ''
    const contextBlock = doc && segment ? contextPromptBlock(doc, index) : ''
    const systemText =
      'You are a professional translator. Preserve meaning, numbers, markup and tone. Use the document brief and surrounding segments to resolve ambiguity, and follow the terminology rules exactly. Return only the translation, without quotes or explanations.'
    const prompt = [
      `Translate from ${src} to ${tgt}.`,
      briefBlock,
      contextBlock,
      terms,
      `Source segment:\n${sourceText}`,
    ]
      .filter((part) => String(part ?? '').trim())
      .join('\n\n')
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ]

    let output
    try {
      const stream = await this.mtRuntime.stream({
        provider,
        model,
        messages,
        system: systemText,
        temperature: this.settings.mt.temperature,
        purpose: 'cait-mt',
        signal: AbortSignal.timeout(45000),
      })
      output = await collectStreamText(stream)
      if (!output) {
        const empty = new Error('DSH 模型路由没有返回译文')
        empty.code = 'MT_EMPTY'
        throw empty
      }
    } catch (error) {
      this.logger?.warn?.(
        `CAIT: DSH MT 路由调用失败 provider=${provider} model=${model} code=${
          error?.code || 'UNKNOWN'
        } status=${error?.status ?? '-'}: ${error?.message || error}`,
      )
      throw new CatError('MT_PROVIDER_FAILED', '机器翻译调用失败，请检查 DSH 模型路由配置。', 502)
    }

    return {
      text: output,
      provider,
      model,
      latencyMs: Date.now() - started,
      contextUsed:
        doc && segment
          ? {
              brief: Boolean(doc.brief),
              before: neighborContext(doc, index, { before: 2, after: 0 }).before.length,
              after: neighborContext(doc, index, { before: 0, after: 2 }).after.length,
            }
          : null,
    }
  },

  /**
   * Translate a bounded batch in one request so later segments share the same
   * brief and terminology decisions. The caller falls back to mtSuggest for
   * any index the model omitted.
   */
  async mtSuggestBatch({ documentId, items = [], sourceLang, targetLang } = {}) {
    if (!Array.isArray(items) || !items.length) {
      throw new CatError('EMPTY_BATCH', '批量翻译至少需要一个句段。')
    }
    if (items.length > MT_BATCH_MAX) {
      throw new CatError('BATCH_TOO_LARGE', `一次最多翻译 ${MT_BATCH_MAX} 个句段。`)
    }
    const doc = this.requireDocument(documentId)
    const src = canonicalLanguage(sourceLang || doc.sourceLang)
    const tgt = canonicalLanguage(targetLang || doc.targetLang)
    const prepared = items.map((item, position) => {
      const index = Number.isInteger(item?.index) ? item.index : doc.cursor
      const segment = this.findSegment(doc, index)
      const sourceText = cleanText(item?.text === undefined ? segment.source : item.text, '原文')
      if (!sourceText) throw new CatError('EMPTY_SOURCE', '没有可翻译的原文。')
      return {
        index,
        sourceText,
        hits: this.findGlossaryHits(sourceText, src, doc.id),
        context: neighborContext(doc, index, { before: 1, after: 1 }),
        position,
      }
    })

    const started = Date.now()
    const route = await this.resolveMtRoute()
    if (route.mock) {
      const note = route.note
      return {
        items: prepared.map((item) => ({
          index: item.index,
          text: this.mockSuggestion(item.sourceText, item.hits, started, note).text,
        })),
        provider: MOCK_PROVIDER,
        model: MOCK_MODEL,
        latencyMs: Date.now() - started,
        partial: false,
        note,
      }
    }

    const termMap = new Map()
    for (const item of prepared) {
      for (const hit of item.hits) {
        termMap.set(
          `${hit.term}\u0000${hit.target}\u0000${hit.forbidden}\u0000${hit.preferred}`,
          hit,
        )
      }
    }
    const terms = this.glossaryPrompt([...termMap.values()])
    const briefBlock = briefPromptBlock(doc.brief)
    const segments = prepared
      .map((item) => {
        const lines = [`[S${item.index}]`]
        for (const previous of item.context.before) {
          lines.push(`previous: ${String(previous.source).slice(0, 500)}`)
        }
        lines.push(`source: ${item.sourceText}`)
        for (const next of item.context.after) {
          lines.push(`next: ${String(next.source).slice(0, 500)}`)
        }
        return lines.join('\n')
      })
      .join('\n\n')
    const prompt = [
      `Translate the following ${prepared.length} segment(s) from ${src} to ${tgt}.`,
      'Return a JSON array only, one object per input segment: [{"id":"S12","text":"..."}]. Copy the id exactly. Translate only the `source:` line; `previous:` and `next:` are context and must not be translated, merged or omitted.',
      briefBlock,
      terms,
      `Segments:\n${segments}`,
    ]
      .filter((part) => String(part ?? '').trim())
      .join('\n\n')
    const systemText =
      'You are a professional translator. Preserve meaning, numbers, markup and tone. Use the document brief and neighbouring segments to resolve ambiguity, and follow the terminology rules exactly. Return only the requested JSON array.'
    const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]

    let output
    try {
      const stream = await this.mtRuntime.stream({
        provider: route.provider,
        model: route.model,
        messages,
        system: systemText,
        temperature: this.settings.mt.temperature,
        purpose: 'cait-mt-batch',
        signal: AbortSignal.timeout(60000),
      })
      output = await collectStreamText(stream)
    } catch (error) {
      this.logger?.warn?.(
        `CAIT: DSH batch MT route failed provider=${route.provider} model=${route.model}: ${
          error?.message || error
        }`,
      )
      throw new CatError(
        'MT_PROVIDER_FAILED',
        '批量机器翻译调用失败，请检查 DSH 模型路由配置。',
        502,
      )
    }

    const parsed = parseBatchTranslations(output, prepared)
    if (!parsed.size) {
      throw new CatError('MT_BATCH_INVALID', '模型没有返回可解析的批量译文。', 502)
    }
    const translated = prepared
      .filter((item) => parsed.has(item.index))
      .map((item) => ({ index: item.index, text: parsed.get(item.index) }))
    if (translated.length < prepared.length) {
      this.logger?.warn?.(
        `CAIT: batch MT returned ${translated.length}/${prepared.length} segments; missing segments will be retried individually.`,
      )
    }
    return {
      items: translated,
      provider: route.provider,
      model: route.model,
      latencyMs: Date.now() - started,
      partial: translated.length < prepared.length,
      contextUsed: { brief: Boolean(doc.brief), segments: prepared.length },
    }
  },
}

function parseBatchTranslations(output, expected) {
  const list = Array.isArray(expected)
    ? expected.filter((item) => item && item.index !== undefined)
    : []
  if (!list.length) return new Map()
  const count = list.length
  const raw = String(output ?? '').trim()
  if (!raw) return new Map()
  const candidates = []
  const fenced = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  candidates.push(fenced)
  const firstBracket = fenced.indexOf('[')
  const lastBracket = fenced.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(fenced.slice(firstBracket, lastBracket + 1))
  }
  const firstBrace = fenced.indexOf('{')
  const lastBrace = fenced.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(fenced.slice(firstBrace, lastBrace + 1))
  }
  let parsed = null
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate)
      break
    } catch {
      // Try the next extraction.
    }
  }
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.translations)) {
    parsed = parsed.translations
  }
  // A model may key the object by id instead of returning an array.
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const entries = Object.entries(parsed)
    if (
      entries.length &&
      entries.every(([key, value]) => /^S?\d+$/i.test(key) && typeof value === 'string')
    ) {
      parsed = entries.map(([id, text]) => ({ id, text }))
    }
  }
  if (!parsed) return new Map()

  const byId = new Map()
  for (const item of list) {
    byId.set(`S${item.index}`.toUpperCase(), item)
    // A model may drop the S prefix; a bare numeric id is still unambiguous
    // inside one batch.
    byId.set(String(item.index), item)
  }
  const byPosition = new Map(list.map((item) => [item.position, item]))
  const byIndex = new Map(list.map((item) => [Number(item.index), item]))
  const result = new Map()

  // Plain strings have no id. Accept them only when the model returned exactly
  // one per input; a missing/merged entry must fall back instead of shifting.
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
    if (parsed.length !== count) return result
    parsed.forEach((text, position) => {
      const target = byPosition.get(position)
      const value = String(text ?? '').trim()
      if (target && value) result.set(target.index, value)
    })
    return result
  }

  if (!Array.isArray(parsed)) return result
  const objects = parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
  if (!objects.length) return result

  // Legacy support: no ids, but the array is exactly 0..n-1 or 1..n. This is
  // only safe when every object is present, so partial renumbered output falls
  // back to per-segment translation rather than shifting.
  const numbers = objects.map((item) => Number(item.index))
  const hasAnyId = objects.some((item) => item.id !== undefined || item.segmentId !== undefined)
  const allZeroBased =
    numbers.length === count && numbers.every((value, position) => value === position)
  const allOneBased =
    numbers.length === count && numbers.every((value, position) => value === position + 1)
  const legacyMode = !hasAnyId && (allZeroBased || allOneBased) ? 'position' : null

  parsed.forEach((item, position) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const text = String(item.text ?? item.translation ?? item.target ?? '').trim()
    if (!text) return
    const id = String(item.id ?? item.segmentId ?? '')
      .trim()
      .toUpperCase()
    let target = id ? byId.get(id) : null
    if (!target && legacyMode) target = byPosition.get(position)
    if (!target && !id) {
      const number = Number(item.index)
      if (Number.isInteger(number) && byIndex.has(number)) target = byIndex.get(number)
    }
    if (!target) return
    // If the model echoed the source, it must be the source we sent. This
    // catches an id paired with the neighbouring segment's text.
    const claimedSource = item.source ?? item.sourceText
    if (claimedSource !== undefined) {
      const normalize = (value) =>
        String(value ?? '')
          .replace(/\s+/g, ' ')
          .trim()
      if (normalize(claimedSource) !== normalize(target.sourceText)) return
    }
    result.set(target.index, text)
  })
  return result
}
