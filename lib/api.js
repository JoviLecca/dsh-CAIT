import { CatError } from './store.js'
import { CAIT_VERSION } from './store-utils.js'

const API_PREFIX = '/cait/api'
const MAX_BODY = 32 * 1024 * 1024

const MUTATIONS = new Set([
  'createDocument',
  'deleteDocument',
  'openDocument',
  'closeDocument',
  'importFile',
  'importTmx',
  'loadDemo',
  'selectSegment',
  'saveDraft',
  'adoptSuggestion',
  'proposeTranslation',
  'writeAlignment',
  'propagateDocument',
  'addGlossaryEntries',
  'preTranslate',
  'confirmSegments',
  'confirmSegment',
  'moveSegment',
  'addTM',
  'updateTM',
  'deleteTM',
  'importTM',
  'clearTM',
  'addGlossary',
  'updateGlossary',
  'deleteGlossary',
  'importGlossary',
  'clearGlossary',
  'createLibrary',
  'renameLibrary',
  'deleteLibrary',
  'setMounts',
  'saveSettings',
])

function sendJson(res, status, payload) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.resume()
      reject(error)
    }

    const onData = (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        fail(new CatError('BODY_TOO_LARGE', '请求体过大。', 413))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onError = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

function confirmDangerous(fn) {
  return (params) => {
    if (params?.confirm !== true) {
      throw new CatError('CONFIRMATION_REQUIRED', '该操作需要二次确认。', 409)
    }
    return fn(params)
  }
}

function createHandlers(store) {
  return {
    bootstrap: () => store.bootstrap(),
    listMtRoutes: (params) => store.listMtRoutes(params),
    createDocument: (params) => store.createDocument(params),
    deleteDocument: (params) => store.deleteDocument(params),
    openDocument: (params) => store.openDocument(params),
    closeDocument: (params) => store.closeDocument(params),
    importFile: (params) => store.importFile(params),
    importTmx: (params) => store.importTmx(params),
    loadDemo: () => store.loadDemo(),
    selectSegment: (params) => store.selectSegment(params),
    saveDraft: (params) => store.saveDraft(params),
    adoptSuggestion: (params) => store.adoptSuggestion(params),
    proposeTranslation: (params) => store.proposeTranslation(params),
    writeAlignment: (params) => store.writeAlignment(params),
    readUploadText: (params) => store.readUploadText(params),
    alignUploads: (params) => store.alignUploads(params),
    consistencyReport: (params) => store.consistencyReport(params),
    termCandidates: (params) => store.termCandidates(params),
    addGlossaryEntries: (params) => store.addGlossaryEntries(params),
    propagateDocument: (params) => store.propagateDocument(params),
    preTranslate: (params) => store.preTranslate(params),
    confirmSegments: (params) => store.confirmSegmentsForTool(params),
    getQaReport: (params) => store.getQaReport(params),
    confirmSegment: (params) => store.confirmSegment(params),
    moveSegment: (params) => store.moveSegment(params),

    lookupTM: (params) => {
      const result = store.lookupTM(params)
      return { ...result, count: result.matches.length }
    },
    listTmEntries: (params) => store.listTmEntries(params),
    listGlossaryEntries: (params) => store.listGlossaryEntries(params),
    exportTM: (params) => store.exportTM(params),
    exportGlossary: (params) => store.exportGlossary(params),
    addTM: (params) => store.addTM(params),
    updateTM: (params) => store.updateTM(params),
    deleteTM: (params) => store.deleteTM(params),
    importTM: (params) => store.importTM(params),
    clearTM: confirmDangerous((params) => store.clearTM(params)),

    addGlossary: (params) => store.addGlossary(params),
    updateGlossary: (params) => store.updateGlossary(params),
    deleteGlossary: (params) => store.deleteGlossary(params),
    importGlossary: (params) => store.importGlossary(params),
    clearGlossary: confirmDangerous((params) => store.clearGlossary(params)),

    createLibrary: (params) => store.createLibrary(params),
    renameLibrary: (params) => store.renameLibrary(params),
    deleteLibrary: (params) => store.deleteLibrary(params),
    setMounts: (params) => store.setMounts(params),
    saveSettings: (params) => store.saveSettings(params),
    mtSuggest: (params) => store.mtSuggest(params),
    exportDocument: (params) => {
      const result = store.exportDocument(params)
      if (result && Buffer.isBuffer(result.content)) {
        return { ...result, content: result.content.toString('base64'), encoding: 'base64' }
      }
      return result
    },
  }
}

export function registerCatApi(ctx, store) {
  let webServer
  let connection
  try {
    webServer = ctx.webServer
    connection = ctx.connection
  } catch {
    return () => {}
  }
  if (!webServer || !connection) return () => {}

  const handlers = createHandlers(store)

  const handler = async (req, res) => {
    try {
      const rejection = connection.requestRejection(req)
      if (rejection) {
        sendJson(res, rejection, {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: 'CAIT API 仅接受本机同源请求。' },
        })
        return
      }

      const url = new URL(req.url || '/', 'http://cait.local')
      if (url.pathname === `${API_PREFIX}/health`) {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET。' } })
          return
        }
        sendJson(res, 200, { ok: true, data: { name: 'cait', version: CAIT_VERSION } })
        return
      }

      if (url.pathname !== `${API_PREFIX}/rpc`) {
        sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在。' } })
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST。' } })
        return
      }
      if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
        sendJson(res, 415, { ok: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '请求必须为 JSON。' } })
        return
      }

      const raw = await readBody(req)
      let payload
      try {
        payload = JSON.parse(raw || '{}')
      } catch {
        throw new CatError('INVALID_JSON', '请求 JSON 解析失败。')
      }

      const method = String(payload?.method ?? '')
      if (!Object.hasOwn(handlers, method)) {
        throw new CatError('UNKNOWN_METHOD', `未知的 CAIT 方法: ${method || '(empty)'}`, 404)
      }

      const params = payload.params && typeof payload.params === 'object' ? payload.params : {}
      const result = await handlers[method](params)
      const data = MUTATIONS.has(method)
        ? { ...(result ?? {}), state: store.bootstrap() }
        : result
      sendJson(res, 200, { ok: true, data })
    } catch (error) {
      const status = error instanceof CatError ? error.status : 500
      const code = error instanceof CatError ? error.code : 'INTERNAL_ERROR'
      const message = error instanceof CatError
        ? error.message
        : 'CAIT 服务发生内部错误。'
      if (!(error instanceof CatError)) {
        try {
          ctx.logger?.('cait')?.error?.(error)
        } catch {
          // logging must never mask the response
        }
      }
      sendJson(res, status, { ok: false, error: { code, message } })
    }
  }

  return webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
}
