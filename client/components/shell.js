import { h } from '../react.js'
import { Spinner, Icon, CaitMark, Modal } from './base.js'
import { DocumentSourceForm } from './forms.js'

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

function SaveBanner({ t, storage, stale, onRefresh }) {
  const error = storage?.error ? String(storage.error) : ''
  if (!error && !stale) return null
  const message = error
    ? `${t('storage.saveFailed')}${error}${stale ? ` ${t('storage.stale')}` : ''}`
    : t('storage.stale')
  return h(
    'div',
    { className: `cait-savebanner${error ? ' is-error' : ''}`, role: 'alert' },
    h(
      'span',
      { className: 'cait-savebanner-icon' },
      h(Icon, { name: error ? 'alert' : 'refresh', size: 14 }),
    ),
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
                h(
                  'small',
                  null,
                  `${doc.sourceLang} → ${doc.targetLang} · ${doc.progress.confirmed}/${doc.progress.total}`,
                ),
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
      h(
        'button',
        { className: 'cait-btn cait-btn-ghost', onClick: onClose, disabled: Boolean(busy) },
        t('modal.confirm.cancel'),
      ),
      h(
        'button',
        {
          className: 'cait-btn cait-btn-danger',
          onClick: onClear,
          disabled: Boolean(busy) || !documents.length,
        },
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
  onReplace,
  view,
  onView,
}) {
  const progress = doc?.progress || { percent: 0, confirmed: 0, total: 0 }
  const openIds = new Set((data.openDocuments || []).map((item) => item.id))
  const closedDocuments = (data.documents || []).filter((item) => !openIds.has(item.id))
  const documentsView = view === 'documents'
  const viewTabs = [
    { id: 'documents', label: t('nav.documents') },
    { id: 'libraries', label: t('nav.libraries') },
    { id: 'align', label: t('nav.align') },
  ]
  return h(
    'header',
    { className: 'cait-topbar' },
    h(
      'div',
      { className: 'cait-brand' },
      h('span', { className: 'cait-logo' }, h(CaitMark, { size: 17 })),
      h(
        'span',
        { className: 'cait-brand-text' },
        h('strong', null, 'CAIT'),
        h('span', null, t('app.subtitle')),
      ),
    ),
    h(
      'div',
      { className: 'cait-viewtabs' },
      viewTabs.map((tab) =>
        h(
          'button',
          {
            key: tab.id,
            type: 'button',
            className: `cait-viewtab${view === tab.id ? ' active' : ''}`,
            onClick: () => onView(tab.id),
          },
          tab.label,
        ),
      ),
    ),
    documentsView
      ? h(
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
            ? h(
                'span',
                { className: 'cait-doc-progress' },
                `${progress.confirmed}/${progress.total} · ${progress.percent}%`,
              )
            : null,
        )
      : h('div', { className: 'cait-docbar' }),
    h(
      'div',
      { className: 'cait-actions' },
      documentsView && pre && pre.running
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
        : null,
      documentsView && !(pre && pre.running)
        ? h(
            'button',
            {
              className: 'cait-btn',
              onClick: onPreTranslate,
              disabled: Boolean(busy) || !doc || !(doc.progress?.total > 0),
              title: t('pretranslate.title'),
            },
            h(Icon, { name: 'sparkles', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('pretranslate.start')),
          )
        : null,
      documentsView
        ? h(
            'button',
            {
              className: 'cait-btn',
              onClick: onReplace,
              disabled: Boolean(busy) || !doc,
              title: t('replace.open'),
            },
            h(Icon, { name: 'search', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('replace.open')),
          )
        : null,
      documentsView
        ? h(
            'button',
            { className: 'cait-btn', onClick: onNew, disabled: Boolean(busy), title: t('nav.new') },
            h(Icon, { name: 'plus', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('nav.new')),
          )
        : null,
      documentsView
        ? h(
            'button',
            {
              className: 'cait-btn',
              onClick: onImport,
              disabled: Boolean(busy),
              title: t('nav.import'),
            },
            h(Icon, { name: 'download', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('nav.import')),
          )
        : null,
      documentsView
        ? h(
            'button',
            {
              className: 'cait-btn',
              onClick: onExport,
              disabled: Boolean(busy) || !doc,
              title: t('nav.export'),
            },
            h(Icon, { name: 'upload', size: 14 }),
            h('span', { className: 'cait-btn-label' }, t('nav.export')),
          )
        : null,
      h(
        'button',
        {
          className: 'cait-iconbtn',
          onClick: onSettings,
          disabled: Boolean(busy),
          title: t('nav.settings'),
        },
        h(Icon, { name: 'settings', size: 15 }),
      ),
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
        h(
          'div',
          { className: 'cait-feature' },
          h('strong', null, h(Icon, { name: 'database', size: 12 }), t('empty.features.tm')),
          h('span', null, t('empty.features.tmDesc')),
        ),
        h(
          'div',
          { className: 'cait-feature' },
          h('strong', null, h(Icon, { name: 'book', size: 12 }), t('empty.features.glossary')),
          h('span', null, t('empty.features.glossaryDesc')),
        ),
        h(
          'div',
          { className: 'cait-feature' },
          h('strong', null, h(Icon, { name: 'sparkles', size: 12 }), t('empty.features.mt')),
          h('span', null, t('empty.features.mtDesc')),
        ),
      ),
      h(DocumentSourceForm, {
        t,
        settings,
        busy,
        submitLabel: t('empty.create'),
        onSubmit: onCreate,
      }),
      h(
        'div',
        { className: 'cait-demo-row' },
        h('span', null, t('empty.demoHint')),
        h(
          'button',
          { className: 'cait-linkbtn', onClick: onDemo, disabled: Boolean(busy) },
          t('empty.demo'),
        ),
      ),
    ),
  )
}

export {
  CaitSidebarIcon,
  SaveBanner,
  DocTabs,
  ClosedDocPicker,
  RecentDocsModal,
  Topbar,
  EmptyState,
}
