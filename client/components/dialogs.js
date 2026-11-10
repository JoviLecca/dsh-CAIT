import { h, useState, useEffect, useRef } from '../react.js'
import { LANGUAGES, DEFAULT_FUZZY_THRESHOLD, fuzzyPercent } from '../helpers.js'
import { UI_LANGS } from '../locales.js'
import { Spinner, Icon, Modal } from './base.js'

function ExportModal({ t, busy, onClose, onExport, onImportReview, qa }) {
  const issues = qa?.issueCount || 0
  const items = [
    ['bilingual-md', t('modal.export.bilingualMd'), t('modal.export.bilingual'), 'file'],
    ['bilingual-csv', t('modal.export.bilingualCsv'), t('modal.export.bilingual'), 'file'],
    ['tmx', t('modal.export.tmx'), t('modal.export.bilingual'), 'database'],
    ['target-txt', t('modal.export.targetTxt'), t('modal.export.target'), 'download'],
    ['target-md', t('modal.export.targetMd'), t('modal.export.target'), 'download'],
    ['docx', t('modal.export.docx'), t('modal.export.docxGroup'), 'file'],
    ['bilingual-docx', t('modal.export.bilingualDocx'), t('modal.export.bilingual'), 'file'],
    ['epub', t('modal.export.epub'), t('modal.export.epubGroup'), 'file'],
    ['srt', t('modal.export.srt'), t('modal.export.subtitleGroup'), 'file'],
    ['vtt', t('modal.export.vtt'), t('modal.export.subtitleGroup'), 'file'],
    ['po', t('modal.export.po'), t('modal.export.localizationGroup'), 'file'],
    ['apple-strings', t('modal.export.appleStrings'), t('modal.export.localizationGroup'), 'file'],
    [
      'apple-stringsdict',
      t('modal.export.appleStringsdict'),
      t('modal.export.localizationGroup'),
      'file',
    ],
    ['android', t('modal.export.android'), t('modal.export.localizationGroup'), 'file'],
    ['resx', t('modal.export.resx'), t('modal.export.localizationGroup'), 'file'],
    ['arb', t('modal.export.arb'), t('modal.export.localizationGroup'), 'file'],
    ['yaml', t('modal.export.yaml'), t('modal.export.localizationGroup'), 'file'],
    ['properties', t('modal.export.properties'), t('modal.export.localizationGroup'), 'file'],
    ['xliff', t('modal.export.xliff'), t('modal.export.localizationGroup'), 'file'],
    ['xliff-review', t('modal.export.xliffReview'), t('modal.export.localizationGroup'), 'file'],
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
            `${t('qa.exportBanner', { count: issues })} `,
            t('qa.counts', {
              placeholder: qa.counts.PLACEHOLDER_MISSING,
              number: qa.counts.NUMBER_MISMATCH,
              term: qa.counts.TERM_NOT_USED,
              empty: qa.counts.EMPTY_TARGET,
            }),
          ),
        )
      : null,
    h(
      'div',
      { className: 'cait-export-grid' },
      items.map(([format, label, group, icon]) =>
        h(
          'button',
          {
            key: format,
            className: 'cait-export-item',
            onClick: () => onExport(format),
            disabled: Boolean(busy),
          },
          h(Icon, { name: icon, size: 15 }),
          h('span', null, h('strong', null, label), h('small', null, group)),
        ),
      ),
    ),
    onImportReview
      ? h(
          'div',
          { className: 'cait-review-import' },
          h('p', { className: 'cait-libnote' }, t('modal.export.reviewImportHint')),
          h(
            'label',
            { className: 'cait-btn' },
            h(Icon, { name: 'upload', size: 13 }),
            t('modal.export.reviewImport'),
            h('input', {
              type: 'file',
              accept: '.xliff,.xlf,application/x-xliff+xml',
              style: { display: 'none' },
              disabled: Boolean(busy),
              onChange: (event) => {
                const file = event.target.files?.[0]
                if (file) onImportReview(file)
                event.target.value = ''
              },
            }),
          ),
        )
      : null,
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
    review: {
      provider: settings.review?.provider || '',
      model: settings.review?.model || '',
      temperature: settings.review?.temperature ?? 0,
    },
  })
  const routes = Array.isArray(mtRoutes?.providers) ? mtRoutes.providers : []
  const route = routes.find((item) => item.id === form.mt.provider)
  const models = Array.isArray(route?.models) ? route.models : []
  const routeMissing = form.mt.provider !== 'mock' && !route
  const reviewRoute = routes.find((item) => item.id === form.review.provider)
  const reviewModels = Array.isArray(reviewRoute?.models) ? reviewRoute.models : []
  const reviewInherited = !form.review.provider

  const setMt = (patch) => setForm((current) => ({ ...current, mt: { ...current.mt, ...patch } }))
  const setReview = (patch) =>
    setForm((current) => ({ ...current, review: { ...current.review, ...patch } }))
  const setPre = (patch) =>
    setForm((current) => ({ ...current, preprocess: { ...current.preprocess, ...patch } }))
  const selectProvider = (provider) => {
    const nextRoute = routes.find((item) => item.id === provider)
    setForm((current) => ({
      ...current,
      mt: {
        ...current.mt,
        provider,
        model: provider === 'mock' ? 'cait-mock' : nextRoute?.models?.[0]?.id || '',
      },
    }))
  }

  const selectReviewProvider = (provider) => {
    const nextRoute = routes.find((item) => item.id === provider)
    setForm((current) => ({
      ...current,
      review: {
        ...current.review,
        provider,
        model: nextRoute?.models?.[0]?.id || '',
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
      review: {
        provider: form.review.provider,
        model: form.review.model,
        temperature: Number(form.review.temperature),
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
              {
                className: 'cait-input',
                value: form.sourceLang,
                onChange: (event) => setForm({ ...form, sourceLang: event.target.value }),
              },
              LANGUAGES.map(([code, label]) =>
                h('option', { key: code, value: code }, `${label} (${code})`),
              ),
            ),
          ),
          h(
            'label',
            { className: 'cait-field' },
            h('span', null, t('modal.new.targetLang')),
            h(
              'select',
              {
                className: 'cait-input',
                value: form.targetLang,
                onChange: (event) => setForm({ ...form, targetLang: event.target.value }),
              },
              LANGUAGES.map(([code, label]) =>
                h('option', { key: code, value: code }, `${label} (${code})`),
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { className: 'cait-settings-section' },
        h('h4', { className: 'cait-settings-title' }, t('modal.settings.preprocess')),
        h(
          'p',
          { className: 'cait-mt-hint', style: { marginTop: 0 } },
          t('modal.settings.preprocessHint'),
        ),
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
          'div',
          { className: 'cait-field' },
          h(
            'div',
            { className: 'cait-fieldhead' },
            h('span', null, `${t('modal.settings.fuzzy')} · ${fuzzyPercent(form.fuzzyThreshold)}%`),
            // Offered only while the slider is away from the default, so the
            // control never takes space in the usual case.
            fuzzyPercent(form.fuzzyThreshold) === fuzzyPercent(DEFAULT_FUZZY_THRESHOLD)
              ? null
              : h(
                  'button',
                  {
                    className: 'cait-linkbtn cait-fieldreset',
                    type: 'button',
                    onClick: () => setForm({ ...form, fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD }),
                  },
                  t('modal.settings.resetDefault'),
                ),
          ),
          h('input', {
            className: 'cait-range',
            type: 'range',
            min: 0.3,
            max: 1,
            step: 0.05,
            value: form.fuzzyThreshold,
            onChange: (event) => setForm({ ...form, fuzzyThreshold: event.target.value }),
          }),
          h('p', { className: 'cait-fieldhint' }, t('modal.settings.fuzzyHint')),
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
        h(
          'p',
          { className: 'cait-mt-hint', style: { marginTop: 0 } },
          t('modal.settings.routeHint'),
        ),
        routes.length === 0 || mtRoutes?.fallback
          ? h('p', { className: 'cait-mt-hint' }, mtRoutes?.message || t('modal.settings.noRoutes'))
          : null,
        form.mt.provider === 'mock'
          ? h(
              'p',
              { className: 'cait-mt-hint', style: { marginTop: 0, marginBottom: 9 } },
              t('modal.settings.mockHint'),
            )
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
                        h(
                          'option',
                          { key: model.id, value: model.id },
                          `${model.name} (${model.id})`,
                        ),
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
        { className: 'cait-settings-section' },
        h('h4', { className: 'cait-settings-title' }, t('modal.settings.review')),
        h(
          'label',
          { className: 'cait-checkline' },
          h('input', {
            type: 'checkbox',
            checked: reviewInherited,
            onChange: (event) => {
              if (event.target.checked) {
                setForm((current) => ({
                  ...current,
                  review: { ...current.review, provider: '', model: '' },
                }))
                return
              }
              const first =
                routes.find((item) => item.id !== 'mock' && item.hasModels !== false) || routes[0]
              setForm((current) => ({
                ...current,
                review: {
                  ...current.review,
                  provider: first?.id || '',
                  model: first?.models?.[0]?.id || '',
                },
              }))
            },
          }),
          t('modal.settings.reviewInherit'),
        ),
        h(
          'p',
          { className: 'cait-mt-hint', style: { marginTop: 0 } },
          t('modal.settings.reviewHint'),
        ),
        reviewInherited
          ? null
          : h(
              'div',
              { className: 'cait-grid2' },
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('modal.settings.reviewProvider')),
                h(
                  'select',
                  {
                    className: 'cait-input',
                    value: form.review.provider,
                    onChange: (event) => selectReviewProvider(event.target.value),
                  },
                  routes.map((item) =>
                    h(
                      'option',
                      { key: item.id, value: item.id, disabled: item.hasModels === false },
                      item.hasModels === false
                        ? `${item.name} (${item.id}) - ${t('modal.settings.noModels')}`
                        : `${item.name} (${item.id})`,
                    ),
                  ),
                  form.review.provider && !reviewRoute
                    ? h('option', { value: form.review.provider }, t('modal.settings.routeMissing'))
                    : null,
                ),
              ),
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('modal.settings.model')),
                reviewModels.length
                  ? h(
                      'select',
                      {
                        className: 'cait-input',
                        value: form.review.model,
                        onChange: (event) => setReview({ model: event.target.value }),
                      },
                      reviewModels.map((model) =>
                        h(
                          'option',
                          { key: model.id, value: model.id },
                          `${model.name} (${model.id})`,
                        ),
                      ),
                    )
                  : h('input', {
                      className: 'cait-input',
                      value: form.review.model,
                      readOnly: true,
                      placeholder: t('modal.settings.noModels'),
                    }),
              ),
            ),
        h(
          'p',
          { className: 'cait-mt-hint', style: { marginTop: 0 } },
          reviewInherited
            ? t('modal.settings.reviewInheritedHint')
            : t('modal.settings.reviewCustomHint'),
        ),
      ),
      h(
        'div',
        { className: 'cait-modal-actions' },
        h(
          'button',
          { type: 'button', className: 'cait-btn cait-btn-ghost', onClick: onClose },
          t('modal.settings.cancel'),
        ),
        h(
          'button',
          { type: 'submit', className: 'cait-btn cait-btn-primary', disabled: Boolean(busy) },
          busy === 'settings' ? h(Spinner) : null,
          t('modal.settings.save'),
        ),
      ),
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
      h(
        'button',
        { className: 'cait-btn cait-btn-ghost', onClick: onClose, disabled: Boolean(busy) },
        t('modal.confirm.cancel'),
      ),
      h(
        'button',
        { className: 'cait-btn cait-btn-danger', onClick: onConfirm, disabled: Boolean(busy) },
        busy ? h(Spinner) : null,
        state.confirmLabel || t('modal.confirm.ok'),
      ),
    ),
  )
}

function BriefModal({ t, doc, busy, onClose, onSave }) {
  const initial = doc.brief || {}
  const [form, setForm] = useState({
    domain: initial.domain || '',
    audience: initial.audience || '',
    tone: initial.tone || '',
    notes: initial.notes || '',
    doNotTranslate: initial.doNotTranslate || '',
    styleSample: initial.styleSample || '',
  })
  const field = (key, label, placeholder, rows) =>
    h(
      'label',
      { className: 'cait-field' },
      h('span', null, t(label)),
      rows
        ? h('textarea', {
            className: 'cait-textarea',
            rows,
            value: form[key],
            placeholder: t(placeholder),
            onChange: (event) => setForm({ ...form, [key]: event.target.value }),
          })
        : h('input', {
            className: 'cait-input',
            value: form[key],
            placeholder: t(placeholder),
            onChange: (event) => setForm({ ...form, [key]: event.target.value }),
          }),
    )
  return h(
    Modal,
    { title: t('brief.title'), onClose, wide: true },
    h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('brief.hint')),
    h(
      'div',
      { className: 'cait-briefform' },
      h(
        'div',
        { className: 'cait-grid2' },
        field('domain', 'brief.domain', 'brief.placeholder.domain'),
        field('audience', 'brief.audience', 'brief.placeholder.audience'),
      ),
      field('tone', 'brief.tone', 'brief.placeholder.tone'),
      field('notes', 'brief.notes', 'brief.placeholder.notes', 3),
      field('doNotTranslate', 'brief.doNotTranslate', 'brief.placeholder.doNotTranslate', 3),
      field('styleSample', 'brief.styleSample', 'brief.placeholder.styleSample', 4),
    ),
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
          className: 'cait-btn cait-btn-primary',
          onClick: () => onSave(form),
          disabled: Boolean(busy),
        },
        busy ? h(Spinner) : null,
        t('brief.save'),
      ),
    ),
  )
}

function NoteModal({ t, index, segment, notes, busy, onAdd, onUpdate, onDelete, onClose }) {
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingText, setEditingText] = useState('')
  const list = Array.isArray(notes) ? notes : []
  const submit = () => {
    const value = text.trim()
    if (!value || busy) return
    onAdd(value)
    setText('')
  }
  return h(
    Modal,
    { title: `${t('notes.title')} · #${index + 1}`, onClose, wide: true },
    h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('notes.hint')),
    h('div', { className: 'cait-notelist' }, segment?.source || ''),
    list.length
      ? h(
          'div',
          { className: 'cait-notelist' },
          list.map((note) =>
            h(
              'div',
              { className: 'cait-noteitem', key: note.id },
              h(
                'div',
                { className: 'cait-notehead' },
                h(
                  'span',
                  { className: 'cait-noteauthor' },
                  note.author === 'agent' ? 'Agent' : t('notes.user'),
                ),
                h(
                  'span',
                  { className: 'cait-notetime' },
                  String(note.createdAt || '')
                    .replace('T', ' ')
                    .slice(0, 16),
                ),
              ),
              editingId === note.id
                ? h(
                    'div',
                    null,
                    h('textarea', {
                      className: 'cait-input cait-textarea',
                      value: editingText,
                      rows: 3,
                      onChange: (event) => setEditingText(event.target.value),
                    }),
                    h(
                      'div',
                      { className: 'cait-noteactions' },
                      h(
                        'button',
                        { className: 'cait-btn cait-btn-ghost', onClick: () => setEditingId('') },
                        t('notes.cancel'),
                      ),
                      h(
                        'button',
                        {
                          className: 'cait-btn cait-btn-primary',
                          disabled: Boolean(busy) || !editingText.trim(),
                          onClick: () => {
                            onUpdate(note.id, editingText)
                            setEditingId('')
                          },
                        },
                        t('notes.save'),
                      ),
                    ),
                  )
                : h(
                    'div',
                    null,
                    h('div', { className: 'cait-notetext' }, note.text),
                    h(
                      'div',
                      { className: 'cait-noteactions' },
                      h(
                        'button',
                        {
                          className: 'cait-minibtn',
                          onClick: () => {
                            setEditingId(note.id)
                            setEditingText(note.text)
                          },
                        },
                        t('notes.edit'),
                      ),
                      h(
                        'button',
                        { className: 'cait-minibtn cait-danger', onClick: () => onDelete(note.id) },
                        t('notes.delete'),
                      ),
                    ),
                  ),
            ),
          ),
        )
      : h('p', { className: 'cait-mt-hint' }, t('notes.empty')),
    h(
      'div',
      { className: 'cait-noteadd' },
      h('textarea', {
        className: 'cait-input cait-textarea',
        value: text,
        rows: 3,
        placeholder: t('notes.placeholder'),
        onChange: (event) => setText(event.target.value),
      }),
      h(
        'div',
        { className: 'cait-noteactions' },
        h(
          'button',
          {
            className: 'cait-btn cait-btn-primary',
            disabled: Boolean(busy) || !text.trim(),
            onClick: submit,
          },
          busy ? h(Spinner) : null,
          t('notes.add'),
        ),
      ),
    ),
  )
}

function ReplaceModal({ t, busy, preview, undoCount, onPreview, onApply, onUndo, onClose }) {
  const queryRef = useRef(null)
  const [form, setForm] = useState({
    query: '',
    replacement: '',
    scope: 'target',
    matchCase: false,
    regex: false,
  })
  useEffect(() => {
    if (queryRef.current) queryRef.current.focus()
  }, [])
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  return h(
    Modal,
    { title: t('replace.title'), onClose, wide: true },
    h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('replace.hint')),
    h(
      'div',
      { className: 'cait-replaceform' },
      h(
        'label',
        { className: 'cait-field' },
        h('span', null, t('replace.query')),
        h('input', {
          ref: queryRef,
          className: 'cait-input',
          value: form.query,
          placeholder: t('replace.queryPlaceholder'),
          onChange: (event) => set('query', event.target.value),
        }),
      ),
      h(
        'label',
        { className: 'cait-field' },
        h('span', null, t('replace.replacement')),
        h('input', {
          className: 'cait-input',
          value: form.replacement,
          placeholder: t('replace.replacementPlaceholder'),
          onChange: (event) => set('replacement', event.target.value),
        }),
      ),
      h(
        'div',
        { className: 'cait-replaceoptions' },
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('replace.scope')),
          h(
            'select',
            {
              className: 'cait-input',
              value: form.scope,
              onChange: (event) => set('scope', event.target.value),
            },
            h('option', { value: 'target' }, t('replace.scope.target')),
            h('option', { value: 'source' }, t('replace.scope.source')),
            h('option', { value: 'both' }, t('replace.scope.both')),
          ),
        ),
        h(
          'label',
          { className: 'cait-check' },
          h('input', {
            type: 'checkbox',
            checked: form.matchCase,
            onChange: (event) => set('matchCase', event.target.checked),
          }),
          t('replace.matchCase'),
        ),
        h(
          'label',
          { className: 'cait-check' },
          h('input', {
            type: 'checkbox',
            checked: form.regex,
            onChange: (event) => set('regex', event.target.checked),
          }),
          t('replace.regex'),
        ),
      ),
    ),
    preview
      ? h(
          'div',
          { className: 'cait-replaceresults' },
          h(
            'div',
            { className: 'cait-replacecounts' },
            t('replace.results', {
              count: preview.total,
              segments: preview.matchedSegments || 0,
            }),
          ),
          preview.truncated ? h('p', { className: 'cait-mt-hint' }, t('replace.truncated')) : null,
          preview.matches?.length
            ? h(
                'div',
                { className: 'cait-replacelist' },
                preview.matches.slice(0, 50).map((match, index) =>
                  h(
                    'div',
                    {
                      className: 'cait-replaceitem',
                      key: `${match.uid}-${match.field}-${index}`,
                    },
                    h(
                      'div',
                      { className: 'cait-replacehead' },
                      h('span', null, `#${match.index + 1}`),
                      h(
                        'span',
                        { className: 'cait-replacefield' },
                        t(`replace.field.${match.field}`),
                      ),
                      h('span', { className: 'cait-replacecount' }, `×${match.count}`),
                    ),
                    h('div', { className: 'cait-replacebefore' }, match.before),
                    h('div', { className: 'cait-replaceafter' }, match.after),
                  ),
                ),
              )
            : h('p', { className: 'cait-mt-hint' }, t('replace.noResults')),
        )
      : null,
    h(
      'div',
      { className: 'cait-modal-actions' },
      h(
        'button',
        { className: 'cait-btn cait-btn-ghost', onClick: onClose, disabled: Boolean(busy) },
        t('modal.confirm.cancel'),
      ),
      undoCount
        ? h(
            'button',
            { className: 'cait-btn', onClick: onUndo, disabled: Boolean(busy) },
            t('replace.undo'),
          )
        : null,
      h(
        'button',
        {
          className: 'cait-btn',
          onClick: () => onPreview(form),
          disabled: Boolean(busy) || !form.query,
        },
        t('replace.preview'),
      ),
      h(
        'button',
        {
          className: 'cait-btn cait-btn-primary',
          onClick: () => onApply(form),
          disabled: Boolean(busy) || !form.query || !preview?.total,
        },
        busy ? h(Spinner) : null,
        t('replace.apply'),
      ),
    ),
  )
}

function CommandPalette({ t, items, onClose, onRun }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])
  const needle = query.trim().toLowerCase()
  const filtered = items.filter((item) => {
    if (!needle) return true
    return `${item.title} ${item.hint || ''}`.toLowerCase().includes(needle)
  })
  useEffect(() => {
    setActive(0)
  }, [query])
  const choose = (item) => {
    if (item) onRun(item)
  }
  return h(
    Modal,
    { title: t('palette.title'), onClose, wide: true },
    h('input', {
      ref: inputRef,
      className: 'cait-input cait-palette-input',
      value: query,
      placeholder: t('palette.placeholder'),
      onChange: (event) => setQuery(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((value) => Math.min(value + 1, Math.max(0, filtered.length - 1)))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((value) => Math.max(value - 1, 0))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          choose(filtered[active])
        }
      },
    }),
    h(
      'div',
      { className: 'cait-palette-list' },
      filtered.length
        ? filtered.map((item, index) =>
            h(
              'button',
              {
                type: 'button',
                key: item.id,
                className: `cait-palette-item${index === active ? ' active' : ''}`,
                onMouseEnter: () => setActive(index),
                onClick: () => choose(item),
              },
              h('span', { className: 'cait-palette-label' }, item.title),
              item.hint ? h('span', { className: 'cait-palette-hint' }, item.hint) : null,
            ),
          )
        : h('p', { className: 'cait-mt-hint' }, t('palette.empty')),
    ),
    h('p', { className: 'cait-palette-foot' }, t('palette.footer')),
  )
}

function ResourceModal({ t, doc, libraries, mounts, busy, onClose, onSave }) {
  const resources = doc.resources || {}
  const [inheritTm, setInheritTm] = useState(resources.inheritsTm !== false)
  const [inheritGlossary, setInheritGlossary] = useState(resources.inheritsGlossary !== false)
  const [tmIds, setTmIds] = useState(
    () => new Set(resources.tmIds ?? resources.effectiveTmIds ?? []),
  )
  const [glossaryIds, setGlossaryIds] = useState(
    () => new Set(resources.glossaryIds ?? resources.effectiveGlossaryIds ?? []),
  )
  const [defaultWriteTmId, setDefaultWriteTmId] = useState(resources.defaultWriteTmId || '')

  const allTm = libraries?.tm || []
  const allGlossary = libraries?.glossary || []
  const selectedTm = inheritTm ? mounts?.tmIds || [] : Array.from(tmIds)
  const selectedGlossary = inheritGlossary ? mounts?.glossaryIds || [] : Array.from(glossaryIds)
  const tmChoices = allTm.filter((library) => selectedTm.includes(library.tmId))
  const checkedTmIds = new Set(selectedTm)
  const checkedGlossaryIds = new Set(selectedGlossary)
  const defaultTm = tmChoices.some((library) => library.tmId === defaultWriteTmId)
    ? defaultWriteTmId
    : ''

  const toggleId = (setter, id) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const librarySection = (
    label,
    all,
    idKey,
    checkedIds,
    inherit,
    setInherit,
    toggle,
    inheritLabel,
  ) =>
    h(
      'div',
      { className: 'cait-resource-section' },
      h(
        'div',
        { className: 'cait-resource-head' },
        h('strong', null, t(label)),
        h(
          'label',
          { className: 'cait-checkline' },
          h('input', {
            type: 'checkbox',
            checked: inherit,
            onChange: (event) => setInherit(event.target.checked),
          }),
          t(inheritLabel),
        ),
      ),
      h(
        'div',
        { className: 'cait-resource-list' },
        all.length === 0
          ? h('p', { className: 'cait-meta' }, t('resources.empty'))
          : all.map((library) =>
              h(
                'label',
                { key: library[idKey], className: 'cait-resource-row' },
                h('input', {
                  type: 'checkbox',
                  checked: checkedIds.has(library[idKey]),
                  disabled: inherit,
                  onChange: () => toggle(library[idKey]),
                }),
                h('span', { className: 'cait-resource-name' }, library.name),
                h('span', { className: 'cait-meta' }, library[idKey]),
              ),
            ),
      ),
    )

  return h(
    Modal,
    { title: t('resources.title'), onClose, wide: true },
    h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('resources.hint')),
    h(
      'div',
      { className: 'cait-briefform' },
      librarySection(
        'resources.tm',
        allTm,
        'tmId',
        checkedTmIds,
        inheritTm,
        setInheritTm,
        (id) => toggleId(setTmIds, id),
        'resources.inheritTm',
      ),
      librarySection(
        'resources.glossary',
        allGlossary,
        'glossaryId',
        checkedGlossaryIds,
        inheritGlossary,
        setInheritGlossary,
        (id) => toggleId(setGlossaryIds, id),
        'resources.inheritGlossary',
      ),
      h(
        'label',
        { className: 'cait-field' },
        h('span', null, t('resources.defaultWrite')),
        h(
          'select',
          {
            className: 'cait-input',
            value: defaultTm,
            onChange: (event) => setDefaultWriteTmId(event.target.value),
          },
          h(
            'option',
            { value: '' },
            t(inheritTm ? 'resources.followDefault' : 'resources.firstBound'),
          ),
          tmChoices.map((library) =>
            h('option', { key: library.tmId, value: library.tmId }, library.name),
          ),
        ),
      ),
    ),
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
          className: 'cait-btn cait-btn-primary',
          disabled: Boolean(busy),
          onClick: () =>
            onSave({
              tmIds: inheritTm ? null : Array.from(tmIds),
              glossaryIds: inheritGlossary ? null : Array.from(glossaryIds),
              defaultWriteTmId: defaultTm || null,
            }),
        },
        busy ? h(Spinner) : null,
        t('resources.save'),
      ),
    ),
  )
}

function AnalysisModal({ t, analysis, busy, onClose }) {
  const download = (format) => {
    if (!analysis) return
    const pairs = [
      ['segments', analysis.segments],
      ['words', analysis.words],
      ['characters', analysis.characters],
      ['duplicates.groups', analysis.duplicates.groups],
      ['duplicates.segments', analysis.duplicates.segments],
      ['translated', analysis.translated],
      ['confirmed', analysis.confirmed],
      ['ice', analysis.buckets.ice],
      ['exact', analysis.buckets.exact],
      ['fuzzy85', analysis.buckets.fuzzy85],
      ['fuzzy70', analysis.buckets.fuzzy70],
      ['new', analysis.buckets.new],
      ['matched.segments', analysis.matched.segments],
      ['matched.percent', analysis.matched.percent],
      ['leverage.percent', analysis.leverage.percent],
      ['generatedAt', analysis.generatedAt],
    ]
    const content =
      format === 'json'
        ? JSON.stringify(analysis, null, 2)
        : ['metric,value', ...pairs.map(([key, value]) => `${key},${value}`)].join('\n')
    const type = format === 'json' ? 'application/json' : 'text/csv'
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${analysis.name || 'document'}-analysis.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const rows = analysis
    ? [
        ['analysis.segments', analysis.segments],
        ['analysis.words', analysis.words],
        ['analysis.characters', analysis.characters],
        ['analysis.duplicates', `${analysis.duplicates.segments} / ${analysis.duplicates.groups}`],
        ['analysis.translated', analysis.translated],
        ['analysis.confirmed', analysis.confirmed],
      ]
    : []
  const buckets = analysis
    ? [
        ['analysis.ice', analysis.buckets.ice],
        ['analysis.exact', analysis.buckets.exact],
        ['analysis.fuzzy85', analysis.buckets.fuzzy85],
        ['analysis.fuzzy70', analysis.buckets.fuzzy70],
        ['analysis.new', analysis.buckets.new],
      ]
    : []

  return h(
    Modal,
    { title: t('analysis.title'), onClose, wide: true },
    h('p', { className: 'cait-mt-hint', style: { marginTop: 0 } }, t('analysis.hint')),
    busy || !analysis
      ? h('div', { className: 'cait-empty' }, h(Spinner))
      : h(
          'div',
          { className: 'cait-analysis' },
          h(
            'div',
            { className: 'cait-analysis-grid' },
            rows.map(([label, value]) =>
              h(
                'div',
                { key: label, className: 'cait-analysis-stat' },
                h('span', null, t(label)),
                h('strong', null, String(value)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'cait-analysis-grid' },
            buckets.map(([label, value]) =>
              h(
                'div',
                { key: label, className: 'cait-analysis-stat' },
                h('span', null, t(label)),
                h('strong', null, String(value)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'cait-analysis-total' },
            h('span', null, `${t('analysis.matchRate')} ${analysis.matched.percent}%`),
            h('span', null, `${t('analysis.leverage')} ${analysis.leverage.percent}%`),
          ),
        ),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h(
        'button',
        { className: 'cait-btn cait-btn-ghost', onClick: onClose, disabled: Boolean(busy) },
        t('analysis.close'),
      ),
      h(
        'button',
        {
          className: 'cait-btn cait-btn-ghost',
          onClick: () => download('csv'),
          disabled: Boolean(busy) || !analysis,
        },
        t('analysis.exportCsv'),
      ),
      h(
        'button',
        {
          className: 'cait-btn cait-btn-primary',
          onClick: () => download('json'),
          disabled: Boolean(busy) || !analysis,
        },
        t('analysis.exportJson'),
      ),
    ),
  )
}

export {
  ExportModal,
  SettingsModal,
  ConfirmModal,
  BriefModal,
  NoteModal,
  ReplaceModal,
  CommandPalette,
  ResourceModal,
  AnalysisModal,
}
