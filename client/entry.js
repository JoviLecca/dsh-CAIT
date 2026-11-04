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
