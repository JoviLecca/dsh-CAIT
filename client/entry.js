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
        makeTranslator,
        uiLangCodes: UI_LANG_CODES,
      },
      apply(ctx) {
        let dshTranslate = null
        try {
          if (ctx.locale?.register) {
            ctx.locale.register('dsh-cait', 'zh', ZH)
            ctx.locale.register('dsh-cait', 'en', EN)
            ctx.locale.register('dsh-cait', 'ja', JA)
            dshTranslate = ctx.locale.bind('dsh-cait')
          }
        } catch (error) {
          console.warn('[dsh-cait] locale registration failed', error)
        }

        // The UI language comes from the plugin setting (`uiLang`), defaulting to
        // 'auto' so CAIT follows the DSH locale until the user picks one.
        let preference = 'auto'
        const translate = (value, key, vars) => makeTranslator(value, dshTranslate)(key, vars)
        const i18n = {
          get preference() {
            return preference
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
