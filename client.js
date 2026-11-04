window.__ModuleLoader__.load({
  id: 'dsh-cait',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React

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

    const CSS = `
.cait-root{--cait-u:1;position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5}
.cait-root *{box-sizing:border-box}
.cait-root input,.cait-root textarea,.cait-root select{font:inherit;color:inherit}
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
.cait-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:31px;padding:0 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;white-space:nowrap;transition:background .12s,border-color .12s,transform .06s}
.cait-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-border-l2)}
.cait-btn:active:not(:disabled){transform:translateY(.5px)}
.cait-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
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
.cait-seg-text{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:11.5px;line-height:1.42;color:var(--dsw-alias-label-primary)}
.cait-segitem.active .cait-seg-text{font-weight:550}
.cait-seg-target{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.cait-main{display:grid;grid-template-columns:minmax(0,1fr) 344px;min-width:0;min-height:0;overflow:hidden}
.cait-main.cait-main-empty{grid-template-columns:minmax(0,1fr)}
.cait-editor-col{min-width:0;min-height:0;overflow-y:auto;padding:22px 26px 44px}
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
.cait-source-card{padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.cait-labelrow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.cait-label{font-size:10px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.cait-source-text{font-size:17px;line-height:1.65;letter-spacing:.005em;overflow-wrap:anywhere}
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
.cait-score{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:9.5px;font-weight:750;font-variant-numeric:tabular-nums}
.cait-score.exact{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);color:var(--dsw-alias-state-success-primary)}
.cait-score.near_exact{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);color:var(--dsw-alias-brand-primary)}
.cait-score.high_fuzzy{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent);color:var(--dsw-alias-state-warn-primary)}
.cait-score.medium_fuzzy{background:color-mix(in srgb,var(--dsw-alias-state-idle-primary) 13%,transparent);color:var(--dsw-alias-state-idle-primary)}
.cait-score.low_fuzzy{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-secondary)}
.cait-score-label{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.cait-minibtn{margin-left:auto;height:23px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600}
.cait-minibtn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1));color:var(--dsw-alias-brand-primary)}
.cait-card-source{margin:0 0 5px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
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
@media(max-width:1180px){.cait-main{grid-template-columns:minmax(0,1fr) 308px}.cait-body{grid-template-columns:218px minmax(0,1fr)}.cait-editor-col{padding:18px 20px 34px}.cait-actions .cait-btn-label{display:none}.cait-actions .cait-btn{padding:0 8px}}
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
      if (extension === 'docx' || extension === 'xlsx' || extension === 'pptx') {
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

    function SegmentRail({ t, doc, selected, query, setQuery, onSelect }) {
      const activeRef = useRef(null)
      useEffect(() => {
        if (activeRef.current) activeRef.current.scrollIntoView({ block: 'nearest' })
      }, [selected])

      const needle = query.trim().toLowerCase()
      const items = doc.segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => {
          if (!needle) return true
          return segment.source.toLowerCase().includes(needle) || (segment.target || '').toLowerCase().includes(needle)
        })

      return h(
        'aside',
        { className: 'cait-rail' },
        h(
          'div',
          { className: 'cait-rail-head' },
          h('div', { className: 'cait-rail-title' }, h('span', null, t('rail.title')), h('span', { className: 'cait-count' }, doc.progress.total)),
          h('div', { className: 'cait-mini-progress' }, h('i', { style: { width: `${doc.progress.percent}%` } })),
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

    function EditorPane({ t, doc, index, segment, detail, draft, setDraft, dirty, busy, onConfirm, onNext, onPrev, onSave, onApplyTerm, textareaRef }) {
      const hits = detail?.index === index ? detail.glossaryHits : []
      const charCount = Array.from(draft || '').length
      const progress = doc.progress

      const onKeyDown = (event) => {
        const mod = event.metaKey || event.ctrlKey
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
          h('span', { className: `cait-badge ${segment.status}` }, segment.status === 'confirmed' ? t('status.confirmed') : t('status.pending')),
        ),
        h(
          'div',
          { className: 'cait-source-card' },
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
          'div',
          { className: 'cait-target-area' },
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
          progress.pending === 0
            ? h('span', { className: 'cait-donechip' }, h(Icon, { name: 'check', size: 11 }), t('editor.done'))
            : h('span', null, `${progress.pending} ${t('status.pending')}`),
          segment.confirmedAt ? h('span', null, `${t('editor.confirmedAt')} ${new Date(segment.confirmedAt).toLocaleString()}`) : null,
        ),
      )
    }

    function TmMatchCard({ t, match, onApply }) {
      const matchType = match.matchType || (match.exact ? 'exact' : 'low_fuzzy')
      return h(
        'article',
        { className: 'cait-card' },
        h(
          'div',
          { className: 'cait-card-head' },
          h('span', { className: `cait-score ${matchType}` }, `${match.percent}%`),
          h('span', { className: 'cait-score-label' }, t(`match.${matchType}`)),
          h('button', { className: 'cait-minibtn', onClick: () => onApply(match) }, t('panel.apply')),
        ),
        h('p', { className: 'cait-card-source' }, match.source),
        h('p', { className: 'cait-card-target' }, match.target),
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
                  ? tmMatches.map((match) => h(TmMatchCard, { key: match.id, t, match, onApply: onApplyTm }))
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
                accept: '.txt,.md,.markdown,.tmx,.docx,.csv,.srt,.vtt,.po,.pot,.xliff,.xlf,.sdlxliff,.html,.htm,.json,.rtf,.xlsx,.pptx',
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

    function ExportModal({ t, busy, onClose, onExport }) {
      const items = [
        ['bilingual-md', t('modal.export.bilingualMd'), t('modal.export.bilingual'), 'file'],
        ['bilingual-csv', t('modal.export.bilingualCsv'), t('modal.export.bilingual'), 'file'],
        ['tmx', t('modal.export.tmx'), t('modal.export.bilingual'), 'database'],
        ['target-txt', t('modal.export.targetTxt'), t('modal.export.target'), 'download'],
        ['target-md', t('modal.export.targetMd'), t('modal.export.target'), 'download'],
        ['docx', t('modal.export.docx'), t('modal.export.docxGroup'), 'file'],
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
                  h('option', { key: item.id, value: item.id }, `${item.name} (${item.id})`),
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

    function LibrariesModal({ t, data, busy, onClose, onSetMounts, onCreate }) {
      const libraries = data.libraries || { tm: [], glossary: [] }
      const mounts = data.mounts || {
        tmIds: [],
        glossaryIds: [],
        defaultTmId: '',
        defaultGlossaryId: '',
      }
      const [tmName, setTmName] = useState('')
      const [glossaryName, setGlossaryName] = useState('')

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
                      h('strong', null, library.name),
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

    function Workbench({ t }) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState('')
      const [busy, setBusy] = useState('')
      const [selected, setSelected] = useState(0)
      const [draft, setDraft] = useState('')
      const [dirty, setDirty] = useState(false)
      const [tab, setTab] = useState('tm')
      const [railQuery, setRailQuery] = useState('')
      const [tmQuery, setTmQuery] = useState('')
      const [tmResults, setTmResults] = useState(null)
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
        mt: { provider: 'mock', model: 'cait-mock', temperature: 0.2 },
      }

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
      }, [tmQuery, doc?.id, doc?.sourceLang, doc?.targetLang, settings.fuzzyThreshold, settings.tmLimit])

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

      const addTerm = async (form) => {
        setBusy('term')
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
        if (typeof ResizeObserver === 'undefined') {
          window.addEventListener('resize', measure)
          return () => window.removeEventListener('resize', measure)
        }
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
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
        }),
        h(SaveBanner, { t, storage: data?.storage, stale, onRefresh: refreshState }),
        h(
          'div',
          { className: `cait-body${doc ? '' : ' cait-no-doc'}` },
          doc ? h(SegmentRail, { t, doc, selected: index, query: railQuery, setQuery: setRailQuery, onSelect: chooseSegment }) : null,
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
          ? h(ExportModal, { t, busy, onClose: () => setModal(null), onExport: exportAs })
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
      'empty.formats': '支持 TXT · Markdown · DOCX · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
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
      'modal.new.dropHint': 'TXT · Markdown · DOCX · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
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
      'modal.settings.languages': '语言',
      'modal.settings.tm': '翻译记忆',
      'modal.settings.fuzzy': '模糊匹配阈值',
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
      'empty.formats': 'TXT · Markdown · DOCX · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
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
      'modal.new.dropHint': 'TXT · Markdown · DOCX · TMX · CSV · SRT · VTT · PO · XLIFF · HTML · JSON · RTF · XLSX · PPTX',
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
      'modal.settings.languages': 'Languages',
      'modal.settings.tm': 'Translation memory',
      'modal.settings.fuzzy': 'Fuzzy-match threshold',
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
    }

    return {
      inject: ['slots'],
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
        cssScaled: CSS_SCALED,
        syncPollMs: SYNC_POLL_MS,
      },
      apply(ctx) {
        let t = (key) => ZH[key] || EN[key] || key
        try {
          if (ctx.locale?.register) {
            ctx.locale.register('dsh-cait', 'zh', ZH)
            ctx.locale.register('dsh-cait', 'en', EN)
            t = ctx.locale.bind('dsh-cait')
          }
        } catch (error) {
          console.warn('[dsh-cait] locale registration failed', error)
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'dsh-cait',
              order: 25,
              label: () => t('app.title'),
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
            () => h(Workbench, { t }),
          ),
        )
      },
    }
  },
})
