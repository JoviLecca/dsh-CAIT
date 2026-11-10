import { h, useState, useEffect, useRef } from '../react.js'
import {
  PAGE_SIZE_OPTIONS,
  readPageSize,
  writePageSize,
  pageBounds,
  segmentNumberToIndex,
} from '../helpers.js'
import { Icon } from './base.js'

const SEGMENT_FILTERS = ['all', 'pending', 'translated', 'confirmed', 'risk']

function SegmentRail({
  t,
  doc,
  selected,
  query,
  setQuery,
  filter,
  setFilter,
  onSelect,
  onConfirmAll,
  onPropagate,
  onClearPretranslated,
  busy,
  qa,
}) {
  const activeRef = useRef(null)
  const storage = typeof localStorage !== 'undefined' ? localStorage : null
  const [pageSize, setPageSize] = useState(() => readPageSize(storage))
  const [page, setPage] = useState(1)
  const [gotoText, setGotoText] = useState('')
  const [gotoBad, setGotoBad] = useState(false)
  const lastSelected = useRef(selected)
  useEffect(() => {
    if (activeRef.current) activeRef.current.scrollIntoView({ block: 'nearest' })
  }, [selected, filter])

  // Advisory QA marks: the check never blocks editing or exporting, it only
  // flags the segment in the rail so review can start where it matters.
  const warns = new Map()
  for (const issue of qa?.issues || []) {
    const list = warns.get(issue.index) || []
    list.push(issue.code)
    warns.set(issue.index, list)
  }
  const riskByIndex = new Map()
  for (const item of qa?.risks || []) riskByIndex.set(item.index, item)

  const counts = {
    all: doc.progress.total,
    pending: doc.progress.pending,
    translated: doc.progress.translated,
    confirmed: doc.progress.confirmed,
    risk: riskByIndex.size,
  }

  // How many empty segments could be filled from a sibling with the same
  // source. Shown on the rail so propagation is a visible, one-click choice
  // rather than something happening behind the user's back.
  const duplicateGroups = new Map()
  for (const segment of doc.segments) {
    const key = String(segment.source || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (!key) continue
    const list = duplicateGroups.get(key) || []
    list.push(segment)
    duplicateGroups.set(key, list)
  }
  let duplicated = 0
  for (const list of duplicateGroups.values()) {
    if (list.length < 2 || !list.some((segment) => segment.target)) continue
    duplicated += list.filter((segment) => !segment.target).length
  }
  const pretranslated = doc.segments.filter(
    (segment) =>
      segment.target && !segment.confirmedAt && ['tm', 'mt', 'auto'].includes(segment.origin),
  ).length
  const needle = query.trim().toLowerCase()
  const filtered = doc.segments
    .map((segment, index) => ({ segment, index }))
    .filter(
      ({ segment, index }) =>
        filter === 'all' ||
        (filter === 'risk' ? riskByIndex.has(index) : segment.status === filter),
    )
    .filter(({ segment }) => {
      if (!needle) return true
      return (
        segment.source.toLowerCase().includes(needle) ||
        (segment.target || '').toLowerCase().includes(needle) ||
        (segment.suggestion || '').toLowerCase().includes(needle)
      )
    })

  // A rail window is a view over the filtered list: the page is clamped to
  // the result count instead of being reset, so narrowing a filter keeps the
  // reader near where they were.
  const bounds = pageBounds(page, filtered.length, pageSize)
  const firstRow = bounds.start === 0 ? 0 : bounds.start - 1
  const visible = filtered.slice(firstRow, bounds.end)

  useEffect(() => {
    if (bounds.page !== page) setPage(bounds.page)
  }, [bounds.page, page])

  // Selection can move from outside the rail (next-unconfirmed, batch
  // confirm), so follow it onto the page that holds it.
  useEffect(() => {
    if (lastSelected.current === selected) return
    lastSelected.current = selected
    const position = filtered.findIndex((item) => item.index === selected)
    if (position < 0) return
    const target = Math.floor(position / pageSize) + 1
    if (target !== bounds.page) setPage(target)
  }, [selected])

  const changePageSize = (value) => {
    const size = writePageSize(storage, value)
    setPageSize(size)
    setPage(1)
  }

  const submitGoto = () => {
    const index = segmentNumberToIndex(gotoText, doc.progress.total)
    if (index === null) {
      setGotoBad(true)
      return
    }
    setGotoBad(false)
    setGotoText('')
    // A number is useless while a filter or a search hides it, so jumping is
    // an explicit "show me this segment" and clears both.
    if (needle || filter !== 'all') {
      setQuery('')
      setFilter('all')
    }
    lastSelected.current = index
    setPage(Math.floor(index / pageSize) + 1)
    onSelect(index)
  }

  return h(
    'aside',
    { className: 'cait-rail' },
    h(
      'div',
      { className: 'cait-rail-head' },
      h(
        'div',
        { className: 'cait-rail-title' },
        h('span', null, t('rail.title')),
        h(
          'span',
          { className: 'cait-count', title: `${filtered.length} / ${doc.progress.total}` },
          needle || filter !== 'all'
            ? `${filtered.length}/${doc.progress.total}`
            : doc.progress.total,
        ),
      ),
      h(
        'div',
        { className: 'cait-mini-progress' },
        h('i', { style: { width: `${doc.progress.percent}%` } }),
      ),
      h(
        'div',
        { className: 'cait-rail-filters' },
        SEGMENT_FILTERS.map((key) =>
          h(
            'button',
            {
              key,
              className: `cait-filterchip${filter === key ? ' active' : ''}`,
              onClick: () => setFilter(key),
              title: t(`rail.filter.${key}`),
            },
            h('span', null, t(`rail.filter.${key}`)),
            h('span', { className: `cait-filtercount ${key}` }, counts[key]),
          ),
        ),
      ),
      doc.progress.translated > 0
        ? h(
            'button',
            {
              className: 'cait-batchbtn',
              onClick: onConfirmAll,
              disabled: Boolean(busy),
              title: t('rail.confirmAllHint'),
            },
            h(Icon, { name: 'check', size: 11 }),
            `${t('rail.confirmAll')} · ${doc.progress.translated}`,
          )
        : null,
      duplicated > 0
        ? h(
            'button',
            {
              className: 'cait-batchbtn cait-batchbtn-plain',
              onClick: onPropagate,
              disabled: Boolean(busy),
              title: t('rail.propagateMessage'),
            },
            h(Icon, { name: 'copy', size: 11 }),
            `${t('rail.propagate')} · ${duplicated}`,
          )
        : null,
      pretranslated > 0
        ? h(
            'button',
            {
              className: 'cait-batchbtn cait-batchbtn-danger',
              onClick: onClearPretranslated,
              disabled: Boolean(busy),
              title: t('rail.clearPretranslatedHint'),
            },
            h(Icon, { name: 'trash', size: 11 }),
            `${t('rail.clearPretranslated')} · ${pretranslated}`,
          )
        : null,
      h(
        'div',
        { className: 'cait-rail-goto' },
        h('input', {
          className: `cait-goto-input${gotoBad ? ' bad' : ''}`,
          value: gotoText,
          onChange: (event) => {
            setGotoText(event.target.value)
            setGotoBad(false)
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') submitGoto()
          },
          placeholder: t('rail.goto'),
          'aria-label': t('rail.goto'),
          title: gotoBad ? t('rail.gotoInvalid') : t('rail.goto'),
          inputMode: 'numeric',
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-gotobtn',
            onClick: submitGoto,
            disabled: Boolean(busy),
            title: t('rail.goto'),
            'aria-label': t('rail.goto'),
          },
          h(Icon, { name: 'arrowRight', size: 12 }),
        ),
      ),
    ),
    h(
      'div',
      { className: 'cait-rail-search' },
      h(Icon, { name: 'search', size: 13 }),
      h('input', {
        value: query,
        onChange: (event) => setQuery(event.target.value),
        placeholder: t('rail.search'),
        'aria-label': t('rail.search'),
      }),
    ),
    h(
      'div',
      { className: 'cait-rail-list' },
      visible.length
        ? visible.map(({ segment, index }) =>
            h(
              'button',
              {
                key: segment.id,
                ref: index === selected ? activeRef : null,
                className: `cait-segitem${index === selected ? ' active' : ''}`,
                onClick: () => onSelect(index),
                title: segment.source,
              },
              h(
                'span',
                { className: 'cait-seg-main' },
                h(
                  'span',
                  { className: 'cait-seg-line' },
                  h('span', { className: 'cait-seg-index' }, String(index + 1).padStart(2, '0')),
                  h('span', { className: `cait-dot ${segment.status}` }),
                  warns.has(index)
                    ? h('span', {
                        className: `cait-seg-warn ${riskByIndex.get(index)?.risk || 'low'}`,
                        title: (warns.get(index) || [])
                          .map((code) => t(`qa.code.${code}`))
                          .join(' · '),
                        'aria-label': t('qa.warn'),
                      })
                    : null,
                ),
                h('span', { className: 'cait-seg-text' }, segment.source),
                segment.target ? h('span', { className: 'cait-seg-target' }, segment.target) : null,
              ),
            ),
          )
        : h('div', { className: 'cait-empty-note' }, t('rail.empty')),
    ),
    h(
      'div',
      { className: 'cait-rail-page' },
      h(
        'button',
        {
          type: 'button',
          className: 'cait-pagebtn',
          onClick: () => setPage(bounds.page - 1),
          disabled: bounds.page <= 1,
          title: t('library.prev'),
          'aria-label': t('library.prev'),
        },
        h(Icon, { name: 'chevronLeft', size: 12 }),
      ),
      h(
        'span',
        { className: 'cait-pageinfo' },
        t('rail.pageInfo', { start: bounds.start, end: bounds.end, total: bounds.total }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-pagebtn',
          onClick: () => setPage(bounds.page + 1),
          disabled: bounds.page >= bounds.pages,
          title: t('library.next'),
          'aria-label': t('library.next'),
        },
        h(Icon, { name: 'chevronRight', size: 12 }),
      ),
      h(
        'select',
        {
          className: 'cait-pagesize',
          value: String(pageSize),
          onChange: (event) => changePageSize(Number(event.target.value)),
          title: t('library.pageSize'),
          'aria-label': t('library.pageSize'),
        },
        PAGE_SIZE_OPTIONS.map((size) =>
          h('option', { key: size, value: String(size) }, String(size)),
        ),
      ),
    ),
  )
}

export { SEGMENT_FILTERS, SegmentRail }
