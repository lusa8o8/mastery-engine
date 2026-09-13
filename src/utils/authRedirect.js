const DEFAULT_AUTH_RETURN_PATH = '/home'

const ALLOWED_RETURN_PATHS = [
  '/home',
  '/upload',
  '/vault',
  '/patterns',
  '/simulate',
  '/engine',
  '/summary',
  '/progress'
]

function isAllowedPath(pathname) {
  return ALLOWED_RETURN_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}

// OAuth redirects cross a trust boundary. Only return to known routes inside
// Atlas; display labels, query parameters, and provider responses are not URLs.
export function sanitizeAuthReturnPath(value) {
  if (typeof value !== 'string') return DEFAULT_AUTH_RETURN_PATH

  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return DEFAULT_AUTH_RETURN_PATH
  }

  try {
    const parsed = new URL(candidate, 'https://atlas.invalid')
    if (parsed.origin !== 'https://atlas.invalid' || !isAllowedPath(parsed.pathname)) {
      return DEFAULT_AUTH_RETURN_PATH
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_AUTH_RETURN_PATH
  }
}

export function locationToReturnPath(location) {
  if (!location) return DEFAULT_AUTH_RETURN_PATH
  if (typeof location === 'string') return sanitizeAuthReturnPath(location)

  const path = `${location.pathname || ''}${location.search || ''}${location.hash || ''}`
  return sanitizeAuthReturnPath(path)
}

export function buildGoogleOAuthRedirectUrl(origin, returnPath) {
  const parsedOrigin = new URL(origin)
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
    throw new Error('Atlas OAuth redirects require an HTTP or HTTPS origin.')
  }

  const callback = new URL('/auth', parsedOrigin.origin)
  callback.searchParams.set('next', sanitizeAuthReturnPath(returnPath))
  return callback.toString()
}

export function hasOAuthCallbackError(search = '', hash = '') {
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return Boolean(
    searchParams.get('error') ||
    searchParams.get('error_code') ||
    hashParams.get('error') ||
    hashParams.get('error_code')
  )
}

export { DEFAULT_AUTH_RETURN_PATH }
