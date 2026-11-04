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
