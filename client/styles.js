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
.cait-editor-col{min-width:0;min-height:0;overflow-y:auto;padding:22px 26px 44px;container-type:inline-size}
.cait-review{display:grid;gap:10px;grid-template-columns:minmax(0,1fr);grid-template-areas:"src" "sugg" "target";align-items:start}
.cait-revcol{min-width:0;padding:13px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.cait-rev-src{grid-area:src}
.cait-rev-sugg{grid-area:sugg;display:flex;flex-direction:column;gap:6px;border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 38%,transparent)}
.cait-rev-target{grid-area:target;display:flex;flex-direction:column;gap:6px}
.cait-rev-target .cait-textarea{min-height:150px;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-base)}
@container (min-width:700px){.cait-review{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);grid-template-areas:"src sugg" "src target";grid-template-rows:auto 1fr}}
@container (min-width:1010px){.cait-review{grid-template-columns:minmax(0,1fr) minmax(0,0.85fr) minmax(0,1.1fr);grid-template-areas:"src sugg target";grid-template-rows:1fr}}
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
