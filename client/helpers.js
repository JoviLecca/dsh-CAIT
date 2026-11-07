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
