import { h, useState, useEffect, useRef } from '../react.js'
import { LANGUAGES } from '../helpers.js'
import { formatBytes, stripExtension } from '../rpc.js'
import { Spinner, Icon, Modal } from './base.js'

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
      h(
        'button',
        {
          type: 'button',
          className: mode === 'text' ? 'active' : '',
          onClick: () => setMode('text'),
        },
        t('empty.paste'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: mode === 'file' ? 'active' : '',
          onClick: () => setMode('file'),
        },
        t('empty.file'),
      ),
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
          {
            className: 'cait-input',
            value: sourceLang,
            onChange: (event) => setSourceLang(event.target.value),
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
            value: targetLang,
            onChange: (event) => setTargetLang(event.target.value),
          },
          LANGUAGES.map(([code, label]) =>
            h('option', { key: code, value: code }, `${label} (${code})`),
          ),
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
            accept:
              '.txt,.md,.markdown,.tmx,.docx,.epub,.csv,.srt,.vtt,.po,.pot,.xliff,.xlf,.sdlxliff,.html,.htm,.json,.rtf,.xlsx,.pptx,.strings,.stringsdict,.resx,.arb,.yaml,.yml,.properties',
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
        {
          className: 'cait-btn cait-btn-primary',
          type: 'submit',
          disabled: Boolean(busy) || !canSubmit,
        },
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
    h(DocumentSourceForm, {
      t,
      settings,
      busy,
      submitLabel: t('modal.new.create'),
      onSubmit: onCreate,
      defaultMode,
    }),
    h(
      'div',
      { className: 'cait-demo-row' },
      h('span', null, t('modal.new.sample')),
      h(
        'button',
        {
          className: 'cait-linkbtn',
          onClick: () => onCreate({ demo: true }),
          disabled: Boolean(busy),
        },
        t('modal.new.demo'),
      ),
    ),
  )
}

/**
 * The library workspace: browse, search, page through, edit and export the
 * translation memories and glossaries themselves. It deliberately does not
 * need an open document — the rail and the right panel stay document-scoped
 * and this page is the only place that manages whole libraries.
 */

export { DocumentSourceForm, NewDocModal }
