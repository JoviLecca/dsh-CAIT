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

function shorten(value, max = 70) {
  const textValue = String(value ?? '').replace(/\s+/g, ' ').trim()
  return textValue.length > max ? `${textValue.slice(0, max - 1)}…` : textValue
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

    ctx.tools.register({
      name: 'cat_pre_translate',
      description:
        'Pre-translate one block of segments in a CAIT document: exact translation-memory matches first, then machine translation through the route in CAIT settings. Segments that are already confirmed or already carry a target are skipped, so repeated calls never overwrite human work. Each call handles at most 32 segments (default 8); the response carries next, the offset of the following block, or null at the end of the document. Call again with from: next to continue.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          from: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based offset of the first segment in this block. Defaults to 0.',
          },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 32,
            description: 'Segments per block. Defaults to 8.',
          },
          mode: {
            type: 'string',
            enum: ['mt', 'tm'],
            description:
              'mt (default) fills from translation memory when possible and machine translation otherwise; tm only reuses exact translation-memory matches and reports the rest as noMatch.',
          },
          overwrite: {
            type: 'boolean',
            description: 'Also replace segments that already have a target. Defaults to false.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Pre-translation failed.'}`)
          }
          const ice = value.segments.filter((item) => item.ice).length
          const lines = [
            `CAIT pre-translate (${value.mode}) — segments ${value.from + 1}–${value.to} of ${value.progress.total}`,
            `Filled ${value.filled}${ice ? ` (${ice} context match${ice === 1 ? '' : 'es'})` : ''} · skipped ${value.skipped.length} · no TM match ${value.noMatch.length} · failed ${value.failed.length}`,
          ]
          if (value.failed.length) {
            for (const item of value.failed.slice(0, 5)) {
              lines.push(`- segment ${item.index + 1}: ${item.code} — ${item.message}`)
            }
          }
          lines.push(
            '',
            `Progress: ${value.progress.confirmed}/${value.progress.total} confirmed · ${value.progress.translated} awaiting review · ${value.progress.pending} pending.`,
          )
          lines.push(value.next === null ? 'End of document reached.' : `Next block starts at segment ${value.next + 1}.`)
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...(await store.preTranslate(args)) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_get_segments',
      description:
        'List a bounded window of segments from a CAIT document with their source, target, status (pending, translated or confirmed), origin (tm, mt, agent or manual) and any pending suggestion. Use status to pull only the segments that still need work. The response carries next, the offset of the following window, or null at the end.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          from: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based offset of the first segment. Defaults to 0.',
          },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Segments per window. Defaults to 20.',
          },
          status: {
            type: 'string',
            enum: ['pending', 'translated', 'confirmed'],
            description: 'Optional status filter.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not list segments.'}`)
          }
          const doc = value.document
          const lines = [
            `CAIT — ${doc.name} (${doc.sourceLang} → ${doc.targetLang}) · ${value.progress.confirmed}/${doc.total} confirmed · ${value.progress.translated} awaiting review · ${value.progress.pending} pending`,
            '',
          ]
          if (!value.segments.length) {
            lines.push('No segments match.')
            return text(lines.join('\n'))
          }
          for (const segment of value.segments) {
            lines.push(
              `[${segment.index + 1}] ${segment.status}${segment.origin ? ` · ${segment.origin}` : ''}${segment.suggestion ? ' · has suggestion' : ''}`,
              `  ${segment.source}`,
              `  → ${segment.target || '(empty)'}`,
            )
          }
          lines.push('', value.next === null ? 'End of document reached.' : `Next window starts at ${value.next + 1}.`)
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.segmentsForTool(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_confirm_segments',
      description:
        'Confirm a batch of CAIT segments that already have a target, writing each source–target pair into translation memory. Pass indices, or a from/count window. Segments without a target and segments that are already confirmed are reported as skipped instead of guessed. Use this after reviewing pre-translated text in bulk.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          indices: {
            type: 'array',
            items: { type: 'integer', minimum: 0 },
            description: 'Zero-based segment indices to confirm. Takes precedence over from/count.',
          },
          from: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based offset of the first segment of the window. Defaults to 0.',
          },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Segments in the window. Defaults to 20.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not confirm segments.'}`)
          }
          const lines = [`Confirmed ${value.confirmed.length} segment(s).`]
          if (value.confirmed.length) lines.push(`Indices: ${value.confirmed.map((index) => index + 1).join(', ')}`)
          if (value.skipped.length) {
            const summary = {}
            for (const item of value.skipped) summary[item.reason] = (summary[item.reason] || 0) + 1
            lines.push(
              `Skipped ${value.skipped.length}: ${Object.entries(summary)
                .map(([reason, amount]) => `${reason} ${amount}`)
                .join(', ')}`,
            )
          }
          lines.push(
            '',
            `Progress: ${value.progress.confirmed}/${value.progress.total} confirmed · ${value.progress.translated} awaiting review · ${value.progress.pending} pending.`,
          )
          if (value.done) lines.push('Every segment is confirmed.')
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.confirmSegmentsForTool(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),
    ctx.tools.register({
      name: 'cat_propose_translation',
      description:
        'Propose a translation for one segment without touching its current target. The proposal is stored as a suggestion the human can adopt in the review pane; confirmed segments are refused so a decision that was already made is never silently overwritten. Use this for terminology fixes, consistency repairs and style rewrites.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          index: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based segment index. Defaults to the document cursor.',
          },
          target: {
            type: 'string',
            description: 'The proposed translation text.',
          },
          reason: {
            type: 'string',
            description: 'Optional short note shown next to the proposal, e.g. "术语统一：mode → 模式".',
          },
        },
        required: ['target'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not propose a translation.'}`)
          }
          const lines = [
            `Proposed a translation for segment ${value.segment.index + 1} (${value.segment.status}).`,
            value.segment.target ? `Current target: ${value.segment.target}` : 'Current target: (empty)',
            `Proposal: ${value.segment.suggestion}`,
          ]
          if (value.segment.suggestionReason) lines.push(`Reason: ${value.segment.suggestionReason}`)
          lines.push('', 'The human adopts it in the review pane; the target is unchanged until then.')
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.proposeTranslation(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),
    ctx.tools.register({
      name: 'cat_align',
      description:
        'Align a source text with an existing translation of it and report how confident the pairing is. Pass the two texts directly (read the files first if they are on disk). Nothing is written: the result only says how many pairs are trustworthy and which rows a human should check. Writing happens in the align pane after review.',
      parameters: {
        type: 'object',
        properties: {
          sourceText: { type: 'string', description: 'Full text of the source document.' },
          targetText: { type: 'string', description: 'Full text of the existing translation.' },
          sourceName: { type: 'string', description: 'Optional file name for display.' },
          targetName: { type: 'string', description: 'Optional file name for display.' },
          minScore: {
            type: 'number',
            description: 'Only list rows below this score as needing review. Defaults to 0.6.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'How many doubtful rows to show. Defaults to 10.',
          },
        },
        required: ['sourceText', 'targetText'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not align the two texts.'}`)
          }
          const threshold = Number.isFinite(args?.minScore) ? args.minScore : 0.6
          const doubtful = value.pairs.filter(
            (row) => row.score < threshold || row.confidence !== 'high',
          )
          const limit = Number.isFinite(args?.limit) ? args.limit : 10
          const lines = [
            `CAIT align: ${value.pairs.length} pair(s) from ${value.sourceSegments} source / ${value.targetSegments} target segment(s).`,
            `High confidence ${value.high} · medium ${value.medium} · low ${value.low} · unpaired source ${value.unpairedSource} · unpaired target ${value.unpairedTarget}.`,
          ]
          if (value.blocked) lines.push('Large document: aligned in blocks, check the middle of the file.')
          if (doubtful.length) {
            lines.push('', `Rows worth a human look (first ${Math.min(limit, doubtful.length)}):`)
            for (const row of doubtful.slice(0, limit)) {
              lines.push(
                `[${row.sourceIndex + 1}↔${row.targetIndex + 1}] ${row.score} · ${shorten(row.source)} → ${shorten(row.target)}`,
              )
            }
          }
          lines.push('', 'Write the reviewed pairs in the align pane; this tool never writes.')
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          const result = store.alignUploads({
            sourceFile: { name: args.sourceName || 'source.txt', text: args.sourceText },
            targetFile: { name: args.targetName || 'target.txt', text: args.targetText },
          })
          return { ok: true, ...result, rows: undefined }
        } catch (error) {
          return failure(error)
        }
      },
    }),
    ctx.tools.register({
      name: 'cat_consistency_report',
      description:
        'List groups of segments that share the same source text but carry different translations. Use it to find inconsistencies an import or propagation left behind; then decide the right wording and use cat_propose_translation.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: 'Maximum groups to return. Defaults to 50.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not build the consistency report.'}`)
          }
          if (!value.conflicts.length) {
            return text('CAIT consistency: every repeated source uses the same translation.')
          }
          const lines = [`CAIT consistency: ${value.total} inconsistent group(s).`]
          for (const conflict of value.conflicts) {
            lines.push('', `Source: ${shorten(conflict.source, 90)}`)
            for (const variant of conflict.variants) {
              lines.push(
                `  ${shorten(variant.target, 80)} — segment(s) ${variant.indices.map((index) => index + 1).join(', ')}`,
              )
            }
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.consistencyReport(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),
    ctx.tools.register({
      name: 'cat_term_candidates',
      description:
        'List terminology candidates mined from a document by counting: repeated multi-word names, capitalised compounds and repeated CJK substrings, ranked by frequency and length. Each candidate carries its occurrence count, sample sentences and any translation-memory wording that already exists. This is the short list to judge; do not re-derive terms yourself. Pick the real domain terms, translate them, then store them with cat_add_terms.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: 'Maximum candidates to return. Defaults to 60.',
          },
          minCount: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Minimum number of occurrences. Defaults to 2.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not mine terminology candidates.'}`)
          }
          if (!value.candidates.length) {
            return text('CAIT terms: no repeated candidate found in this document.')
          }
          const lines = [`CAIT terms: ${value.total} candidate(s).`]
          for (const candidate of value.candidates) {
            const flags = [
              `×${candidate.count}`,
              candidate.inLibrary ? 'in glossary' : '',
              candidate.evidence.length ? `memory: ${candidate.evidence.map((item) => shorten(item, 40)).join(' | ')}` : '',
            ].filter(Boolean)
            lines.push('', `${candidate.term} — ${flags.join(' · ')}`)
            if (candidate.examples.length) lines.push(`  e.g. ${shorten(candidate.examples[0], 100)}`)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.termCandidates(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),
    ctx.tools.register({
      name: 'cat_get_brief',
      description:
        'Read the active CAIT document translation brief: domain, audience, tone, notes, do-not-translate terms and a style sample. Read it before translating so terminology and register match the document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
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
          const brief = value.brief
          if (!brief) return text('CAIT brief: not set for this document.')
          const labels = {
            domain: 'Domain',
            audience: 'Audience',
            tone: 'Tone',
            notes: 'Notes',
            doNotTranslate: 'Do not translate',
            styleSample: 'Style sample',
          }
          const lines = ['CAIT brief:']
          for (const field of Object.keys(labels)) {
            if (brief[field]) lines.push(`${labels[field]}: ${brief[field]}`)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.getBrief(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_set_brief',
      description:
        'Update the active CAIT document translation brief. Send only the fields to change; an empty string clears one field, and clear=true removes the whole brief. The brief is saved with the document and used by later translation.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          domain: { type: 'string', description: 'Subject domain, for example legal or gaming.' },
          audience: { type: 'string', description: 'Intended readers and their background.' },
          tone: { type: 'string', description: 'Register and voice, for example concise and neutral.' },
          notes: { type: 'string', description: 'Other instructions for the translator.' },
          doNotTranslate: { type: 'string', description: 'Terms or fragments that must stay unchanged.' },
          styleSample: { type: 'string', description: 'A short sample of the desired target style.' },
          clear: { type: 'boolean', description: 'Remove the whole brief. Defaults to false.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not update the brief.'}`)
          }
          return text(value.brief ? 'CAIT brief updated.' : 'CAIT brief cleared.')
        },
      },
      async execute(args = {}) {
        try {
          const { documentId, clear, ...fields } = args
          return { ok: true, ...store.setBrief({ documentId, brief: fields, clear }) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_get_context',
      description:
        'Read a bounded context window around a CAIT segment: the document brief, the current segment and its previous/next source segments. Use it before translating or reviewing so pronouns, terms and omitted subjects are resolved from context.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          index: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based segment index. Defaults to the document cursor.',
          },
          before: {
            type: 'integer',
            minimum: 0,
            maximum: 5,
            description: 'Previous source segments to include. Defaults to 2.',
          },
          after: {
            type: 'integer',
            minimum: 0,
            maximum: 5,
            description: 'Following source segments to include. Defaults to 2.',
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
          const lines = [
            `CAIT context — ${value.document.name} (${value.document.sourceLang} → ${value.document.targetLang})`,
            `Segment ${value.segment.index + 1}/${value.document.total} · ${value.segment.status}`,
          ]
          if (value.brief) {
            lines.push('', 'BRIEF:')
            for (const [field, fieldValue] of Object.entries(value.brief)) {
              if (field !== 'updatedAt' && fieldValue) lines.push(`- ${field}: ${fieldValue}`)
            }
          }
          if (value.before.length) {
            lines.push('', 'BEFORE:')
            for (const item of value.before) lines.push(`- ${item.index + 1}. ${item.source}`)
          }
          lines.push('', 'CURRENT:', value.segment.source)
          if (value.segment.target) lines.push('', 'CURRENT TARGET:', value.segment.target)
          if (value.after.length) {
            lines.push('', 'AFTER:')
            for (const item of value.after) lines.push(`- ${item.index + 1}. ${item.source}`)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.contextForTool(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_unconfirm_segment',
      description:
        'Revoke the confirmation of a CAIT segment. The translated text stays as a draft and translation memory is not changed. Use it when a confirmed segment needs rework before it is confirmed again.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id. Defaults to the active document.',
          },
          index: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based segment index. Defaults to the document cursor.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not unconfirm the segment.'}`)
          }
          return text(
            `CAIT: segment ${value.index + 1} is now ${value.segment.status}; translation memory was left unchanged.`,
          )
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.unconfirmSegment(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_concordance',
      description:
        'Search every mounted CAIT translation-memory entry for a word or phrase in the source or target text. Use it to check how a term was translated elsewhere; results are capped and carry their surrounding context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Word or phrase to search for.' },
          documentId: {
            type: 'string',
            description: 'Optional CAIT document id whose language pair filters results.',
          },
          sourceLang: { type: 'string', description: 'Optional source language filter.' },
          targetLang: { type: 'string', description: 'Optional target language filter.' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Maximum matches to return. Defaults to 20.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Concordance search failed.'}`)
          }
          if (!value.entries.length) return text(`CAIT concordance: no match for “${value.query}”.`)
          const lines = [`CAIT concordance: ${value.total} match(es), showing ${value.entries.length}.`]
          for (const entry of value.entries) {
            lines.push('', `${entry.source} → ${entry.target}`)
            if (entry.context?.prev || entry.context?.next) {
              lines.push(`  context: ${entry.context.prev || '—'} | ${entry.context.next || '—'}`)
            }
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.concordance(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_add_terms',
      description:
        'Add accepted terminology to a glossary library in one batch. Entries already present (same source and language) are skipped rather than overwritten, so this never destroys wording the user chose. Create or pick a library with the user first when they keep separate projects.',
      parameters: {
        type: 'object',
        properties: {
          glossaryId: {
            type: 'string',
            description: 'Optional glossary library id. Defaults to the mounted library.',
          },
          entries: {
            type: 'array',
            description: 'Terms to add.',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', description: 'Source term.' },
                target: { type: 'string', description: 'Translated term.' },
                note: { type: 'string', description: 'Optional note.' },
                sourceLang: { type: 'string', description: 'Optional source language tag.' },
                caseSensitive: { type: 'boolean', description: 'Match this term case-sensitively.' },
                forbidden: {
                  type: 'boolean',
                  description: 'Never use this translation; it is a forbidden rendering of the source term.',
                },
                preferred: {
                  type: 'boolean',
                  description: 'Require this translation when the source term appears.',
                },
              },
              required: ['source', 'target'],
              additionalProperties: false,
            },
          },
        },
        required: ['entries'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'Could not add terms.'}`)
          }
          return text(`CAIT terms: added ${value.added}, skipped ${value.skipped} (of ${value.total}).`)
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...store.addGlossaryEntries(args) }
        } catch (error) {
          return failure(error)
        }
      },
    }),

    ctx.tools.register({
      name: 'cat_review',
      description:
        'Run one LLM review pass over a bounded range of translated segments. Returns structured issues with severity, code, message and an optional replacement suggestion. It never writes to the document; report the issues or apply a suggestion through cat_submit_translation after the user agrees.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'CAIT document id. Defaults to the active document.' },
          from: { type: 'integer', minimum: 0, description: 'Zero-based first segment index. Defaults to 0.' },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Segments to review in this pass. Defaults to 20.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          if (!value || value.ok === false) {
            return text(`CAIT: ${value?.message || 'AI review failed.'}`)
          }
          if (!value.issues.length) return text(`CAIT review: no issue found in segments ${value.from}–${value.to - 1}.`)
          const lines = [`CAIT review: ${value.issues.length} issue(s) in segments ${value.from}–${value.to - 1}.`]
          for (const issue of value.issues) {
            lines.push('', `[${issue.severity}] #${issue.index} ${issue.code}: ${issue.message}`)
            if (issue.suggestion) lines.push(`  suggestion: ${issue.suggestion}`)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(args = {}) {
        try {
          return { ok: true, ...(await store.reviewDocument(args)) }
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
