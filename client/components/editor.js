import { h, useState, useEffect } from '../react.js'
import { Spinner, Icon, highlightSource } from './base.js'

function EditorPane({
  t,
  doc,
  index,
  segment,
  detail,
  draft,
  setDraft,
  dirty,
  busy,
  onConfirm,
  onUnconfirm,
  onNext,
  onPrev,
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleLock,
  onMerge,
  onSplit,
  onMergeCue,
  onSplitCue,
  onShiftSubtitles,
  onAdopt,
  onApplyTerm,
  onOpenBrief,
  onOpenResources,
  onOpenAnalysis,
  onOpenNotes,
  noteCount,
  qaRisk,
  textareaRef,
}) {
  const hits = detail?.index === index ? detail.glossaryHits : []
  const charCount = Array.from(draft || '').length
  const isSubtitle = doc.format === 'srt' || doc.format === 'vtt'
  const [shiftSeconds, setShiftSeconds] = useState('1')
  const cueStart = Number(segment.meta?.start)
  const cueEnd = Number(segment.meta?.end)
  const formatCue = (value) => {
    if (!Number.isFinite(value)) return '--:--.-'
    const total = Math.max(0, Math.round(value))
    const minutes = Math.floor(total / 60000)
    const seconds = Math.floor((total % 60000) / 1000)
    const millis = total % 1000
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
  }
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
  const canMerge = !segment.locked && index < doc.segments.length - 1
  const canSplit = !segment.locked && String(segment.source || '').length > 1
  const splitAtCursor = () => {
    const sourceLength = String(segment.source || '').length
    const targetLength = String(draft || '').length
    const cursor = textareaRef?.current?.selectionStart
    const ratio = targetLength > 0 && Number.isInteger(cursor) ? cursor / targetLength : 0.5
    const at = Math.max(1, Math.min(sourceLength - 1, Math.round(sourceLength * ratio)))
    onSplit(at)
  }

  const onKeyDown = (event) => {
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'z') {
      if (canUndo || canRedo) {
        event.preventDefault()
        if (event.shiftKey) onRedo()
        else onUndo()
      }
    } else if (mod && event.key.toLowerCase() === 'y') {
      if (canRedo) {
        event.preventDefault()
        onRedo()
      }
    } else if (mod && event.key === 'Enter') {
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
          h(
            'button',
            {
              className: 'cait-linkbtn cait-brieflink',
              onClick: onOpenBrief,
              title: doc.brief ? t('panel.briefHint') : t('brief.empty'),
            },
            h(Icon, { name: 'file', size: 11 }),
            t('editor.brief'),
            doc.brief ? h('span', { className: 'cait-briefdot' }) : null,
          ),
          h(
            'button',
            {
              className: 'cait-linkbtn',
              onClick: onOpenResources,
              title: t('resources.hint'),
            },
            h(Icon, { name: 'database', size: 11 }),
            t('editor.resources'),
          ),
          h(
            'button',
            {
              className: 'cait-linkbtn',
              onClick: onOpenAnalysis,
              title: t('analysis.hint'),
            },
            h(Icon, { name: 'chart', size: 11 }),
            t('editor.analysis'),
          ),
        ),
      ),
      h(
        'div',
        { className: 'cait-progress-box' },
        h('span', { className: 'cait-pct' }, `${progress.percent}%`),
        h(
          'div',
          { className: 'cait-progress' },
          h('i', { style: { width: `${progress.percent}%` } }),
        ),
        h(
          'span',
          { className: 'cait-meta' },
          `${progress.confirmed}/${progress.total} ${t('progress.confirmed')}`,
        ),
      ),
    ),
    h(
      'div',
      { className: 'cait-seg-head' },
      h(
        'span',
        { className: 'cait-seg-label' },
        `${t('editor.segment')} ${index + 1} / ${doc.segments.length}`,
      ),
      h(
        'span',
        { className: 'cait-seg-flags' },
        h(
          'button',
          {
            className: `cait-linkbtn ${segment.locked ? 'active' : ''}`,
            onClick: onToggleLock,
            title: segment.locked ? t('editor.unlock') : t('editor.lock'),
            'aria-pressed': Boolean(segment.locked),
          },
          h(Icon, { name: segment.locked ? 'unlock' : 'lock', size: 11 }),
          segment.locked ? t('editor.locked') : t('editor.lock'),
        ),
        h(
          'button',
          {
            className: 'cait-linkbtn cait-notelink',
            onClick: onOpenNotes,
            title: t('notes.hint'),
          },
          h(Icon, { name: 'message', size: 11 }),
          t('editor.notes'),
          noteCount ? h('span', { className: 'cait-notecount' }, String(noteCount)) : null,
        ),
        qaRisk
          ? h(
              'span',
              {
                className: `cait-riskchip ${qaRisk.risk}`,
                title: qaRisk.codes.map((code) => t(`qa.code.${code}`)).join(' · '),
              },
              `${t('qa.risk')} · ${t(`qa.${qaRisk.risk}`)}`,
            )
          : null,
        h('span', { className: `cait-badge ${segment.status}` }, statusLabel),
      ),
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
            ? h(
                'span',
                { className: `cait-originchip ${baselineOrigin}` },
                t(`origin.${baselineOrigin}`),
              )
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
        h(
          'div',
          { className: 'cait-rev-hint' },
          segment.suggestion ? t('editor.adoptHint') : t('editor.baselineHint'),
        ),
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
          readOnly: Boolean(segment.locked),
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
        {
          className: 'cait-btn cait-btn-primary',
          onClick: onConfirm,
          disabled: Boolean(busy) || Boolean(segment.locked) || !draft.trim(),
        },
        busy === 'confirm' ? h(Spinner) : h(Icon, { name: 'check', size: 14 }),
        segment.status === 'confirmed' ? t('editor.update') : t('editor.confirm'),
      ),
      segment.status === 'confirmed'
        ? h(
            'button',
            {
              className: 'cait-btn cait-btn-ghost',
              onClick: onUnconfirm,
              disabled: Boolean(busy) || Boolean(segment.locked),
              title: t('editor.unconfirmHint'),
            },
            h(Icon, { name: 'refresh', size: 13 }),
            t('editor.unconfirm'),
          )
        : null,
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
      isSubtitle
        ? h(
            'div',
            { className: 'cait-subbar' },
            h(
              'span',
              { className: 'cait-subtime' },
              `${formatCue(cueStart)} → ${formatCue(cueEnd)}`,
            ),
            h('input', {
              className: 'cait-suboffset',
              type: 'number',
              step: '0.1',
              value: shiftSeconds,
              onChange: (event) => setShiftSeconds(event.target.value),
              title: t('editor.shiftHint'),
            }),
            h(
              'button',
              {
                className: 'cait-btn cait-btn-ghost',
                onClick: () => onShiftSubtitles(Math.round(Number(shiftSeconds) * 1000)),
                disabled:
                  Boolean(busy) ||
                  Boolean(segment.locked) ||
                  !Number.isFinite(Number(shiftSeconds)),
              },
              t('editor.shift'),
            ),
            h(
              'button',
              {
                className: 'cait-btn cait-btn-ghost',
                onClick: onMergeCue,
                disabled:
                  Boolean(busy) || Boolean(segment.locked) || index >= doc.segments.length - 1,
              },
              t('editor.mergeCue'),
            ),
            h(
              'button',
              {
                className: 'cait-btn cait-btn-ghost',
                onClick: () => onSplitCue(Math.round((cueStart + cueEnd) / 2)),
                disabled: Boolean(busy) || Boolean(segment.locked) || !(cueEnd > cueStart),
              },
              t('editor.splitCue'),
            ),
          )
        : [
            h(
              'button',
              {
                key: 'merge',
                className: 'cait-btn cait-btn-ghost',
                onClick: onMerge,
                disabled: Boolean(busy) || !canMerge,
                title: t('editor.mergeHint'),
              },
              t('editor.merge'),
            ),
            h(
              'button',
              {
                key: 'split',
                className: 'cait-btn cait-btn-ghost',
                onClick: splitAtCursor,
                disabled: Boolean(busy) || !canSplit,
                title: t('editor.splitHint'),
              },
              t('editor.split'),
            ),
          ],
      h(
        'button',
        {
          className: 'cait-iconbtn',
          onClick: onUndo,
          disabled: Boolean(busy) || !canUndo,
          title: t('editor.undo'),
          'aria-label': t('editor.undo'),
        },
        '↶',
      ),
      h(
        'button',
        {
          className: 'cait-iconbtn',
          onClick: onRedo,
          disabled: Boolean(busy) || !canRedo,
          title: t('editor.redo'),
          'aria-label': t('editor.redo'),
        },
        '↷',
      ),
      h(
        'button',
        {
          className: 'cait-iconbtn cait-savebtn',
          onClick: onSave,
          disabled: Boolean(busy) || Boolean(segment.locked) || !dirty,
          title: t('editor.save'),
        },
        h(Icon, { name: 'save', size: 14 }),
      ),
      h('span', { className: 'cait-hint' }, t('editor.hint')),
    ),
    h(
      'div',
      { className: 'cait-editor-foot' },
      remaining === 0
        ? h(
            'span',
            { className: 'cait-donechip' },
            h(Icon, { name: 'check', size: 11 }),
            t('editor.done'),
          )
        : h('span', null, `${remaining} ${t('editor.remaining')}`),
      segment.confirmedAt
        ? h(
            'span',
            null,
            `${t('editor.confirmedAt')} ${new Date(segment.confirmedAt).toLocaleString()}`,
          )
        : null,
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
          {
            className: 'cait-minibtn',
            onClick: () => setEditing((current) => !current),
            disabled: Boolean(busy),
            title: t('panel.edit'),
          },
          h(Icon, { name: 'pencil', size: 11 }),
        ),
        h(
          'button',
          {
            className: 'cait-deletebtn',
            onClick: () => onDelete(match),
            disabled: Boolean(busy),
            title: t('panel.delete'),
          },
          h(Icon, { name: 'trash', size: 11 }),
        ),
      ),
    ),
    h('p', { className: 'cait-card-source' }, match.source),
    match.context
      ? h(
          'p',
          { className: 'cait-card-context' },
          `${t('panel.contextPrev')} ${match.context.prev || '—'} · ${t('panel.contextNext')} ${match.context.next || '—'}`,
        )
      : null,
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
            h(
              'button',
              {
                className: 'cait-btn cait-btn-primary',
                onClick: save,
                disabled: Boolean(busy) || !value.trim(),
              },
              t('panel.saveEntry'),
            ),
            h(
              'button',
              { className: 'cait-btn cait-btn-ghost', onClick: () => setEditing(false) },
              t('panel.cancel'),
            ),
          ),
        )
      : h('p', { className: 'cait-card-target' }, match.target),
  )
}

export { EditorPane, TmMatchCard }
