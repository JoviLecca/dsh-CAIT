import { h, useEffect } from '../react.js'
import { CAIT_UNIT_VAR } from '../helpers.js'
import { escapeRegExp } from '../rpc.js'

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
    chevronRight: ['M6 3l5 5-5 5'],
    chevronLeft: ['M10 3L5 8l5 5'],
    chevronDown: ['M3 6l5 5 5-5'],
    search: ['M7.2 12.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4Z', 'M10.9 10.9L14 14'],
    sparkles: [
      'M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3L8 2Z',
      'M13 12l.6 1.4L15 14l-1.4.6L13 16l-.6-1.4L11 14l1.4-.6L13 12Z',
    ],
    book: [
      'M2 3.5A1.5 1.5 0 0 1 3.5 2H7v12H3.5A1.5 1.5 0 0 1 2 12.5v-9Z',
      'M14 3.5A1.5 1.5 0 0 0 12.5 2H9v12h3.5a1.5 1.5 0 0 0 1.5-1.5v-9Z',
    ],
    database: [
      'M8 2c3.3 0 5.5.9 5.5 2s-2.2 2-5.5 2-5.5-.9-5.5-2S4.7 2 8 2Z',
      'M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4',
      'M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2',
    ],
    close: ['M3 3l10 10', 'M13 3L3 13'],
    trash: ['M3 4h10', 'M6 4V2.5h4V4', 'M5 4l.6 9.5h4.8L11 4'],
    copy: ['M5.5 5.5h7v8h-7z', 'M3.5 3.5h7v2'],
    file: ['M4 1.5h5L13 5v9.5H4z', 'M9 1.5V5h4'],
    refresh: ['M13 8a5 5 0 1 1-1.5-3.6', 'M13 2v3h-3'],
    arrowRight: ['M2 8h11', 'M9 4l4 4-4 4'],
    play: ['M4 2l9 6-9 6z'],
    globe: [
      'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z',
      'M2.5 8h11',
      'M8 2c2 2 2 10 0 12',
      'M8 2c-2 2-2 10 0 12',
    ],
    alert: ['M8 2L14 13H2L8 2Z', 'M8 6v3.5', 'M8 11.5v.2'],
    save: ['M3 2h8l2 2v10H3z', 'M5 2v4h6V2', 'M5 14v-4h6v4'],
    pencil: ['M11 2.5l2.5 2.5-8 8L2 14l1-3.5 8-8Z', 'M9.5 4l2.5 2.5'],
    languages: [
      'M2 4h7',
      'M5.5 4v2c0 2-1.5 4-3.5 5',
      'M4 8c0 1.5 2 3 4.5 3.5',
      'M9 13l3-7 3 7',
      'M10 11h4',
    ],
    check: ['M3 8.5l3.2 3.2L13 4.3'],
    align: ['M2 5h8', 'M2 11h5', 'M12 3v10', 'M10 11l2 2 2-2'],
    folder: ['M2 4h4l1.5 2H14v6.5H2z'],
    chart: ['M3 13V8', 'M8 13V3', 'M13 13V6', 'M2 14h12'],
    message: ['M2 3h12v8H8l-3 3v-3H2z'],
    lock: ['M4 7h8v6H4z', 'M6 7V5a2 2 0 0 1 4 0v2'],
    unlock: ['M4 7h8v6H4z', 'M6 7V5a2 2 0 0 1 3.8-1'],
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
    shape.map((d, index) =>
      h('path', {
        key: index,
        d,
        ...(name === 'play' ? { fill: 'currentColor', stroke: 'none' } : {}),
      }),
    ),
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
    h('path', {
      d: 'M6.3 5.8H15.2C17 5.8 18.4 7.2 18.4 9V14.8C18.4 16.6 17 18 15.2 18H9.3L5.9 21.6V18H6.3C4.5 18 3.1 16.6 3.1 14.8V9C3.1 7.2 4.5 5.8 6.3 5.8Z',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M5.4 16.4 9.2 8.5 13 16.4M6.8 13.4h4.8',
      stroke: 'currentColor',
      strokeWidth: 1.9,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M17.4 14.2H27.4C29 14.2 30.2 15.4 30.2 17V22.2C30.2 23.8 29 25 27.4 25H27.2L27 28.8 23.2 25H17.4C15.8 25 14.6 23.8 14.6 22.2V17C14.6 15.4 15.8 14.2 17.4 14.2Z',
      fill: 'var(--dsw-alias-bg-base, #ffffff)',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    h('circle', { cx: 23, cy: 17.2, r: 1.4, fill: 'currentColor' }),
    h('path', {
      d: 'M18.6 20.6H27.4M23 20.6l-4.2 4.2M23 20.6l4.2 4.2',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function highlightSource(text, hits) {
  const terms = [...new Set((hits || []).map((hit) => hit.term).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  if (!terms.length) return text
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return String(text)
    .split(pattern)
    .map((part, index) => {
      const hit = (hits || []).find(
        (item) => item.term.toLowerCase() === String(part).toLowerCase(),
      )
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
      {
        className: `cait-modal${wide ? ' cait-modal-wide' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
      },
      h(
        'div',
        { className: 'cait-modal-head' },
        h('h3', null, title),
        h(
          'button',
          { className: 'cait-iconbtn', onClick: onClose, 'aria-label': 'Close' },
          h(Icon, { name: 'close', size: 14 }),
        ),
      ),
      h('div', { className: 'cait-modal-body' }, children),
    ),
  )
}

function Toast({ toast }) {
  const icon = toast.kind === 'error' ? 'alert' : toast.kind === 'info' ? 'sparkles' : 'check'
  return h(
    'div',
    { className: `cait-toast cait-toast-${toast.kind || 'success'}`, role: 'status' },
    h(Icon, { name: icon, size: 14 }),
    h('span', null, toast.message),
  )
}

export { Spinner, scaledLength, Icon, CaitMark, highlightSource, Modal, Toast }
