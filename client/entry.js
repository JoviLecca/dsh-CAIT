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
            ctx.locale.register('cait', 'zh', ZH)
            ctx.locale.register('cait', 'en', EN)
            t = ctx.locale.bind('cait')
          }
        } catch (error) {
          console.warn('[cait] locale registration failed', error)
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'cait',
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
              key: 'cait',
            },
            () => h(Workbench, { t }),
          ),
        )
      },
    }
  },
})
