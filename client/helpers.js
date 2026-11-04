    const API = '/cait/api/rpc'
    const SYNC_POLL_MS = 2000

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
    // DSH panel area. Fullscreen/maximized windows on 1440p and 4K displays
    // were still capped at 1.4× with the old 1320×800 base, which left the
    // 13px body type visibly smaller than the surrounding DSH UI. Keep the
    // height term so short windows do not overflow, but let large panels grow
    // to 1.8× before the cap applies.
    const CAIT_UI_BASE = { width: 1100, height: 680 }
    const CAIT_UI_MIN_UNIT = 1
    const CAIT_UI_MAX_UNIT = 1.8

    // Grow with the panel but never shrink below the designed size; the height
    // term keeps short/wide windows from becoming oversized and scroll-heavy.
    function computeCaitUnit({ width, height } = {}) {
      const w = Number(width)
      const h = Number(height)
      if (!(w > 0) || !(h > 0)) return CAIT_UI_MIN_UNIT
      const fit = Math.min(w / CAIT_UI_BASE.width, h / CAIT_UI_BASE.height)
      const unit = Math.min(CAIT_UI_MAX_UNIT, Math.max(CAIT_UI_MIN_UNIT, fit))
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
