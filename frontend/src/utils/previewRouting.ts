export function isWebPreviewInput(val: string): boolean {
  const s = val.trim()
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return true
  if (/^\/\//.test(s)) return true
  if (/^:?\d+(\/.*)?$/.test(s)) return true
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true
  if (/^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(s)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return true
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}([/:?#].*)?$/.test(s)) return true
  return false
}

export function normalizeWebUrl(val: string): string {
  const v = val.trim()
  if (/^\/\//.test(v)) return `https:${v}`
  if (/^https?:\/\//i.test(v)) return v
  const portSh = v.match(/^:?(\d+)(\/.*)?$/)
  if (portSh) {
    const path = portSh[2] || '/'
    return `http://localhost:${portSh[1]}${path.startsWith('/') ? path : `/${path}`}`
  }
  if (/^localhost/i.test(v) || /^127\.0\.0\.1/.test(v)) {
    return /:\/\//.test(v) ? v : `http://${v}`
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(v)) {
    return `http://${v}`
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}([/:?#].*)?$/.test(v)) {
    return `https://${v}`
  }
  return `http://${v}`
}

function isPrivateHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true
  }
  if (!/\.[a-zA-Z]{2,}$/.test(host)) return true
  if (/\.(local|internal|lan|home|intranet|corp|test)$/i.test(host)) return true
  return false
}

export function urlToPreviewSrc(url: string, embeddedHttpOrigin?: string): string {
  if (!url) return 'about:blank'
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')

    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      const basePath = `/preview/${port}${parsed.pathname}${parsed.search}${parsed.hash}`
      const base = embeddedHttpOrigin?.replace(/\/$/, '')
      return base ? `${base}${basePath}` : basePath
    }

    if (isPrivateHost(host)) {
      const basePath = `/preview/${host}/${port}${parsed.pathname}${parsed.search}${parsed.hash}`
      const base = embeddedHttpOrigin?.replace(/\/$/, '')
      return base ? `${base}${basePath}` : basePath
    }

    const proxyPath = `/api/proxy?url=${encodeURIComponent(url)}`
    const base = embeddedHttpOrigin?.replace(/\/$/, '')
    return base ? `${base}${proxyPath}` : proxyPath
  } catch {}
  return url
}
