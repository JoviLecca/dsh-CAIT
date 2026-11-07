    function Spinner() {
      return h('span', { className: 'cait-spinner', 'aria-hidden': true })
    }

    // SVG width/height attributes are fixed pixels; route them through the same
    // unit as the CSS so icons grow with the panel.
    function scaledLength(value) {
      return `calc(${value}px * var(${CAIT_UNIT_VAR}, 1))`
    }

    function Icon({ name, size = 16 }) {
      const paths = {
        plus: ['M8 3v10', 'M3 8h10'],
        upload: ['M8 11V2', 'M5 5l3-3 3 3', 'M2 12v1.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V12'],
        download: ['M8 2v9', 'M5 8l3 3 3-3', 'M2 12v1.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V12'],
        settings: ['M2 4h12', 'M2 8h12', 'M2 12h12', 'M5 2.5v3', 'M11 6.5v3', 'M7 10.5v3'],
        check: ['M3 8.6l3.1 3.1L13 4.8'],
        chevronRight: ['M6 3l5 5-5 5'],
        chevronLeft: ['M10 3L5 8l5 5'],
        chevronDown: ['M3 6l5 5 5-5'],
        search: ['M7.2 12.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4Z', 'M10.9 10.9L14 14'],
        sparkles: ['M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3L8 2Z', 'M13 12l.6 1.4L15 14l-1.4.6L13 16l-.6-1.4L11 14l1.4-.6L13 12Z'],
        book: ['M2 3.5A1.5 1.5 0 0 1 3.5 2H7v12H3.5A1.5 1.5 0 0 1 2 12.5v-9Z', 'M14 3.5A1.5 1.5 0 0 0 12.5 2H9v12h3.5a1.5 1.5 0 0 0 1.5-1.5v-9Z'],
        database: ['M8 2c3.3 0 5.5.9 5.5 2s-2.2 2-5.5 2-5.5-.9-5.5-2S4.7 2 8 2Z', 'M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4', 'M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2'],
        close: ['M3 3l10 10', 'M13 3L3 13'],
        trash: ['M3 4h10', 'M6 4V2.5h4V4', 'M5 4l.6 9.5h4.8L11 4'],
        copy: ['M5.5 5.5h7v8h-7z', 'M3.5 3.5h7v2'],
        file: ['M4 1.5h5L13 5v9.5H4z', 'M9 1.5V5h4'],
        refresh: ['M13 8a5 5 0 1 1-1.5-3.6', 'M13 2v3h-3'],
        arrowRight: ['M2 8h11', 'M9 4l4 4-4 4'],
        play: ['M4 2l9 6-9 6z'],
        globe: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z', 'M2.5 8h11', 'M8 2c2 2 2 10 0 12', 'M8 2c-2 2-2 10 0 12'],
        alert: ['M8 2L14 13H2L8 2Z', 'M8 6v3.5', 'M8 11.5v.2'],
        save: ['M3 2h8l2 2v10H3z', 'M5 2v4h6V2', 'M5 14v-4h6v4'],
        pencil: ['M11 2.5l2.5 2.5-8 8L2 14l1-3.5 8-8Z', 'M9.5 4l2.5 2.5'],
        languages: ['M2 4h7', 'M5.5 4v2c0 2-1.5 4-3.5 5', 'M4 8c0 1.5 2 3 4.5 3.5', 'M9 13l3-7 3 7', 'M10 11h4'],
      }
      const shape = paths[name] || paths.file
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          style: { width: scaledLength(size), height: scaledLength(size), flex: '0 0 auto' },
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        shape.map((d, index) => h('path', { key: index, d, ...(name === 'play' ? { fill: 'currentColor', stroke: 'none' } : {}) })),
      )
    }

    function CaitMark({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 32 32',
          fill: 'none',
          style: { width: scaledLength(size), height: scaledLength(size), flex: '0 0 auto' },
          'aria-hidden': true,
          focusable: false,
        },
        h('path', { d: 'M6.3 5.8H15.2C17 5.8 18.4 7.2 18.4 9V14.8C18.4 16.6 17 18 15.2 18H9.3L5.9 21.6V18H6.3C4.5 18 3.1 16.6 3.1 14.8V9C3.1 7.2 4.5 5.8 6.3 5.8Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M5.4 16.4 9.2 8.5 13 16.4M6.8 13.4h4.8', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M17.4 14.2H27.4C29 14.2 30.2 15.4 30.2 17V22.2C30.2 23.8 29 25 27.4 25H27.2L27 28.8 23.2 25H17.4C15.8 25 14.6 23.8 14.6 22.2V17C14.6 15.4 15.8 14.2 17.4 14.2Z', fill: 'var(--dsw-alias-bg-base, #ffffff)', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { cx: 23, cy: 17.2, r: 1.4, fill: 'currentColor' }),
        h('path', { d: 'M18.6 20.6H27.4M23 20.6l-4.2 4.2M23 20.6l4.2 4.2', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function CaitSidebarIcon({ size = 18, active }) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
          },
          'aria-hidden': true,
        },
        h(CaitMark, { size }),
      )
    }

    function highlightSource(text, hits) {
      const terms = [...new Set((hits || []).map((hit) => hit.term).filter(Boolean))]
        .sort((a, b) => b.length - a.length)
      if (!terms.length) return text
      const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
      return String(text).split(pattern).map((part, index) => {
        const hit = (hits || []).find((item) => item.term.toLowerCase() === String(part).toLowerCase())
        if (!hit) return part
        return h('mark', { key: `m${index}`, title: `${hit.term} → ${hit.target}` }, part)
      })
    }

    function Modal({ title, children, onClose, wide }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      return h(
        'div',
        {
          className: 'cait-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: `cait-modal${wide ? ' cait-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h(
            'div',
            { className: 'cait-modal-head' },
            h('h3', null, title),
            h('button', { className: 'cait-iconbtn', onClick: onClose, 'aria-label': 'Close' }, h(Icon, { name: 'close', size: 14 })),
          ),
          h('div', { className: 'cait-modal-body' }, children),
        ),
      )
    }

    function Toast({ toast }) {
      const icon = toast.kind === 'error' ? 'alert' : toast.kind === 'info' ? 'sparkles' : 'check'
      return h('div', { className: `cait-toast cait-toast-${toast.kind || 'success'}`, role: 'status' }, h(Icon, { name: icon, size: 14 }), h('span', null, toast.message))
    }

    function SaveBanner({ t, storage, stale, onRefresh }) {
      const error = storage?.error ? String(storage.error) : ''
      if (!error && !stale) return null
      const message = error
        ? `${t('storage.saveFailed')}${error}${stale ? ` ${t('storage.stale')}` : ''}`
        : t('storage.stale')
      return h(
        'div',
        { className: `cait-savebanner${error ? ' is-error' : ''}`, role: 'alert' },
        h('span', { className: 'cait-savebanner-icon' }, h(Icon, { name: error ? 'alert' : 'refresh', size: 14 })),
        h('span', { className: 'cait-savebanner-text' }, message),
        h('button', { className: 'cait-btn cait-btn-ghost', onClick: onRefresh }, t('common.refresh')),
      )
    }

    function DocTabs({ t, documents, activeId, busy, onOpen, onClose, onNew }) {
      return h(
        'div',
        { className: 'cait-doctabs', role: 'tablist', 'aria-label': t('tabs.title') },
        documents.map((doc) =>
          h(
            'div',
            { key: doc.id, className: `cait-doctab${doc.id === activeId ? ' active' : ''}` },
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                className: 'cait-doctab-main',
                'aria-selected': doc.id === activeId,
                title: `${doc.name} · ${doc.progress.percent}%`,
                onClick: () => onOpen(doc.id),
              },
              h('span', { className: 'cait-doctab-name' }, doc.name),
              h('span', { className: 'cait-doctab-progress' }, `${doc.progress.percent}%`),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'cait-doctab-close',
                title: t('tabs.close'),
                'aria-label': t('tabs.close'),
                disabled: Boolean(busy),
                onClick: (event) => {
                  event.stopPropagation()
                  onClose(doc.id)
                },
              },
              h(Icon, { name: 'close', size: 11 }),
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-doctab-new',
            title: t('tabs.new'),
            'aria-label': t('tabs.new'),
            disabled: Boolean(busy),
            onClick: onNew,
          },
          h(Icon, { name: 'plus', size: 13 }),
          h('span', null, t('tabs.new')),
        ),
      )
    }

    function ClosedDocPicker({ t, documents, busy, onOpen }) {
      if (!documents?.length) return null
      return h(
        'label',
        { className: 'cait-doc-select-wrap cait-closed-docs' },
        h('span', { className: 'cait-muted cait-tiny' }, t('doc.openExisting')),
        h(
          'select',
          {
            className: 'cait-select cait-doc-select',
            value: '',
            disabled: Boolean(busy),
            onChange: (event) => {
              if (event.target.value) onOpen(event.target.value)
            },
          },
          h('option', { value: '' }, t('doc.openExisting')),
          documents.map((doc) =>
            h('option', { key: doc.id, value: doc.id }, `${doc.name} · ${doc.progress.percent}%`),
          ),
        ),
      )
    }

    function RecentDocsModal({ t, documents, busy, onClose, onDelete, onClear }) {
      return h(
        Modal,
        { title: t('doc.cleanTitle'), onClose },
        h('p', { className: 'cait-modal-hint' }, t('doc.cleanHint')),
        documents.length
          ? h(
              'div',
              { className: 'cait-recent-list' },
              documents.map((doc) =>
                h(
                  'div',
                  { key: doc.id, className: 'cait-recent-row' },
                  h(
                    'div',
                    { className: 'cait-recent-meta' },
                    h('strong', null, doc.name),
                    h('small', null, `${doc.sourceLang} → ${doc.targetLang} · ${doc.progress.confirmed}/${doc.progress.total}`),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-iconbtn cait-recent-del',
                      title: t('doc.delete'),
                      'aria-label': t('doc.delete'),
                      disabled: Boolean(busy),
                      onClick: () => onDelete(doc),
                    },
                    h(Icon, { name: 'trash', size: 12 }),
                  ),
                ),
              ),
            )
          : h('p', { className: 'cait-muted cait-tiny' }, t('doc.cleanEmpty')),
        h(
          'div',
          { className: 'cait-modal-actions' },
          h('button', { className: 'cait-btn cait-btn-ghost', onClick: onClose, disabled: Boolean(busy) }, t('modal.confirm.cancel')),
          h(
            'button',
            { className: 'cait-btn cait-btn-danger', onClick: onClear, disabled: Boolean(busy) || !documents.length },
            busy ? h(Spinner) : null,
            t('doc.cleanAll'),
          ),
        ),
      )
    }

    function Topbar({
      t,
      doc,
      data,
      busy,
      onNew,
      onImport,
      onExport,
      onSettings,
      onOpenDoc,
      onCloseDoc,
      onNewTab,
      onCleanClosed,
      pre,
      onPreTranslate,
      onCancelPreTranslate,
    }) {
      const progress = doc?.progress || { percent: 0, confirmed: 0, total: 0 }
      const openIds = new Set((data.openDocuments || []).map((item) => item.id))
      const closedDocuments = (data.documents || []).filter((item) => !openIds.has(item.id))
      return h(
        'header',
        { className: 'cait-topbar' },
        h(
          'div',
          { className: 'cait-brand' },
          h('span', { className: 'cait-logo' }, h(CaitMark, { size: 17 })),
          h('span', { className: 'cait-brand-text' }, h('strong', null, 'CAIT'), h('span', null, t('app.subtitle'))),
        ),
        h(
          'div',
          { className: 'cait-docbar' },
          h(DocTabs, {
            t,
            documents: data.openDocuments || data.documents || [],
            activeId: doc?.id,
            busy,
            onOpen: onOpenDoc,
            onClose: onCloseDoc,
            onNew: onNewTab,
          }),
          h(ClosedDocPicker, { t, documents: closedDocuments, busy, onOpen: onOpenDoc }),
          closedDocuments.length
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'cait-doc-clean',
                  title: t('doc.clean'),
                  'aria-label': t('doc.clean'),
                  disabled: Boolean(busy),
                  onClick: onCleanClosed,
                },
                h(Icon, { name: 'trash', size: 13 }),
              )
            : null,
          doc
            ? h('span', { className: 'cait-doc-progress' }, `${progress.confirmed}/${progress.total} · ${progress.percent}%`)
            : null,
        ),
        h(
          'div',
          { className: 'cait-actions' },
          pre && pre.running
            ? h(
                'span',
                { className: 'cait-pre-status', title: t('pretranslate.running') },
                h(Spinner),
                h('span', null, `${t('pretranslate.running')} ${pre.done}/${pre.total}`),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cait-iconbtn',
                    title: t('pretranslate.cancel'),
                    'aria-label': t('pretranslate.cancel'),
                    onClick: onCancelPreTranslate,
                  },
                  h(Icon, { name: 'close', size: 13 }),
                ),
              )
            : h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: onPreTranslate,
                  disabled: Boolean(busy) || !doc || !(doc.progress?.total > 0),
                  title: t('pretranslate.title'),
                },
                h(Icon, { name: 'sparkles', size: 14 }),
                h('span', { className: 'cait-btn-label' }, t('pretranslate.start')),
              ),
          h(
            'button',
            { className: 'cait-btn', onClick: onNew, disabled: Boolean(busy), title: t('nav.new') },
            h(Icon, { name: 'plus', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('nav.new')),
          ),
          h(
            'button',
            { className: 'cait-btn', onClick: onImport, disabled: Boolean(busy), title: t('nav.import') },
            h(Icon, { name: 'upload', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('nav.import')),
          ),
          h(
            'button',
            { className: 'cait-btn', onClick: onExport, disabled: Boolean(busy) || !doc, title: t('nav.export') },
            h(Icon, { name: 'download', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('nav.export')),
          ),
          h('button', { className: 'cait-iconbtn', onClick: onSettings, disabled: Boolean(busy), title: t('nav.settings') }, h(Icon, { name: 'settings', size: 15 })),
        ),
      )
    }

    const SEGMENT_FILTERS = ['all', 'pending', 'translated', 'confirmed']

    function SegmentRail({ t, doc, selected, query, setQuery, filter, setFilter, onSelect, onConfirmAll, busy, qa }) {
      const activeRef = useRef(null)
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

      const counts = {
        all: doc.progress.total,
        pending: doc.progress.pending,
        translated: doc.progress.translated,
        confirmed: doc.progress.confirmed,
      }
      const needle = query.trim().toLowerCase()
      const items = doc.segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => filter === 'all' || segment.status === filter)
        .filter(({ segment }) => {
          if (!needle) return true
          return (
            segment.source.toLowerCase().includes(needle) ||
            (segment.target || '').toLowerCase().includes(needle) ||
            (segment.suggestion || '').toLowerCase().includes(needle)
          )
        })

      return h(
        'aside',
        { className: 'cait-rail' },
        h(
          'div',
          { className: 'cait-rail-head' },
          h('div', { className: 'cait-rail-title' }, h('span', null, t('rail.title')), h('span', { className: 'cait-count' }, doc.progress.total)),
          h('div', { className: 'cait-mini-progress' }, h('i', { style: { width: `${doc.progress.percent}%` } })),
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
        ),
        h(
          'div',
          { className: 'cait-rail-search' },
          h(Icon, { name: 'search', size: 13 }),
          h('input', { value: query, onChange: (event) => setQuery(event.target.value), placeholder: t('rail.search'), 'aria-label': t('rail.search') }),
        ),
        h(
          'div',
          { className: 'cait-rail-list' },
          items.length
            ? items.map(({ segment, index }) =>
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
                            className: 'cait-seg-warn',
                            title: (warns.get(index) || []).map((code) => t(`qa.code.${code}`)).join(' · '),
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
      )
    }

    function EditorPane({ t, doc, index, segment, detail, draft, setDraft, dirty, busy, onConfirm, onNext, onPrev, onSave, onAdopt, onApplyTerm, textareaRef }) {
      const hits = detail?.index === index ? detail.glossaryHits : []
      const charCount = Array.from(draft || '').length
      const progress = doc.progress
      const remaining = progress.total - progress.confirmed
      const statusLabel =
        segment.status === 'confirmed'
          ? t('status.confirmed')
          : segment.status === 'translated'
            ? t('status.translated')
            : t('status.pending')

      // The middle column keeps the machine/agent baseline that produced the
      // current text, so editing in the right column has something to compare
      // against. It is stored in `suggestion`, which adoption already preserves.
      const baselineText = segment.suggestion || ''
      const baselineOrigin = segment.origin || 'agent'

      const onKeyDown = (event) => {        const mod = event.metaKey || event.ctrlKey
        if (mod && event.key === 'Enter') {
          event.preventDefault()
          onConfirm()
        } else if (mod && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSave()
        } else if (event.altKey && event.key === 'ArrowDown') {
          event.preventDefault()
          onNext()
        } else if (event.altKey && event.key === 'ArrowUp') {
          event.preventDefault()
          onPrev()
        }
      }

      return h(
        'div',
        { className: 'cait-editor-col' },
        h(
          'div',
          { className: 'cait-doc-head' },
          h(
            'div',
            null,
            h('h2', { className: 'cait-doc-title' }, doc.name),
            h(
              'div',
              { className: 'cait-doc-meta' },
              h('span', { className: 'cait-langchip' }, doc.sourceLang),
              h(Icon, { name: 'arrowRight', size: 11 }),
              h('span', { className: 'cait-langchip' }, doc.targetLang),
              h('span', null, `· ${doc.segments.length} ${t('doc.segments')}`),
            ),
          ),
          h(
            'div',
            { className: 'cait-progress-box' },
            h('span', { className: 'cait-pct' }, `${progress.percent}%`),
            h('div', { className: 'cait-progress' }, h('i', { style: { width: `${progress.percent}%` } })),
            h('span', { className: 'cait-meta' }, `${progress.confirmed}/${progress.total} ${t('progress.confirmed')}`),
          ),
        ),
        h(
          'div',
          { className: 'cait-seg-head' },
          h('span', { className: 'cait-seg-label' }, `${t('editor.segment')} ${index + 1} / ${doc.segments.length}`),
          h('span', { className: `cait-badge ${segment.status}` }, statusLabel),
        ),
        h(
          'div',
          { className: 'cait-review' },
          h(
            'section',
            { className: 'cait-revcol cait-rev-src' },
            h(
              'div',
              { className: 'cait-labelrow' },
              h('span', { className: 'cait-label' }, t('editor.source')),
              h('span', { className: 'cait-langchip' }, doc.sourceLang),
            ),
            h('div', { className: 'cait-source-text' }, highlightSource(segment.source, hits)),
            hits.length
              ? h(
                  'div',
                  { className: 'cait-hitrow' },
                  hits.map((hit) =>
                    h(
                      'button',
                      {
                        key: hit.id,
                        className: 'cait-chip cait-chip-action',
                        onClick: () => onApplyTerm(hit),
                        title: hit.note || `${hit.term} → ${hit.target}`,
                      },
                      h(Icon, { name: 'book', size: 11 }),
                      `${hit.term} → ${hit.target}`,
                    ),
                  ),
                )
              : null,
          ),
          h(
            'section',
            { className: 'cait-revcol cait-rev-sugg' },
            h(
              'div',
              { className: 'cait-labelrow' },
              h('span', { className: 'cait-label' }, t('editor.suggestion')),
              baselineText
                ? h('span', { className: `cait-originchip ${baselineOrigin}` }, t(`origin.${baselineOrigin}`))
                : null,
              segment.suggestion
                ? h(
                    'button',
                    {
                      className: 'cait-chip cait-chip-action',
                      onClick: onAdopt,
                      disabled: Boolean(busy) || draft.trim() === segment.suggestion,
                      title: t('editor.adoptHint'),
                    },
                    h(Icon, { name: 'download', size: 11 }),
                    t('editor.adopt'),
                  )
                : null,
            ),
            baselineText
              ? h('div', { className: 'cait-suggest-text' }, baselineText)
              : h('div', { className: 'cait-suggest-empty' }, t('editor.noSuggestion')),
            h('div', { className: 'cait-rev-hint' }, segment.suggestion ? t('editor.adoptHint') : t('editor.baselineHint')),
          ),
          h(
            'section',
            { className: 'cait-revcol cait-rev-target' },
            h(
              'div',
              { className: 'cait-labelrow' },
              h('span', { className: 'cait-label' }, t('editor.target')),
              h(
                'span',
                { className: 'cait-meta' },
                `${charCount} ${t('editor.chars')}${dirty ? ` · ${t('editor.unsaved')}` : ''}`,
              ),
            ),
            h('textarea', {
              ref: textareaRef,
              className: 'cait-textarea',
              value: draft,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown,
              placeholder: t('editor.targetPlaceholder'),
              spellCheck: false,
              rows: 8,
            }),
          ),
        ),
        h(
          'div',
          { className: 'cait-actionbar' },
          h(
            'button',
            { className: 'cait-btn cait-btn-primary', onClick: onConfirm, disabled: Boolean(busy) || !draft.trim() },
            busy === 'confirm' ? h(Spinner) : h(Icon, { name: 'check', size: 14 }),
            segment.status === 'confirmed' ? t('editor.update') : t('editor.confirm'),
          ),
          h(
            'button',
            { className: 'cait-btn', onClick: onNext, disabled: Boolean(busy) },
            t('editor.next'),
            h(Icon, { name: 'chevronRight', size: 13 }),
          ),
          h(
            'button',
            { className: 'cait-btn cait-btn-ghost', onClick: onPrev, disabled: Boolean(busy) },
            h(Icon, { name: 'chevronLeft', size: 13 }),
            t('editor.prev'),
          ),
          h(
            'button',
            { className: 'cait-iconbtn cait-savebtn', onClick: onSave, disabled: Boolean(busy) || !dirty, title: t('editor.save') },
            h(Icon, { name: 'save', size: 14 }),
          ),
          h('span', { className: 'cait-hint' }, t('editor.hint')),
        ),
        h(
          'div',
          { className: 'cait-editor-foot' },
          remaining === 0
            ? h('span', { className: 'cait-donechip' }, h(Icon, { name: 'check', size: 11 }), t('editor.done'))
            : h('span', null, `${remaining} ${t('editor.remaining')}`),
          segment.confirmedAt ? h('span', null, `${t('editor.confirmedAt')} ${new Date(segment.confirmedAt).toLocaleString()}`) : null,
        ),
      )
    }

    function TmMatchCard({ t, match, onApply, onEdit, onDelete, busy }) {
      const matchType = match.matchType || (match.exact ? 'exact' : 'low_fuzzy')
      const [editing, setEditing] = useState(false)
      const [value, setValue] = useState(match.target)

      useEffect(() => {
        setEditing(false)
        setValue(match.target)
      }, [match.id, match.target])

      const save = async () => {
        if (!value.trim()) return
        const ok = await onEdit({ id: match.id, target: value })
        if (ok) setEditing(false)
      }

      return h(
        'article',
        { className: 'cait-card' },
        h(
          'div',
          { className: 'cait-card-head' },
          h('span', { className: `cait-score ${matchType}` }, `${match.percent}%`),
          h('span', { className: 'cait-score-label' }, t(`match.${matchType}`)),
          h(
            'div',
            { className: 'cait-term-actions' },
            h('button', { className: 'cait-minibtn', onClick: () => onApply(match) }, t('panel.apply')),
            h(
              'button',
              { className: 'cait-minibtn', onClick: () => setEditing((current) => !current), disabled: Boolean(busy), title: t('panel.edit') },
              h(Icon, { name: 'pencil', size: 11 }),
            ),
            h(
              'button',
              { className: 'cait-deletebtn', onClick: () => onDelete(match), disabled: Boolean(busy), title: t('panel.delete') },
              h(Icon, { name: 'trash', size: 11 }),
            ),
          ),
        ),
        h('p', { className: 'cait-card-source' }, match.source),
        editing
          ? h(
              'div',
              { className: 'cait-tmedit' },
              h('textarea', {
                className: 'cait-textarea cait-tmedit-input',
                value,
                rows: 3,
                autoFocus: true,
                onChange: (event) => setValue(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    save()
                  }
                  if (event.key === 'Escape') setEditing(false)
                },
              }),
              h(
                'div',
                { className: 'cait-formrow' },
                h('button', { className: 'cait-btn cait-btn-primary', onClick: save, disabled: Boolean(busy) || !value.trim() }, t('panel.saveEntry')),
                h('button', { className: 'cait-btn cait-btn-ghost', onClick: () => setEditing(false) }, t('panel.cancel')),
              ),
            )
          : h('p', { className: 'cait-card-target' }, match.target),
      )
    }

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
      onAddTerm,
      onDeleteTerm,
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
      onOpenLibraries,
      busy,
    }) {
      const [termQuery, setTermQuery] = useState('')
      const [showTermForm, setShowTermForm] = useState(false)
      const [termForm, setTermForm] = useState({ source: '', target: '', note: '' })
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
      const needle = termQuery.trim().toLowerCase()
      const terms = (data.glossary || [])
        .filter((term) => !needle || term.source.toLowerCase().includes(needle) || term.target.toLowerCase().includes(needle))
        .slice(0, 200)

      const submitTerm = async (event) => {
        event.preventDefault()
        if (!termForm.source.trim() || !termForm.target.trim()) return
        const ok = await onAddTerm(termForm)
        if (ok) {
          setTermForm({ source: '', target: '', note: '' })
          setShowTermForm(false)
        }
      }

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
                onClick: onOpenLibraries,
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
            { className: `cait-tab${tab === 'glossary' ? ' active' : ''}`, onClick: () => setTab('glossary') },
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
                  h('button', { className: 'cait-iconbtn', type: 'submit', title: t('panel.search') }, h(Icon, { name: 'arrowRight', size: 13 })),
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
                  : h('p', { className: 'cait-empty-note' }, tmResults ? t('panel.noMatches') : t('panel.noCurrentMatches')),
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
                  h('button', { className: 'cait-btn', onClick: () => tmxInput.current?.click(), disabled: Boolean(busy) }, h(Icon, { name: 'upload', size: 12 }), t('panel.importTmx')),
                  h('button', { className: 'cait-btn cait-btn-danger', onClick: onClearTm, disabled: Boolean(busy) || data.tm.count === 0 }, t('panel.clearTm')),
                ),
              )
            : null,
          tab === 'glossary'
            ? h(
                'div',
                null,
                h('div', { className: 'cait-subhead' }, h('span', null, t('panel.termHits')), h('span', { className: 'cait-count' }, hits.length)),
                hits.length
                  ? h(
                      'div',
                      { className: 'cait-hitrow', style: { marginTop: 0, marginBottom: 10 } },
                      hits.map((hit) =>
                        h(
                          'button',
                          { key: hit.id, className: 'cait-chip cait-chip-action', onClick: () => onApplyTerm(hit), title: hit.note || hit.target },
                          `${hit.term} → ${hit.target}`,
                        ),
                      ),
                    )
                  : h('p', { className: 'cait-empty-note' }, t('panel.noHits')),
                h(
                  'div',
                  { className: 'cait-subhead' },
                  h('span', null, t('panel.allTerms')),
                  h('button', { className: 'cait-linkbtn', onClick: () => setShowTermForm((value) => !value) }, `+ ${t('panel.addTerm')}`),
                ),
                showTermForm
                  ? h(
                      'form',
                      { className: 'cait-termform', onSubmit: submitTerm },
                      h('input', {
                        className: 'cait-input',
                        value: termForm.source,
                        onChange: (event) => setTermForm({ ...termForm, source: event.target.value }),
                        placeholder: t('panel.termSource'),
                        autoFocus: true,
                      }),
                      h(
                        'div',
                        { className: 'cait-formrow' },
                        h('input', {
                          className: 'cait-input',
                          value: termForm.target,
                          onChange: (event) => setTermForm({ ...termForm, target: event.target.value }),
                          placeholder: t('panel.termTarget'),
                        }),
                        h('input', {
                          className: 'cait-input',
                          value: termForm.note,
                          onChange: (event) => setTermForm({ ...termForm, note: event.target.value }),
                          placeholder: t('panel.termNote'),
                        }),
                      ),
                      h(
                        'div',
                        { className: 'cait-formrow' },
                        h('button', { className: 'cait-btn cait-btn-primary', type: 'submit', disabled: Boolean(busy) || !termForm.source.trim() || !termForm.target.trim() }, t('panel.saveTerm')),
                        h('button', { className: 'cait-btn cait-btn-ghost', type: 'button', onClick: () => setShowTermForm(false) }, t('panel.cancel')),
                      ),
                    )
                  : null,
                h(
                  'div',
                  { className: 'cait-search' },
                  h(Icon, { name: 'search', size: 13 }),
                  h('input', { value: termQuery, onChange: (event) => setTermQuery(event.target.value), placeholder: t('panel.termSearch'), 'aria-label': t('panel.termSearch') }),
                ),
                terms.length
                  ? terms.map((term) =>
                      h(
                        'div',
                        { key: term.id, className: 'cait-term' },
                        h(
                          'div',
                          { className: 'cait-term-main' },
                          h('strong', null, term.source),
                          h(Icon, { name: 'arrowRight', size: 11, className: 'cait-term-arrow' }),
                          h('span', null, term.target),
                        ),
                        term.note ? h('div', { className: 'cait-muted cait-tiny', style: { marginTop: 2 } }, term.note) : null,
                        h(
                          'div',
                          { className: 'cait-term-actions' },
                          h('button', { className: 'cait-minibtn', onClick: () => onApplyTerm(term) }, t('panel.apply')),
                          h('button', { className: 'cait-deletebtn', onClick: () => onDeleteTerm(term), title: t('panel.delete') }, h(Icon, { name: 'trash', size: 11 })),
                        ),
                      ),
                    )
                  : h('p', { className: 'cait-empty-note' }, t('panel.noTerms')),
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
                  h('button', { className: 'cait-btn', onClick: () => glossaryInput.current?.click(), disabled: Boolean(busy) }, h(Icon, { name: 'upload', size: 12 }), t('panel.importCsv')),
                  h('button', { className: 'cait-btn cait-btn-danger', onClick: onClearGlossary, disabled: Boolean(busy) || data.glossary.length === 0 }, t('panel.clearGlossary')),
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
                  h('div', { className: 'cait-labelrow' }, h('span', { className: 'cait-label' }, t('panel.mtRoute')), h('span', { className: 'cait-meta' }, settings.mt.provider || '—')),
                  h(
                    'button',
                    { className: 'cait-btn cait-btn-primary', onClick: onGenerateMt, disabled: Boolean(busy) || mtBusy, style: { width: '100%' } },
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
                        h('button', { className: 'cait-minibtn', onClick: () => onCopy(mt.text) }, t('panel.copy')),
                        h('button', { className: 'cait-minibtn', onClick: onApplyMt }, t('panel.mtInsert')),
                      ),
                    )
                  : h('p', { className: 'cait-empty-note' }, t('panel.mtEmpty')),
                h(
                  'p',
                  { className: 'cait-mt-hint' },
                  settings.mt.provider === 'mock'
                    ? t('panel.mtMockHint')
                    : t('panel.mtHint'),
                ),
                h(
                  'div',
                  { className: 'cait-panel-foot' },
                  h('button', { className: 'cait-btn', onClick: onOpenSettings }, h(Icon, { name: 'settings', size: 12 }), t('panel.mtSettings')),
                ),
              )
            : null,
        ),
      )
    }

    function DocumentSourceForm({ t, settings, busy, submitLabel, onSubmit, defaultMode = 'text' }) {
      const [mode, setMode] = useState(defaultMode)
      const [name, setName] = useState('')
      const [text, setText] = useState('')
      const [file, setFile] = useState(null)
      const [sourceLang, setSourceLang] = useState(settings.sourceLang || 'en')
      const [targetLang, setTargetLang] = useState(settings.targetLang || 'zh-CN')
      const [csvSourceColumn, setCsvSourceColumn] = useState('')
      const [csvTargetColumn, setCsvTargetColumn] = useState('')
      const inputRef = useRef(null)

      useEffect(() => {
        if (settings.sourceLang) setSourceLang(settings.sourceLang)
        if (settings.targetLang) setTargetLang(settings.targetLang)
      }, [settings.sourceLang, settings.targetLang])

      const pickFile = (nextFile) => {
        if (!nextFile) return
        setFile(nextFile)
        setMode('file')
        if (!name.trim()) setName(stripExtension(nextFile.name))
      }

      const submit = (event) => {
        event.preventDefault()
        onSubmit({
          mode,
          name,
          text,
          file,
          sourceLang,
          targetLang,
          csvSourceColumn,
          csvTargetColumn,
        })
      }

      const canSubmit = mode === 'file' ? Boolean(file) : Boolean(text.trim())
      const isCsv = mode === 'file' && /\.csv$/i.test(file?.name || '')

      return h(
        'form',
        { className: 'cait-docform', onSubmit: submit },
        h(
          'div',
          { className: 'cait-segmented' },
          h('button', { type: 'button', className: mode === 'text' ? 'active' : '', onClick: () => setMode('text') }, t('empty.paste')),
          h('button', { type: 'button', className: mode === 'file' ? 'active' : '', onClick: () => setMode('file') }, t('empty.file')),
        ),
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('modal.new.name')),
          h('input', {
            className: 'cait-input',
            value: name,
            onChange: (event) => setName(event.target.value),
            placeholder: t('modal.new.namePlaceholder'),
          }),
        ),
        h(
          'div',
          { className: 'cait-grid2' },
          h(
            'label',
            { className: 'cait-field' },
            h('span', null, t('modal.new.sourceLang')),
            h(
              'select',
              { className: 'cait-input', value: sourceLang, onChange: (event) => setSourceLang(event.target.value) },
              LANGUAGES.map(([code, label]) => h('option', { key: code, value: code }, `${label} (${code})`)),
            ),
          ),
          h(
            'label',
            { className: 'cait-field' },
            h('span', null, t('modal.new.targetLang')),
            h(
              'select',
              { className: 'cait-input', value: targetLang, onChange: (event) => setTargetLang(event.target.value) },
              LANGUAGES.map(([code, label]) => h('option', { key: code, value: code }, `${label} (${code})`)),
            ),
          ),
        ),
        isCsv
          ? h(
              'div',
              { className: 'cait-grid2' },
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('modal.new.csvSource')),
                h('input', {
                  className: 'cait-input',
                  value: csvSourceColumn,
                  onChange: (event) => setCsvSourceColumn(event.target.value),
                  placeholder: t('modal.new.csvColumnPlaceholder'),
                }),
              ),
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('modal.new.csvTarget')),
                h('input', {
                  className: 'cait-input',
                  value: csvTargetColumn,
                  onChange: (event) => setCsvTargetColumn(event.target.value),
                  placeholder: t('modal.new.csvColumnPlaceholder'),
                }),
              ),
              h('p', { className: 'cait-modal-hint' }, t('modal.new.csvHint')),
            )
          : null,
        mode === 'text'
          ? h('textarea', {
              className: 'cait-formtext',
              value: text,
              onChange: (event) => setText(event.target.value),
              placeholder: t('empty.textPlaceholder'),
              rows: 6,
            })
          : h(
              'label',
              {
                className: 'cait-drop',
                onDragOver: (event) => event.preventDefault(),
                onDrop: (event) => {
                  event.preventDefault()
                  pickFile(event.dataTransfer?.files?.[0])
                },
              },
              h('input', {
                ref: inputRef,
                type: 'file',
                accept: '.txt,.md,.markdown,.tmx,.docx,.epub,.csv,.srt,.vtt,.po,.pot,.xliff,.xlf,.sdlxliff,.html,.htm,.json,.rtf,.xlsx,.pptx',
                hidden: true,
                onChange: (event) => pickFile(event.target.files?.[0]),
              }),
              h(Icon, { name: file ? 'file' : 'upload', size: 22 }),
              h('strong', null, file ? file.name : t('empty.drop')),
              h('span', null, file ? formatBytes(file.size) : t('modal.new.dropHint')),
            ),
        h(
          'div',
          { className: 'cait-formfoot' },
          h('span', { className: 'cait-muted' }, t('empty.formats')),
          h(
            'button',
            { className: 'cait-btn cait-btn-primary', type: 'submit', disabled: Boolean(busy) || !canSubmit },
            busy === 'create' ? h(Spinner) : h(Icon, { name: 'plus', size: 13 }),
            busy === 'create' ? t('modal.new.importing') : submitLabel,
          ),
        ),
      )
    }

    function NewDocModal({ t, settings, busy, defaultMode, onClose, onCreate }) {
      return h(
        Modal,
        { title: t('modal.new.title'), onClose },
        h(DocumentSourceForm, { t, settings, busy, submitLabel: t('modal.new.create'), onSubmit: onCreate, defaultMode }),
        h(
          'div',
          { className: 'cait-demo-row' },
          h('span', null, t('modal.new.sample')),
          h('button', { className: 'cait-linkbtn', onClick: () => onCreate({ demo: true }), disabled: Boolean(busy) }, t('modal.new.demo')),
        ),
      )
    }

    function ExportModal({ t, busy, onClose, onExport, qa }) {
      const issues = qa?.issueCount || 0
      const items = [
        ['bilingual-md', t('modal.export.bilingualMd'), t('modal.export.bilingual'), 'file'],
        ['bilingual-csv', t('modal.export.bilingualCsv'), t('modal.export.bilingual'), 'file'],
        ['tmx', t('modal.export.tmx'), t('modal.export.bilingual'), 'database'],
        ['target-txt', t('modal.export.targetTxt'), t('modal.export.target'), 'download'],
        ['target-md', t('modal.export.targetMd'), t('modal.export.target'), 'download'],
        ['docx', t('modal.export.docx'), t('modal.export.docxGroup'), 'file'],
        ['epub', t('modal.export.epub'), t('modal.export.epubGroup'), 'file'],
        ['srt', t('modal.export.srt'), t('modal.export.subtitleGroup'), 'file'],
        ['vtt', t('modal.export.vtt'), t('modal.export.subtitleGroup'), 'file'],
        ['po', t('modal.export.po'), t('modal.export.localizationGroup'), 'file'],
        ['xliff', t('modal.export.xliff'), t('modal.export.localizationGroup'), 'file'],
        ['xliff2', t('modal.export.xliff2'), t('modal.export.localizationGroup'), 'file'],
        ['sdlxliff', t('modal.export.sdlxliff'), t('modal.export.localizationGroup'), 'file'],
        ['html', t('modal.export.html'), t('modal.export.webGroup'), 'file'],
        ['json-tree', t('modal.export.jsonTree'), t('modal.export.webGroup'), 'file'],
        ['rtf', t('modal.export.rtf'), t('modal.export.officeGroup'), 'file'],
        ['xlsx', t('modal.export.xlsx'), t('modal.export.officeGroup'), 'file'],
        ['pptx', t('modal.export.pptx'), t('modal.export.officeGroup'), 'file'],
        ['document-json', t('modal.export.json'), t('modal.export.current'), 'save'],
      ]
      return h(
        Modal,
        { title: t('modal.export.title'), onClose, wide: true },
        h('p', { className: 'cait-confirm-text' }, t('modal.export.desc')),
        issues
          ? h(
              'div',
              { className: 'cait-qa-banner' },
              h(Icon, { name: 'alert', size: 12 }),
              h(
                'span',
                null,
                `${t('qa.exportBanner').replace('{count}', String(issues))} `,
                t('qa.counts')
                  .replace('{placeholder}', String(qa.counts.PLACEHOLDER_MISSING))
                  .replace('{number}', String(qa.counts.NUMBER_MISMATCH))
                  .replace('{term}', String(qa.counts.TERM_NOT_USED))
                  .replace('{empty}', String(qa.counts.EMPTY_TARGET)),
              ),
            )
          : null,
        h(
          'div',
          { className: 'cait-export-grid' },
          items.map(([format, label, group, icon]) =>
            h(
              'button',
              { key: format, className: 'cait-export-item', onClick: () => onExport(format), disabled: Boolean(busy) },
              h(Icon, { name: icon, size: 15 }),
              h('span', null, h('strong', null, label), h('small', null, group)),
            ),
          ),
        ),
      )
    }

    function SettingsModal({ t, settings, mtRoutes, busy, onClose, onSave }) {
      const [form, setForm] = useState({
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        fuzzyThreshold: settings.fuzzyThreshold,
        tmLimit: settings.tmLimit,
        uiLang: settings.uiLang || 'auto',
        preprocess: {
          normalizeWhitespace: settings.preprocess?.normalizeWhitespace !== false,
          stripInvisible: settings.preprocess?.stripInvisible !== false,
          collapseBlankLines: settings.preprocess?.collapseBlankLines !== false,
        },
        mt: {
          provider: settings.mt.provider,
          model: settings.mt.model,
          temperature: settings.mt.temperature,
        },
      })
      const routes = Array.isArray(mtRoutes?.providers) ? mtRoutes.providers : []
      const route = routes.find((item) => item.id === form.mt.provider)
      const models = Array.isArray(route?.models) ? route.models : []
      const routeMissing = form.mt.provider !== 'mock' && !route

      const setMt = (patch) => setForm((current) => ({ ...current, mt: { ...current.mt, ...patch } }))
      const setPre = (patch) =>
        setForm((current) => ({ ...current, preprocess: { ...current.preprocess, ...patch } }))
      const selectProvider = (provider) => {
        const nextRoute = routes.find((item) => item.id === provider)
        setForm((current) => ({
          ...current,
          mt: {
            ...current.mt,
            provider,
            model:
              provider === 'mock'
                ? 'cait-mock'
                : nextRoute?.models?.[0]?.id || '',
          },
        }))
      }

      const submit = (event) => {
        event.preventDefault()
        const patch = {
          sourceLang: form.sourceLang,
          targetLang: form.targetLang,
          fuzzyThreshold: Number(form.fuzzyThreshold),
          tmLimit: Number(form.tmLimit),
          uiLang: form.uiLang,
          preprocess: {
            normalizeWhitespace: Boolean(form.preprocess.normalizeWhitespace),
            stripInvisible: Boolean(form.preprocess.stripInvisible),
            collapseBlankLines: Boolean(form.preprocess.collapseBlankLines),
          },
          mt: {
            provider: form.mt.provider,
            model: form.mt.model,
            temperature: Number(form.mt.temperature),
          },
        }
        onSave(patch)
      }

      return h(
        Modal,
        { title: t('modal.settings.title'), onClose, wide: true },
        h(
          'form',
          { onSubmit: submit },
          h(
            'div',
            { className: 'cait-settings-section' },
            h('h4', { className: 'cait-settings-title' }, t('modal.settings.ui')),
            h(
              'label',
              { className: 'cait-field' },
              h('span', null, t('modal.settings.uiLanguage')),
              h(
                'select',
                {
                  className: 'cait-input',
                  value: form.uiLang,
                  onChange: (event) => setForm({ ...form, uiLang: event.target.value }),
                },
                UI_LANGS.map(([code, label]) =>
                  h('option', { key: code, value: code }, label || t('modal.settings.uiAuto')),
                ),
              ),
            ),
            h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('modal.settings.uiHint')),
          ),
          h(
            'div',
            { className: 'cait-settings-section' },
            h('h4', { className: 'cait-settings-title' }, t('modal.settings.languages')),
            h(
              'div',
              { className: 'cait-grid2' },
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('modal.new.sourceLang')),
                h(
                  'select',
                  { className: 'cait-input', value: form.sourceLang, onChange: (event) => setForm({ ...form, sourceLang: event.target.value }) },
                  LANGUAGES.map(([code, label]) => h('option', { key: code, value: code }, `${label} (${code})`)),
                ),
              ),
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('modal.new.targetLang')),
                h(
                  'select',
                  { className: 'cait-input', value: form.targetLang, onChange: (event) => setForm({ ...form, targetLang: event.target.value }) },
                  LANGUAGES.map(([code, label]) => h('option', { key: code, value: code }, `${label} (${code})`)),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'cait-settings-section' },
            h('h4', { className: 'cait-settings-title' }, t('modal.settings.preprocess')),
            h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('modal.settings.preprocessHint')),
            ['normalizeWhitespace', 'stripInvisible', 'collapseBlankLines'].map((key) =>
              h(
                'label',
                { key, className: 'cait-checkline' },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(form.preprocess[key]),
                  onChange: (event) => setPre({ [key]: event.target.checked }),
                }),
                t(`modal.settings.pre.${key}`),
              ),
            ),
          ),
          h(
            'div',
            { className: 'cait-settings-section' },
            h('h4', { className: 'cait-settings-title' }, t('modal.settings.tm')),
            h(
              'label',
              { className: 'cait-field' },
              h('span', null, `${t('modal.settings.fuzzy')} · ${Math.round(Number(form.fuzzyThreshold) * 100)}%`),
              h('input', {
                className: 'cait-range',
                type: 'range',
                min: 0.3,
                max: 1,
                step: 0.05,
                value: form.fuzzyThreshold,
                onChange: (event) => setForm({ ...form, fuzzyThreshold: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'cait-field' },
              h('span', null, t('modal.settings.limit')),
              h('input', {
                className: 'cait-input',
                type: 'number',
                min: 1,
                max: 20,
                value: form.tmLimit,
                onChange: (event) => setForm({ ...form, tmLimit: event.target.value }),
              }),
            ),
          ),
          h(
            'div',
            { className: 'cait-settings-section' },
            h('h4', { className: 'cait-settings-title' }, t('modal.settings.mt')),
            h(
              'label',
              { className: 'cait-field' },
              h('span', null, t('modal.settings.provider')),
              h(
                'select',
                {
                  className: 'cait-input',
                  value: form.mt.provider,
                  onChange: (event) => selectProvider(event.target.value),
                },
                h('option', { value: 'mock' }, t('mt.mock')),
                routes.map((item) =>
                  h(
                    'option',
                    { key: item.id, value: item.id, disabled: item.hasModels === false },
                    item.hasModels === false
                      ? `${item.name} (${item.id}) · ${t('modal.settings.noModels')}`
                      : `${item.name} (${item.id})`,
                  ),
                ),
                routeMissing
                  ? h('option', { value: form.mt.provider }, t('modal.settings.routeMissing'))
                  : null,
              ),
            ),
            h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('modal.settings.routeHint')),
            routes.length === 0 || mtRoutes?.fallback
              ? h('p', { className: 'cait-mt-hint' }, mtRoutes?.message || t('modal.settings.noRoutes'))
              : null,
            form.mt.provider === 'mock'
              ? h('p', { className: 'cait-mt-hint', style: { marginTop: 0, marginBottom: 9 } }, t('modal.settings.mockHint'))
              : h(
                  'div',
                  { className: 'cait-grid2' },
                  h(
                    'label',
                    { className: 'cait-field' },
                    h('span', null, t('modal.settings.model')),
                    models.length
                      ? h(
                          'select',
                          {
                            className: 'cait-input',
                            value: form.mt.model,
                            onChange: (event) => setMt({ model: event.target.value }),
                          },
                          models.map((model) =>
                            h('option', { key: model.id, value: model.id }, `${model.name} (${model.id})`),
                          ),
                        )
                      : h('input', {
                          className: 'cait-input',
                          value: form.mt.model,
                          readOnly: true,
                          placeholder: t('modal.settings.noModels'),
                        }),
                  ),
                  h(
                    'label',
                    { className: 'cait-field' },
                    h('span', null, `${t('modal.settings.temperature')} · ${form.mt.temperature}`),
                    h('input', {
                      className: 'cait-range',
                      type: 'range',
                      min: 0,
                      max: 1,
                      step: 0.1,
                      value: form.mt.temperature,
                      onChange: (event) => setMt({ temperature: event.target.value }),
                    }),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'cait-modal-actions' },
            h('button', { type: 'button', className: 'cait-btn cait-btn-ghost', onClick: onClose }, t('modal.settings.cancel')),
            h('button', { type: 'submit', className: 'cait-btn cait-btn-primary', disabled: Boolean(busy) }, busy === 'settings' ? h(Spinner) : null, t('modal.settings.save')),
          ),
        ),
      )
    }

    function LibrariesModal({ t, data, busy, onClose, onSetMounts, onCreate, onRename, onDeleteLibrary }) {
      const libraries = data.libraries || { tm: [], glossary: [] }
      const mounts = data.mounts || {
        tmIds: [],
        glossaryIds: [],
        defaultTmId: '',
        defaultGlossaryId: '',
      }
      const [tmName, setTmName] = useState('')
      const [glossaryName, setGlossaryName] = useState('')
      const [editing, setEditing] = useState(null)
      const [editName, setEditName] = useState('')

      const startRename = (kind, id, name) => {
        setEditing({ kind, id })
        setEditName(name)
      }

      const submitRename = async () => {
        if (!editing || !editName.trim()) return
        const ok = await onRename({ kind: editing.kind, id: editing.id, name: editName.trim() })
        if (ok) setEditing(null)
      }

      const toggle = (kind, id, checked) => {
        const current = kind === 'tm' ? mounts.tmIds : mounts.glossaryIds
        const next = computeNextMountIds(current, id, checked)
        if (!next) return
        onSetMounts(kind === 'tm' ? { tmIds: next } : { glossaryIds: next })
      }

      const create = async (kind, name, reset) => {
        if (!name.trim()) return
        const ok = await onCreate({ kind, name: name.trim() })
        if (ok) reset('')
      }

      const section = (kind, title, list, defaultId, ids) =>
        h(
          'div',
          { className: 'cait-libsection' },
          h(
            'div',
            { className: 'cait-libhead' },
            h('h4', { className: 'cait-settings-title' }, title),
            h('span', { className: 'cait-count' }, `${ids.length}/${list.length}`),
          ),
          list.length
            ? list.map((library) => {
                const id = kind === 'tm' ? library.tmId : library.glossaryId
                const mounted = ids.includes(id)
                return h(
                  'div',
                  { className: 'cait-librow', key: id },
                  h(
                    'label',
                    { className: 'cait-libcheck' },
                    h('input', {
                      type: 'checkbox',
                      checked: mounted,
                      disabled: isMountToggleDisabled({
                        mounted,
                        mountedCount: ids.length,
                        busy: Boolean(busy),
                      }),
                      onChange: (event) => toggle(kind, id, event.target.checked),
                    }),
                    h(
                      'span',
                      { className: 'cait-libmeta' },
                      editing && editing.kind === kind && editing.id === id
                        ? h('input', {
                            className: 'cait-input cait-librename',
                            value: editName,
                            autoFocus: true,
                            disabled: Boolean(busy),
                            onChange: (event) => setEditName(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                submitRename()
                              }
                              if (event.key === 'Escape') setEditing(null)
                            },
                          })
                        : h('strong', null, library.name),
                      h(
                        'small',
                        null,
                        `${library.entryCount || 0} ${t('libraries.entries')}${
                          library.mounted ? '' : ` · ${t('libraries.notMounted')}`
                        }`,
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'cait-libactions' },
                    editing && editing.kind === kind && editing.id === id
                      ? h(
                          'span',
                          { className: 'cait-formrow' },
                          h(
                            'button',
                            {
                              className: 'cait-minibtn',
                              onClick: submitRename,
                              disabled: Boolean(busy) || !editName.trim(),
                            },
                            t('libraries.save'),
                          ),
                          h('button', { className: 'cait-minibtn', onClick: () => setEditing(null) }, t('panel.cancel')),
                        )
                      : h(
                          'button',
                          {
                            className: 'cait-deletebtn',
                            onClick: () => startRename(kind, id, library.name),
                            disabled: Boolean(busy),
                            title: t('libraries.rename'),
                          },
                          h(Icon, { name: 'pencil', size: 11 }),
                        ),
                    h(
                      'button',
                      {
                        className: 'cait-deletebtn',
                        onClick: () => onDeleteLibrary({ kind, id, name: library.name }),
                        disabled: Boolean(busy) || list.length <= 1,
                        title: t('libraries.delete'),
                      },
                      h(Icon, { name: 'trash', size: 11 }),
                    ),
                  ),
                  h(
                    'label',
                    { className: 'cait-libdefault' },
                    h('input', {
                      type: 'radio',
                      name: `cait-default-${kind}`,
                      checked: defaultId === id,
                      disabled: Boolean(busy) || !mounted,
                      onChange: () =>
                        onSetMounts(
                          kind === 'tm'
                            ? { defaultTmId: id }
                            : { defaultGlossaryId: id },
                        ),
                    }),
                    t(kind === 'tm' ? 'libraries.defaultTm' : 'libraries.defaultGlossary'),
                  ),
                )
              })
            : h('p', { className: 'cait-empty-note' }, t('libraries.empty')),
          h(
            'form',
            {
              className: 'cait-libcreate',
              onSubmit: (event) => {
                event.preventDefault()
                create(kind, kind === 'tm' ? tmName : glossaryName, kind === 'tm' ? setTmName : setGlossaryName)
              },
            },
            h('input', {
              className: 'cait-input',
              value: kind === 'tm' ? tmName : glossaryName,
              onChange: (event) =>
                kind === 'tm' ? setTmName(event.target.value) : setGlossaryName(event.target.value),
              placeholder: t('libraries.namePlaceholder'),
              disabled: Boolean(busy),
            }),
            h(
              'button',
              { className: 'cait-btn', type: 'submit', disabled: Boolean(busy) },
              h(Icon, { name: 'plus', size: 12 }),
              t('libraries.create'),
            ),
          ),
        )

      return h(
        Modal,
        { title: t('libraries.title'), onClose, wide: true },
        h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('libraries.desc')),
        section('tm', t('libraries.tm'), libraries.tm, mounts.defaultTmId, mounts.tmIds),
        section(
          'glossary',
          t('libraries.glossary'),
          libraries.glossary,
          mounts.defaultGlossaryId,
          mounts.glossaryIds,
        ),
        h(
          'div',
          { className: 'cait-modal-actions' },
          h('button', { className: 'cait-btn cait-btn-primary', onClick: onClose }, t('libraries.done')),
        ),
      )
    }

    function ConfirmModal({ t, state, busy, onClose, onConfirm }) {
      return h(
        Modal,
        { title: state.title || t('modal.confirm.title'), onClose },
        h('p', { className: 'cait-confirm-text' }, state.message),
        h(
          'div',
          { className: 'cait-modal-actions' },
          h('button', { className: 'cait-btn cait-btn-ghost', onClick: onClose, disabled: Boolean(busy) }, t('modal.confirm.cancel')),
          h('button', { className: 'cait-btn cait-btn-danger', onClick: onConfirm, disabled: Boolean(busy) }, busy ? h(Spinner) : null, state.confirmLabel || t('modal.confirm.ok')),
        ),
      )
    }

    function EmptyState({ t, settings, busy, onCreate, onDemo }) {
      return h(
        'div',
        { className: 'cait-empty' },
        h(
          'div',
          { className: 'cait-empty-inner' },
          h('span', { className: 'cait-kicker' }, 'CAIT · CAT WORKBENCH'),
          h('h1', null, t('empty.title')),
          h('p', { className: 'cait-lede' }, t('empty.desc')),
          h(
            'div',
            { className: 'cait-features' },
            h('div', { className: 'cait-feature' }, h('strong', null, h(Icon, { name: 'database', size: 12 }), t('empty.features.tm')), h('span', null, t('empty.features.tmDesc'))),
            h('div', { className: 'cait-feature' }, h('strong', null, h(Icon, { name: 'book', size: 12 }), t('empty.features.glossary')), h('span', null, t('empty.features.glossaryDesc'))),
            h('div', { className: 'cait-feature' }, h('strong', null, h(Icon, { name: 'sparkles', size: 12 }), t('empty.features.mt')), h('span', null, t('empty.features.mtDesc'))),
          ),
          h(DocumentSourceForm, { t, settings, busy, submitLabel: t('empty.create'), onSubmit: onCreate }),
          h(
            'div',
            { className: 'cait-demo-row' },
            h('span', null, t('empty.demoHint')),
            h('button', { className: 'cait-linkbtn', onClick: onDemo, disabled: Boolean(busy) }, t('empty.demo')),
          ),
        ),
      )
    }

    function Workbench({ i18n, translate }) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState('')
      const [busy, setBusy] = useState('')
      const [selected, setSelected] = useState(0)
      const [draft, setDraft] = useState('')
      const [dirty, setDirty] = useState(false)
      const [tab, setTab] = useState('tm')
      const [railQuery, setRailQuery] = useState('')
      const [railFilter, setRailFilter] = useState('all')
      const [pre, setPre] = useState({ running: false, done: 0, total: 0, filled: 0, failed: 0 })
      const [qa, setQa] = useState(null)
      const [tmQuery, setTmQuery] = useState('')
      const [tmResults, setTmResults] = useState(null)
      const [tmRefresh, setTmRefresh] = useState(0)
      const [tmError, setTmError] = useState('')
      const [mt, setMt] = useState(null)
      const [mtError, setMtError] = useState('')
      const [mtBusy, setMtBusy] = useState(false)
      const [mtRoutes, setMtRoutes] = useState({ providers: [], fallback: true, message: '' })
      const [stale, setStale] = useState(false)
      const [toast, setToast] = useState(null)
      const [modal, setModal] = useState(null)
      const textareaRef = useRef(null)
      const dirtyRef = useRef(false)
      const busyRef = useRef(false)
      const rootRef = useRef(null)
      const unitRef = useRef(0)

      const doc = data?.activeDocument || null
      const segments = doc?.segments || []
      const index = doc ? Math.min(selected, Math.max(0, segments.length - 1)) : 0
      const segment = segments[index] || null
      const detail = doc?.current?.index === index ? doc.current : null
      const settings = data?.settings || {
        sourceLang: 'en',
        targetLang: 'zh-CN',
        fuzzyThreshold: 0.55,
        tmLimit: 5,
        uiLang: 'auto',
        mt: { provider: 'mock', model: 'cait-mock', temperature: 0.2 },
      }

      // The UI language is a plugin setting; 'auto' follows the DSH locale.
      const uiLang = UI_LANG_CODES.includes(settings.uiLang) ? settings.uiLang : 'auto'
      // A DSH language switch must re-render the workbench while 'auto' is
      // selected, so subscribe to the locale service through the entry seam.
      const [localeRevision, setLocaleRevision] = useState(0)
      useEffect(
        () => (i18n.subscribe ? i18n.subscribe(() => setLocaleRevision(revision => revision + 1)) : undefined),
        [i18n],
      )
      const t = useMemo(
        () => (key, vars) => translate(uiLang, key, vars),
        [translate, uiLang, localeRevision],
      )
      useEffect(() => {
        // Keep the sidebar label in sync with the in-app switch.
        i18n.set(uiLang)
      }, [i18n, uiLang])

      const adoptState = (next, forcedIndex) => {
        setData(next)
        setStale(false)
        const nextDoc = next?.activeDocument
        if (!nextDoc) {
          setSelected(0)
          setDraft('')
          setDirty(false)
          setMt(null)
          setMtError('')
          return
        }
        const nextIndex = Number.isInteger(forcedIndex)
          ? Math.min(Math.max(forcedIndex, 0), nextDoc.segments.length - 1)
          : Math.min(nextDoc.cursor, nextDoc.segments.length - 1)
        setSelected(nextIndex)
        setDraft(nextDoc.segments[nextIndex]?.target || '')
        setDirty(false)
        setMt(null)
        setMtError('')
      }

      const notify = (message, kind = 'success') => setToast({ message, kind, id: Date.now() })
      const report = (error) => notify(error?.message || t('toast.error'), 'error')
      const importNotice = (result, fallback) => {
        const warning = result?.warnings?.[0]
        if (warning) {
          const message = warning.code === 'TMX_INLINE_MARKUP_LOST'
            ? t('toast.tmxMarkupLost').replace('{count}', warning.count)
            : warning.message || t('toast.tmxMarkupLost').replace('{count}', warning.count)
          notify(message, 'info')
        } else {
          notify(fallback)
        }
      }

      useEffect(() => {
        dirtyRef.current = dirty
      }, [dirty])

      useEffect(() => {
        busyRef.current = Boolean(busy)
      }, [busy])

      const refreshStorage = async () => {
        try {
          const next = await rpc('bootstrap')
          setData((current) => (current ? { ...current, storage: next.storage } : next))
        } catch {
          // The banner already reports the persistence error; a failed refresh
          // must not replace the editor state or the user's draft.
        }
      }

      const refreshState = async () => {
        try {
          if (dirty) {
            const saved = await saveDraft(true)
            if (!saved) return
          }
          const next = await rpc('bootstrap')
          adoptState(next)
          setStale(false)
        } catch (error) {
          report(error)
        }
      }

      const preCancelRef = useRef(false)

      // The client drives pre-translation block by block instead of asking the
      // host for a background job: a block is one RPC, cancellation is simply
      // "stop looping", and every finished block is already persisted.
      const runPreTranslate = async () => {
        const active = data?.activeDocument
        if (!active || pre.running) return
        preCancelRef.current = false
        const initial = active.progress || { confirmed: 0, translated: 0, total: 0 }
        setPre({
          running: true,
          done: initial.confirmed + initial.translated,
          total: initial.total,
          filled: 0,
          failed: 0,
        })
        let from = 0
        let filled = 0
        let failed = 0
        try {
          while (from !== null) {
            if (preCancelRef.current) break
            const result = await rpc('preTranslate', {
              documentId: active.id,
              from,
              count: PRETRANSLATE_BLOCK_SIZE,
            })
            filled += result.filled
            failed += result.failed.length
            from = result.next
            const progress = result.progress
            setPre((current) => ({
              ...current,
              done: progress.confirmed + progress.translated,
              total: progress.total,
              filled,
              failed,
            }))
            await refreshState()
          }
          if (preCancelRef.current) notify(t('toast.preCancelled'))
          else if (failed) notify(t('toast.preFailed').replace('{count}', String(failed)))
          else notify(t('toast.preDone').replace('{count}', String(filled)))
        } catch (error) {
          report(error)
        } finally {
          setPre((current) => ({ ...current, running: false }))
        }
      }

      const cancelPreTranslate = () => {
        preCancelRef.current = true
      }

      useEffect(() => {
        let alive = true
        setLoading(true)
        rpc('bootstrap')
          .then((state) => {
            if (!alive) return
            adoptState(state)
            setLoadError('')
          })
          .catch((error) => {
            if (!alive) return
            setLoadError(error?.message || t('error.load'))
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        let alive = true
        let inFlight = false
        const tick = async () => {
          if (!alive || inFlight || busyRef.current) return
          inFlight = true
          try {
            const next = await rpc('bootstrap')
            if (!alive) return
            if (Number(next.revision) !== Number(data?.revision)) {
              if (
                shouldAdoptRemote({
                  currentRevision: data?.revision,
                  nextRevision: next.revision,
                  dirty: dirtyRef.current,
                })
              ) {
                adoptState(next)
              } else if (dirtyRef.current) {
                setStale(true)
              }
            }
          } catch {
            // A transient poll failure should not replace the workbench state.
          } finally {
            inFlight = false
          }
        }
        const timer = setInterval(tick, SYNC_POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [data?.revision])

      useEffect(() => {
        const id = data?.activeDocument?.id
        if (!id) {
          setQa(null)
          return
        }
        let alive = true
        rpc('getQaReport', { documentId: id })
          .then((report) => {
            if (alive) setQa(report)
          })
          .catch(() => {
            // QA is advisory: a failure must never disturb the workbench.
            if (alive) setQa(null)
          })
        return () => {
          alive = false
        }
      }, [data?.activeDocument?.id, data?.revision])

      useEffect(() => {
        let alive = true
        rpc('listMtRoutes')
          .then((routes) => {
            if (alive) setMtRoutes(routes || { providers: [], fallback: true, message: '' })
          })
          .catch(() => {
            if (alive) setMtRoutes({ providers: [], fallback: true, message: '' })
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 3200)
        return () => clearTimeout(timer)
      }, [toast])

      useEffect(() => {
        setRailQuery('')
        setTmQuery('')
        setTmResults(null)
        setTmError('')
      }, [doc?.id])

      useEffect(() => {
        const query = tmQuery.trim()
        if (!query) {
          setTmResults(null)
          setTmError('')
          return undefined
        }
        let cancelled = false
        const timer = setTimeout(() => {
          rpc('lookupTM', {
            query,
            sourceLang: doc?.sourceLang,
            targetLang: doc?.targetLang,
            threshold: settings.fuzzyThreshold,
            limit: settings.tmLimit,
          })
            .then((result) => {
              if (!cancelled) {
                setTmResults(result)
                setTmError('')
              }
            })
            .catch((error) => {
              if (!cancelled) setTmError(error?.message || t('toast.error'))
            })
        }, 260)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [tmQuery, tmRefresh, doc?.id, doc?.sourceLang, doc?.targetLang, settings.fuzzyThreshold, settings.tmLimit])

      const saveDraft = async (silent = true) => {
        if (!doc || !dirty) return true
        try {
          await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
          setDirty(false)
          if (!silent) notify(t('toast.draftSaved'))
          return true
        } catch (error) {
          report(error)
          return false
        }
      }

      const chooseSegment = async (nextIndex) => {
        if (!doc || busy || nextIndex === selected) return
        setBusy('select')
        try {
          if (dirty) {
            await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
            setDirty(false)
          }
          const result = await rpc('selectSegment', { documentId: doc.id, index: nextIndex })
          adoptState(result.state)
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const confirmSegment = async () => {
        if (!doc || busy) return
        if (!draft.trim()) {
          notify(t('editor.emptyTarget'), 'error')
          textareaRef.current?.focus()
          return
        }
        setBusy('confirm')
        try {
          const result = await rpc('confirmSegment', {
            documentId: doc.id,
            index: selected,
            target: draft,
            targetTmId: data?.mounts?.defaultTmId,
          })
          adoptState(result.state)
          notify(result.done ? t('editor.done') : t('toast.confirmed'))
        } catch (error) {
          report(error)
          if (error?.code === 'PERSISTENCE_FAILED') await refreshStorage()
        } finally {
          setBusy('')
        }
      }

      const adoptSuggestion = async () => {
        if (!doc || busy || !segment?.suggestion) return
        if (dirty) {
          const saved = await saveDraft(true)
          if (!saved) return
        }
        setBusy('adopt')
        try {
          const result = await rpc('adoptSuggestion', { documentId: doc.id, index: selected })
          adoptState(result.state)
          notify(t('toast.suggestionAdopted'))
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const moveSegment = async (delta) => {
        if (!doc || busy) return
        setBusy('move')
        try {
          if (dirty) {
            await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
            setDirty(false)
          }
          const result = await rpc('moveSegment', { documentId: doc.id, delta })
          adoptState(result.state)
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const openDocument = async (documentId) => {
        if (!documentId || documentId === doc?.id || busy) return
        setBusy('open')
        try {
          if (dirty) {
            await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
            setDirty(false)
          }
          const result = await rpc('openDocument', { documentId })
          adoptState(result.state)
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const closeDocumentTab = async (documentId) => {
        if (!documentId || busy) return
        setBusy('close')
        try {
          if (dirty) {
            const saved = await saveDraft(true)
            if (!saved) return
          }
          const result = await rpc('closeDocument', { documentId })
          adoptState(result.state)
          notify(t('toast.docClosed'))
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const createFromForm = async (form) => {
        if (form.demo) {
          await loadDemo()
          return
        }
        setBusy('create')
        try {
          let result
          if (form.mode === 'file' && form.file) {
            const payload = await filePayload(form.file)
            result = await rpc('importFile', {
              ...payload,
              name: form.name.trim() || form.file.name,
              sourceLang: form.sourceLang,
              targetLang: form.targetLang,
              csvSourceColumn: form.csvSourceColumn,
              csvTargetColumn: form.csvTargetColumn,
            })
          } else {
            result = await rpc('createDocument', {
              name: form.name,
              text: form.text,
              sourceLang: form.sourceLang,
              targetLang: form.targetLang,
            })
          }
          adoptState(result.state)
          setModal(null)
          if (result.reused) notify(t('toast.docAlreadyOpen'))
          else importNotice(result, t('toast.imported'))
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const loadDemo = async () => {
        setBusy('demo')
        try {
          const result = await rpc('loadDemo')
          adoptState(result.state)
          setModal(null)
          notify(result.reused ? t('toast.docAlreadyOpen') : t('toast.created'))
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const applyTm = (match) => {
        setDraft(match.target)
        setDirty(true)
        setMt(null)
        setTimeout(() => textareaRef.current?.focus(), 0)
      }

      const applyTerm = (term) => {
        const separator = /^(zh|ja|ko)/i.test(doc?.targetLang || '') ? '' : ' '
        setDraft((current) => {
          const value = current.replace(/\s+$/, '')
          return value ? `${value}${separator}${term.target}` : term.target
        })
        setDirty(true)
        setTimeout(() => textareaRef.current?.focus(), 0)
      }

      const editTm = async ({ id, target }) => {
        setBusy('tm-edit')
        try {
          const result = await rpc('updateTM', { id, target })
          setData(result.state)
          setTmRefresh((value) => value + 1)
          notify(t('toast.tmUpdated'))
          return true
        } catch (error) {
          report(error)
          return false
        } finally {
          setBusy('')
        }
      }

      const deleteTm = (match) => {
        setModal({
          type: 'confirm',
          title: t('modal.confirm.title'),
          message: `${t('modal.confirm.deleteTm')} “${match.source} → ${match.target}”？`,
          confirmLabel: t('panel.delete'),
          action: async () => {
            const result = await rpc('deleteTM', { id: match.id })
            setData(result.state)
            setTmRefresh((value) => value + 1)
            notify(t('toast.tmDeleted'))
          },
        })
      }

      const confirmAllTranslated = () => {
        const active = data?.activeDocument
        const awaiting = active?.progress?.translated || 0
        if (!active || !awaiting) return
        setModal({
          type: 'confirm',
          title: t('rail.confirmAll'),
          message: t('rail.confirmAllMessage').replace('{count}', String(awaiting)),
          confirmLabel: t('rail.confirmAll'),
          action: async () => {
            const result = await rpc('confirmSegments', { documentId: active.id, status: 'translated' })
            await refreshState()
            setTmRefresh((value) => value + 1)
            notify(t('toast.confirmedMany').replace('{count}', String(result.confirmed.length)))
          },
        })
      }

      const addTerm = async (form) => {        setBusy('term')
        try {
          const result = await rpc('addGlossary', {
            ...form,
            sourceLang: doc?.sourceLang || settings.sourceLang,
            glossaryId: data?.mounts?.defaultGlossaryId,
          })
          setData(result.state)
          notify(t('toast.termSaved'))
          return true
        } catch (error) {
          report(error)
          return false
        } finally {
          setBusy('')
        }
      }

      const deleteTerm = (term) => {
        setModal({
          type: 'confirm',
          title: t('modal.confirm.title'),
          message: `${t('modal.confirm.deleteTerm')} “${term.source} → ${term.target}”？`,
          confirmLabel: t('panel.delete'),
          action: async () => {
            const result = await rpc('deleteGlossary', { id: term.id })
            setData(result.state)
            notify(t('toast.termDeleted'))
          },
        })
      }

      const importTmxFile = async (file) => {
        setBusy('tm-import')
        try {
          const text = await file.text()
          const result = await rpc('importTmx', {
            text,
            importAs: 'tm',
            sourceLang: doc?.sourceLang || settings.sourceLang,
            targetLang: doc?.targetLang || settings.targetLang,
            tmId: data?.mounts?.defaultTmId,
          })
          setData(result.state)
          importNotice(
            result,
            `${t('toast.tmImported')} · +${result.added} / ~${result.updated}`,
          )
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const importGlossaryFile = async (file) => {
        setBusy('glossary-import')
        try {
          const text = await file.text()
          const result = await rpc('importGlossary', {
            text,
            glossaryId: data?.mounts?.defaultGlossaryId,
          })
          setData(result.state)
          notify(`${t('toast.glossaryImported')} · +${result.added} / ~${result.updated}`)
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const generateMt = async () => {
        if (!doc || !segment || mtBusy) return
        setMtBusy(true)
        setMtError('')
        try {
          const result = await rpc('mtSuggest', {
            text: segment.source,
            documentId: doc.id,
            index: selected,
            sourceLang: doc.sourceLang,
            targetLang: doc.targetLang,
          })
          setMt(result)
          notify(t('toast.mtReady'), 'info')
        } catch (error) {
          setMtError(error?.message || t('toast.error'))
        } finally {
          setMtBusy(false)
        }
      }

      const saveSettings = async (patch) => {
        setBusy('settings')
        try {
          const result = await rpc('saveSettings', patch)
          setData(result.state)
          setModal(null)
          notify(t('toast.settingsSaved'))
          return true
        } catch (error) {
          report(error)
          return false
        } finally {
          setBusy('')
        }
      }

      const setMounts = async (patch) => {
        setBusy('mounts')
        try {
          const result = await rpc('setMounts', patch)
          setData(result.state)
          setTmResults(null)
          notify(t('libraries.mountSaved'))
          return true
        } catch (error) {
          report(error)
          return false
        } finally {
          setBusy('')
        }
      }

      const createLibrary = async ({ kind, name }) => {
        setBusy('library')
        try {
          const result = await rpc('createLibrary', { kind, name })
          setData(result.state)
          notify(t('libraries.created'))
          return true
        } catch (error) {
          report(error)
          return false
        } finally {
          setBusy('')
        }
      }

      const renameLibrary = async ({ kind, id, name }) => {
        setBusy('library')
        try {
          const result = await rpc('renameLibrary', { kind, id, name })
          setData(result.state)
          notify(t('libraries.renamed'))
          return true
        } catch (error) {
          report(error)
          return false
        } finally {
          setBusy('')
        }
      }

      const deleteLibrary = ({ kind, id, name }) => {
        const entries = kind === 'tm' ? t('libraries.deleteTmWarn') : t('libraries.deleteGlossaryWarn')
        setModal({
          type: 'confirm',
          title: t('modal.confirm.title'),
          message: `${t('libraries.delete')} “${name}”？${entries}`,
          confirmLabel: t('libraries.delete'),
          action: async () => {
            const result = await rpc('deleteLibrary', { kind, id })
            setData(result.state)
            setTmResults(null)
            notify(t('libraries.deleted'))
          },
        })
      }

      const exportAs = async (format) => {
        if (!doc) return
        setBusy('export')
        try {
          const result = await rpc('exportDocument', { format, documentId: doc.id })
          const content = result.encoding === 'base64'
            ? decodeBase64(result.content)
            : result.content
          downloadFile(result.filename, content, result.mime)
          notify(t('toast.exported'))
          setModal(null)
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const openConfirm = (state) => setModal({ type: 'confirm', ...state })

      const clearTm = () =>
        openConfirm({
          title: t('modal.confirm.title'),
          message: t('modal.confirm.clearTm'),
          confirmLabel: t('panel.clearTm'),
          action: async () => {
            const result = await rpc('clearTM', { tmIds: data?.mounts?.tmIds || [], confirm: true })
            setData(result.state)
            setTmResults(null)
            notify(t('toast.tmCleared'))
          },
        })

      const clearGlossary = () =>
        openConfirm({
          title: t('modal.confirm.title'),
          message: t('modal.confirm.clearGlossary'),
          confirmLabel: t('panel.clearGlossary'),
          action: async () => {
            const result = await rpc('clearGlossary', {
              glossaryIds: data?.mounts?.glossaryIds || [],
              confirm: true,
            })
            setData(result.state)
            notify(t('toast.glossaryCleared'))
          },
        })

      const runConfirm = async () => {
        if (!modal?.action) return
        setBusy('confirm-action')
        try {
          await modal.action()
          setModal(null)
        } catch (error) {
          report(error)
        } finally {
          setBusy('')
        }
      }

      const copy = async (value) => {
        try {
          await copyText(value)
          notify(t('toast.copied'))
        } catch (error) {
          report(error)
        }
      }

      const openIds = new Set((data?.openDocuments || []).map((item) => item.id))
      const closedDocuments = (data?.documents || []).filter((item) => !openIds.has(item.id))

      const deleteClosedDocument = (document) =>
        openConfirm({
          title: t('doc.deleteTitle'),
          message: t('doc.deleteMessage').replace('{name}', document.name),
          confirmLabel: t('doc.delete'),
          action: async () => {
            const result = await rpc('deleteDocument', { documentId: document.id })
            adoptState(result.state)
            notify(t('toast.docDeleted'))
          },
        })

      const clearClosedDocuments = () =>
        openConfirm({
          title: t('doc.cleanTitle'),
          message: t('doc.cleanAllMessage').replace('{count}', String(closedDocuments.length)),
          confirmLabel: t('doc.cleanAll'),
          action: async () => {
            let lastState = null
            for (const document of closedDocuments) {
              const result = await rpc('deleteDocument', { documentId: document.id })
              lastState = result.state
            }
            if (lastState) adoptState(lastState)
            notify(t('toast.docsCleared').replace('{count}', String(closedDocuments.length)))
          },
        })

      // Track the size DSH gives the panel and publish it as a CSS unit. The
      // observer watches the stable root element and writes the property
      // directly, so resizing never triggers a React render.
      useEffect(() => {
        const element = rootRef.current
        if (!element) return undefined
        const measure = () => {
          const rect = element.getBoundingClientRect()
          const unit = computeCaitUnit({ width: rect.width, height: rect.height })
          if (Math.abs(unit - unitRef.current) < 0.002) return
          unitRef.current = unit
          element.style.setProperty(CAIT_UNIT_VAR, String(unit))
        }
        measure()

        // Mirror the host theme so native widgets follow `color-scheme`. DSH
        // toggles the marker on <body>, so observe that instead of guessing
        // from colours.
        const syncTheme = () => {
          const kind = detectThemeKind(document)
          if (element.getAttribute(CAIT_THEME_ATTR) !== kind) element.setAttribute(CAIT_THEME_ATTR, kind)
        }
        syncTheme()
        let themeObserver = null
        if (typeof MutationObserver !== 'undefined' && document.body) {
          themeObserver = new MutationObserver(syncTheme)
          themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-ds-dark-theme', 'data-theme', 'class'],
          })
        }
        const stopTheme = () => {
          if (themeObserver) themeObserver.disconnect()
        }

        if (typeof ResizeObserver === 'undefined') {
          window.addEventListener('resize', measure)
          return () => {
            window.removeEventListener('resize', measure)
            stopTheme()
          }
        }
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => {
          observer.disconnect()
          stopTheme()
        }
      }, [])

      if (loading) {
        return h(
          'div',
          { className: 'cait-root', ref: rootRef },
          h('style', null, CSS_SCALED),
          h('div', { className: 'cait-center' }, h(Spinner), t('common.loading')),
        )
      }

      if (loadError) {
        return h(
          'div',
          { className: 'cait-root', ref: rootRef },
          h('style', null, CSS_SCALED),
          h(
            'div',
            { className: 'cait-center' },
            h(
              'div',
              { className: 'cait-errorcard' },
              h('p', null, `${t('error.load')}: ${loadError}`),
              h('button', { className: 'cait-btn cait-btn-primary', onClick: () => window.location.reload() }, h(Icon, { name: 'refresh', size: 13 }), t('common.retry')),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'cait-root', ref: rootRef },
        h('style', null, CSS_SCALED),
        h(Topbar, {
          t,
          doc,
          data,
          busy,
          onNew: () => setModal({ type: 'new', defaultMode: 'text' }),
          onImport: () => setModal({ type: 'new', defaultMode: 'file' }),
          onExport: () => setModal({ type: 'export' }),
          onSettings: () => setModal({ type: 'settings' }),
          onOpenDoc: openDocument,
          onCloseDoc: closeDocumentTab,
          onNewTab: () => setModal({ type: 'new', defaultMode: 'file' }),
          onCleanClosed: () => setModal({ type: 'recent' }),
          pre,
          onPreTranslate: runPreTranslate,
          onCancelPreTranslate: cancelPreTranslate,
        }),
        h(SaveBanner, { t, storage: data?.storage, stale, onRefresh: refreshState }),
        h(
          'div',
          { className: `cait-body${doc ? '' : ' cait-no-doc'}` },
          doc ? h(SegmentRail, { t, doc, selected: index, query: railQuery, setQuery: setRailQuery, filter: railFilter, setFilter: setRailFilter, onSelect: chooseSegment, onConfirmAll: confirmAllTranslated, busy, qa }) : null,
          h(
            'div',
            { className: `cait-main${doc ? '' : ' cait-main-empty'}` },
            doc
              ? h(EditorPane, {
                  t,
                  doc,
                  index,
                  segment,
                  detail,
                  draft,
                  setDraft: (value) => {
                    setDraft(value)
                    setDirty(true)
                  },
                  dirty,
                  busy,
                  onConfirm: confirmSegment,
                  onNext: () => moveSegment(1),
                  onPrev: () => moveSegment(-1),
                  onSave: () => saveDraft(false),
                  onAdopt: adoptSuggestion,
                  onApplyTerm: applyTerm,
                  textareaRef,
                })
              : h(EmptyState, { t, settings, busy, onCreate: createFromForm, onDemo: loadDemo }),
            doc
              ? h(CatPanel, {
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
                  onApplyTm: applyTm,
                  onEditTm: editTm,
                  onDeleteTm: deleteTm,
                  onImportTmx: importTmxFile,
                  onClearTm: clearTm,
                  onAddTerm: addTerm,
                  onDeleteTerm: deleteTerm,
                  onApplyTerm: applyTerm,
                  onImportGlossary: importGlossaryFile,
                  onClearGlossary: clearGlossary,
                  mt,
                  mtError,
                  mtBusy,
                  onGenerateMt: generateMt,
                  onApplyMt: () => {
                    if (mt?.text) {
                      setDraft(mt.text)
                      setDirty(true)
                      setTimeout(() => textareaRef.current?.focus(), 0)
                    }
                  },
                  onCopy: copy,
                  onOpenSettings: () => setModal({ type: 'settings' }),
                  onOpenLibraries: () => setModal({ type: 'libraries' }),
                  busy,
                })
              : null,
          ),
        ),
        modal?.type === 'new'
          ? h(NewDocModal, {
              t,
              settings,
              busy,
              defaultMode: modal.defaultMode,
              onClose: () => setModal(null),
              onCreate: createFromForm,
            })
          : null,
        modal?.type === 'export'
          ? h(ExportModal, { t, busy, qa, onClose: () => setModal(null), onExport: exportAs })
          : null,
        modal?.type === 'settings'
          ? h(SettingsModal, { t, settings, mtRoutes, busy, onClose: () => setModal(null), onSave: saveSettings })
          : null,
        modal?.type === 'libraries'
          ? h(LibrariesModal, {
              t,
              data,
              busy,
              onClose: () => setModal(null),
              onSetMounts: setMounts,
              onCreate: createLibrary,
              onRename: renameLibrary,
              onDeleteLibrary: deleteLibrary,
            })
          : null,
        modal?.type === 'recent'
          ? h(RecentDocsModal, {
              t,
              documents: closedDocuments,
              busy,
              onClose: () => setModal(null),
              onDelete: deleteClosedDocument,
              onClear: clearClosedDocuments,
            })
          : null,
        modal?.type === 'confirm'
          ? h(ConfirmModal, { t, state: modal, busy, onClose: () => setModal(null), onConfirm: runConfirm })
          : null,
        toast ? h(Toast, { toast }) : null,
      )
    }
