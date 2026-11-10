import { h, useRef } from '../react.js'
import { Spinner, Icon } from './base.js'
import { TmMatchCard } from './editor.js'

function CatPanel({
  t,
  doc,
  data,
  settings,
  mtRoutes,
  tab,
  setTab,
  tmQuery,
  setTmQuery,
  tmResults,
  tmError,
  onApplyTm,
  onEditTm,
  onDeleteTm,
  onImportTmx,
  onClearTm,
  onApplyTerm,
  onImportGlossary,
  onClearGlossary,
  mt,
  mtError,
  mtBusy,
  onGenerateMt,
  onApplyMt,
  onCopy,
  onOpenSettings,
  onSearchLibrary,
  qa,
  onRefreshQa,
  onJumpQa,
  onFixQa,
  review,
  reviewBusy,
  onReview,
  onCancelReview,
  onApplyReview,
  concordance,
  concordanceQuery,
  setConcordanceQuery,
  onConcordance,
  onApplyConcordance,
  busy,
}) {
  const tmxInput = useRef(null)
  const glossaryInput = useRef(null)
  const routes = Array.isArray(mtRoutes?.providers) ? mtRoutes.providers : []
  const currentRoute = routes.find((route) => route.id === settings.mt.provider)
  const mtProviderLabel =
    settings.mt.provider === 'mock'
      ? t('mt.mock')
      : currentRoute?.name || settings.mt.provider || t('mt.mock')

  const current = doc.current
  const tmMatches = tmResults?.matches ?? current?.tmMatches ?? []
  const hits = current?.glossaryHits ?? []

  return h(
    'aside',
    { className: 'cait-cat' },
    h(
      'div',
      { className: 'cait-cat-head' },
      h('span', { className: 'cait-cat-title' }, t('panel.title')),
      h(
        'div',
        { className: 'cait-cat-head-actions' },
        h(
          'button',
          {
            className: 'cait-btn cait-libopen',
            onClick: () =>
              onSearchLibrary(tab === 'glossary' ? 'glossary' : 'tm', tab === 'tm' ? tmQuery : ''),
            disabled: Boolean(busy),
            title: t('libraries.open'),
          },
          h(Icon, { name: 'database', size: 12 }),
          t('libraries.short'),
        ),
        h('span', { className: 'cait-live-dot', title: t('panel.live') }),
      ),
    ),
    h(
      'div',
      { className: 'cait-tabs' },
      h(
        'button',
        { className: `cait-tab${tab === 'tm' ? ' active' : ''}`, onClick: () => setTab('tm') },
        h(Icon, { name: 'database', size: 13 }),
        t('panel.tm'),
        h('span', { className: 'cait-count' }, data.tm.count),
      ),
      h(
        'button',
        {
          className: `cait-tab${tab === 'glossary' ? ' active' : ''}`,
          onClick: () => setTab('glossary'),
        },
        h(Icon, { name: 'book', size: 13 }),
        t('panel.glossary'),
        h('span', { className: 'cait-count' }, data.glossary.length),
      ),
      h(
        'button',
        { className: `cait-tab${tab === 'mt' ? ' active' : ''}`, onClick: () => setTab('mt') },
        h(Icon, { name: 'sparkles', size: 13 }),
        t('panel.mt'),
      ),
      h(
        'button',
        { className: `cait-tab${tab === 'qa' ? ' active' : ''}`, onClick: () => setTab('qa') },
        h(Icon, { name: 'alert', size: 13 }),
        t('panel.qa'),
        qa?.issueCount ? h('span', { className: 'cait-count' }, qa.issueCount) : null,
      ),
      h(
        'button',
        {
          className: `cait-tab${tab === 'concordance' ? ' active' : ''}`,
          onClick: () => setTab('concordance'),
        },
        h(Icon, { name: 'search', size: 13 }),
        t('panel.concordance'),
      ),
    ),
    h(
      'div',
      { className: 'cait-tabbody' },
      tab === 'tm'
        ? h(
            'div',
            null,
            h(
              'form',
              {
                className: 'cait-search',
                onSubmit: (event) => {
                  event.preventDefault()
                  setTmQuery(tmQuery)
                },
              },
              h(Icon, { name: 'search', size: 13 }),
              h('input', {
                value: tmQuery,
                onChange: (event) => {
                  setTmQuery(event.target.value)
                  if (tmResults) {
                    // clearing the field returns to current-segment matches
                  }
                },
                placeholder: t('panel.searchPlaceholder'),
                'aria-label': t('panel.searchPlaceholder'),
              }),
              h(
                'button',
                { className: 'cait-iconbtn', type: 'submit', title: t('panel.search') },
                h(Icon, { name: 'arrowRight', size: 13 }),
              ),
            ),
            // The panel searches what is mounted; the library workspace
            // searches everything. This carries the typed query across.
            h(
              'div',
              { className: 'cait-paneljump' },
              h(
                'button',
                {
                  className: 'cait-linkbtn',
                  type: 'button',
                  onClick: () => onSearchLibrary('tm', tmQuery),
                },
                t('panel.searchInLibrary'),
              ),
            ),
            h(
              'div',
              { className: 'cait-listhead' },
              h('span', null, tmResults ? t('panel.searchResults') : t('panel.currentMatches')),
              h('span', { className: 'cait-count' }, tmError ? '!' : tmMatches.length),
            ),
            tmError ? h('div', { className: 'cait-mt-error' }, tmError) : null,
            tmMatches.length
              ? tmMatches.map((match) =>
                  h(TmMatchCard, {
                    key: match.id,
                    t,
                    match,
                    busy,
                    onApply: onApplyTm,
                    onEdit: onEditTm,
                    onDelete: onDeleteTm,
                  }),
                )
              : h(
                  'p',
                  { className: 'cait-empty-note' },
                  tmResults ? t('panel.noMatches') : t('panel.noCurrentMatches'),
                ),
            h('p', { className: 'cait-mt-hint' }, t('panel.tmHint')),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h('input', {
                ref: tmxInput,
                type: 'file',
                accept: '.tmx,application/xml,text/xml',
                hidden: true,
                onChange: (event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportTmx(file)
                  event.target.value = ''
                },
              }),
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => tmxInput.current?.click(),
                  disabled: Boolean(busy),
                },
                h(Icon, { name: 'download', size: 12 }),
                t('panel.importTmx'),
              ),
              h(
                'button',
                {
                  className: 'cait-btn cait-btn-danger',
                  onClick: onClearTm,
                  disabled: Boolean(busy) || data.tm.count === 0,
                },
                t('panel.clearTm'),
              ),
            ),
          )
        : null,
      tab === 'glossary'
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'cait-subhead' },
              h('span', null, t('panel.termHits')),
              h('span', { className: 'cait-count' }, hits.length),
            ),
            hits.length
              ? h(
                  'div',
                  { className: 'cait-hitrow', style: { marginTop: 0, marginBottom: 10 } },
                  hits.map((hit) =>
                    h(
                      'button',
                      {
                        key: hit.id,
                        className: 'cait-chip cait-chip-action',
                        onClick: () => onApplyTerm(hit),
                        title: hit.note || hit.target,
                      },
                      `${hit.term} → ${hit.target}${hit.forbidden ? ` · ${t('panel.termForbidden')}` : hit.preferred ? ` · ${t('panel.termPreferred')}` : ''}`,
                    ),
                  ),
                )
              : h('p', { className: 'cait-empty-note' }, t('panel.noHits')),
            // The panel is a per-segment view: whole-library browsing,
            // adding and editing live on the library page, so the panel
            // stays short instead of dumping the mounted glossary.
            h('p', { className: 'cait-mt-hint' }, t('panel.glossaryMatchesOnly')),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => onSearchLibrary('glossary', ''),
                  disabled: Boolean(busy),
                },
                h(Icon, { name: 'book', size: 12 }),
                t('panel.viewAll'),
              ),
            ),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h('input', {
                ref: glossaryInput,
                type: 'file',
                accept: '.csv,.tsv,.txt',
                hidden: true,
                onChange: (event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportGlossary(file)
                  event.target.value = ''
                },
              }),
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => glossaryInput.current?.click(),
                  disabled: Boolean(busy),
                },
                h(Icon, { name: 'download', size: 12 }),
                t('panel.importCsv'),
              ),
              h(
                'button',
                {
                  className: 'cait-btn cait-btn-danger',
                  onClick: onClearGlossary,
                  disabled: Boolean(busy) || data.glossary.length === 0,
                },
                t('panel.clearGlossary'),
              ),
            ),
          )
        : null,
      tab === 'mt'
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'cait-mt-head' },
              h('span', { className: 'cait-mt-mode' }, mtProviderLabel),
              h(
                'span',
                { className: 'cait-muted cait-tiny' },
                `${t('panel.mtModel')}: ${settings.mt.model || '—'}`,
              ),
            ),
            h(
              'div',
              { className: 'cait-card' },
              h(
                'div',
                { className: 'cait-labelrow' },
                h('span', { className: 'cait-label' }, t('panel.mtRoute')),
                h('span', { className: 'cait-meta' }, settings.mt.provider || '—'),
              ),
              h(
                'button',
                {
                  className: 'cait-btn cait-btn-primary',
                  onClick: onGenerateMt,
                  disabled: Boolean(busy) || mtBusy,
                  style: { width: '100%' },
                },
                mtBusy ? h(Spinner) : h(Icon, { name: 'sparkles', size: 14 }),
                mtBusy ? t('panel.mtGenerating') : t('panel.mtGenerate'),
              ),
            ),
            mtError ? h('div', { className: 'cait-mt-error' }, mtError) : null,
            mt
              ? h(
                  'article',
                  { className: 'cait-card cait-mt-card' },
                  h(
                    'div',
                    { className: 'cait-card-head' },
                    h('span', { className: 'cait-score exact' }, t('panel.mtSuggestion')),
                    h('span', { className: 'cait-score-label' }, `${mt.latencyMs} ms`),
                  ),
                  h('p', { className: 'cait-mt-text' }, mt.text),
                  mt.note ? h('p', { className: 'cait-mt-hint' }, mt.note) : null,
                  h(
                    'div',
                    { className: 'cait-mt-actions' },
                    h(
                      'button',
                      { className: 'cait-minibtn', onClick: () => onCopy(mt.text) },
                      t('panel.copy'),
                    ),
                    h(
                      'button',
                      { className: 'cait-minibtn', onClick: onApplyMt },
                      t('panel.mtInsert'),
                    ),
                  ),
                )
              : h('p', { className: 'cait-empty-note' }, t('panel.mtEmpty')),
            h(
              'p',
              { className: 'cait-mt-hint' },
              settings.mt.provider === 'mock' ? t('panel.mtMockHint') : t('panel.mtHint'),
            ),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h(
                'button',
                { className: 'cait-btn', onClick: onOpenSettings },
                h(Icon, { name: 'settings', size: 12 }),
                t('panel.mtSettings'),
              ),
            ),
          )
        : null,
      tab === 'qa'
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'cait-subhead' },
              h('span', null, t('qa.title')),
              h(
                'div',
                { className: 'cait-subhead-actions' },
                h(
                  'button',
                  {
                    className: 'cait-btn cait-btn-primary',
                    onClick: () => onReview('page'),
                    disabled: Boolean(busy) || Boolean(reviewBusy),
                    title: t('qa.reviewPageHint'),
                  },
                  h(Icon, { name: 'sparkles', size: 12 }),
                  reviewBusy ? t('qa.reviewing') : t('qa.reviewPage'),
                ),
                h(
                  'button',
                  {
                    className: 'cait-linkbtn',
                    onClick: () => onReview('risk'),
                    disabled:
                      Boolean(busy) ||
                      Boolean(reviewBusy) ||
                      (qa?.risks || []).every((item) => item.risk !== 'high'),
                    title: t('qa.reviewRiskHint'),
                  },
                  t('qa.reviewRisk', {
                    count: (qa?.risks || []).filter((item) => item.risk === 'high').length,
                  }),
                ),
                h(
                  'button',
                  { className: 'cait-linkbtn', onClick: onRefreshQa, disabled: Boolean(busy) },
                  h(Icon, { name: 'refresh', size: 12 }),
                  t('qa.refresh'),
                ),
              ),
            ),
            qa
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'cait-riskcounts' },
                    ['high', 'medium', 'low'].map((level) =>
                      h(
                        'span',
                        { key: level, className: `cait-riskcount ${level}` },
                        `${t(`qa.${level}`)} ${qa.riskCounts?.[level] || 0}`,
                      ),
                    ),
                  ),
                  (qa.risks || []).length
                    ? qa.risks.map((item) => {
                        const segment = doc.segments[item.index]
                        const codes = (item.codes || [])
                          .map((code) => t(`qa.code.${code}`))
                          .join(' · ')
                        return h(
                          'div',
                          {
                            key: item.index,
                            className: `cait-riskrow ${item.risk}`,
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => onJumpQa(item.index),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onJumpQa(item.index)
                              }
                            },
                            title: codes,
                          },
                          h('span', { className: 'cait-riskrow-index' }, `${item.index + 1}`),
                          h(
                            'div',
                            { className: 'cait-riskrow-body' },
                            h('span', { className: 'cait-riskrow-source' }, segment?.source || ''),
                            h('span', { className: 'cait-riskrow-codes' }, codes),
                            onFixQa
                              ? h(
                                  'div',
                                  { className: 'cait-riskactions' },
                                  h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onFixQa(item, 'copy-source')
                                      },
                                      disabled: Boolean(busy),
                                    },
                                    t('qa.fixCopy'),
                                  ),
                                  h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onFixQa(item, 'clear')
                                      },
                                      disabled: Boolean(busy),
                                    },
                                    t('qa.fixClear'),
                                  ),
                                  item.termTarget
                                    ? h(
                                        'button',
                                        {
                                          className: 'cait-riskaction',
                                          onClick: (event) => {
                                            event.stopPropagation()
                                            onFixQa(item, 'term')
                                          },
                                          disabled: Boolean(busy),
                                        },
                                        t('qa.fixTerm'),
                                      )
                                    : null,
                                )
                              : null,
                          ),
                          h(Icon, { name: 'chevronRight', size: 12 }),
                        )
                      })
                    : h('p', { className: 'cait-empty-note' }, t('qa.empty')),
                )
              : h('p', { className: 'cait-empty-note' }, t('qa.loading')),
            review
              ? h(
                  'div',
                  { className: 'cait-review' },
                  h(
                    'div',
                    { className: 'cait-listhead' },
                    t('qa.reviewTitle'),
                    h(
                      'span',
                      { className: 'cait-reviewmeta' },
                      h(
                        'span',
                        { className: 'cait-muted' },
                        t('qa.reviewProgress', { done: review.done, total: review.total }),
                      ),
                      review.running
                        ? h(
                            'button',
                            { className: 'cait-linkbtn', onClick: onCancelReview },
                            t('qa.reviewCancel'),
                          )
                        : null,
                    ),
                  ),
                  review.cancelled && !review.running
                    ? h('p', { className: 'cait-empty-note' }, t('qa.reviewCancelled'))
                    : null,
                  (review.issues || []).length
                    ? review.issues.map((issue, issueIndex) => {
                        const severity = ['high', 'medium', 'low'].includes(issue.severity)
                          ? issue.severity
                          : 'medium'
                        return h(
                          'div',
                          {
                            key: `${issue.index}-${issueIndex}`,
                            className: 'cait-reviewrow',
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => onJumpQa(issue.index),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onJumpQa(issue.index)
                              }
                            },
                          },
                          h('span', { className: 'cait-reviewrow-index' }, `${issue.index + 1}`),
                          h(
                            'div',
                            { className: 'cait-reviewrow-body' },
                            h(
                              'span',
                              { className: `cait-reviewrow-msg ${severity}` },
                              `[${t(`qa.${severity}`)}] ${issue.message}`,
                            ),
                            issue.suggestion
                              ? h(
                                  'button',
                                  {
                                    className: 'cait-riskaction',
                                    onClick: (event) => {
                                      event.stopPropagation()
                                      onApplyReview(issue)
                                    },
                                  },
                                  t('qa.reviewApply'),
                                )
                              : null,
                          ),
                        )
                      })
                    : h('p', { className: 'cait-empty-note' }, t('qa.reviewEmpty')),
                )
              : null,
          )
        : null,
      tab === 'concordance'
        ? h(
            'div',
            null,
            h(
              'form',
              {
                className: 'cait-search',
                onSubmit: (event) => {
                  event.preventDefault()
                  onConcordance()
                },
              },
              h(Icon, { name: 'search', size: 13 }),
              h('input', {
                value: concordanceQuery,
                onChange: (event) => setConcordanceQuery(event.target.value),
                placeholder: t('panel.concordancePlaceholder'),
                'aria-label': t('panel.concordancePlaceholder'),
              }),
              h(
                'button',
                { className: 'cait-iconbtn', type: 'submit', title: t('panel.searchConcordance') },
                h(Icon, { name: 'arrowRight', size: 13 }),
              ),
            ),
            h('p', { className: 'cait-mt-hint' }, t('panel.concordanceHint')),
            concordance
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'cait-listhead' },
                    h('span', null, t('panel.concordance')),
                    h(
                      'span',
                      { className: 'cait-count' },
                      concordance.total ?? concordance.entries?.length ?? 0,
                    ),
                  ),
                  (concordance.entries || []).length
                    ? concordance.entries.map((entry, i) =>
                        h(
                          'button',
                          {
                            key: `${entry.tmId || entry.library || 'c'}-${i}`,
                            className: 'cait-concordance-row',
                            onClick: () => onApplyConcordance(entry),
                          },
                          h('span', { className: 'cait-concordance-source' }, entry.source),
                          h('span', { className: 'cait-concordance-target' }, entry.target),
                          h('span', { className: 'cait-concordance-meta' }, entry.library || ''),
                        ),
                      )
                    : h('p', { className: 'cait-empty-note' }, t('panel.noConcordance')),
                )
              : null,
          )
        : null,
    ),
  )
}

export { CatPanel }
