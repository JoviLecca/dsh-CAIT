import { MOCK_PROVIDER, NO_MODEL_MESSAGE, NO_ROUTE_MESSAGE } from './mt.js'

/**
 * routes: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const routeMethods = {
  async listMtRoutes(options = {}) {
    if (this.mtRuntime && typeof this.mtRuntime.listRoutes === 'function') {
      return this.mtRuntime.listRoutes(options)
    }
    return { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
  },

  /**
   * Resolve the configured DSH route once, so single and batch translation
   * share the same mock/fallback behaviour.
   */
  async resolveMtRoute() {
    const provider = this.settings.mt.provider
    let routes
    try {
      routes = await this.listMtRoutes()
    } catch {
      routes = { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
    }
    const providers = Array.isArray(routes?.providers) ? routes.providers : []
    if (provider === MOCK_PROVIDER) {
      return {
        mock: true,
        note: providers.length ? '术语替换（离线）：当前未调用 DSH 模型。' : NO_ROUTE_MESSAGE,
      }
    }
    const selectedRoute = providers.find((route) => route.id === provider)
    if (!selectedRoute) return { mock: true, note: NO_ROUTE_MESSAGE }
    const models = Array.isArray(selectedRoute.models) ? selectedRoute.models : []
    const model = models.some((item) => item.id === this.settings.mt.model)
      ? this.settings.mt.model
      : models[0]?.id
    if (!model) return { mock: true, note: NO_MODEL_MESSAGE }
    return { mock: false, provider, model }
  },

  /**
   * Review may intentionally use a different route than bulk MT. An empty
   * review provider inherits the MT route, which keeps old settings working.
   */
  async resolveReviewRoute() {
    const provider = String(this.settings.review?.provider || '').trim()
    if (!provider) {
      return { ...(await this.resolveMtRoute()), inherited: true }
    }
    let routes
    try {
      routes = await this.listMtRoutes()
    } catch {
      routes = { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
    }
    const providers = Array.isArray(routes?.providers) ? routes.providers : []
    if (provider === MOCK_PROVIDER) {
      return { mock: true, note: NO_ROUTE_MESSAGE, inherited: false }
    }
    const selectedRoute = providers.find((route) => route.id === provider)
    if (!selectedRoute) return { mock: true, note: NO_ROUTE_MESSAGE, inherited: false }
    const models = Array.isArray(selectedRoute.models) ? selectedRoute.models : []
    const wanted = String(this.settings.review?.model || '').trim()
    const model = models.some((item) => item.id === wanted) ? wanted : models[0]?.id
    if (!model) return { mock: true, note: NO_MODEL_MESSAGE, inherited: false }
    return { mock: false, provider, model, inherited: false }
  },
}
