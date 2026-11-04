import { CatError, canonicalLanguage } from './store.js'

function text(value) {
  return [{ type: 'text', text: String(value ?? '') }]
}

function failure(error) {
  if (error instanceof CatError) return { ok: false, error: error.code, message: error.message }
  return { ok: false, error: 'CAIT_ERROR', message: error?.message ?? String(error) }
}

const MATCH_LABELS = {
  exact: 'exact',
  near_exact: 'near-exact',
  high_fuzzy: 'high fuzzy',
  medium_fuzzy: 'medium fuzzy',
  low_fuzzy: 'low fuzzy',
}

function matchLabel(match) {
  return MATCH_LABELS[match?.matchType] || (match?.exact ? 'exact' : 'fuzzy')
}

function summarizeMatches(matches) {
  if (!matches?.length) return 'TM matches: none'
  const lines = ['TM matches:']
  for (const match of matches.slice(0, 5)) {
    lines.push(`- ${match.percent}% ${matchLabel(match)} · ${match.source} → ${match.target}`)
  }
  return lines.join('\n')
}

function summarizeTerms(hits) {
  if (!hits?.length) return 'Glossary hits: none'
  const lines = ['Glossary hits:']
  for (const hit of hits.slice(0, 10)) {
    lines.push(`- ${hit.term} → ${hit.target}${hit.note ? ` (${hit.note})` : ''}`)
  }
  return lines.join('\n')
}

function summarizeDocument(doc, activeDocumentId) {
  const marker = doc.id === activeDocumentId ? '[active] ' : ''
  const progress = doc.progress || { confirmed: 0, total: 0, percent: 0 }
  return `${marker}${doc.name} (${doc.sourceLang} → ${doc.targetLang}) · ${progress.confirmed}/${progress.total} confirmed (${progress.percent}%) · cursor ${doc.cursor}`
}

export function registerCatTools(ctx, store) {
  const disposers = [
    ctx.tools.register({
      name: 'cat_get_segment',
      description:
        'Get the current segment of the active CAIT translation document, together with translation-memory matches and glossary hits from the currently mounted libraries. Call this before translating. Returns ok:false when no document has been created in the CAIT workbench.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document in the workbench.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'No active document.'}`)
          }
          const doc = value.document
          const segment = value.segment
          const lines = [
            `CAIT — ${doc.name} (${doc.sourceLang} → ${doc.targetLang})`,
            `Segment ${segment.index + 1}/${doc.total} · ${segment.status} · ${value.progress.confirmed}/${doc.total} confirmed`,
            '',
            'SOURCE:',
            segment.source,
            '',
            'TARGET:',
            segment.target || '(not translated yet)',
            '',
            summarizeMatches(value.tmMatches),
            '',
            summarizeTerms(value.glossaryHits),
          ]
          if (value.done) lines.push('', 'All segments are confirmed.')
          return text(lines.join('\n'))
        },
      },
      async execute(args) {
        try {
          return { ok: true, ...store.getSegmentForTool(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_submit_translation',
      description:
        'Submit and confirm the translation of a CAIT segment. The source–target pair is written to the selected mounted translation-memory library immediately, and the workbench advances to the next unconfirmed segment. Always provide the complete translated segment text.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'The complete translated text for the segment.',
          },
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document in the workbench.',
          },
          index: {
            type: 'integer',
            minimum: 0,
            description: 'Optional zero-based segment index. Defaults to the current segment.',
          },
          addToTm: {
            type: 'boolean',
            description: 'Write the confirmed pair into translation memory. Defaults to true.',
          },
          targetTmId: {
            type: 'string',
            description:
              'Optional mounted translation-memory library id. Defaults to the current default write library; a known but unmounted library is rejected with TM_NOT_MOUNTED.',
          },
        },
        required: ['target'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not confirm the segment.'}`)
          }
          const confirmed = value.confirmed
          const lines = [
            `Confirmed segment ${confirmed.index + 1}.`,
            '',
            'SOURCE:',
            confirmed.source,
            '',
            'TARGET:',
            confirmed.target,
          ]
          if (value.tm?.count !== undefined) {
            lines.push('', `Translation memory now holds ${value.tm.count} segment pair(s).`)
          }
          if (value.next) {
            lines.push(
              '',
              `Next segment ${value.next.index + 1}/${value.document.total}:`,
              value.next.source,
              `Progress: ${value.progress.confirmed}/${value.progress.total} (${value.progress.percent}%).`,
            )
          } else {
            lines.push('', `All ${value.progress.total} segments are confirmed.`)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args) {
        try {
          return { ok: true, ...store.submitTranslationForTool(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_lookup_tm',
      description:
        'Search the currently mounted CAIT translation-memory libraries for a source sentence. Returns exact, near-exact and graded fuzzy matches sorted by score, with a 0–1 threshold (default from workbench settings). Each match carries matchType and the source tmId.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Source text to look up in translation memory.',
          },
          threshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Minimum fuzzy score. 1 returns exact matches only.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 30,
            description: 'Maximum number of matches. Defaults to 5.',
          },
          sourceLang: {
            type: 'string',
            description: 'Optional source language filter, e.g. en.',
          },
          targetLang: {
            type: 'string',
            description: 'Optional target language filter, e.g. zh-CN.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Lookup failed.'}`)
          }
          if (!value.matches?.length) {
            return text(`CAIT TM: no matches for “${value.query}”.`)
          }
          const lines = [`CAIT TM: ${value.matches.length} match(es) for “${value.query}”`, '']
          for (const match of value.matches) {
            lines.push(
              `${match.percent}% ${matchLabel(match)} · ${match.sourceLang} → ${match.targetLang}`,
              `  ${match.source}`,
              `  → ${match.target}`,
              '',
            )
          }
          return text(lines.join('\n').trim())
        },
      },
      async execute(args) {
        try {
          const result = store.lookupTM(args)
          return { ok: true, ...result, count: result.matches.length }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_lookup_glossary',
      description:
        'Search the currently mounted CAIT glossary libraries by source language and optional source/target substring. Returns the same glossary entry fields as the workbench bootstrap state, including glossaryId.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "Optional substring matched against the source or target term; each entry's caseSensitive flag controls case handling.",
          },
          sourceLang: {
            type: 'string',
            description: 'Optional source language filter, e.g. en. Omit to search every language.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum number of entries to return. Defaults to 20.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Glossary lookup failed.'}`)
          }
          if (!value.entries?.length) {
            const scope = value.sourceLang ? ` for ${value.sourceLang}` : ''
            return text(`CAIT glossary: no entries matching “${value.query}”${scope}.`)
          }
          const suffix = value.total > value.entries.length
            ? `, showing ${value.entries.length} of ${value.total}`
            : ''
          const scope = value.sourceLang ? ` · ${value.sourceLang}` : ''
          const lines = [`CAIT glossary: ${value.entries.length} entry(ies)${scope}${suffix}`, '']
          for (const entry of value.entries) {
            lines.push(
              `- ${entry.source} → ${entry.target}${entry.note ? ` (${entry.note})` : ''}`,
              `  ${entry.sourceLang || 'any'} · ${entry.glossaryId || 'glossary_default'}`,
            )
          }
          return text(lines.join('\n').trim())
        },
      },
      async execute(args = {}) {
        try {
          const query = String(args?.query ?? '').trim()
          const sourceLang = String(args?.sourceLang ?? '').trim()
          const rawLimit = Number(args?.limit)
          const limit = Number.isFinite(rawLimit)
            ? Math.min(100, Math.max(1, Math.trunc(rawLimit)))
            : 20
          const lang = sourceLang ? canonicalLanguage(sourceLang) : ''
          const foldedQuery = query.toLocaleLowerCase()
          const matches = store.bootstrap().glossary.filter((entry) => {
            if (lang && (!entry.sourceLang || canonicalLanguage(entry.sourceLang) !== lang)) {
              return false
            }
            if (!query) return true
            const haystack = `${entry.source ?? ''}\n${entry.target ?? ''}`
            return entry.caseSensitive
              ? haystack.includes(query)
              : haystack.toLocaleLowerCase().includes(foldedQuery)
          })
          return {
            ok: true,
            query,
            sourceLang: lang || null,
            count: Math.min(matches.length, limit),
            total: matches.length,
            entries: matches.slice(0, limit),
          }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_list_documents',
      description:
        'List every CAIT document with its translation progress, using the same document summary and stats fields as the workbench bootstrap state. The active document is marked by activeDocumentId.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not list documents.'}`)
          }
          if (!value.documents?.length) return text('CAIT documents: none.')
          const lines = [`CAIT documents (${value.documents.length}):`, '']
          for (const doc of value.documents) {
            lines.push(`- ${summarizeDocument(doc, value.activeDocumentId)}`)
          }
          lines.push(
            '',
            `Stats: ${value.stats?.segments ?? 0} segments · ${value.stats?.confirmed ?? 0} confirmed · ${value.stats?.tm ?? 0} TM entries · ${value.stats?.glossary ?? 0} glossary terms`,
          )
          return text(lines.join('\n'))
        },
      },
      async execute() {
        try {
          const state = store.bootstrap()
          return {
            ok: true,
            activeDocumentId: state.activeDocument?.id ?? null,
            documents: state.documents,
            stats: state.stats,
          }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_switch_document',
      description:
        'Switch the active CAIT document. Subsequent cat_get_segment and cat_submit_translation calls use this document by default. Returns the selected document summary, including its progress.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'CAIT document id returned by cat_list_documents.',
          },
        },
        required: ['documentId'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not switch document.'}`)
          }
          const doc = value.document
          const progress = doc.progress || { confirmed: 0, total: 0, percent: 0 }
          return text(
            [
              `CAIT: switched to “${doc.name}” (${doc.sourceLang} → ${doc.targetLang}).`,
              `Progress: ${progress.confirmed}/${progress.total} confirmed (${progress.percent}%).`,
              `Current segment: ${doc.cursor + 1}/${progress.total}.`,
            ].join('\n'),
          )
        },
      },
      async execute(args = {}) {
        try {
          if (!args?.documentId || typeof args.documentId !== 'string') {
            throw new CatError('MISSING_DOCUMENT_ID', 'documentId 不能为空。')
          }
          const result = store.openDocument({ documentId: args.documentId })
          const state = store.bootstrap()
          const document =
            state.documents.find((item) => item.id === result.document.id) || result.document
          return { ok: true, activeDocumentId: document.id, document }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_suggest_mt',
      description:
        'Generate a machine-translation suggestion through the DSH provider route selected in CAIT settings. Credentials are resolved by DSH; CAIT never receives an API key. If no usable DSH route is configured, falls back to offline glossary substitution and returns a note. Without text, the selected segment (or active document cursor) is used; an explicitly supplied unknown documentId or out-of-range index is an error.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Optional source text. Defaults to the current segment of the active document.',
          },
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          index: {
            type: 'integer',
            minimum: 0,
            description: 'Optional zero-based segment index. Defaults to the document cursor.',
          },
          sourceLang: {
            type: 'string',
            description: 'Optional source language override, e.g. en.',
          },
          targetLang: {
            type: 'string',
            description: 'Optional target language override, e.g. zh-CN.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Machine translation failed.'}`)
          }
          const lines = [
            `CAIT MT (${value.provider} · ${value.model} · ${value.latencyMs} ms):`,
            '',
            value.text,
          ]
          if (value.note) lines.push('', value.note)
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          const result = await store.mtSuggest(args)
          return { ok: true, ...result }
        } catch (error) {
          return failure(error)
        }
      },
    }),
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}
