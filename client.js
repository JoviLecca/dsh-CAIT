window.__ModuleLoader__.load({
  id: 'dsh-cait',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React

    const API = '/cait/api/rpc'
    const SYNC_POLL_MS = 2000
    // One pre-translation block is 8 segments: roughly 12 s with a warm route,
    // short enough that one cancellation click never waits long.
    const PRETRANSLATE_BLOCK_SIZE = 8

    // Only the last mounted library must stay checked. An unmounted library is
    // always selectable, even when that is currently the only mounted one.
    function isMountToggleDisabled({ mounted, mountedCount, busy = false } = {}) {
      return Boolean(busy) || (Boolean(mounted) && Number(mountedCount) <= 1)
    }

    function computeNextMountIds(currentIds, id, checked) {
      const current = Array.isArray(currentIds) ? currentIds : []
      if (!checked && current.length <= 1) return null
      return checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id)
    }

    // A dirty draft wins over a remote snapshot; the banner asks the user to
    // save/refresh instead of silently replacing their text.
    function shouldAdoptRemote({ currentRevision, nextRevision, dirty = false } = {}) {
      return !dirty && Number(nextRevision) !== Number(currentRevision)
    }

    const LANGUAGES = [
      ['en', 'English'],
      ['zh-CN', '简体中文'],
      ['zh-TW', '繁體中文'],
      ['ja', '日本語'],
      ['ko', '한국어'],
      ['fr', 'Français'],
      ['de', 'Deutsch'],
      ['es', 'Español'],
      ['pt', 'Português'],
      ['ru', 'Русский'],
      ['ar', 'العربية'],
      ['it', 'Italiano'],
    ]

    // --- UI scaling ---------------------------------------------------------
    // styles.js is authored in fixed CSS pixels, which makes the workbench look
    // undersized next to the rest of DSH once the window is maximized. Every
    // length is therefore rewritten as `calc(<n>px * var(--cait-u))` and
    // --cait-u (a unitless multiplier) tracks the size of the panel.
    const CAIT_UNIT_VAR = '--cait-u'
    // The designed density is calibrated for roughly 1100×680 CSS pixels of
    // DSH panel area. Growing linearly from there made a maximized window reach
    // 1.8×, which is visibly larger than the surrounding DSH chrome and eats the
    // horizontal budget the three-column review view needs. Growth is therefore
    // damped and capped well below the old ceiling.
    const CAIT_UI_BASE = { width: 1100, height: 680 }
    const CAIT_UI_MIN_UNIT = 1
    const CAIT_UI_MAX_UNIT = 1.45
    // 0.6 keeps small and mid panels close to the old density while flattening
    // the large end: 1920×1080 lands at 1.353, 2560 and 4K stop at 1.45.
    const CAIT_UI_DAMPING = 0.6

    // Grow with the panel but never shrink below the designed size; the height
    // term keeps short/wide windows from becoming oversized and scroll-heavy.
    function computeCaitUnit({ width, height } = {}) {
      const w = Number(width)
      const h = Number(height)
      if (!(w > 0) || !(h > 0)) return CAIT_UI_MIN_UNIT
      const fit = Math.min(w / CAIT_UI_BASE.width, h / CAIT_UI_BASE.height)
      const grown = 1 + (fit - 1) * CAIT_UI_DAMPING
      const unit = Math.min(CAIT_UI_MAX_UNIT, Math.max(CAIT_UI_MIN_UNIT, grown))
      return Math.round(unit * 1000) / 1000
    }

    const CSS_PX_RE = /(-?(?:\d+\.?\d*|\.\d+))px/g

    function scaleCssChunk(chunk, unitVar) {
      return chunk.replace(CSS_PX_RE, (whole, value) => {
        // Hairlines stay exactly 1px so borders keep rendering crisply.
        if (Math.abs(Number(value)) <= 1) return whole
        return `calc(${value}px * var(${unitVar}, 1))`
      })
    }

    // Scale declaration values only. Media/supports/container preludes are
    // copied verbatim: var() is not allowed in a media condition and those
    // breakpoints must keep matching viewport pixels.
    function scaleCssLengths(css, unitVar = CAIT_UNIT_VAR) {
      const source = String(css ?? '')
      let output = ''
      let index = 0
      while (index < source.length) {
        const at = source.indexOf('@', index)
        if (at === -1) {
          output += scaleCssChunk(source.slice(index), unitVar)
          break
        }
        output += scaleCssChunk(source.slice(index, at), unitVar)
        let cursor = at
        let depth = 0
        while (cursor < source.length) {
          const ch = source[cursor]
          if (ch === '(') depth += 1
          else if (ch === ')') depth = Math.max(0, depth - 1)
          else if (depth === 0 && (ch === '{' || ch === ';')) break
          cursor += 1
        }
        output += source.slice(at, cursor + 1)
        index = cursor + 1
      }
      return output
    }

    // --- theme --------------------------------------------------------------
    // DSH marks the dark theme on <body>; the tokens handle every authored
    // colour, but native widgets (select popups, checkboxes, scrollbars, caret)
    // follow `color-scheme`, which tokens cannot reach. Mirror the host's theme
    // onto our own root attribute and let CSS set the scheme from it.
    const CAIT_THEME_ATTR = 'data-cait-theme'

    function detectThemeKind(doc) {
      const root = doc?.documentElement
      const body = doc?.body
      if (body?.hasAttribute?.('data-ds-dark-theme')) return 'dark'
      const explicit = root?.getAttribute?.('data-theme') || body?.getAttribute?.('data-theme')
      if (explicit === 'dark') return 'dark'
      return 'light'
    }

    // --- paging -------------------------------------------------------------
    // Both the segment rail and the library page page through server-side
    // windows, so the arithmetic lives here: one place to clamp, one place to
    // validate a typed segment number, one place to remember the page size.
    const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
    const PAGE_SIZE_DEFAULT = 50
    const PAGE_SIZE_STORAGE_KEY = 'cait:pageSize'

    function normalizePageSize(value) {
      // A missing setting arrives as null (localStorage) or undefined, and
      // Number(null) is 0, which would snap to the smallest page instead of the
      // documented default.
      if (value === null || value === undefined || value === '') return PAGE_SIZE_DEFAULT
      const size = Number(value)
      if (!Number.isFinite(size)) return PAGE_SIZE_DEFAULT
      let best = PAGE_SIZE_OPTIONS[0]
      let bestGap = Infinity
      for (const option of PAGE_SIZE_OPTIONS) {
        const gap = Math.abs(option - size)
        if (gap < bestGap) {
          best = option
          bestGap = gap
        }
      }
      return best
    }

    function readPageSize(storage) {
      try {
        return normalizePageSize(storage?.getItem?.(PAGE_SIZE_STORAGE_KEY))
      } catch {
        return PAGE_SIZE_DEFAULT
      }
    }

    function writePageSize(storage, value) {
      const size = normalizePageSize(value)
      try {
        storage?.setItem?.(PAGE_SIZE_STORAGE_KEY, String(size))
      } catch {
        // A blocked storage must not break paging; the in-memory value wins.
      }
      return size
    }

    function pageCount(total, pageSize) {
      const size = normalizePageSize(pageSize)
      const count = Number(total)
      if (!Number.isFinite(count) || count <= 0) return 1
      return Math.max(1, Math.ceil(count / size))
    }

    function clampPage(page, total, pageSize) {
      const last = pageCount(total, pageSize)
      const wanted = Number(page)
      if (!Number.isFinite(wanted)) return 1
      return Math.min(last, Math.max(1, Math.trunc(wanted)))
    }

    // Returns 1-based inclusive bounds plus the row count, so callers can print
    // "x–y of n" without repeating the arithmetic.
    function pageBounds(page, total, pageSize) {
      const size = normalizePageSize(pageSize)
      const count = Math.max(0, Number(total) || 0)
      const current = clampPage(page, count, size)
      const start = count === 0 ? 0 : (current - 1) * size + 1
      const end = Math.min(count, current * size)
      return { page: current, pageSize: size, start, end, total: count, pages: pageCount(count, size) }
    }

    // A translator types "42" meaning segment 42, so the input is 1-based; the
    // return value is the 0-based index the store uses.
    function segmentNumberToIndex(value, total) {
      const text = String(value ?? '').trim()
      if (!/^\d+$/.test(text)) return null
      const number = Number(text)
      const count = Number(total)
      if (!Number.isFinite(count) || number < 1 || number > count) return null
      return number - 1
    }

    // --- settings defaults ---------------------------------------------------
    // Below ~70% a fuzzy match usually shares little more than function words,
    // so it costs review time and saves none. The settings modal offers a reset
    // button only while the slider sits away from this value.
    const DEFAULT_FUZZY_THRESHOLD = 0.7

    function fuzzyPercent(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return Math.round(DEFAULT_FUZZY_THRESHOLD * 100)
      return Math.round(Math.min(1, Math.max(0, number)) * 100)
    }

    const CSS = `
.cait-root{--cait-u:1;position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5;color-scheme:light}
.cait-root[data-cait-theme="dark"]{color-scheme:dark}
.cait-root *{box-sizing:border-box}
.cait-root input,.cait-root textarea,.cait-root select{font:inherit;color:inherit}
.cait-root select option{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.cait-root button{font:inherit;cursor:pointer}
.cait-root button:disabled{cursor:not-allowed;opacity:.48}
.cait-root ::selection{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent)}
.cait-topbar{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);flex:0 0 auto;min-height:57px}
.cait-brand{display:flex;align-items:center;gap:9px;min-width:0;flex:0 0 auto}
.cait-logo{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary);flex:0 0 auto}
.cait-brand-text{display:flex;flex-direction:column;line-height:1.18}
.cait-brand-text strong{font-size:13px;font-weight:700;letter-spacing:.04em}
.cait-brand-text span{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.cait-docbar{display:flex;align-items:center;gap:8px;min-width:0;padding-left:12px;border-left:1px solid var(--dsw-alias-border-l1);flex:1 1 auto}
.cait-doctabs{display:flex;align-items:center;gap:3px;min-width:0;max-width:min(56vw,680px);overflow-x:auto;padding:2px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;scrollbar-width:thin}
.cait-doctab{display:flex;align-items:center;min-width:0;border-radius:6px}
.cait-doctab:hover{background:var(--dsw-alias-bg-layer-2)}
.cait-doctab.active{background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px var(--dsw-alias-border-l1) inset}
.cait-doctab-main{display:flex;align-items:center;gap:6px;min-width:0;height:26px;padding:0 3px 0 8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer}
.cait-doctab.active .cait-doctab-main{color:var(--dsw-alias-label-primary)}
.cait-doctab-name{max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cait-doctab-progress{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-doctab-close{display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:3px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);opacity:.65;cursor:pointer}
.cait-doctab-close:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);opacity:1}
.cait-doctab-new{display:flex;align-items:center;gap:3px;height:26px;padding:0 7px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;white-space:nowrap}
.cait-doctab-new:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.cait-closed-docs{min-width:0}
.cait-closed-docs .cait-doc-select{max-width:160px}
.cait-doc-clean{display:flex;align-items:center;justify-content:center;width:29px;height:29px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;flex:0 0 auto}
.cait-doc-clean:hover{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1))}
.cait-recent-list{display:flex;flex-direction:column;gap:6px;max-height:min(52vh,420px);overflow-y:auto;margin:10px 0 14px}
.cait-recent-row{display:flex;align-items:center;gap:10px;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cait-recent-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.cait-recent-meta strong{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cait-recent-meta small{font-size:10px;color:var(--dsw-alias-label-secondary)}
.cait-recent-del{color:var(--dsw-alias-label-secondary)}
.cait-recent-del:hover{color:var(--dsw-alias-state-error-primary)}
.cait-doc-select-wrap{display:flex;align-items:center;gap:6px;min-width:0}
.cait-doc-select{max-width:210px;height:29px;padding:0 24px 0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);font-size:12px;text-overflow:ellipsis}
.cait-doc-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:550}
.cait-doc-progress{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 0 auto}
.cait-pre-status{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 3px 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.cait-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:31px;padding:0 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;white-space:nowrap;transition:background .12s,border-color .12s,transform .06s}
.cait-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-border-l2)}
.cait-btn:active:not(:disabled){transform:translateY(.5px)}
.cait-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}
.cait-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,var(--dsw-alias-label-primary));border-color:var(--dsw-alias-brand-primary)}
.cait-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,var(--dsw-alias-border-l1))}
.cait-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,var(--dsw-alias-bg-layer-1))}
.cait-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.cait-btn-ghost:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary);border-color:transparent}
.cait-btn-label{display:inline}
.cait-iconbtn{display:inline-grid;place-items:center;width:29px;height:29px;padding:0;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s}
.cait-iconbtn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}
.cait-savebanner{display:flex;align-items:flex-start;gap:8px;padding:8px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);font-size:11px;line-height:1.45}
.cait-savebanner.is-error{border-bottom-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,var(--dsw-alias-bg-base))}
.cait-savebanner.is-error .cait-savebanner-icon{color:var(--dsw-alias-state-error-primary)}
.cait-savebanner-icon{display:flex;margin-top:1px;color:var(--dsw-alias-state-warn-primary)}
.cait-savebanner-text{flex:1;min-width:0;overflow-wrap:anywhere}
.cait-savebanner .cait-btn{height:24px;margin-left:8px;padding:0 8px;font-size:10.5px;flex:0 0 auto}
.cait-body{flex:1;min-height:0;display:grid;grid-template-columns:246px minmax(0,1fr);overflow:hidden}
.cait-body.cait-no-doc{grid-template-columns:minmax(0,1fr)}
.cait-rail{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 45%,var(--dsw-alias-bg-base))}
.cait-rail-head{padding:12px 12px 9px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.cait-rail-title{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:650}
.cait-count{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-mini-progress{height:3px;margin-top:9px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}
.cait-mini-progress i{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);transition:width .25s ease}
.cait-rail-search{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.cait-rail-search input{min-width:0;flex:1;height:25px;padding:0;border:0;outline:0;background:transparent;font-size:11.5px}
.cait-rail-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.cait-rail-list{flex:1;min-height:0;overflow-y:auto;padding:6px}
.cait-segitem{display:flex;gap:8px;width:100%;padding:8px 8px;border:1px solid transparent;border-radius:8px;background:transparent;text-align:left;color:var(--dsw-alias-label-primary);transition:background .1s,border-color .1s}
.cait-segitem:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.cait-segitem.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,var(--dsw-alias-border-l1))}
.cait-seg-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.cait-seg-line{display:flex;align-items:center;gap:6px}
.cait-seg-index{font-size:9.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);letter-spacing:.03em}
.cait-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}
.cait-dot.confirmed{background:var(--dsw-alias-state-success-primary)}
.cait-dot.translated{background:var(--dsw-alias-button-primary-fill)}
.cait-seg-warn{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:0 0 auto}
.cait-qa-banner{display:flex;align-items:flex-start;gap:6px;margin-bottom:10px;padding:7px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);color:var(--dsw-alias-label-primary);font-size:11px;line-height:1.5}
.cait-seg-text{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:11.5px;line-height:1.42;color:var(--dsw-alias-label-primary)}
.cait-segitem.active .cait-seg-text{font-weight:550}
.cait-seg-target{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.cait-rail-filters{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.cait-filterchip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;cursor:pointer}
.cait-filterchip:hover{background:var(--dsw-alias-bg-layer-1)}
.cait-filterchip.active{border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 10%,transparent)}
.cait-filtercount{font-variant-numeric:tabular-nums;opacity:.85}
.cait-batchbtn{display:inline-flex;align-items:center;gap:4px;height:20px;margin-top:6px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;cursor:pointer}
.cait-batchbtn:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary)}
.cait-suggest-card{display:flex;flex-direction:column;gap:5px;margin-top:10px;padding:9px 11px;border:1px dashed color-mix(in srgb,var(--dsw-alias-button-primary-fill) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 6%,transparent)}
.cait-suggest-text{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap}
.cait-suggest-empty{padding:10px 0;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-style:italic}
.cait-rev-hint{margin-top:auto;padding-top:6px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.45}
.cait-originchip{display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:9.5px;font-weight:600;letter-spacing:.02em}
.cait-main{display:grid;grid-template-columns:minmax(0,1fr) 344px;min-width:0;min-height:0;overflow:hidden}
.cait-main.cait-main-empty{grid-template-columns:minmax(0,1fr)}
.cait-editor-col{min-width:0;min-height:0;overflow-y:auto;padding:22px 26px 44px}
.cait-review{display:grid;gap:10px;grid-template-columns:minmax(0,1fr);grid-template-areas:"src" "sugg" "target";align-items:start}
.cait-revcol{min-width:0;padding:13px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.cait-rev-src{grid-area:src}
.cait-rev-sugg{grid-area:sugg;display:flex;flex-direction:column;gap:6px;border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 38%,transparent)}
.cait-rev-target{grid-area:target;display:flex;flex-direction:column;gap:6px}
.cait-rev-target .cait-textarea{min-height:150px;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-base)}
.cait-doc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
.cait-doc-title{max-width:680px;margin:0;font-size:17px;font-weight:650;line-height:1.35;letter-spacing:-.01em}
.cait-doc-meta{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.cait-langchip{display:inline-flex;align-items:center;height:17px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-layer-1);font-size:9.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.cait-progress-box{display:flex;flex-direction:column;align-items:flex-end;gap:4px;min-width:112px;flex:0 0 auto}
.cait-pct{font-size:17px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary)}
.cait-progress{width:112px;height:4px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}
.cait-progress i{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);transition:width .25s ease}
.cait-seg-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
.cait-seg-label{font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.cait-badge{display:inline-flex;align-items:center;height:21px;padding:0 8px;border-radius:999px;font-size:10px;font-weight:600;border:1px solid transparent}
.cait-badge.pending{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 11%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 25%,transparent)}
.cait-badge.confirmed{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 11%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 25%,transparent)}
.cait-badge.translated{color:var(--dsw-alias-button-primary-fill);background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 11%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 25%,transparent)}
.cait-source-card{padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.cait-labelrow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.cait-label{font-size:10px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-source-text{font-size:17px;line-height:1.65;letter-spacing:.005em;overflow-wrap:anywhere}
.cait-rev-src .cait-source-text{font-size:15px;line-height:1.6}
.cait-source-text mark{padding:0 2px;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 22%,transparent);color:inherit;box-shadow:inset 0 -1px 0 color-mix(in srgb,var(--dsw-alias-state-warn-primary) 65%,transparent)}
.cait-hitrow{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:12px}
.cait-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:3px 7px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 26%,var(--dsw-alias-border-l1));border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent);font-size:10.5px;color:var(--dsw-alias-label-primary)}
.cait-chip-action:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}
.cait-target-area{margin-top:16px}
.cait-textarea{display:block;width:100%;min-height:190px;resize:vertical;padding:14px 15px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;outline:0;background:var(--dsw-alias-bg-layer-1);font-size:15px;line-height:1.7;transition:border-color .12s,box-shadow .12s}
.cait-textarea:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1));box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.cait-textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.cait-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-actionbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:13px}
.cait-hint{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary)}
.cait-savebtn{width:31px;height:31px;border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.cait-editor-foot{display:flex;align-items:center;gap:8px;margin-top:11px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.cait-donechip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);font-size:10px;font-weight:600}
.cait-cat{display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 32%,var(--dsw-alias-bg-base))}
.cait-cat-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 13px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.cait-cat-title{font-size:12px;font-weight:650;letter-spacing:.01em}
.cait-cat-head-actions{display:flex;align-items:center;gap:8px}
.cait-libopen{height:25px;padding:0 7px;gap:4px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.cait-libopen:hover{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1))}
.cait-live-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.cait-libsection{padding:11px 0 13px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.cait-libsection:last-of-type{border-bottom:0}
.cait-libhead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.cait-librow{display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cait-libcheck{display:flex;align-items:center;gap:7px;flex:1;min-width:0;cursor:pointer}
.cait-libcheck input{width:13px;height:13px;accent-color:var(--dsw-alias-brand-primary);flex:0 0 auto}
.cait-libmeta{display:flex;flex-direction:column;gap:1px;min-width:0}
.cait-libmeta strong{font-size:11.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cait-libmeta small{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.cait-libactions{display:flex;align-items:center;gap:4px;margin-left:auto;flex:0 0 auto}
.cait-librename{height:24px;font-size:11.5px;min-width:0;flex:1}
.cait-libdefault{display:inline-flex;align-items:center;gap:4px;font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.cait-libdefault input{width:11px;height:11px;accent-color:var(--dsw-alias-brand-primary)}
.cait-libdefault:has(input:checked){color:var(--dsw-alias-brand-primary);font-weight:650}
.cait-libcreate{display:flex;align-items:center;gap:5px;margin-top:8px}
.cait-libcreate .cait-input{height:27px;min-width:0;flex:1}
.cait-libcreate .cait-btn{height:27px;padding:0 8px;font-size:10px;flex:0 0 auto}
.cait-tabs{display:flex;gap:3px;padding:7px 9px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.cait-tab{display:flex;align-items:center;justify-content:center;gap:5px;flex:1;height:29px;padding:0 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500}
.cait-tab:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.cait-tab.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,var(--dsw-alias-border-l1));color:var(--dsw-alias-brand-primary);font-weight:650}
.cait-tab .cait-count{color:inherit;opacity:.72}
.cait-tabbody{flex:1;min-height:0;overflow-y:auto;padding:11px}
.cait-search{display:flex;align-items:center;gap:5px;height:30px;padding:0 4px 0 8px;margin-bottom:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.cait-search:focus-within{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1))}
.cait-search input{min-width:0;flex:1;height:100%;padding:0;border:0;outline:0;background:transparent;font-size:11.5px}
.cait-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.cait-listhead{display:flex;align-items:center;justify-content:space-between;margin:3px 1px 7px;font-size:10px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-card{margin-bottom:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);transition:border-color .12s,background .12s}
.cait-card:hover{border-color:var(--dsw-alias-border-l2)}
.cait-card-head{display:flex;align-items:center;gap:5px;margin-bottom:7px}
.cait-tmedit{display:flex;flex-direction:column;gap:6px;margin-top:3px}
.cait-tmedit-input{min-height:64px;font-size:11.5px}
.cait-score{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:9.5px;font-weight:750;font-variant-numeric:tabular-nums}
.cait-score.exact{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);color:var(--dsw-alias-state-success-primary)}
.cait-score.context{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,transparent);color:var(--dsw-alias-state-success-primary)}
.cait-score.near_exact{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);color:var(--dsw-alias-brand-primary)}
.cait-score.high_fuzzy{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent);color:var(--dsw-alias-state-warn-primary)}
.cait-score.medium_fuzzy{background:color-mix(in srgb,var(--dsw-alias-state-idle-primary) 13%,transparent);color:var(--dsw-alias-state-idle-primary)}
.cait-score.low_fuzzy{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-secondary)}
.cait-score-label{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.cait-minibtn{margin-left:auto;height:23px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600}
.cait-minibtn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1));color:var(--dsw-alias-brand-primary)}
.cait-card-source{margin:0 0 5px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.cait-card-context{margin:0 0 5px;font-size:9.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cait-card-target{margin:0;font-size:12.5px;line-height:1.5;font-weight:500;overflow-wrap:anywhere}
.cait-tiny{font-size:10px}
.cait-muted{color:var(--dsw-alias-label-secondary)}
.cait-empty-note{padding:18px 10px;text-align:center;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.cait-panel-foot{display:flex;align-items:center;gap:5px;margin-top:10px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.cait-panel-foot .cait-btn{height:26px;padding:0 7px;font-size:10px}
.cait-subhead{display:flex;align-items:center;justify-content:space-between;margin:2px 1px 7px;font-size:10px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-term{padding:8px 9px;margin-bottom:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cait-term-main{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:11.5px}
.cait-term-main strong{font-weight:650;overflow-wrap:anywhere}
.cait-term-main span{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.cait-term-arrow{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.cait-term-actions{display:flex;align-items:center;gap:3px;margin-top:5px;justify-content:flex-end}
.cait-term-actions .cait-minibtn{margin-left:0}
.cait-deletebtn{width:22px;height:22px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-grid;place-items:center}
.cait-deletebtn:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.cait-termform{display:flex;flex-direction:column;gap:6px;padding:9px;margin-bottom:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cait-input{width:100%;height:29px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;outline:0;background:var(--dsw-alias-bg-base);font-size:11.5px}
.cait-input:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.cait-termform .cait-btn{height:27px;font-size:10.5px}
.cait-formrow{display:flex;gap:5px}
.cait-formrow .cait-input{min-width:0}
.cait-mt-head{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-bottom:9px}
.cait-mt-mode{display:inline-flex;align-items:center;height:19px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary);font-size:9.5px;font-weight:650}
.cait-mt-card{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-layer-1))}
.cait-mt-text{margin:2px 0 8px;font-size:12.5px;line-height:1.6;overflow-wrap:anywhere}
.cait-mt-actions{display:flex;gap:5px;justify-content:flex-end}
.cait-mt-error{padding:8px;margin-bottom:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,var(--dsw-alias-border-l1));border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);color:var(--dsw-alias-state-error-primary);font-size:10.5px;line-height:1.5}
.cait-mt-hint{margin-top:9px;font-size:10px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.cait-paneljump{display:flex;align-items:center;justify-content:flex-end;margin-top:1px}
.cait-empty{display:grid;place-items:center;min-height:0;overflow-y:auto;padding:34px 28px}
.cait-empty-inner{width:min(680px,100%);padding:6px 0 20px}
.cait-kicker{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,var(--dsw-alias-border-l1));border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);color:var(--dsw-alias-brand-primary);font-size:10px;font-weight:700;letter-spacing:.08em}
.cait-empty h1{margin:13px 0 7px;font-size:25px;line-height:1.24;letter-spacing:-.025em;font-weight:680}
.cait-empty .cait-lede{margin:0 0 16px;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-width:590px}
.cait-features{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-bottom:17px}
.cait-feature{padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cait-feature strong{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:650}
.cait-feature span{display:block;margin-top:2px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.cait-docform{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.cait-segmented{display:flex;gap:3px;padding:3px;margin-bottom:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base)}
.cait-segmented button{flex:1;height:27px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:550}
.cait-segmented button.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
.cait-field{display:flex;flex-direction:column;gap:4px;margin-bottom:9px}
.cait-fieldhead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.cait-fieldhead>span{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.cait-fieldreset{font-size:10px;padding:1px 0}
.cait-fieldhint{margin:0;font-size:9.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.cait-field>span{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.cait-field .cait-input,.cait-field select{height:30px}
.cait-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cait-formtext{width:100%;min-height:122px;resize:vertical;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;outline:0;background:var(--dsw-alias-bg-base);font-size:12px;line-height:1.55}
.cait-formtext:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.cait-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:112px;padding:15px;border:1.5px dashed var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);color:var(--dsw-alias-label-secondary);text-align:center;cursor:pointer;transition:border-color .12s,background .12s}
.cait-drop:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent)}
.cait-drop strong{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.cait-drop span{font-size:10px}
.cait-formfoot{display:flex;align-items:center;gap:8px;margin-top:11px}
.cait-formfoot .cait-muted{font-size:9.5px}
.cait-formfoot .cait-btn{margin-left:auto}
.cait-linkbtn{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:600;padding:3px 0}
.cait-linkbtn:hover{text-decoration:underline}
.cait-demo-row{display:flex;align-items:center;gap:8px;margin-top:11px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.cait-overlay{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:18px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);backdrop-filter:blur(2px)}
.cait-modal{width:min(530px,100%);max-height:92%;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:13px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 18px 55px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
.cait-modal-wide{width:min(620px,100%)}
.cait-modal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 11px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.cait-modal-head h3{margin:0;font-size:14px;font-weight:650}
.cait-modal-body{padding:14px 16px 16px}
.cait-modal-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;margin-top:14px}
.cait-confirm-text{margin:0;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.cait-modal-hint{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.cait-export-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}
.cait-export-item{display:flex;align-items:flex-start;gap:8px;padding:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);text-align:left;color:var(--dsw-alias-label-primary)}
.cait-export-item:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1))}
.cait-export-item span{display:flex;flex-direction:column;gap:1px;min-width:0}
.cait-export-item strong{font-size:11px;font-weight:600}
.cait-export-item small{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.cait-settings-section{padding:10px 0 3px;border-top:1px solid var(--dsw-alias-border-l1)}
.cait-settings-section:first-of-type{padding-top:0;border-top:0}
.cait-settings-title{margin:0 0 8px;font-size:10.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-checkline{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:5px}
.cait-range{width:100%;accent-color:var(--dsw-alias-brand-primary)}
.cait-center{display:flex;align-items:center;justify-content:center;gap:9px;height:100%;color:var(--dsw-alias-label-secondary);font-size:12px}
.cait-spinner{display:inline-block;width:13px;height:13px;border:1.6px solid color-mix(in srgb,currentColor 25%,transparent);border-top-color:currentColor;border-radius:50%;animation:cait-spin .7s linear infinite;flex:0 0 auto}
@keyframes cait-spin{to{transform:rotate(360deg)}}
.cait-toast{position:absolute;left:50%;bottom:20px;z-index:30;display:flex;align-items:center;gap:7px;max-width:min(520px,90%);padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);color:var(--dsw-alias-label-primary);font-size:11.5px;transform:translateX(-50%);animation:cait-toast-in .16s ease}
.cait-toast-success svg{color:var(--dsw-alias-state-success-primary)}
.cait-toast-error svg{color:var(--dsw-alias-state-error-primary)}
.cait-toast-info svg{color:var(--dsw-alias-brand-primary)}
@keyframes cait-toast-in{from{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,0)}}
.cait-errorcard{width:min(430px,100%);padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);text-align:center}
.cait-errorcard p{margin:0 0 11px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.cait-viewtabs{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);flex:0 0 auto}
.cait-viewtab{height:25px;padding:0 11px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:550;white-space:nowrap}
.cait-viewtab:hover{color:var(--dsw-alias-label-primary)}
.cait-viewtab.active{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1) inset}
.cait-rail-goto{display:flex;align-items:center;gap:5px;margin-top:8px}
.cait-goto-input{width:100%;min-width:0;height:26px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;outline:0;background:var(--dsw-alias-bg-base);font-size:11px;font-variant-numeric:tabular-nums}
.cait-goto-input:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1))}
.cait-goto-input.bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.cait-gotobtn{display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.cait-gotobtn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.cait-rail-page{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.cait-pagebtn{display:inline-grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.cait-pagebtn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.cait-pageinfo{flex:1;min-width:0;text-align:center;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cait-pagesize{height:24px;padding:0 3px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-size:10.5px;flex:0 0 auto}
.cait-libpage{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cait-libpage-head{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.cait-libtabs{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cait-libtabs-item{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:550}
.cait-libtabs-item:hover{color:var(--dsw-alias-label-primary)}
.cait-libtabs-item.active{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1) inset}
.cait-libtabs-count{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-libhint{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.cait-libpage-body{flex:1;min-height:0;display:grid;grid-template-columns:224px minmax(0,1fr) 300px;overflow:hidden}
.cait-liblist{display:flex;flex-direction:column;min-height:0;overflow-y:auto;padding:8px;gap:2px;border-right:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 45%,var(--dsw-alias-bg-base))}
.cait-liblist-head{padding:3px 5px 7px;font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-librow{display:flex;align-items:center;gap:6px;padding:5px 5px;border-radius:6px}
.cait-librow:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.cait-librow.scoped{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
.cait-libname{display:flex;align-items:center;gap:6px;min-width:0;flex:1;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:11.5px;text-align:left}
.cait-libname-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cait-libcount{font-size:9.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-libmounted{font-size:8px;color:var(--dsw-alias-brand-primary);line-height:1}
.cait-libactions{display:flex;align-items:center;gap:2px;margin-left:auto;flex:0 0 auto;opacity:.55}
.cait-librow:hover .cait-libactions{opacity:1}
.cait-libnew{display:flex;align-items:center;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.cait-libnew input{min-width:0;flex:1;height:25px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;outline:0;background:var(--dsw-alias-bg-base);font-size:11px}
.cait-libmain{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.cait-libtoolbar{display:flex;align-items:center;gap:6px;padding:9px 12px 6px;flex-wrap:wrap;flex:0 0 auto}
.cait-libsearch{display:flex;align-items:center;gap:6px;min-width:150px;flex:1;height:29px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.cait-libsearch input{min-width:0;flex:1;border:0;outline:0;background:transparent;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.cait-liblang{height:29px;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);font-size:11px;flex:0 0 auto}
.cait-libscope{display:flex;align-items:center;gap:4px;padding:0 12px 8px;flex-wrap:wrap;flex:0 0 auto}
.cait-libtable-wrap{flex:1;min-height:0;overflow:auto;padding:0 12px}
.cait-libtable{width:100%;border-collapse:collapse;table-layout:fixed}
.cait-libtable th{position:sticky;top:0;z-index:1;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);text-align:left;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-libtable td{padding:6px 8px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent);font-size:11.5px;vertical-align:top;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cait-libtable tbody tr{cursor:pointer}
.cait-libtable tbody tr:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.cait-libtable tbody tr.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
.cait-libtable td.note,.cait-libtable td.lang,.cait-libtable td.ctx{color:var(--dsw-alias-label-secondary)}
.cait-libtable td.ctx{font-size:10.5px}  
.cait-libtable th:nth-child(1),.cait-libtable td:nth-child(1){width:30%}
.cait-libtable th:nth-child(2),.cait-libtable td:nth-child(2){width:28%}
.cait-libpage-bar{border-top:1px solid var(--dsw-alias-border-l1);padding:7px 12px}
.cait-libdetail{display:flex;flex-direction:column;min-height:0;overflow-y:auto;padding:10px 12px 14px;border-left:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 45%,var(--dsw-alias-bg-base))}
.cait-libdetail-title{padding:2px 0 8px;font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-libform{display:flex;flex-direction:column;gap:4px}
.cait-libform label{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:5px}
.cait-libinput{width:100%;min-height:28px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;outline:0;background:var(--dsw-alias-bg-base);font-size:11.5px;line-height:1.5;resize:vertical}
.cait-libinput:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1))}
.cait-libcheck{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:var(--dsw-alias-label-primary)}
.cait-libnote{margin:6px 0 0;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.cait-libform-actions{display:flex;align-items:center;gap:6px;margin-top:11px}
.cait-libform-actions .cait-btn{flex:1}
.cait-batchbtn-plain{border-style:dashed}
.cait-alignpage{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding:12px 14px 14px;overflow:auto}
.cait-alignhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cait-alignhead h2{margin:0 0 3px;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.cait-alignactions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.cait-alignactions .cait-libinput{width:118px;min-height:26px;height:26px}
.cait-alignfiles{display:flex;gap:8px;flex-wrap:wrap}
.cait-alignfile{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);min-width:0;flex:1 1 300px}
.cait-alignlabel{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.cait-alignname{font-size:11.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cait-alignname.empty{color:var(--dsw-alias-label-secondary)}
.cait-alignmeta{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:0 0 auto}
.cait-alignstats{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.cait-alignstats .cait-btn{margin-left:auto}
.cait-alignwarn{color:var(--dsw-alias-state-warning-primary)}
.cait-aligntable-wrap{flex:1;min-height:0;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
.cait-aligntable td{vertical-align:top;font-size:11.5px;line-height:1.55}
.cait-aligntable tr.included{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent)}
.cait-aligntable td:first-child{width:28px}
.cait-aligntable td:nth-child(4){width:74px}
.cait-aligntable td:nth-child(5){width:86px;white-space:nowrap}
.cait-confidence{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10px;font-variant-numeric:tabular-nums;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.cait-confidence.high{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary)}
.cait-confidence.low{border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 45%,transparent);color:var(--dsw-alias-state-warning-primary)}
.cait-alignmissing{color:var(--dsw-alias-label-secondary)}
.cait-alignrow-actions{display:flex;gap:2px;justify-content:flex-end}
.cait-termpanel{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);padding:9px 10px;max-height:46vh;display:flex;flex-direction:column;gap:7px}
.cait-termpanel-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cait-termpanel-head strong{font-size:12px;color:var(--dsw-alias-label-primary)}
.cait-termpanel-actions{margin-left:auto;display:flex;gap:6px}
.cait-termlist{overflow:auto;display:flex;flex-direction:column;gap:3px}
.cait-termrow{display:flex;align-items:center;gap:7px;padding:3px 4px;border-radius:6px;font-size:11.5px}
.cait-termrow.picked{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}
.cait-termname{font-family:var(--cait-mono,ui-monospace,monospace);color:var(--dsw-alias-label-primary);min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cait-termcount{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:0 0 auto}
.cait-termtarget{flex:1;min-width:120px;min-height:24px;height:24px}
@media(max-width:1180px){.cait-main{grid-template-columns:minmax(0,1fr) 308px}.cait-body{grid-template-columns:218px minmax(0,1fr)}.cait-editor-col{padding:18px 20px 34px}.cait-actions .cait-btn-label{display:none}.cait-actions .cait-btn{padding:0 8px}.cait-libpage-body{grid-template-columns:196px minmax(0,1fr) 264px}}
@media(max-width:940px){.cait-topbar{flex-wrap:wrap}.cait-body{grid-template-columns:190px minmax(0,1fr)}.cait-main{grid-template-columns:minmax(0,1fr)}.cait-cat{border-left:0;border-top:1px solid var(--dsw-alias-border-l1);max-height:43%;min-height:210px}.cait-features{grid-template-columns:1fr}.cait-docbar{display:flex;order:3;flex:1 1 100%;padding:7px 0 0;border-left:0;border-top:1px solid var(--dsw-alias-border-l1)}}
@media(max-width:700px){.cait-body{grid-template-columns:minmax(0,1fr)}.cait-rail{display:none}.cait-editor-col{padding:14px}.cait-topbar{padding:9px 10px}.cait-export-grid{grid-template-columns:1fr}}
`

    // Every fixed pixel length scales through --cait-u; see helpers.js.
    const CSS_SCALED = scaleCssLengths(CSS, CAIT_UNIT_VAR)

    class RpcError extends Error {
      constructor(message, code) {
        super(message)
        this.name = 'RpcError'
        this.code = code
      }
    }

    async function rpc(method, params = {}) {
      let response
      try {
        response = await fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params }),
        })
      } catch (error) {
        throw new RpcError(`无法连接 CAIT 服务：${error?.message ?? error}`, 'NETWORK')
      }

      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }

      if (!response.ok || !payload?.ok) {
        const message = payload?.error?.message || `CAIT 服务返回 HTTP ${response.status}`
        throw new RpcError(message, payload?.error?.code || 'HTTP')
      }
      return payload.data
    }

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes)) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    function stripExtension(name) {
      return String(name || '').replace(/\.[^.]+$/, '')
    }

    function filePayload(file) {
      const extension = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
      if (extension === 'docx' || extension === 'xlsx' || extension === 'pptx' || extension === 'epub') {
        return file.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer)
          let binary = ''
          const chunk = 0x8000
          for (let offset = 0; offset < bytes.length; offset += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk))
          }
          return { name: file.name, base64: btoa(binary) }
        })
      }
      return file.text().then((text) => ({ name: file.name, text }))
    }

    function downloadFile(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename || 'cait-export'
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    function decodeBase64(value) {
      const binary = atob(String(value ?? ''))
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return bytes
    }

    async function copyText(value) {
      if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板。')
      await navigator.clipboard.writeText(value)
    }

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
        check: ['M3 8.5l3.2 3.2L13 4.3'],
        align: ['M2 5h8', 'M2 11h5', 'M12 3v10', 'M10 11l2 2 2-2'],
        folder: ['M2 4h4l1.5 2H14v6.5H2z'],
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
          h('span', { className: 'cait-brand-text' }, h('strong', null, 'CAIT'), h('span', null, t('app.subtitle'))),
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
                ? h('span', { className: 'cait-doc-progress' }, `${progress.confirmed}/${progress.total} · ${progress.percent}%`)
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
                { className: 'cait-btn', onClick: onNew, disabled: Boolean(busy), title: t('nav.new') },
                h(Icon, { name: 'plus', size: 14 }),
                h('span', { className: 'cait-btn-label' }, t('nav.new')),
              )
            : null,
          documentsView
            ? h(
                'button',
                { className: 'cait-btn', onClick: onImport, disabled: Boolean(busy), title: t('nav.import') },
                h(Icon, { name: 'upload', size: 14 }),
                h('span', { className: 'cait-btn-label' }, t('nav.import')),
              )
            : null,
          documentsView
            ? h(
                'button',
                { className: 'cait-btn', onClick: onExport, disabled: Boolean(busy) || !doc, title: t('nav.export') },
                h(Icon, { name: 'download', size: 14 }),
                h('span', { className: 'cait-btn-label' }, t('nav.export')),
              )
            : null,
          h('button', { className: 'cait-iconbtn', onClick: onSettings, disabled: Boolean(busy), title: t('nav.settings') }, h(Icon, { name: 'settings', size: 15 })),
        ),
      )
    }

    const SEGMENT_FILTERS = ['all', 'pending', 'translated', 'confirmed']

    function SegmentRail({ t, doc, selected, query, setQuery, filter, setFilter, onSelect, onConfirmAll, onPropagate, busy, qa }) {
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

      const counts = {
        all: doc.progress.total,
        pending: doc.progress.pending,
        translated: doc.progress.translated,
        confirmed: doc.progress.confirmed,
      }

      // How many empty segments could be filled from a sibling with the same
      // source. Shown on the rail so propagation is a visible, one-click choice
      // rather than something happening behind the user's back.
      const duplicateGroups = new Map()
      for (const segment of doc.segments) {
        const key = String(segment.source || '').replace(/\s+/g, ' ').trim().toLowerCase()
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
      const needle = query.trim().toLowerCase()
      const filtered = doc.segments
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
              needle || filter !== 'all' ? `${filtered.length}/${doc.progress.total}` : doc.progress.total,
            ),
          ),
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
          h('input', { value: query, onChange: (event) => setQuery(event.target.value), placeholder: t('rail.search'), 'aria-label': t('rail.search') }),
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
          h('span', { className: 'cait-pageinfo' }, t('rail.pageInfo', { start: bounds.start, end: bounds.end, total: bounds.total })),
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
            PAGE_SIZE_OPTIONS.map((size) => h('option', { key: size, value: String(size) }, String(size))),
          ),
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
      onSearchLibrary,
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
                onClick: () => onSearchLibrary(tab === 'glossary' ? 'glossary' : 'tm', tab === 'tm' ? tmQuery : ''),
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
                // The panel searches what is mounted; the library workspace
                // searches everything. This carries the typed query across.
                h(
                  'div',
                  { className: 'cait-paneljump' },
                  h(
                    'button',
                    { className: 'cait-linkbtn', type: 'button', onClick: () => onSearchLibrary('tm', tmQuery) },
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
                // The panel is a per-segment view: whole-library browsing,
                // adding and editing live on the library page, so the panel
                // stays short instead of dumping the mounted glossary.
                h('p', { className: 'cait-mt-hint' }, t('panel.glossaryMatchesOnly')),
                h(
                  'div',
                  { className: 'cait-panel-foot' },
                  h(
                    'button',
                    { className: 'cait-btn', onClick: () => onSearchLibrary('glossary', ''), disabled: Boolean(busy) },
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

    /**
     * The library workspace: browse, search, page through, edit and export the
     * translation memories and glossaries themselves. It deliberately does not
     * need an open document — the rail and the right panel stay document-scoped
     * and this page is the only place that manages whole libraries.
     */
    function AlignPage({ t, data, busy, notify, report, onApplyState, onConfirm }) {
      const [sourceFile, setSourceFile] = useState(null)
      const [targetFile, setTargetFile] = useState(null)
      const [sourceLang, setSourceLang] = useState('')
      const [targetLang, setTargetLang] = useState('')
      const [result, setResult] = useState(null)
      const [rows, setRows] = useState([])
      const [working, setWorking] = useState(false)
      const [tmId, setTmId] = useState('')
      const sourceRef = useRef(null)
      const targetRef = useRef(null)
      const libraries = data?.tmLibraries || []

      useEffect(() => {
        if (!tmId && libraries.length) setTmId(libraries[0].id)
      }, [libraries.length])

      const readBase64 = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error(t('align.readError')))
          reader.onload = () => {
            const value = String(reader.result || '')
            const comma = value.indexOf(',')
            resolve(comma >= 0 ? value.slice(comma + 1) : '')
          }
          reader.readAsDataURL(file)
        })

      const pick = async (which, file) => {
        if (!file) return
        setWorking(true)
        try {
          const uploaded = await rpc('readUploadText', {
            name: file.name,
            base64: await readBase64(file),
          })
          const picked = { name: uploaded.name, text: uploaded.text, chars: uploaded.chars }
          if (which === 'source') setSourceFile(picked)
          else setTargetFile(picked)
        } catch (error) {
          report(error)
        } finally {
          setWorking(false)
        }
      }

      const run = async () => {
        if (!sourceFile || !targetFile) {
          notify(t('align.needFiles'), true)
          return
        }
        setWorking(true)
        try {
          const aligned = await rpc('alignUploads', {
            sourceFile: { name: sourceFile.name, text: sourceFile.text },
            targetFile: { name: targetFile.name, text: targetFile.text },
            sourceLang,
            targetLang,
          })
          setResult(aligned)
          setRows(aligned.rows.map((row) => ({ ...row, include: row.confidence === 'high' })))
        } catch (error) {
          report(error)
        } finally {
          setWorking(false)
        }
      }

      const updateRow = (at, patch) =>
        setRows((current) => current.map((row, position) => (position === at ? { ...row, ...patch } : row)))

      const removeRow = (at) => setRows((current) => current.filter((_row, position) => position !== at))

      const mergeRow = (at) =>
        setRows((current) => {
          const head = current[at]
          const next = current[at + 1]
          if (!head || !next) return current
          const merged = {
            ...head,
            target: [head.target, next.target].filter(Boolean).join(' '),
            include: head.include,
            merged: true,
          }
          return [...current.slice(0, at), merged, ...current.slice(at + 2)]
        })

      const splitRow = (at) =>
        setRows((current) => {
          const row = current[at]
          if (!row || !row.target) return current
          const parts = String(row.target).split(/\n+/).filter(Boolean)
          if (parts.length < 2) return current
          const replacement = parts.map((part) => ({ ...row, target: part }))
          return [...current.slice(0, at), ...replacement, ...current.slice(at + 1)]
        })

      const write = async () => {
        const pairs = rows
          .filter((row) => row.include && row.source && row.target)
          .map((row) => ({ source: row.source, target: row.target, sourceLang, targetLang }))
        if (!pairs.length) {
          notify(t('align.nothing'), true)
          return
        }
        onConfirm({
          title: t('align.write'),
          message: t('align.writeMessage', { count: pairs.length }),
          action: async () => {
            setWorking(true)
            try {
              const written = await rpc('writeAlignment', { pairs, tmId: tmId || undefined })
              notify(t('align.written', { written: written.written, skipped: written.skipped }))
            } catch (error) {
              report(error)
            } finally {
              setWorking(false)
            }
          },
        })
      }

      const included = rows.filter((row) => row.include && row.source && row.target).length
      const fileCard = (which, file, ref) =>
        h(
          'div',
          { className: 'cait-alignfile' },
          h('span', { className: 'cait-alignlabel' }, t(which === 'source' ? 'align.sourceFile' : 'align.targetFile')),
          h('span', { className: `cait-alignname${file ? '' : ' empty'}` }, file ? file.name : t('align.pick')),
          h('span', { className: 'cait-alignmeta' }, file ? t('align.chars', { count: file.chars }) : ''),
          h('input', {
            ref,
            type: 'file',
            accept: '.txt,.md,.docx,.epub,.html,.htm,.xlsx,.pptx,.csv,.srt,.vtt,.po,.json,.rtf,.xliff',
            style: { display: 'none' },
            onChange: (event) => {
              const chosen = event.target.files && event.target.files[0]
              pick(which, chosen)
              event.target.value = ''
            },
          }),
          h(
            'button',
            { type: 'button', className: 'cait-btn', onClick: () => ref.current && ref.current.click(), disabled: working },
            h(Icon, { name: 'folder', size: 13 }),
            h('span', { className: 'cait-btn-label' }, t('align.choose')),
          ),
        )

      return h(
        'div',
        { className: 'cait-alignpage' },
        h(
          'div',
          { className: 'cait-alignhead' },
          h('div', null, h('h2', null, t('align.title')), h('p', { className: 'cait-mt-hint' }, t('align.hint'))),
          h(
            'div',
            { className: 'cait-alignactions' },
            h('input', {
              className: 'cait-libinput',
              placeholder: t('align.sourceLang'),
              value: sourceLang,
              onChange: (event) => setSourceLang(event.target.value),
            }),
            h('input', {
              className: 'cait-libinput',
              placeholder: t('align.targetLang'),
              value: targetLang,
              onChange: (event) => setTargetLang(event.target.value),
            }),
            h(
              'select',
              {
                className: 'cait-select cait-liblang',
                value: tmId,
                onChange: (event) => setTmId(event.target.value),
              },
              libraries.map((library) => h('option', { key: library.id, value: library.id }, library.name)),
            ),
            h(
              'button',
              { type: 'button', className: 'cait-btn cait-btn-primary', onClick: run, disabled: working || !sourceFile || !targetFile },
              h(Icon, { name: 'align', size: 13 }),
              h('span', { className: 'cait-btn-label' }, working ? t('align.running') : t('align.run')),
            ),
          ),
        ),
        h('div', { className: 'cait-alignfiles' }, fileCard('source', sourceFile, sourceRef), fileCard('target', targetFile, targetRef)),
        result
          ? h(
              'div',
              { className: 'cait-alignstats' },
              h('span', null, t('align.stats', {
                high: result.high,
                medium: result.medium,
                low: result.low,
              })),
              h('span', null, `${t('align.unpairedSource')}: ${result.unpairedSource}`),
              h('span', null, `${t('align.unpairedTarget')}: ${result.unpairedTarget}`),
              result.blocked ? h('span', { className: 'cait-alignwarn' }, t('align.blocked')) : null,
              h(
                'button',
                { type: 'button', className: 'cait-btn', onClick: write, disabled: working || !included },
                h(Icon, { name: 'check', size: 13 }),
                h('span', { className: 'cait-btn-label' }, t('align.writeCount', { count: included })),
              ),
            )
          : null,
        rows.length
          ? h(
              'div',
              { className: 'cait-libtable-wrap cait-aligntable-wrap' },
              h(
                'table',
                { className: 'cait-libtable cait-aligntable' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', null, ''),
                    h('th', null, t('align.sourceFile')),
                    h('th', null, t('align.targetFile')),
                    h('th', null, t('align.confidence')),
                    h('th', null, ''),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  rows.map((row, at) =>
                    h(
                      'tr',
                      { key: `${row.sourceIndex}-${row.targetIndex}-${at}`, className: row.include ? 'included' : '' },
                      h(
                        'td',
                        null,
                        h('input', {
                          type: 'checkbox',
                          checked: Boolean(row.include),
                          onChange: (event) => updateRow(at, { include: event.target.checked }),
                        }),
                      ),
                      h('td', null, row.source),
                      h('td', null, row.target || h('span', { className: 'cait-alignmissing' }, '—')),
                      h(
                        'td',
                        null,
                        h('span', { className: `cait-confidence ${row.confidence}` }, `${Math.round(row.score * 100)}%`),
                      ),
                      h(
                        'td',
                        { className: 'cait-alignrow-actions' },
                        h(
                          'button',
                          { type: 'button', className: 'cait-minibtn', title: t('align.merge'), onClick: () => mergeRow(at) },
                          h(Icon, { name: 'chevronDown', size: 12 }),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'cait-minibtn', title: t('align.split'), onClick: () => splitRow(at) },
                          h(Icon, { name: 'chevronRight', size: 12 }),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'cait-minibtn cait-deletebtn', title: t('align.remove'), onClick: () => removeRow(at) },
                          h(Icon, { name: 'trash', size: 12 }),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function LibraryPage({
      t,
      data,
      settings,
      busy,
      notify,
      report,
      seed,
      onApplyState,
      onConfirm,
      onCreateLibrary,
      onRenameLibrary,
      onDeleteLibrary,
    }) {
      const storage = typeof localStorage !== 'undefined' ? localStorage : null
      const [kind, setKind] = useState(seed?.kind === 'glossary' ? 'glossary' : 'tm')
      const [scopeIds, setScopeIds] = useState([])
      const [query, setQuery] = useState(seed?.query || '')
      const [debouncedQuery, setDebouncedQuery] = useState('')
      const [lang, setLang] = useState('')
      const [page, setPage] = useState(1)
      const [pageSize, setPageSize] = useState(() => readPageSize(storage))
      const [rows, setRows] = useState(null)
      const [loading, setLoading] = useState(false)
      const [working, setWorking] = useState('')
      const [selectedId, setSelectedId] = useState('')
      const [draft, setDraft] = useState(null)
      const [renamingId, setRenamingId] = useState('')
      const [renameText, setRenameText] = useState('')
      const [newLibraryName, setNewLibraryName] = useState('')
      const [adding, setAdding] = useState(false)
      const [exportFormat, setExportFormat] = useState('tbx')
      const [terms, setTerms] = useState(null)
      const fileRef = useRef(null)
      const importMode = useRef('')

      const libraries = (kind === 'tm' ? data?.libraries?.tm : data?.libraries?.glossary) || []
      const idKey = kind === 'tm' ? 'tmId' : 'glossaryId'
      const labelKey = 'name'
      const scopeKey = scopeIds.join(',')
      const targetLibraryId = scopeIds[0] || (kind === 'tm' ? data?.mounts?.defaultTmId : data?.mounts?.defaultGlossaryId) || libraries[0]?.[idKey] || ''

      useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 250)
        return () => clearTimeout(timer)
      }, [query])

      // The panel can jump into the library with its current search text; a
      // fresh nonce means "apply this seed now" even when the values repeat.
      useEffect(() => {
        if (!seed) return
        setKind(seed.kind === 'glossary' ? 'glossary' : 'tm')
        setQuery(seed.query || '')
        setPage(1)
      }, [seed?.nonce])

      // Switching kind resets the scope: library ids are not interchangeable.
      useEffect(() => {
        setScopeIds([])
        setPage(1)
        setSelectedId('')
        setLang('')
      }, [kind])

      const loadRows = async () => {
        setLoading(true)
        try {
          const params =
            kind === 'tm'
              ? { tmIds: scopeIds, query: debouncedQuery, page, pageSize }
              : { glossaryIds: scopeIds, query: debouncedQuery, page, pageSize }
          if (lang) params.sourceLang = lang
          const result = await rpc(kind === 'tm' ? 'listTmEntries' : 'listGlossaryEntries', params)
          setRows(result)
          if (result.page !== page) setPage(result.page)
        } catch (error) {
          report(error)
          setRows(null)
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => {
        let alive = true
        const run = async () => {
          if (!alive) return
          await loadRows()
        }
        run()
        return () => {
          alive = false
        }
      }, [kind, scopeKey, debouncedQuery, lang, page, pageSize, data?.revision])

      useEffect(() => {
        const entry = (rows?.entries || []).find((item) => item.id === selectedId)
        setDraft(entry ? { ...entry } : null)
      }, [selectedId, rows])

      const dirty =
        draft &&
        rows?.entries?.some(
          (item) =>
            item.id === draft.id &&
            (item.source !== draft.source ||
              item.target !== draft.target ||
              (item.note || '') !== (draft.note || '') ||
              Boolean(item.caseSensitive) !== Boolean(draft.caseSensitive)),
        )

      const selectKind = (next) => setKind(next)

      const mineTerms = async () => {
        const active = data?.activeDocument
        if (!active) {
          notify(t('term.noDoc'), true)
          return
        }
        setWorking('terms')
        try {
          const mined = await rpc('termCandidates', { documentId: active.id, limit: 60 })
          setTerms(mined.candidates.map((candidate) => ({
            ...candidate,
            picked: false,
            target: candidate.evidence[0] || '',
          })))
        } catch (error) {
          report(error)
        } finally {
          setWorking('')
        }
      }

      const toggleTerm = (index) =>
        setTerms((current) =>
          current.map((item, position) => (position === index ? { ...item, picked: !item.picked } : item)),
        )

      const setTermTarget = (index, value) =>
        setTerms((current) =>
          current.map((item, position) => (position === index ? { ...item, target: value, picked: true } : item)),
        )

      const addMinedTerms = async () => {
        const picked = (terms || []).filter((item) => item.picked && item.target.trim())
        if (!picked.length) return
        setWorking('terms')
        try {
          const result = await rpc('addGlossaryEntries', {
            glossaryId: targetLibraryId || undefined,
            entries: picked.map((item) => ({
              source: item.term,
              target: item.target.trim(),
              sourceLang: settings.sourceLang,
            })),
          })
          if (result?.state) onApplyState(result.state)
          notify(t('term.added').replace('{added}', String(result.added)))
          setTerms(null)
          await loadRows()
        } catch (error) {
          report(error)
        } finally {
          setWorking('')
        }
      }

      const toggleScope = (id) => {
        setPage(1)
        setScopeIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
      }

      const allLanguages = rows?.languages
        ? [...new Set([...(rows.languages.source || []), ...(rows.languages.target || [])])].filter(Boolean)
        : []

      const changePageSize = (value) => {
        const size = writePageSize(storage, value)
        setPageSize(size)
        setPage(1)
      }

      const saveEntry = async () => {
        if (!draft) return
        setWorking('save')
        try {
          const result =
            kind === 'tm'
              ? await rpc('updateTM', {
                  id: draft.id,
                  source: draft.source,
                  target: draft.target,
                  note: draft.note,
                })
              : await rpc('updateGlossary', {
                  id: draft.id,
                  source: draft.source,
                  target: draft.target,
                  note: draft.note,
                  sourceLang: draft.sourceLang,
                  caseSensitive: Boolean(draft.caseSensitive),
                })
          if (result?.state) onApplyState(result.state)
          notify(t('library.entrySaved'))
          setAdding(false)
          await loadRows()
        } catch (error) {
          report(error)
        } finally {
          setWorking('')
        }
      }

      const addEntry = async () => {
        if (!draft) return
        setWorking('add')
        try {
          const result =
            kind === 'tm'
              ? await rpc('addTM', {
                  source: draft.source,
                  target: draft.target,
                  tmId: targetLibraryId,
                  sourceLang: draft.sourceLang || settings.sourceLang,
                  targetLang: draft.targetLang || settings.targetLang,
                })
              : await rpc('addGlossary', {
                  source: draft.source,
                  target: draft.target,
                  note: draft.note,
                  glossaryId: targetLibraryId,
                  sourceLang: draft.sourceLang || '',
                  caseSensitive: Boolean(draft.caseSensitive),
                })
          if (result?.state) onApplyState(result.state)
          notify(t('library.entryCreated'))
          setAdding(false)
          setSelectedId('')
          await loadRows()
        } catch (error) {
          report(error)
        } finally {
          setWorking('')
        }
      }

      const deleteEntry = () => {
        if (!draft || adding) return
        onConfirm({
          title: t('library.deleteEntry'),
          message: kind === 'tm' ? t('modal.confirm.deleteTm') : t('library.deleteEntry'),
          confirmLabel: t('library.deleteEntry'),
          action: async () => {
            const result = await rpc(kind === 'tm' ? 'deleteTM' : 'deleteGlossary', { id: draft.id })
            if (result?.state) onApplyState(result.state)
            setSelectedId('')
            notify(t('library.entryDeleted'))
            await loadRows()
          },
        })
      }

      const clearLibrary = () => {
        if (!targetLibraryId) return
        onConfirm({
          title: t('library.clear'),
          message: t('modal.confirm.clearTm'),
          confirmLabel: t('library.clear'),
          action: async () => {
            const result =
              kind === 'tm'
                ? await rpc('clearTM', { tmIds: [targetLibraryId], confirm: true })
                : await rpc('clearGlossary', { glossaryIds: [targetLibraryId], confirm: true })
            if (result?.state) onApplyState(result.state)
            setSelectedId('')
            await loadRows()
          },
        })
      }

      const exportLibrary = async () => {
        if (!targetLibraryId) return
        setWorking('export')
        try {
          const result =
            kind === 'tm'
              ? await rpc('exportTM', { tmId: targetLibraryId, format: 'tmx' })
              : await rpc('exportGlossary', { glossaryId: targetLibraryId, format: exportFormat })
          downloadFile(result.filename, result.content, result.mime)
          notify(t('library.exported'))
        } catch (error) {
          report(error)
        } finally {
          setWorking('')
        }
      }

      const pickImport = (mode) => {
        importMode.current = mode
        if (fileRef.current) {
          fileRef.current.value = ''
          fileRef.current.click()
        }
      }

      const runImport = async (file) => {
        if (!file || !targetLibraryId) return
        setWorking('import')
        try {
          const text = await file.text()
          if (importMode.current === 'glossary') {
            const result = await rpc('importGlossary', { text, glossaryId: targetLibraryId })
            if (result?.state) onApplyState(result.state)
            notify(`${t('toast.glossaryImported')} · +${result.added} / ~${result.updated}`)
          } else {
            const result = await rpc('importTmx', {
              text,
              importAs: 'tm',
              tmId: targetLibraryId,
              sourceLang: kind === 'tm' ? undefined : settings.sourceLang,
              targetLang: settings.targetLang,
            })
            if (result?.state) onApplyState(result.state)
            notify(`${t('toast.tmImported')} · +${result.added} / ~${result.updated}`)
          }
          await loadRows()
        } catch (error) {
          report(error)
        } finally {
          setWorking('')
        }
      }

      const submitRename = async (library) => {
        const name = renameText.trim()
        setRenamingId('')
        if (!name || name === library[labelKey]) return
        await onRenameLibrary({ kind, id: library[idKey], name })
      }

      const submitNewLibrary = async () => {
        const name = newLibraryName.trim()
        if (!name) return
        const ok = await onCreateLibrary({ kind, name })
        if (ok) setNewLibraryName('')
      }

      const confirmDeleteLibrary = (library) => {
        if (libraries.length <= 1) return
        onConfirm({
          title: t('library.deleteLibrary'),
          message: t('library.deleteLibraryMessage', { name: library[labelKey] }),
          confirmLabel: t('library.deleteLibrary'),
          action: async () => {
            await onDeleteLibrary({ kind, id: library[idKey], name: library[labelKey] })
            if (scopeIds.includes(library[idKey])) {
              setScopeIds((current) => current.filter((item) => item !== library[idKey]))
            }
          },
        })
      }

      const startAdding = () => {
        setAdding(true)
        setSelectedId('')
        setDraft(
          kind === 'tm'
            ? {
                id: '',
                source: '',
                target: '',
                note: '',
                sourceLang: settings.sourceLang,
                targetLang: settings.targetLang,
              }
            : { id: '', source: '', target: '', note: '', sourceLang: settings.sourceLang, caseSensitive: false },
        )
      }

      const bounds = pageBounds(rows?.page || 1, rows?.total || 0, rows?.pageSize || pageSize)
      const contextLabel = (entry) =>
        entry.context ? `${entry.context.prev || '—'} · ${entry.context.next || '—'}` : '—'
      const columns = kind === 'tm'
        ? [t('library.colSource'), t('library.colTarget'), t('library.colNote'), t('library.colContext'), t('library.colLang'), t('library.colUpdated')]
        : [t('library.colSource'), t('library.colTarget'), t('library.colNote'), t('library.colLang'), t('library.colCase'), t('library.colUpdated')]

      return h(
        'div',
        { className: 'cait-libpage' },
        h(
          'div',
          { className: 'cait-libpage-head' },
          h(
            'div',
            { className: 'cait-libtabs' },
            h(
              'button',
              { className: `cait-libtabs-item${kind === 'tm' ? ' active' : ''}`, onClick: () => selectKind('tm') },
              t('library.tmTab'),
              h('span', { className: 'cait-libtabs-count' }, data?.libraries?.tm?.length || 0),
            ),
            h(
              'button',
              { className: `cait-libtabs-item${kind === 'glossary' ? ' active' : ''}`, onClick: () => selectKind('glossary') },
              t('library.glossaryTab'),
              h('span', { className: 'cait-libtabs-count' }, data?.libraries?.glossary?.length || 0),
            ),
          ),
          h('span', { className: 'cait-libhint' }, t('library.noDocHint')),
        ),
        h(
          'div',
          { className: 'cait-libpage-body' },
          h(
            'div',
            { className: 'cait-liblist' },
            h(
              'div',
              { className: 'cait-liblist-head' },
              t('library.title'),
            ),
            libraries.map((library) =>
              h(
                'div',
                { key: library[idKey], className: `cait-librow${scopeIds.includes(library[idKey]) ? ' scoped' : ''}` },
                h('input', {
                  type: 'checkbox',
                  checked: scopeIds.includes(library[idKey]),
                  onChange: () => toggleScope(library[idKey]),
                  title: t('library.scope'),
                  'aria-label': t('library.scope'),
                }),
                renamingId === library[idKey]
                  ? h('input', {
                      className: 'cait-librename',
                      value: renameText,
                      autoFocus: true,
                      onChange: (event) => setRenameText(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') submitRename(library)
                        if (event.key === 'Escape') setRenamingId('')
                      },
                      onBlur: () => submitRename(library),
                    })
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-libname',
                        onClick: () => toggleScope(library[idKey]),
                        title: library[labelKey],
                      },
                      h('span', { className: 'cait-libname-text' }, library[labelKey]),
                      h('span', { className: 'cait-libcount' }, library.entryCount),
                      library.mounted ? h('span', { className: 'cait-libmounted' }, '●') : null,
                    ),
                h(
                  'span',
                  { className: 'cait-libactions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-minibtn',
                      title: t('library.rename'),
                      onClick: () => {
                        setRenamingId(library[idKey])
                        setRenameText(library[labelKey])
                      },
                    },
                    h(Icon, { name: 'pencil', size: 12 }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-deletebtn',
                      title: t('library.deleteLibrary'),
                      disabled: libraries.length <= 1,
                      onClick: () => confirmDeleteLibrary(library),
                    },
                    h(Icon, { name: 'trash', size: 12 }),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'cait-libnew' },
              h('input', {
                value: newLibraryName,
                placeholder: t('library.newLibrary'),
                onChange: (event) => setNewLibraryName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submitNewLibrary()
                },
              }),
              h(
                'button',
                { type: 'button', className: 'cait-minibtn', onClick: submitNewLibrary, disabled: !newLibraryName.trim() },
                h(Icon, { name: 'plus', size: 12 }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'cait-libmain' },
            h(
              'div',
              { className: 'cait-libtoolbar' },
              h(
                'div',
                { className: 'cait-libsearch' },
                h(Icon, { name: 'search', size: 13 }),
                h('input', {
                  value: query,
                  onChange: (event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  },
                  placeholder: t('library.search'),
                  'aria-label': t('library.search'),
                }),
              ),
              h(
                'select',
                {
                  className: 'cait-liblang',
                  value: lang,
                  onChange: (event) => {
                    setLang(event.target.value)
                    setPage(1)
                  },
                  title: t('library.language'),
                  'aria-label': t('library.language'),
                },
                h('option', { value: '' }, t('library.language')),
                allLanguages.map((code) => h('option', { key: code, value: code }, code)),
              ),
              kind === 'glossary'
                ? h(
                    'select',
                    {
                      className: 'cait-liblang',
                      value: exportFormat,
                      onChange: (event) => setExportFormat(event.target.value),
                      title: t('library.exportFormat'),
                      'aria-label': t('library.exportFormat'),
                    },
                    ['tbx', 'csv', 'json'].map((format) => h('option', { key: format, value: format }, format.toUpperCase())),
                  )
                : null,
              kind === 'glossary'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-btn',
                      onClick: mineTerms,
                      disabled: Boolean(busy) || working === 'terms' || !data?.activeDocument,
                      title: t('term.extract'),
                    },
                    h(Icon, { name: 'sparkles', size: 13 }),
                    h('span', { className: 'cait-btn-label' }, t('term.extract')),
                  )
                : null,
              h(
                'button',
                { type: 'button', className: 'cait-btn', onClick: startAdding, disabled: Boolean(busy) },
                h(Icon, { name: 'plus', size: 13 }),
                h('span', { className: 'cait-btn-label' }, t('library.add')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  onClick: () => pickImport(kind),
                  disabled: Boolean(busy) || !targetLibraryId,
                  title: t('library.import'),
                },
                h(Icon, { name: 'upload', size: 13 }),
                h('span', { className: 'cait-btn-label' }, t('library.import')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  onClick: exportLibrary,
                  disabled: Boolean(busy) || working === 'export' || !targetLibraryId,
                  title: t('library.export'),
                },
                h(Icon, { name: 'download', size: 13 }),
                h('span', { className: 'cait-btn-label' }, kind === 'tm' ? 'TMX' : exportFormat.toUpperCase()),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  onClick: clearLibrary,
                  disabled: Boolean(busy) || !targetLibraryId,
                  title: t('library.clear'),
                },
                h(Icon, { name: 'trash', size: 13 }),
              ),
              h('input', {
                ref: fileRef,
                type: 'file',
                accept: kind === 'tm' ? '.tmx' : '.tbx,.csv,.json',
                style: { display: 'none' },
                onChange: (event) => {
                  const file = event.target.files && event.target.files[0]
                  if (file) runImport(file)
                },
              }),
            ),
            h(
              'div',
              { className: 'cait-libscope' },
              h(
                'button',
                {
                  type: 'button',
                  className: `cait-filterchip${scopeIds.length === 0 ? ' active' : ''}`,
                  onClick: () => {
                    setScopeIds([])
                    setPage(1)
                  },
                },
                t('library.scopeAll'),
              ),
              libraries.map((library) =>
                h(
                  'button',
                  {
                    key: library[idKey],
                    type: 'button',
                    className: `cait-filterchip${scopeIds.includes(library[idKey]) ? ' active' : ''}`,
                    onClick: () => toggleScope(library[idKey]),
                  },
                  library[labelKey],
                ),
              ),
            ),
            h(
              'div',
              { className: 'cait-libtable-wrap' },
              loading && !rows?.entries?.length
                ? h('div', { className: 'cait-center' }, h(Spinner), t('common.loading'))
                : rows?.entries?.length
                  ? h(
                      'table',
                      { className: 'cait-libtable' },
                      h('thead', null, h('tr', null, columns.map((column) => h('th', { key: column }, column)))),
                      h(
                        'tbody',
                        null,
                        rows.entries.map((entry) =>
                          h(
                            'tr',
                            {
                              key: entry.id,
                              className: entry.id === selectedId ? 'active' : '',
                              onClick: () => {
                                setAdding(false)
                                setSelectedId(entry.id)
                              },
                            },
                            h('td', { className: 'src', title: entry.source }, entry.source),
                            h('td', { className: 'tgt', title: entry.target }, entry.target),
                            h('td', { className: 'note' }, entry.note || ''),
                            kind === 'tm'
                              ? h(
                                  'td',
                                  { className: 'ctx', title: contextLabel(entry) },
                                  contextLabel(entry),
                                )
                              : null,
                            h(
                              'td',
                              { className: 'lang' },
                              kind === 'tm' ? `${entry.sourceLang} → ${entry.targetLang}` : entry.sourceLang || '—',
                            ),
                            kind === 'glossary'
                              ? h('td', { className: 'case' }, entry.caseSensitive ? '✓' : '')
                              : null,
                            h('td', { className: 'upd' }, String(entry.updatedAt || '').slice(0, 10)),
                          ),
                        ),
                      ),
                    )
                  : h('div', { className: 'cait-empty-note' }, query || lang ? t('library.noMatch') : t('library.empty')),
            ),
            h(
              'div',
              { className: 'cait-rail-page cait-libpage-bar' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-pagebtn',
                  onClick: () => setPage(Math.max(1, (rows?.page || 1) - 1)),
                  disabled: (rows?.page || 1) <= 1,
                  title: t('library.prev'),
                  'aria-label': t('library.prev'),
                },
                h(Icon, { name: 'chevronLeft', size: 12 }),
              ),
              h('span', { className: 'cait-pageinfo' }, t('library.pageInfo', { start: bounds.start, end: bounds.end, total: bounds.total })),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-pagebtn',
                  onClick: () => setPage((rows?.page || 1) + 1),
                  disabled: (rows?.page || 1) >= (rows?.totalPages || 1),
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
                PAGE_SIZE_OPTIONS.map((size) => h('option', { key: size, value: String(size) }, String(size))),
              ),
            ),
          ),
          h(
            'aside',
            { className: 'cait-libdetail' },
            h('div', { className: 'cait-libdetail-title' }, t('library.detail')),
            draft
              ? h(
                  'div',
                  { className: 'cait-libform' },
                  h('label', null, t('library.colSource')),
                  h('textarea', {
                    className: 'cait-libinput',
                    value: draft.source,
                    onChange: (event) => setDraft({ ...draft, source: event.target.value }),
                  }),
                  h('label', null, t('library.colTarget')),
                  h('textarea', {
                    className: 'cait-libinput',
                    value: draft.target,
                    onChange: (event) => setDraft({ ...draft, target: event.target.value }),
                  }),
                  h('label', null, t('library.colNote')),
                  h('input', {
                    className: 'cait-libinput',
                    value: draft.note || '',
                    onChange: (event) => setDraft({ ...draft, note: event.target.value }),
                  }),
                  h('label', null, t('library.colLang')),
                  h('input', {
                    className: 'cait-libinput',
                    value: draft.sourceLang || '',
                    disabled: adding,
                    onChange: (event) => setDraft({ ...draft, sourceLang: event.target.value }),
                  }),
                  kind === 'glossary'
                    ? h(
                        'label',
                        { className: 'cait-libcheck' },
                        h('input', {
                          type: 'checkbox',
                          checked: Boolean(draft.caseSensitive),
                          onChange: (event) => setDraft({ ...draft, caseSensitive: event.target.checked }),
                        }),
                        h('span', null, t('library.colCase')),
                      )
                    : null,
                  kind === 'glossary' ? h('p', { className: 'cait-libnote' }, t('library.caseSensitiveHint')) : null,
                  h(
                    'div',
                    { className: 'cait-libform-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-btn cait-btn-primary',
                        onClick: adding ? addEntry : saveEntry,
                        disabled: Boolean(busy) || working !== '' || !draft.source.trim() || !draft.target.trim(),
                      },
                      adding ? t('library.add') : t('library.save'),
                    ),
                    adding
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'cait-btn',
                            onClick: () => {
                              setAdding(false)
                              setDraft(null)
                            },
                          },
                          t('panel.cancel'),
                        )
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'cait-btn',
                            onClick: deleteEntry,
                            disabled: Boolean(busy) || working !== '',
                          },
                          h(Icon, { name: 'trash', size: 13 }),
                          t('library.deleteEntry'),
                        ),
                  ),
                  dirty ? h('p', { className: 'cait-libnote' }, t('editor.unsaved')) : null,
                )
              : h('div', { className: 'cait-empty-note' }, t('library.detailEmpty')),
          ),
        ),
        terms
          ? h(
              'div',
              { className: 'cait-termpanel' },
              h(
                'div',
                { className: 'cait-termpanel-head' },
                h('strong', null, t('term.title')),
                h('span', { className: 'cait-mt-hint' }, t('term.hint')),
                h('span', { className: 'cait-termpanel-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'cait-btn cait-btn-primary', onClick: addMinedTerms, disabled: working === 'terms' },
                    h(Icon, { name: 'check', size: 13 }),
                    t('term.add'),
                  ),
                  h('button', { type: 'button', className: 'cait-btn', onClick: () => setTerms(null) }, t('panel.cancel')),
                ),
              ),
              terms.length
                ? h(
                    'div',
                    { className: 'cait-termlist' },
                    terms.map((candidate, at) =>
                      h(
                        'div',
                        { key: `${candidate.term}-${at}`, className: `cait-termrow${candidate.picked ? ' picked' : ''}` },
                        h('input', {
                          type: 'checkbox',
                          checked: Boolean(candidate.picked),
                          onChange: () => toggleTerm(at),
                        }),
                        h('span', { className: 'cait-termname' }, candidate.term),
                        h('span', { className: 'cait-termcount' }, `×${candidate.count}`),
                        candidate.inLibrary ? h('span', { className: 'cait-originchip' }, t('term.inLibrary')) : null,
                        h('input', {
                          className: 'cait-libinput cait-termtarget',
                          placeholder: t('library.colTarget'),
                          value: candidate.target,
                          onChange: (event) => setTermTarget(at, event.target.value),
                        }),
                      ),
                    ),
                  )
                : h('div', { className: 'cait-empty-note' }, t('term.empty')),
            )
          : null,
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
      // Two top-level workspaces: the translator's document and the library
      // manager. The latter needs no document, so it must not be a modal.
      const [view, setView] = useState('documents')
      // A seed carries the panel's search text into the library workspace.
      const [libSeed, setLibSeed] = useState(null)

      const openLibrary = (kind, query) => {
        setLibSeed({ kind: kind === 'glossary' ? 'glossary' : 'tm', query: query || '', nonce: Date.now() })
        setView('libraries')
      }
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
        fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
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

      const propagateRepeats = () => {
        const active = data?.activeDocument
        if (!active) return
        setModal({
          type: 'confirm',
          title: t('rail.propagate'),
          message: t('rail.propagateMessage'),
          confirmLabel: t('rail.propagate'),
          action: async () => {
            const result = await rpc('propagateDocument', { documentId: active.id })
            await refreshState()
            notify(t('toast.propagated').replace('{count}', String(result.filled)))
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
          view,
          onView: setView,
        }),
        h(SaveBanner, { t, storage: data?.storage, stale, onRefresh: refreshState }),
        view === 'libraries'
          ? h(LibraryPage, {
              t,
              data,
              settings,
              busy,
              notify,
              report,
              seed: libSeed,
              onApplyState: (state) => setData(state),
              onConfirm: openConfirm,
              onCreateLibrary: createLibrary,
              onRenameLibrary: renameLibrary,
              onDeleteLibrary: deleteLibrary,
            })
          : null,
        view === 'align'
          ? h(AlignPage, {
              t,
              data,
              busy,
              notify,
              report,
              onApplyState: (state) => setData(state),
              onConfirm: openConfirm,
            })
          : null,
        view === 'documents'
          ? h(
          'div',
          { className: `cait-body${doc ? '' : ' cait-no-doc'}` },
          doc ? h(SegmentRail, { t, doc, selected: index, query: railQuery, setQuery: setRailQuery, filter: railFilter, setFilter: setRailFilter, onSelect: chooseSegment, onConfirmAll: confirmAllTranslated, onPropagate: propagateRepeats, busy, qa }) : null,
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
                  onSearchLibrary: openLibrary,
                  busy,
                })
              : null,
          ),
        )
          : null,
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

    const ZH = {
      'app.title': 'CAIT',
      'app.subtitle': 'CAT 翻译工作台',
      'nav.new': '新建',
      'nav.import': '导入',
      'nav.export': '导出',
      'nav.settings': '设置',
      'doc.switch': '文档',
      'doc.openExisting': '打开已有文档',
      'doc.clean': '清理已关闭文档',
      'doc.cleanTitle': '已关闭的文档',
      'doc.cleanHint': '这些文档已关闭但仍保存在 CAIT 中。删除后文档及其句段会被永久移除。',
      'doc.cleanAll': '删除全部已关闭文档',
      'doc.cleanAllMessage': '确定永久删除全部 {count} 个已关闭文档吗？该操作不可撤销。',
      'doc.cleanEmpty': '没有已关闭的文档。',
      'doc.delete': '删除文档',
      'doc.deleteTitle': '删除文档',
      'doc.deleteMessage': '确定永久删除“{name}”吗？该文档的句段也会被删除。',
      'doc.segments': '句段',
      'tabs.title': '打开的文档',
      'tabs.close': '关闭文档',
      'tabs.new': '新开页面',
      'progress.confirmed': '已确认',
      'status.pending': '待翻译',
      'status.confirmed': '已确认',
      'common.loading': '正在加载工作台…',
      'common.retry': '重试',
      'common.refresh': '刷新',
      'storage.saveFailed': '保存失败：',
      'storage.stale': '数据已在其他窗口或 agent 操作中更新；当前草稿未被覆盖。保存后可刷新同步。',
      'error.load': '无法加载 CAIT 工作台',
      'rail.title': '句段',
      'rail.search': '筛选句段…',
      'rail.empty': '没有匹配的句段',
      'editor.segment': '句段',
      'editor.source': '原文',
      'editor.target': '译文',
      'editor.targetPlaceholder': '在此输入译文…',
      'editor.confirm': '确认并写入记忆库',
      'editor.update': '更新译文并入库',
      'editor.next': '下一句',
      'editor.prev': '上一句',
      'editor.save': '保存草稿',
      'editor.unsaved': '未保存',
      'editor.chars': '字符',
      'editor.hint': '⌘/Ctrl + Enter 确认 · Alt + ↑/↓ 切换',
      'editor.emptyTarget': '请先输入译文',
      'editor.done': '全部句段已确认',
      'editor.confirmedAt': '确认于',
      'editor.suggestion': '机器建议',
      'editor.adopt': '采纳',
      'editor.adoptHint': '把建议填入译文，保留它的来源',
      'editor.remaining': '句待确认',
      'status.translated': '已翻译',
      'origin.tm': 'TM',
      'origin.mt': 'MT',
      'origin.agent': 'Agent',
      'origin.manual': '手动',
      'rail.filter.all': '全部',
      'rail.filter.pending': '待译',
      'rail.filter.translated': '待审',
      'rail.filter.confirmed': '已确认',
      'rail.confirmAll': '全部确认',
      'rail.confirmAllHint': '把当前所有「待审」句段一次性确认并写入翻译记忆',
      'rail.confirmAllMessage': '将确认 {count} 个待审句段并写入翻译记忆，句段译文不会经过逐句复核。确定继续？',
      'toast.confirmedMany': '已确认 {count} 段',
      'qa.warn': '检查提醒',
      'qa.exportBanner': '导出前检查发现 {count} 条提醒（不影响导出）：',
      'qa.counts': '占位符 {placeholder} · 数字 {number} · 术语 {term} · 空译文 {empty}',
      'qa.code.PLACEHOLDER_MISSING': '占位符缺失',
      'qa.code.NUMBER_MISMATCH': '数字不一致',
      'qa.code.TERM_NOT_USED': '术语未使用',
      'qa.code.EMPTY_TARGET': '空译文',
      'toast.suggestionAdopted': '已采纳建议',
      'pretranslate.start': '预翻译',
      'editor.noSuggestion': '暂无建议，可直接翻译或让 agent 补刀',
      'editor.baselineHint': '中间栏是机器或 agent 的初次产出，右侧可以对照着改',
      'pretranslate.title': '用翻译记忆与机器翻译给整篇铺底，之后逐句审校',
      'pretranslate.running': '预翻译中',
      'pretranslate.cancel': '停止预翻译',
      'toast.preDone': '预翻译完成，填充 {count} 段',
      'toast.preCancelled': '已停止预翻译',
      'toast.preFailed': '预翻译结束，{count} 段失败',
      'empty.title': '开始一次 CAT 翻译',
      'empty.desc': '粘贴文本、拖入文件，或加载演示文档。CAIT 会把源文切成句段，并同时查询翻译记忆与术语库；确认译文后自动入库。',
      'empty.paste': '粘贴文本',
      'empty.file': '导入文件',
      'empty.name': '文档名称（可选）',
      'empty.textPlaceholder': '在此粘贴源文本…',
      'empty.create': '创建文档',
      'empty.demo': '加载演示文档',
      'empty.demoHint': '没有素材？',
      'empty.drop': '拖入文件，或点击选择',
      'empty.formats': '支持 TXT · Markdown · DOCX · EPUB · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
      'empty.features.tm': '翻译记忆',
      'empty.features.tmDesc': '精确 + 模糊匹配',
      'empty.features.glossary': '术语库',
      'empty.features.glossaryDesc': '命中高亮与提示',
      'empty.features.mt': 'AI 翻译',
      'empty.features.mtDesc': '可配置兼容接口',
      'modal.new.title': '新建文档',
      'modal.new.name': '文档名称',
      'modal.new.namePlaceholder': '例如：产品手册',
      'modal.new.sourceLang': '源语言',
      'modal.new.targetLang': '目标语言',
      'modal.new.create': '创建文档',
      'modal.new.importing': '正在导入…',
      'modal.new.dropHint': 'TXT · Markdown · DOCX · EPUB · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
      'modal.new.csvSource': 'CSV 源文列',
      'modal.new.csvTarget': 'CSV 译文列',
      'modal.new.csvColumnPlaceholder': '列名或列号，例如 Source / 2',
      'modal.new.csvHint': '可选。留空时自动识别 Source/Target 表头，或使用前两列。',
      'modal.new.sample': '没有素材？',
      'modal.new.demo': '加载演示文档',
      'panel.title': 'CAT 助手',
      'panel.live': '实时',
      'libraries.open': '管理挂载库',
      'libraries.short': '库',
      'libraries.title': '翻译记忆与术语库',
      'libraries.desc': '勾选当前翻译会话要检索的库。至少保留一个 TM 和一个术语库；默认库用于新译文和新术语写入。',
      'libraries.tm': '翻译记忆库',
      'libraries.glossary': '术语库',
      'libraries.entries': '条',
      'libraries.notMounted': '未挂载',
      'libraries.defaultTm': '默认写入',
      'libraries.defaultGlossary': '默认新增',
      'libraries.empty': '还没有库，先创建一个。',
      'libraries.namePlaceholder': '库名称',
      'libraries.create': '新建',
      'libraries.done': '完成',
      'libraries.created': '库已创建并自动挂载',
      'libraries.rename': '重命名',
      'libraries.save': '保存',
      'libraries.renamed': '库已重命名',
      'libraries.delete': '删除库',
      'libraries.deleted': '库已删除',
      'libraries.deleteTmWarn': '库里的记忆条目也会一起删除，无法撤销。',
      'libraries.deleteGlossaryWarn': '库里的术语也会一起删除，无法撤销。',
      'libraries.mountSaved': '挂载设置已保存',
      'panel.tm': '记忆库',
      'panel.glossary': '术语库',
      'panel.mt': 'AI 翻译',
      'panel.currentMatches': '当前句段匹配',
      'panel.searchResults': '搜索结果',
      'panel.searchPlaceholder': '搜索记忆库…',
      'panel.search': '搜索',
      'panel.noMatches': '没有匹配结果。确认句段后会自动写入记忆库。',
      'panel.noCurrentMatches': '当前句段暂无匹配。确认译文后即可复用。',
      'panel.exact': '精确',
      'panel.fuzzy': '模糊',
      'match.exact': '精确',
      'match.near_exact': '近似精确',
      'match.high_fuzzy': '高模糊',
      'match.medium_fuzzy': '中模糊',
      'match.low_fuzzy': '低模糊',
      'match.context': '上下文匹配',
      'panel.contextPrev': '上文',
      'panel.contextNext': '下文',
      'panel.apply': '应用',
      'panel.importTmx': '导入 TMX',
      'panel.clearTm': '清空记忆库',
      'panel.tmHint': '确认句段时自动写入；模糊阈值可在设置中调整。',
      'panel.termHits': '本句命中',
      'panel.noHits': '本句暂无术语命中',
      'panel.allTerms': '全部术语',
      'panel.termSearch': '筛选术语…',
      'panel.addTerm': '添加术语',
      'panel.termSource': '术语',
      'panel.termTarget': '译文',
      'panel.termNote': '备注（可选）',
      'panel.saveTerm': '保存术语',
      'panel.cancel': '取消',
      'panel.delete': '删除',
      'panel.edit': '编辑',
      'panel.saveEntry': '保存修改',
      'panel.noTerms': '术语库为空。添加术语后，命中会自动高亮。',
      'panel.importCsv': '导入 CSV/TSV',
      'panel.clearGlossary': '清空术语库',
      'panel.mtProvider': '提供商',
      'panel.mtRoute': '路由',
      'panel.mtGenerate': '生成译文建议',
      'panel.mtGenerating': '正在生成…',
      'panel.mtInsert': '插入译文',
      'panel.mtCopy': '复制',
      'panel.mtEmpty': '点击生成，获取当前句段的机器翻译建议。',
      'panel.mtModel': '模型',
      'panel.mtSuggestion': 'MT 建议',
      'panel.mtSettings': '配置路由',
      'panel.mtHint': '通过 DSH 模型路由调用，凭据由 DSH 管理。',
      'panel.mtMockHint': '术语替换（离线）不联网，只使用术语库；在设置中选择 DSH 路由可启用真实翻译。',
      'panel.copy': '复制',
      'mt.mock': '术语替换（离线）',
      'modal.export.title': '导出',
      'modal.export.desc': '导出当前文档。双语格式保留原文与译文对照，仅译文格式适合直接交付。',
      'modal.export.bilingual': '双语对照',
      'modal.export.target': '仅译文',
      'modal.export.current': '当前文档',
      'modal.export.bilingualMd': 'Markdown 表格',
      'modal.export.bilingualCsv': 'CSV 表格',
      'modal.export.tmx': 'TMX 记忆交换',
      'modal.export.targetTxt': '纯文本',
      'modal.export.targetMd': 'Markdown',
      'modal.export.docx': 'Word DOCX',
      'modal.export.docxGroup': '保留源格式',
      'modal.export.epub': 'EPUB 电子书',
      'modal.export.epubGroup': '保留源排版',
      'modal.export.json': '文档 JSON',
      'modal.export.subtitleGroup': '字幕',
      'modal.export.localizationGroup': '本地化交换',
      'modal.export.srt': 'SRT 字幕',
      'modal.export.vtt': 'WebVTT 字幕',
      'modal.export.po': 'PO 本地化',
      'modal.export.xliff': 'XLIFF 1.2',
      'modal.export.xliff2': 'XLIFF 2.0',
      'modal.export.sdlxliff': 'SDL XLIFF（基础）',
      'modal.export.webGroup': '网页与结构化文本',
      'modal.export.officeGroup': '办公文档',
      'modal.export.html': 'HTML 网页',
      'modal.export.jsonTree': 'JSON（保留结构）',
      'modal.export.rtf': 'RTF 富文本',
      'modal.export.xlsx': 'Excel XLSX',
      'modal.export.pptx': 'PowerPoint PPTX',
      'modal.settings.title': '设置',
      'modal.settings.ui': '界面',
      'modal.settings.uiLanguage': '界面语言',
      'modal.settings.uiAuto': '跟随 DSH 语言',
      'modal.settings.uiHint': '只影响 CAIT 界面，不会改变文档的源语言和目标语言。',
      'modal.settings.languages': '语言',
      'modal.settings.preprocess': '预处理',
      'modal.settings.preprocessHint': '在导入切句之前清理源文，占位符与标点不会被改写。',
      'modal.settings.pre.normalizeWhitespace': '折叠多余空格与制表符',
      'modal.settings.pre.stripInvisible': '移除零宽字符与控制字符',
      'modal.settings.pre.collapseBlankLines': '合并连续空行',
      'modal.settings.tm': '翻译记忆',
      'modal.settings.fuzzy': '模糊匹配阈值',
      'modal.settings.fuzzyHint': '低于 70% 的匹配通常只共享虚词，改起来比重译更慢；70% 是主流 CAT 工具的默认值。',
      'modal.settings.resetDefault': '恢复默认',
      'modal.settings.limit': '返回匹配数',
      'modal.settings.mt': '机器翻译',
      'modal.settings.provider': 'MT provider 路由',
      'modal.settings.routeHint': 'CAIT 只保存路由名和模型；API Key 由 DSH 凭据服务解析，CAIT 不接触。',
      'modal.settings.routeMissing': '已失效的路由',
      'modal.settings.noRoutes': '未检测到可用的 DSH 模型路由，当前使用术语替换（离线）。',
      'modal.settings.noModels': '该路由没有可用模型',
      'modal.settings.model': '模型',
      'modal.settings.temperature': '温度',
      'modal.settings.save': '保存设置',
      'modal.settings.cancel': '取消',
      'modal.settings.mockHint': '术语替换（离线）不联网，只使用术语库。',
      'modal.confirm.title': '确认操作',
      'modal.confirm.clearTm':
        '清空当前挂载的翻译记忆？未挂载库不会受影响；如要清空全部库，请在 API 调用中显式传 all: true。此操作无法撤销。',
      'modal.confirm.clearGlossary':
        '清空当前挂载的术语？未挂载库不会受影响；如要清空全部库，请在 API 调用中显式传 all: true。此操作无法撤销。',
      'modal.confirm.deleteTerm': '删除术语',
      'modal.confirm.deleteTm': '删除记忆库条目',
      'modal.confirm.ok': '确认',
      'modal.confirm.cancel': '取消',
      'toast.confirmed': '句段已确认并写入记忆库',
      'toast.created': '文档已创建',
      'toast.docClosed': '文档已关闭，可在“打开已有文档”中重新打开',
      'toast.docDeleted': '文档已删除',
      'toast.docsCleared': '已清理 {count} 个已关闭文档',
      'toast.docAlreadyOpen': '该文档已在工作台打开',
      'toast.imported': '导入完成',
      'toast.draftSaved': '草稿已保存',
      'toast.termSaved': '术语已保存',
      'toast.termDeleted': '术语已删除',
      'toast.tmUpdated': '记忆库条目已更新',
      'toast.tmDeleted': '记忆库条目已删除',
      'toast.tmImported': 'TMX 已导入',
      'toast.tmxMarkupLost': 'TMX 已导入；{count} 个内联占位符/格式标签已按纯文本处理，格式信息丢失。',
      'toast.glossaryImported': '术语已导入',
      'toast.tmCleared': '记忆库已清空',
      'toast.glossaryCleared': '术语库已清空',
      'toast.settingsSaved': '设置已保存',
      'toast.exported': '文件已导出',
      'toast.copied': '已复制到剪贴板',
      'toast.mtReady': '译文建议已生成',
      'toast.error': '操作失败',
      'nav.documents': '文档',
      'nav.libraries': '库',
      'library.title': '翻译记忆与术语库',
      'library.tmTab': '翻译记忆',
      'library.glossaryTab': '术语库',
      'library.scope': '搜索范围',
      'library.scopeAll': '全部库',
      'library.search': '搜索原文或译文…',
      'library.language': '全部语言',
      'library.pageSize': '每页',
      'library.pageInfo': '第 {start}–{end} 条 / 共 {total} 条',
      'library.prev': '上一页',
      'library.next': '下一页',
      'library.empty': '这个库里还没有条目。',
      'library.noMatch': '没有匹配的条目。',
      'library.add': '新增',
      'library.import': '导入',
      'library.export': '导出',
      'library.clear': '清空',
      'library.newLibrary': '新建库',
      'library.rename': '重命名',
      'library.deleteLibrary': '删除库',
      'library.deleteLibraryMessage': '删除「{name}」？库里的条目也会一起删除。',
      'library.colSource': '原文',
      'library.colTarget': '译文',
      'library.colNote': '备注',
      'library.colContext': '上下文',
      'library.colLang': '语言',
      'library.colCase': '区分大小写',
      'library.colUpdated': '更新时间',
      'library.detail': '条目详情',
      'library.detailEmpty': '点一行查看和编辑。',
      'library.save': '保存',
      'library.deleteEntry': '删除条目',
      'library.entryCreated': '已新增条目',
      'library.entrySaved': '已保存',
      'library.entryDeleted': '已删除',
      'library.exported': '已导出',
      'library.exportFormat': '导出格式',
      'library.caseSensitiveHint': '区分大小写时只匹配完全一致的写法。',
      'library.noDocHint': '不用打开文档也能管理库。',
      'rail.pageInfo': '第 {start}–{end} 条 / 共 {total} 条',
      'rail.goto': '跳到编号',
      'rail.gotoInvalid': '编号超出范围。',
      'rail.nextUnconfirmed': '下一个未确认',
      'panel.searchInLibrary': '在库中搜索',
      'panel.viewAll': '在库页面查看全部',
      'panel.glossaryMatchesOnly': '这里只显示当前句段命中的术语。',
      'nav.align': '对齐',
      'align.title': '对齐两个文件',
      'align.hint': '分别放入源文件和译文文件，CAIT 会按段落逐句配对。两个文件可以是完全不同的语言。',
      'align.sourceFile': '源文件',
      'align.targetFile': '译文文件',
      'align.pick': '未选择文件',
      'align.choose': '选择',
      'align.chars': '{count} 字符',
      'align.run': '开始对齐',
      'align.running': '对齐中…',
      'align.needFiles': '请先选择源文件和译文文件。',
      'align.readError': '读取文件失败。',
      'align.sourceLang': '源语言（可选）',
      'align.targetLang': '目标语言（可选）',
      'align.stats': '高置信 {high} · 待确认 {medium} · 可疑 {low}',
      'align.unpairedSource': '未配对原文',
      'align.unpairedTarget': '未配对译文',
      'align.blocked': '文件较大，已按段落分块对齐，结果可能不如整体对齐稳定。',
      'align.confidence': '置信度',
      'align.merge': '与下一行合并',
      'align.split': '按换行拆开',
      'align.remove': '删除这一行',
      'align.write': '写入记忆库',
      'align.writeCount': '写入选中的 {count} 条',
      'align.writeMessage': '将写入 {count} 条，完全相同的条目会被跳过。',
      'align.written': '已写入 {written} 条，跳过 {skipped} 条。',
      'align.nothing': '没有可写入的行。',
      'origin.auto': '自动传播',
      'rail.propagate': '铺满重复句段',
      'rail.propagateMessage': '把已有译文填到本文档中其它相同原文的句段（已确认的不会动）。',
      'toast.propagated': '已铺满 {count} 个句段。',
      'term.title': '术语候选',
      'term.hint': '按出现次数与长度排序，点选后填入译文即可入库。',
      'term.extract': '从文档提取术语',
      'term.empty': '没有找到重复出现的候选术语。',
      'term.add': '加入术语库',
      'term.added': '已加入 {added} 条术语。',
      'term.noDoc': '先打开一个文档再提取术语。',
      'term.inLibrary': '已有',
    }

    const EN = {
      'app.title': 'CAIT',
      'app.subtitle': 'CAT workbench',
      'nav.new': 'New',
      'nav.import': 'Import',
      'nav.export': 'Export',
      'nav.settings': 'Settings',
      'doc.switch': 'Document',
      'doc.openExisting': 'Open existing document',
      'doc.clean': 'Clean closed documents',
      'doc.cleanTitle': 'Closed documents',
      'doc.cleanHint': 'These documents are closed but still stored in CAIT. Deleting one permanently removes the document and its segments.',
      'doc.cleanAll': 'Delete all closed documents',
      'doc.cleanAllMessage': 'Permanently delete all {count} closed documents? This cannot be undone.',
      'doc.cleanEmpty': 'No closed documents.',
      'doc.delete': 'Delete document',
      'doc.deleteTitle': 'Delete document',
      'doc.deleteMessage': 'Permanently delete “{name}”? Its segments will also be deleted.',
      'doc.segments': 'segments',
      'tabs.title': 'Open documents',
      'tabs.close': 'Close document',
      'tabs.new': 'New page',
      'progress.confirmed': 'confirmed',
      'status.pending': 'Pending',
      'status.confirmed': 'Confirmed',
      'common.loading': 'Loading workbench…',
      'common.retry': 'Retry',
      'common.refresh': 'Refresh',
      'storage.saveFailed': 'Save failed: ',
      'storage.stale': 'Data changed in another window or by an agent. Your draft is preserved; save and refresh to sync.',
      'error.load': 'Could not load the CAIT workbench',
      'rail.title': 'Segments',
      'rail.search': 'Filter segments…',
      'rail.empty': 'No matching segments',
      'editor.segment': 'Segment',
      'editor.source': 'Source',
      'editor.target': 'Target',
      'editor.targetPlaceholder': 'Type the translation…',
      'editor.confirm': 'Confirm & add to TM',
      'editor.update': 'Update & add to TM',
      'editor.next': 'Next',
      'editor.prev': 'Previous',
      'editor.save': 'Save draft',
      'editor.unsaved': 'unsaved',
      'editor.chars': 'chars',
      'editor.hint': '⌘/Ctrl + Enter confirm · Alt + ↑/↓ navigate',
      'editor.emptyTarget': 'Enter a translation first',
      'editor.done': 'All segments confirmed',
      'editor.confirmedAt': 'Confirmed',
      'editor.suggestion': 'Machine suggestion',
      'editor.adopt': 'Adopt',
      'editor.adoptHint': 'Fill the target with this suggestion and keep its origin',
      'editor.remaining': 'to review',
      'status.translated': 'Translated',
      'origin.tm': 'TM',
      'origin.mt': 'MT',
      'origin.agent': 'Agent',
      'origin.manual': 'Manual',
      'rail.filter.all': 'All',
      'rail.filter.pending': 'To translate',
      'rail.filter.translated': 'To review',
      'rail.filter.confirmed': 'Confirmed',
      'rail.confirmAll': 'Confirm all',
      'rail.confirmAllHint': 'Confirm every "To review" segment at once and write them to translation memory',
      'rail.confirmAllMessage': 'This confirms {count} segment(s) awaiting review and writes them to translation memory, without reviewing them one by one. Continue?',
      'toast.confirmedMany': 'Confirmed {count} segment(s)',
      'qa.warn': 'Review note',
      'qa.exportBanner': 'Pre-export check found {count} note(s) — export is not blocked:',
      'qa.counts': 'placeholders {placeholder} · numbers {number} · terms {term} · empty {empty}',
      'qa.code.PLACEHOLDER_MISSING': 'placeholder missing',
      'qa.code.NUMBER_MISMATCH': 'number mismatch',
      'qa.code.TERM_NOT_USED': 'term unused',
      'qa.code.EMPTY_TARGET': 'empty target',
      'toast.suggestionAdopted': 'Suggestion adopted',
      'pretranslate.start': 'Pre-translate',
      'editor.noSuggestion': 'No suggestion yet — translate directly or let an agent draft it',
      'editor.baselineHint': 'The middle column is what the machine or agent produced; edit against it on the right',
      'pretranslate.title': 'Fill the whole document from TM and machine translation, then review segment by segment',
      'pretranslate.running': 'Pre-translating',
      'pretranslate.cancel': 'Stop pre-translation',
      'toast.preDone': 'Pre-translation finished, {count} segment(s) filled',
      'toast.preCancelled': 'Pre-translation stopped',
      'toast.preFailed': 'Pre-translation finished, {count} segment(s) failed',
      'empty.title': 'Start a CAT translation',
      'empty.desc': 'Paste text, drop a file, or load the demo. CAIT splits the source into segments, queries translation memory and glossary hits, and stores each confirmed pair in TM.',
      'empty.paste': 'Paste text',
      'empty.file': 'Import file',
      'empty.name': 'Document name (optional)',
      'empty.textPlaceholder': 'Paste source text here…',
      'empty.create': 'Create document',
      'empty.demo': 'Load demo document',
      'empty.demoHint': 'No material?',
      'empty.drop': 'Drop a file, or click to choose',
      'empty.formats': 'TXT · Markdown · DOCX · EPUB · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
      'empty.features.tm': 'Translation memory',
      'empty.features.tmDesc': 'Exact + fuzzy matching',
      'empty.features.glossary': 'Glossary',
      'empty.features.glossaryDesc': 'Highlighted term hits',
      'empty.features.mt': 'AI translation',
      'empty.features.mtDesc': 'Configurable endpoint',
      'modal.new.title': 'New document',
      'modal.new.name': 'Document name',
      'modal.new.namePlaceholder': 'e.g. Product handbook',
      'modal.new.sourceLang': 'Source language',
      'modal.new.targetLang': 'Target language',
      'modal.new.create': 'Create document',
      'modal.new.importing': 'Importing…',
      'modal.new.dropHint': 'TXT · Markdown · DOCX · EPUB · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
      'modal.new.csvSource': 'CSV source column',
      'modal.new.csvTarget': 'CSV target column',
      'modal.new.csvColumnPlaceholder': 'Column name or number, e.g. Source / 2',
      'modal.new.csvHint': 'Optional. Empty auto-detects Source/Target headers or uses the first two columns.',
      'modal.new.sample': 'No material?',
      'modal.new.demo': 'Load demo document',
      'panel.title': 'CAT assistant',
      'panel.live': 'live',
      'libraries.open': 'Manage mounted libraries',
      'libraries.short': 'Libraries',
      'libraries.title': 'Translation memories and glossaries',
      'libraries.desc': 'Choose which libraries this translation session searches. Keep at least one TM and one glossary mounted. Defaults receive new translations and terms.',
      'libraries.tm': 'Translation memories',
      'libraries.glossary': 'Glossaries',
      'libraries.entries': 'entries',
      'libraries.notMounted': 'not mounted',
      'libraries.defaultTm': 'Default write',
      'libraries.defaultGlossary': 'Default add',
      'libraries.empty': 'No libraries yet. Create one below.',
      'libraries.namePlaceholder': 'Library name',
      'libraries.create': 'Create',
      'libraries.done': 'Done',
      'libraries.created': 'Library created and mounted',
      'libraries.rename': 'Rename',
      'libraries.save': 'Save',
      'libraries.renamed': 'Library renamed',
      'libraries.delete': 'Delete library',
      'libraries.deleted': 'Library deleted',
      'libraries.deleteTmWarn': 'Its TM entries are deleted with it. This cannot be undone.',
      'libraries.deleteGlossaryWarn': 'Its terms are deleted with it. This cannot be undone.',
      'libraries.mountSaved': 'Mount settings saved',
      'panel.tm': 'TM',
      'panel.glossary': 'Glossary',
      'panel.mt': 'AI translate',
      'panel.currentMatches': 'Current segment matches',
      'panel.searchResults': 'Search results',
      'panel.searchPlaceholder': 'Search translation memory…',
      'panel.search': 'Search',
      'panel.noMatches': 'No matches. Confirmed segments are added to TM automatically.',
      'panel.noCurrentMatches': 'No matches for this segment yet. Confirm a translation to reuse it.',
      'panel.exact': 'exact',
      'panel.fuzzy': 'fuzzy',
      'match.exact': 'Exact',
      'match.near_exact': 'Near exact',
      'match.high_fuzzy': 'High fuzzy',
      'match.medium_fuzzy': 'Medium fuzzy',
      'match.low_fuzzy': 'Low fuzzy',
      'match.context': 'Context match',
      'panel.contextPrev': 'Prev',
      'panel.contextNext': 'Next',
      'panel.apply': 'Apply',
      'panel.importTmx': 'Import TMX',
      'panel.clearTm': 'Clear TM',
      'panel.tmHint': 'Confirmed segments are stored automatically; adjust the fuzzy threshold in Settings.',
      'panel.termHits': 'Hits in this segment',
      'panel.noHits': 'No glossary hits in this segment',
      'panel.allTerms': 'All terms',
      'panel.termSearch': 'Filter terms…',
      'panel.addTerm': 'Add term',
      'panel.termSource': 'Term',
      'panel.termTarget': 'Translation',
      'panel.termNote': 'Note (optional)',
      'panel.saveTerm': 'Save term',
      'panel.cancel': 'Cancel',
      'panel.delete': 'Delete',
      'panel.edit': 'Edit',
      'panel.saveEntry': 'Save changes',
      'panel.noTerms': 'The glossary is empty. Hits will be highlighted automatically.',
      'panel.importCsv': 'Import CSV/TSV',
      'panel.clearGlossary': 'Clear glossary',
      'panel.mtProvider': 'Provider',
      'panel.mtRoute': 'Route',
      'panel.mtGenerate': 'Generate suggestion',
      'panel.mtGenerating': 'Generating…',
      'panel.mtInsert': 'Insert translation',
      'panel.mtCopy': 'Copy',
      'panel.mtEmpty': 'Generate a machine-translation suggestion for the current segment.',
      'panel.mtModel': 'Model',
      'panel.mtSuggestion': 'MT suggestion',
      'panel.mtSettings': 'Configure route',
      'panel.mtHint': 'Calls through a DSH model route; credentials stay inside DSH.',
      'panel.mtMockHint': 'Glossary substitution is offline and uses only glossary terms. Pick a DSH route in Settings for real MT.',
      'panel.copy': 'Copy',
      'mt.mock': 'Glossary substitution (offline)',
      'modal.export.title': 'Export',
      'modal.export.desc': 'Export the current document. Bilingual formats keep source and target side by side; target-only formats are ready for delivery.',
      'modal.export.bilingual': 'Bilingual',
      'modal.export.target': 'Target only',
      'modal.export.current': 'Current document',
      'modal.export.bilingualMd': 'Markdown table',
      'modal.export.bilingualCsv': 'CSV table',
      'modal.export.tmx': 'TMX exchange',
      'modal.export.targetTxt': 'Plain text',
      'modal.export.targetMd': 'Markdown',
      'modal.export.docx': 'Word DOCX',
      'modal.export.docxGroup': 'Preserve source formatting',
      'modal.export.epub': 'EPUB ebook',
      'modal.export.epubGroup': 'Preserve source layout',
      'modal.export.json': 'Document JSON',
      'modal.export.subtitleGroup': 'Subtitles',
      'modal.export.localizationGroup': 'Localization exchange',
      'modal.export.srt': 'SRT subtitles',
      'modal.export.vtt': 'WebVTT subtitles',
      'modal.export.po': 'PO localization',
      'modal.export.xliff': 'XLIFF 1.2',
      'modal.export.xliff2': 'XLIFF 2.0',
      'modal.export.sdlxliff': 'SDL XLIFF (basic)',
      'modal.export.webGroup': 'Web and structured text',
      'modal.export.officeGroup': 'Office documents',
      'modal.export.html': 'HTML page',
      'modal.export.jsonTree': 'JSON (structure preserved)',
      'modal.export.rtf': 'RTF rich text',
      'modal.export.xlsx': 'Excel XLSX',
      'modal.export.pptx': 'PowerPoint PPTX',
      'modal.settings.title': 'Settings',
      'modal.settings.ui': 'Interface',
      'modal.settings.uiLanguage': 'Interface language',
      'modal.settings.uiAuto': 'Follow DSH language',
      'modal.settings.uiHint': 'Changes only the CAIT interface; document source and target languages are unaffected.',
      'modal.settings.languages': 'Languages',
      'modal.settings.preprocess': 'Preprocessing',
      'modal.settings.preprocessHint': 'Cleans imported source text before segmentation. Placeholders and punctuation are left untouched.',
      'modal.settings.pre.normalizeWhitespace': 'Collapse extra spaces and tabs',
      'modal.settings.pre.stripInvisible': 'Remove zero-width and control characters',
      'modal.settings.pre.collapseBlankLines': 'Merge consecutive blank lines',
      'modal.settings.tm': 'Translation memory',
      'modal.settings.fuzzy': 'Fuzzy-match threshold',
      'modal.settings.fuzzyHint':
        'Below 70% a match usually shares only function words, so editing it takes longer than retranslating. 70% is what mainstream CAT tools default to.',
      'modal.settings.resetDefault': 'Reset',
      'modal.settings.limit': 'Matches returned',
      'modal.settings.mt': 'Machine translation',
      'modal.settings.provider': 'MT provider route',
      'modal.settings.routeHint': 'CAIT stores only the route and model name; DSH resolves the API key, which CAIT never sees.',
      'modal.settings.routeMissing': 'Route no longer available',
      'modal.settings.noRoutes': 'No usable DSH model route was found. CAIT will use offline glossary substitution.',
      'modal.settings.noModels': 'This route has no available models',
      'modal.settings.model': 'Model',
      'modal.settings.temperature': 'Temperature',
      'modal.settings.save': 'Save settings',
      'modal.settings.cancel': 'Cancel',
      'modal.settings.mockHint': 'Glossary substitution is offline and only replaces glossary terms.',
      'modal.confirm.title': 'Confirm',
      'modal.confirm.clearTm':
        'Clear the currently mounted translation memories? Unmounted libraries are not affected; pass all: true to the API to clear every library. This cannot be undone.',
      'modal.confirm.clearGlossary':
        'Clear the currently mounted glossary terms? Unmounted libraries are not affected; pass all: true to the API to clear every library. This cannot be undone.',
      'modal.confirm.deleteTerm': 'Delete term',
      'modal.confirm.deleteTm': 'Delete TM entry',
      'modal.confirm.ok': 'Confirm',
      'modal.confirm.cancel': 'Cancel',
      'toast.confirmed': 'Segment confirmed and written to TM',
      'toast.created': 'Document created',
      'toast.docClosed': 'Document closed; reopen it from Open existing document',
      'toast.docDeleted': 'Document deleted',
      'toast.docsCleared': 'Cleared {count} closed documents',
      'toast.docAlreadyOpen': 'This document is already open in the workbench',
      'toast.imported': 'Import complete',
      'toast.draftSaved': 'Draft saved',
      'toast.termSaved': 'Term saved',
      'toast.termDeleted': 'Term deleted',
      'toast.tmUpdated': 'TM entry updated',
      'toast.tmDeleted': 'TM entry deleted',
      'toast.tmImported': 'TMX imported',
      'toast.tmxMarkupLost': 'TMX imported; {count} inline placeholder/format tags were flattened to plain text.',
      'toast.glossaryImported': 'Glossary imported',
      'toast.tmCleared': 'Translation memory cleared',
      'toast.glossaryCleared': 'Glossary cleared',
      'toast.settingsSaved': 'Settings saved',
      'toast.exported': 'File exported',
      'toast.copied': 'Copied to clipboard',
      'toast.mtReady': 'Suggestion ready',
      'toast.error': 'Operation failed',
      'nav.documents': 'Documents',
      'nav.libraries': 'Libraries',
      'library.title': 'Translation memory and glossary',
      'library.tmTab': 'Translation memory',
      'library.glossaryTab': 'Glossary',
      'library.scope': 'Search in',
      'library.scopeAll': 'All libraries',
      'library.search': 'Search source or target…',
      'library.language': 'All languages',
      'library.pageSize': 'Per page',
      'library.pageInfo': '{start}–{end} of {total}',
      'library.prev': 'Previous',
      'library.next': 'Next',
      'library.empty': 'This library has no entries yet.',
      'library.noMatch': 'No entries match.',
      'library.add': 'Add',
      'library.import': 'Import',
      'library.export': 'Export',
      'library.clear': 'Clear',
      'library.newLibrary': 'New library',
      'library.rename': 'Rename',
      'library.deleteLibrary': 'Delete library',
      'library.deleteLibraryMessage': 'Delete “{name}”? Its entries will be deleted too.',
      'library.colSource': 'Source',
      'library.colTarget': 'Target',
      'library.colNote': 'Note',
      'library.colContext': 'Context',
      'library.colLang': 'Language',
      'library.colCase': 'Case-sensitive',
      'library.colUpdated': 'Updated',
      'library.detail': 'Entry',
      'library.detailEmpty': 'Select a row to view and edit it.',
      'library.save': 'Save',
      'library.deleteEntry': 'Delete entry',
      'library.entryCreated': 'Entry added',
      'library.entrySaved': 'Saved',
      'library.entryDeleted': 'Deleted',
      'library.exported': 'Exported',
      'library.exportFormat': 'Format',
      'library.caseSensitiveHint': 'Case-sensitive terms match only the exact spelling.',
      'library.noDocHint': 'Manage libraries without opening a document.',
      'rail.pageInfo': '{start}–{end} of {total}',
      'rail.goto': 'Go to segment',
      'rail.gotoInvalid': 'Segment number is out of range.',
      'rail.nextUnconfirmed': 'Next unconfirmed',
      'panel.searchInLibrary': 'Search the library',
      'panel.viewAll': 'View all in libraries',
      'panel.glossaryMatchesOnly': 'Only terms that match this segment are listed here.',
      'nav.align': 'Align',
      'align.title': 'Align two files',
      'align.hint': 'Drop the source file and the translated file. CAIT pairs them paragraph by paragraph — they can be in completely different languages.',
      'align.sourceFile': 'Source file',
      'align.targetFile': 'Translated file',
      'align.pick': 'No file chosen',
      'align.choose': 'Choose',
      'align.chars': '{count} chars',
      'align.run': 'Align',
      'align.running': 'Aligning…',
      'align.needFiles': 'Choose both files first.',
      'align.readError': 'Could not read that file.',
      'align.sourceLang': 'Source language (optional)',
      'align.targetLang': 'Target language (optional)',
      'align.stats': 'high {high} · to review {medium} · doubtful {low}',
      'align.unpairedSource': 'Unpaired source',
      'align.unpairedTarget': 'Unpaired target',
      'align.blocked': 'Large files are aligned in paragraph blocks; results may be less stable than a whole-file pass.',
      'align.confidence': 'Confidence',
      'align.merge': 'Merge with the next row',
      'align.split': 'Split on line breaks',
      'align.remove': 'Remove this row',
      'align.write': 'Write to memory',
      'align.writeCount': 'Write {count} selected',
      'align.writeMessage': 'This writes {count} pair(s); identical entries are skipped.',
      'align.written': 'Wrote {written}, skipped {skipped}.',
      'align.nothing': 'Nothing selected to write.',
      'origin.auto': 'Propagated',
      'rail.propagate': 'Fill repeated segments',
      'rail.propagateMessage': 'Copy the existing translation to other segments with the same source. Confirmed segments are left alone.',
      'toast.propagated': 'Filled {count} segment(s).',
      'term.title': 'Terminology candidates',
      'term.hint': 'Ranked by occurrences and length. Pick the real terms, type a translation, and add them.',
      'term.extract': 'Mine terms from the document',
      'term.empty': 'No repeated candidate found.',
      'term.add': 'Add to glossary',
      'term.added': 'Added {added} term(s).',
      'term.noDoc': 'Open a document before mining terms.',
      'term.inLibrary': 'in library',
    }

    const JA = {
      'app.title': 'CAIT',
      'app.subtitle': 'CAT 翻訳ワークベンチ',
      'nav.new': '新規',
      'nav.import': 'インポート',
      'nav.export': 'エクスポート',
      'nav.settings': '設定',
      'doc.switch': '文書',
      'doc.openExisting': '既存の文書を開く',
      'doc.clean': '閉じた文書を整理',
      'doc.cleanTitle': '閉じた文書',
      'doc.cleanHint': 'これらの文書は閉じていますが CAIT に保存されています。削除すると文書とセグメントは完全に削除されます。',
      'doc.cleanAll': '閉じた文書をすべて削除',
      'doc.cleanAllMessage': '閉じた {count} 件の文書を完全に削除しますか？この操作は元に戻せません。',
      'doc.cleanEmpty': '閉じた文書はありません。',
      'doc.delete': '文書を削除',
      'doc.deleteTitle': '文書を削除',
      'doc.deleteMessage': '「{name}」を完全に削除しますか？この文書のセグメントも削除されます。',
      'doc.segments': 'セグメント',
      'tabs.title': '開いている文書',
      'tabs.close': '文書を閉じる',
      'tabs.new': '新しいタブ',
      'progress.confirmed': '確認済み',
      'status.pending': '未翻訳',
      'status.confirmed': '確認済み',
      'common.loading': 'ワークベンチを読み込み中…',
      'common.retry': '再試行',
      'common.refresh': '更新',
      'storage.saveFailed': '保存に失敗しました：',
      'storage.stale': 'データは別ウィンドウまたは agent の操作で更新されました。現在の下書きは上書きされていません。保存後に更新すると同期されます。',
      'error.load': 'CAIT ワークベンチを読み込めません',
      'rail.title': 'セグメント',
      'rail.search': 'セグメントを絞り込む…',
      'rail.empty': '一致するセグメントはありません',
      'editor.segment': 'セグメント',
      'editor.source': '原文',
      'editor.target': '訳文',
      'editor.targetPlaceholder': 'ここに訳文を入力…',
      'editor.confirm': '確認して TM に保存',
      'editor.update': '訳文を更新して TM に保存',
      'editor.next': '次のセグメント',
      'editor.prev': '前のセグメント',
      'editor.save': '下書きを保存',
      'editor.unsaved': '未保存',
      'editor.chars': '文字',
      'editor.hint': '⌘/Ctrl + Enter で確認 · Alt + ↑/↓ で移動',
      'editor.emptyTarget': '先に訳文を入力してください',
      'editor.done': 'すべてのセグメントを確認済み',
      'editor.confirmedAt': '確認日時',
      'editor.suggestion': '機械翻訳の提案',
      'editor.adopt': '採用',
      'editor.adoptHint': '提案を訳文に反映し、出所を保ちます',
      'editor.remaining': '件が未確認',
      'status.translated': '翻訳済み',
      'origin.tm': 'TM',
      'origin.mt': 'MT',
      'origin.agent': 'Agent',
      'origin.manual': '手動',
      'rail.filter.all': 'すべて',
      'rail.filter.pending': '未翻訳',
      'rail.filter.translated': '要確認',
      'rail.filter.confirmed': '確認済み',
      'rail.confirmAll': 'まとめて確認',
      'rail.confirmAllHint': '「要確認」の文をまとめて確認し、翻訳メモリに書き込みます',
      'rail.confirmAllMessage': '要確認の {count} 文をまとめて確認し、翻訳メモリに書き込みます。1 文ずつ見直すことはありません。続けますか？',
      'toast.confirmedMany': '{count} 文を確認しました',
      'qa.warn': 'チェック注意',
      'qa.exportBanner': '書き出し前のチェックで {count} 件の注意が見つかりました（書き出しは可能です）：',
      'qa.counts': 'プレースホルダー {placeholder} · 数字 {number} · 用語 {term} · 空訳 {empty}',
      'qa.code.PLACEHOLDER_MISSING': 'プレースホルダー欠落',
      'qa.code.NUMBER_MISMATCH': '数字の不一致',
      'qa.code.TERM_NOT_USED': '用語が未使用',
      'qa.code.EMPTY_TARGET': '訳文が空',
      'toast.suggestionAdopted': '提案を採用しました',
      'pretranslate.start': '事前翻訳',
      'editor.noSuggestion': '提案はまだありません。直接翻訳するか、agent に下訳させてください',
      'editor.baselineHint': '中央の列は機械翻訳／agent の初回出力です。右側で見比べながら直せます',
      'pretranslate.title': 'TM と機械翻訳で文書全体を下訳し、あとから文ごとに確認します',
      'pretranslate.running': '事前翻訳中',
      'pretranslate.cancel': '事前翻訳を停止',
      'toast.preDone': '事前翻訳が完了しました（{count} 文を反映）',
      'toast.preCancelled': '事前翻訳を停止しました',
      'toast.preFailed': '事前翻訳が終了しました（{count} 文が失敗）',
      'empty.title': 'CAT 翻訳を始める',
      'empty.desc': 'テキストを貼り付けるか、ファイルをドロップするか、デモ文書を読み込みます。CAIT は原文をセグメントに分割し、翻訳メモリと用語集を同時に検索します。確認した訳文は自動的に TM に保存されます。',
      'empty.paste': 'テキストを貼り付け',
      'empty.file': 'ファイルをインポート',
      'empty.name': '文書名（任意）',
      'empty.textPlaceholder': 'ここに原文を貼り付け…',
      'empty.create': '文書を作成',
      'empty.demo': 'デモ文書を読み込む',
      'empty.demoHint': '素材がありませんか？',
      'empty.drop': 'ファイルをドロップ、またはクリックして選択',
      'empty.formats': 'TXT · Markdown · DOCX · EPUB · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX に対応',
      'empty.features.tm': '翻訳メモリ',
      'empty.features.tmDesc': '完全一致＋あいまい一致',
      'empty.features.glossary': '用語集',
      'empty.features.glossaryDesc': 'ヒットを強調表示',
      'empty.features.mt': 'AI 翻訳',
      'empty.features.mtDesc': '互換エンドポイントを設定可能',
      'modal.new.title': '新規文書',
      'modal.new.name': '文書名',
      'modal.new.namePlaceholder': '例：製品マニュアル',
      'modal.new.sourceLang': '原文言語',
      'modal.new.targetLang': '訳文言語',
      'modal.new.create': '文書を作成',
      'modal.new.importing': 'インポート中…',
      'modal.new.dropHint': 'TXT · Markdown · DOCX · EPUB · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
      'modal.new.csvSource': 'CSV 原文列',
      'modal.new.csvTarget': 'CSV 訳文列',
      'modal.new.csvColumnPlaceholder': '列名または列番号（例：Source / 2）',
      'modal.new.csvHint': '任意。空の場合は Source/Target ヘッダーを自動判定するか、先頭 2 列を使用します。',
      'modal.new.sample': '素材がありませんか？',
      'modal.new.demo': 'デモ文書を読み込む',
      'panel.title': 'CAT アシスタント',
      'panel.live': 'ライブ',
      'libraries.open': 'マウント中のライブラリを管理',
      'libraries.short': 'ライブラリ',
      'libraries.title': '翻訳メモリと用語集',
      'libraries.desc': 'この翻訳セッションで検索するライブラリを選択します。TM と用語集をそれぞれ 1 つ以上マウントしてください。既定のライブラリには新しい訳文と用語が書き込まれます。',
      'libraries.tm': '翻訳メモリ',
      'libraries.glossary': '用語集',
      'libraries.entries': '件',
      'libraries.notMounted': '未マウント',
      'libraries.defaultTm': '既定の書き込み先',
      'libraries.defaultGlossary': '既定の追加先',
      'libraries.empty': 'ライブラリがまだありません。作成してください。',
      'libraries.namePlaceholder': 'ライブラリ名',
      'libraries.create': '作成',
      'libraries.done': '完了',
      'libraries.created': 'ライブラリを作成してマウントしました',
      'libraries.rename': '名前を変更',
      'libraries.save': '保存',
      'libraries.renamed': 'ライブラリ名を変更しました',
      'libraries.delete': 'ライブラリを削除',
      'libraries.deleted': 'ライブラリを削除しました',
      'libraries.deleteTmWarn': '中の TM エントリも一緒に削除され、元に戻せません。',
      'libraries.deleteGlossaryWarn': '中の用語も一緒に削除され、元に戻せません。',
      'libraries.mountSaved': 'マウント設定を保存しました',
      'panel.tm': 'TM',
      'panel.glossary': '用語集',
      'panel.mt': 'AI 翻訳',
      'panel.currentMatches': '現在のセグメントの一致',
      'panel.searchResults': '検索結果',
      'panel.searchPlaceholder': '翻訳メモリを検索…',
      'panel.search': '検索',
      'panel.noMatches': '一致する結果はありません。確認したセグメントは自動的に TM に保存されます。',
      'panel.noCurrentMatches': 'このセグメントにはまだ一致がありません。訳文を確認すると再利用できます。',
      'panel.exact': '完全一致',
      'panel.fuzzy': 'あいまい',
      'match.exact': '完全一致',
      'match.near_exact': 'ほぼ完全一致',
      'match.high_fuzzy': '高あいまい一致',
      'match.medium_fuzzy': '中あいまい一致',
      'match.low_fuzzy': '低あいまい一致',
      'match.context': 'コンテキスト一致',
      'panel.contextPrev': '前文',
      'panel.contextNext': '後文',
      'panel.apply': '適用',
      'panel.importTmx': 'TMX をインポート',
      'panel.clearTm': 'TM をクリア',
      'panel.tmHint': 'セグメントを確認すると自動的に書き込まれます。あいまい一致のしきい値は設定で変更できます。',
      'panel.termHits': 'このセグメントのヒット',
      'panel.noHits': 'このセグメントには用語ヒットがありません',
      'panel.allTerms': 'すべての用語',
      'panel.termSearch': '用語を絞り込む…',
      'panel.addTerm': '用語を追加',
      'panel.termSource': '用語',
      'panel.termTarget': '訳語',
      'panel.termNote': 'メモ（任意）',
      'panel.saveTerm': '用語を保存',
      'panel.cancel': 'キャンセル',
      'panel.delete': '削除',
      'panel.edit': '編集',
      'panel.saveEntry': '変更を保存',
      'panel.noTerms': '用語集は空です。用語を追加するとヒットが自動で強調表示されます。',
      'panel.importCsv': 'CSV/TSV をインポート',
      'panel.clearGlossary': '用語集をクリア',
      'panel.mtProvider': 'プロバイダー',
      'panel.mtRoute': 'ルート',
      'panel.mtGenerate': '訳文候補を生成',
      'panel.mtGenerating': '生成中…',
      'panel.mtInsert': '訳文を挿入',
      'panel.mtCopy': 'コピー',
      'panel.mtEmpty': '現在のセグメントの機械翻訳候補を生成します。',
      'panel.mtModel': 'モデル',
      'panel.mtSuggestion': 'MT 候補',
      'panel.mtSettings': 'ルートを設定',
      'panel.mtHint': 'DSH のモデルルート経由で呼び出します。認証情報は DSH が管理します。',
      'panel.mtMockHint': '用語置換（オフライン）はネットワークを使わず、用語集の用語だけを置換します。設定で DSH ルートを選ぶと実際の翻訳が有効になります。',
      'panel.copy': 'コピー',
      'mt.mock': '用語置換（オフライン）',
      'modal.export.title': 'エクスポート',
      'modal.export.desc': '現在の文書をエクスポートします。対訳形式は原文と訳文を並べて保持し、訳文のみの形式はそのまま納品できます。',
      'modal.export.bilingual': '対訳',
      'modal.export.target': '訳文のみ',
      'modal.export.current': '現在の文書',
      'modal.export.bilingualMd': 'Markdown テーブル',
      'modal.export.bilingualCsv': 'CSV テーブル',
      'modal.export.tmx': 'TMX 交換',
      'modal.export.targetTxt': 'プレーンテキスト',
      'modal.export.targetMd': 'Markdown',
      'modal.export.docx': 'Word DOCX',
      'modal.export.docxGroup': '元の書式を保持',
      'modal.export.epub': 'EPUB 電子書',
      'modal.export.epubGroup': '元のレイアウトを保持',
      'modal.export.json': '文書 JSON',
      'modal.export.subtitleGroup': '字幕',
      'modal.export.localizationGroup': 'ローカライズ交換',
      'modal.export.srt': 'SRT 字幕',
      'modal.export.vtt': 'WebVTT 字幕',
      'modal.export.po': 'PO ローカライズ',
      'modal.export.xliff': 'XLIFF 1.2',
      'modal.export.xliff2': 'XLIFF 2.0',
      'modal.export.sdlxliff': 'SDL XLIFF（基本）',
      'modal.export.webGroup': 'Web と構造化テキスト',
      'modal.export.officeGroup': 'オフィス文書',
      'modal.export.html': 'HTML ページ',
      'modal.export.jsonTree': 'JSON（構造を保持）',
      'modal.export.rtf': 'RTF リッチテキスト',
      'modal.export.xlsx': 'Excel XLSX',
      'modal.export.pptx': 'PowerPoint PPTX',
      'modal.settings.title': '設定',
      'modal.settings.ui': '表示',
      'modal.settings.uiLanguage': '表示言語',
      'modal.settings.uiAuto': 'DSH の言語に合わせる',
      'modal.settings.uiHint': 'CAIT の表示だけを切り替えます。文書の原文言語・訳文言語には影響しません。',
      'modal.settings.languages': '言語',
      'modal.settings.preprocess': '前処理',
      'modal.settings.preprocessHint': '取り込みと分割の前に原文を整えます。プレースホルダーと句読点は変更しません。',
      'modal.settings.pre.normalizeWhitespace': '余分な空白とタブをまとめる',
      'modal.settings.pre.stripInvisible': 'ゼロ幅文字と制御文字を除去',
      'modal.settings.pre.collapseBlankLines': '連続する空行をまとめる',
      'modal.settings.tm': '翻訳メモリ',
      'modal.settings.fuzzy': 'あいまい一致のしきい値',
      'modal.settings.fuzzyHint':
        '70% を下回る一致は機能語だけが重なることが多く、訳し直すより遅くなります。主流の CAT ツールも 70% を既定にしています。',
      'modal.settings.resetDefault': '既定に戻す',
      'modal.settings.limit': '返す一致件数',
      'modal.settings.mt': '機械翻訳',
      'modal.settings.provider': 'MT プロバイダーのルート',
      'modal.settings.routeHint': 'CAIT はルート名とモデル名だけを保存します。API キーは DSH の認証情報サービスが解決し、CAIT は触れません。',
      'modal.settings.routeMissing': '利用できないルート',
      'modal.settings.noRoutes': '利用可能な DSH モデルルートが見つかりません。用語置換（オフライン）を使用します。',
      'modal.settings.noModels': 'このルートに利用可能なモデルがありません',
      'modal.settings.model': 'モデル',
      'modal.settings.temperature': '温度',
      'modal.settings.save': '設定を保存',
      'modal.settings.cancel': 'キャンセル',
      'modal.settings.mockHint': '用語置換（オフライン）はネットワークを使わず、用語集の用語だけを置換します。',
      'modal.confirm.title': '確認',
      'modal.confirm.clearTm':
        '現在マウント中の翻訳メモリをクリアしますか？未マウントのライブラリは影響を受けません。すべてのライブラリをクリアするには API に all: true を明示してください。この操作は元に戻せません。',
      'modal.confirm.clearGlossary':
        '現在マウント中の用語をクリアしますか？未マウントのライブラリは影響を受けません。すべてのライブラリをクリアするには API に all: true を明示してください。この操作は元に戻せません。',
      'modal.confirm.deleteTerm': '用語を削除',
      'modal.confirm.deleteTm': 'TM エントリを削除',
      'modal.confirm.ok': '確認',
      'modal.confirm.cancel': 'キャンセル',
      'toast.confirmed': 'セグメントを確認して TM に保存しました',
      'toast.created': '文書を作成しました',
      'toast.docClosed': '文書を閉じました。「既存の文書を開く」から再度開けます',
      'toast.docDeleted': '文書を削除しました',
      'toast.docsCleared': '閉じた {count} 件の文書を整理しました',
      'toast.docAlreadyOpen': 'この文書はすでにワークベンチで開いています',
      'toast.imported': 'インポートが完了しました',
      'toast.draftSaved': '下書きを保存しました',
      'toast.termSaved': '用語を保存しました',
      'toast.termDeleted': '用語を削除しました',
      'toast.tmUpdated': 'TM エントリを更新しました',
      'toast.tmDeleted': 'TM エントリを削除しました',
      'toast.tmImported': 'TMX をインポートしました',
      'toast.tmxMarkupLost': 'TMX をインポートしました。{count} 個のインライン プレースホルダー/書式タグはプレーンテキストとして処理され、書式情報は失われました。',
      'toast.glossaryImported': '用語をインポートしました',
      'toast.tmCleared': '翻訳メモリをクリアしました',
      'toast.glossaryCleared': '用語集をクリアしました',
      'toast.settingsSaved': '設定を保存しました',
      'toast.exported': 'ファイルをエクスポートしました',
      'toast.copied': 'クリップボードにコピーしました',
      'toast.mtReady': '訳文候補を生成しました',
      'toast.error': '操作に失敗しました',
      'nav.documents': '文書',
      'nav.libraries': 'ライブラリ',
      'library.title': '翻訳メモリと用語集',
      'library.tmTab': '翻訳メモリ',
      'library.glossaryTab': '用語集',
      'library.scope': '検索範囲',
      'library.scopeAll': 'すべてのライブラリ',
      'library.search': '原文または訳文を検索…',
      'library.language': 'すべての言語',
      'library.pageSize': '表示件数',
      'library.pageInfo': '{start}–{end} 件 / 全 {total} 件',
      'library.prev': '前へ',
      'library.next': '次へ',
      'library.empty': 'このライブラリにはまだエントリがありません。',
      'library.noMatch': '一致するエントリはありません。',
      'library.add': '追加',
      'library.import': 'インポート',
      'library.export': 'エクスポート',
      'library.clear': 'クリア',
      'library.newLibrary': '新しいライブラリ',
      'library.rename': '名前を変更',
      'library.deleteLibrary': 'ライブラリを削除',
      'library.deleteLibraryMessage': '「{name}」を削除しますか？エントリも一緒に削除されます。',
      'library.colSource': '原文',
      'library.colTarget': '訳文',
      'library.colNote': 'メモ',
      'library.colContext': 'コンテキスト',
      'library.colLang': '言語',
      'library.colCase': '大文字小文字を区別',
      'library.colUpdated': '更新日時',
      'library.detail': 'エントリ詳細',
      'library.detailEmpty': '行を選択すると表示・編集できます。',
      'library.save': '保存',
      'library.deleteEntry': 'エントリを削除',
      'library.entryCreated': 'エントリを追加しました',
      'library.entrySaved': '保存しました',
      'library.entryDeleted': '削除しました',
      'library.exported': 'エクスポートしました',
      'library.exportFormat': '形式',
      'library.caseSensitiveHint': '大文字小文字を区別すると、完全に同じ表記だけが一致します。',
      'library.noDocHint': '文書を開かなくてもライブラリを管理できます。',
      'rail.pageInfo': '{start}–{end} 件 / 全 {total} 件',
      'rail.goto': '番号へ移動',
      'rail.gotoInvalid': '番号が範囲外です。',
      'rail.nextUnconfirmed': '次の未確認へ',
      'panel.searchInLibrary': 'ライブラリを検索',
      'panel.viewAll': 'ライブラリで全件表示',
      'panel.glossaryMatchesOnly': 'ここには現在のセグメントに一致する用語だけを表示します。',
      'nav.align': '整列',
      'align.title': '2つのファイルを整列',
      'align.hint': '原文ファイルと訳文ファイルをそれぞれ選んでください。段落ごとに 1 対 1 で対応づけます。言語が違っても構いません。',
      'align.sourceFile': '原文ファイル',
      'align.targetFile': '訳文ファイル',
      'align.pick': 'ファイル未選択',
      'align.choose': '選択',
      'align.chars': '{count} 文字',
      'align.run': '整列する',
      'align.running': '整列中…',
      'align.needFiles': '先に 2 つのファイルを選んでください。',
      'align.readError': 'ファイルを読み込めませんでした。',
      'align.sourceLang': '原文言語（任意）',
      'align.targetLang': '訳文言語（任意）',
      'align.stats': '高 {high} · 要確認 {medium} · 要注意 {low}',
      'align.unpairedSource': '未対応の原文',
      'align.unpairedTarget': '未対応の訳文',
      'align.blocked': '大きいファイルは段落ブロックごとに整列します。全体整列より不安定になることがあります。',
      'align.confidence': '信頼度',
      'align.merge': '次の行と結合',
      'align.split': '改行で分割',
      'align.remove': 'この行を削除',
      'align.write': 'メモリに保存',
      'align.writeCount': '選択した {count} 件を保存',
      'align.writeMessage': '{count} 件を保存します。同一の項目はスキップされます。',
      'align.written': '{written} 件を保存、{skipped} 件をスキップしました。',
      'align.nothing': '保存する行がありません。',
      'origin.auto': '自動反映',
      'rail.propagate': '重複セグメントを埋める',
      'rail.propagateMessage': '同じ原文の他のセグメントに既存の訳文をコピーします。確定済みは変更しません。',
      'toast.propagated': '{count} 件のセグメントを埋めました。',
      'term.title': '用語候補',
      'term.hint': '出現回数と長さで並んでいます。実際の用語だけを選び、訳語を入れて登録してください。',
      'term.extract': '文書から用語を抽出',
      'term.empty': '繰り返し現れる候補はありませんでした。',
      'term.add': '用語集に追加',
      'term.added': '{added} 件の用語を追加しました。',
      'term.noDoc': '先に文書を開いてください。',
      'term.inLibrary': '登録済み',
    }

    // UI languages offered by the in-app switch. 'auto' follows the DSH locale
    // through the bound DSH translator; the other entries use the dictionaries
    // above. Labels are native names, except 'auto', which is localized.
    const UI_LANGS = [
      ['auto', ''],
      ['zh', '简体中文'],
      ['en', 'English'],
      ['ja', '日本語'],
    ]
    const UI_LANG_CODES = UI_LANGS.map(([code]) => code)
    const UI_DICTS = { zh: ZH, en: EN, ja: JA }

    function interpolateText(text, vars) {
      if (!vars || typeof text !== 'string' || text.indexOf('{') < 0) return text
      return text.replace(/\{(\w+)\}/g, (whole, name) =>
        vars[name] === undefined || vars[name] === null ? whole : String(vars[name]),
      )
    }

    /**
     * Resolves a UI language preference to a concrete dictionary code.
     *
     * 'auto' means "follow the DSH locale": the DSH locale service reports the
     * active language tag (for example 'zh', 'zh-CN' or 'en'), and we map its
     * prefix onto one of our dictionaries. Returns '' when the preference is
     * 'auto' and the tag is unknown, so the caller can fall back to the
     * DSH-bound translator. (The bound translator alone is not enough: it only
     * answers keys registered through the very same namespace, and a lookup
     * miss silently yields the key, which used to leave 'auto' on English.)
     */
    function resolveUiLang(preference, activeLocale) {
      const value = String(preference || 'auto')
      if (value !== 'auto') return UI_LANG_CODES.includes(value) ? value : 'auto'
      const tag = String(activeLocale || '').trim().toLowerCase()
      if (!tag) return ''
      if (tag.startsWith('zh')) return 'zh'
      if (tag.startsWith('ja')) return 'ja'
      if (tag.startsWith('en')) return 'en'
      return ''
    }

    /**
     * Builds a translator for one UI language preference.
     * `dshTranslate` is the DSH-bound translator (or null) used by 'auto'.
     */
    function makeTranslator(preference, dshTranslate) {
      const code = String(preference || 'auto')
      const dict = UI_DICTS[code] || null
      return (key, vars) => {
        let text = dict ? dict[key] : null
        if (!text && dshTranslate) {
          const bound = dshTranslate(key)
          if (bound && bound !== key) text = bound
        }
        if (!text) text = EN[key] || ZH[key] || key
        return interpolateText(text, vars)
      }
    }

    return {
      // `locale` must be declared: Cordis guards service access with the inject
      // list, and reading `ctx.locale` without it throws. The throw used to be
      // swallowed by the try/catch below, leaving the DSH-bound translator null
      // and every 'auto' UI stuck on the English fallback.
      inject: ['slots', 'locale'],
      // Exposed for the Node-side pure-logic test; the Host/Client runtime
      // ignores this field.
      __test: {
        isMountToggleDisabled,
        computeNextMountIds,
        shouldAdoptRemote,
        computeCaitUnit,
        scaleCssLengths,
        caitUiBase: CAIT_UI_BASE,
        caitUiMaxUnit: CAIT_UI_MAX_UNIT,
        caitUiDamping: CAIT_UI_DAMPING,
        caitThemeAttr: CAIT_THEME_ATTR,
        detectThemeKind,
        normalizePageSize,
        readPageSize,
        writePageSize,
        pageCount,
        clampPage,
        pageBounds,
        segmentNumberToIndex,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        pageSizeDefault: PAGE_SIZE_DEFAULT,
        pageSizeStorageKey: PAGE_SIZE_STORAGE_KEY,
        defaultFuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
        fuzzyPercent,
        cssScaled: CSS_SCALED,
        syncPollMs: SYNC_POLL_MS,
        makeTranslator,
        resolveUiLang,
        uiLangCodes: UI_LANG_CODES,
      },
      apply(ctx) {
        let dshTranslate = null
        let dshActive = ''
        const localeListeners = new Set()

        const readActiveLocale = () => {
          try {
            const snapshot = ctx.locale?.getSnapshot?.()
            dshActive = typeof snapshot?.active === 'string' ? snapshot.active : ''
          } catch {
            dshActive = ''
          }
          return dshActive
        }
        readActiveLocale()

        let stopLocale = null
        try {
          if (ctx.locale?.register) {
            ctx.locale.register('dsh-cait', 'zh', ZH)
            ctx.locale.register('dsh-cait', 'en', EN)
            ctx.locale.register('dsh-cait', 'ja', JA)
          }
          if (ctx.locale?.bind) dshTranslate = ctx.locale.bind('dsh-cait')
          if (ctx.locale?.subscribe) {
            stopLocale = ctx.locale.subscribe(() => {
              readActiveLocale()
              localeListeners.forEach(listener => listener())
            })
          }
        } catch (error) {
          console.warn('[dsh-cait] locale registration failed', error)
        }
        if (stopLocale) ctx.effect(() => stopLocale)

        // The UI language comes from the plugin setting (`uiLang`), defaulting to
        // 'auto' so CAIT follows the DSH locale until the user picks one. 'auto'
        // is resolved from the locale service snapshot first (a 'zh-CN' style
        // tag still maps onto our 'zh' dictionary) and only then through the
        // DSH-bound translator.
        let preference = 'auto'
        const resolve = value => resolveUiLang(value, dshActive)
        const translate = (value, key, vars) =>
          makeTranslator(resolve(value) || 'auto', dshTranslate)(key, vars)
        const i18n = {
          get preference() {
            return preference
          },
          get activeLocale() {
            return dshActive
          },
          resolve,
          subscribe(listener) {
            if (typeof listener !== 'function') return () => {}
            localeListeners.add(listener)
            return () => localeListeners.delete(listener)
          },
          set(value) {
            preference = UI_LANG_CODES.includes(String(value)) ? String(value) : 'auto'
          },
          translate,
          t: (key, vars) => translate(preference, key, vars),
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'dsh-cait',
              order: 25,
              label: () => i18n.t('app.title'),
            },
            CaitSidebarIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'dsh-cait',
            },
            () => h(Workbench, { i18n, translate }),
          ),
        )
      },
    }
  },
})
