// ─── CSRF token plumbing ───────────────────────────────────────────────────
// Server (app/middleware/csrf.js) sets a non-HttpOnly `csrf-token` cookie on
// every response (double-submit pattern). This module reads that cookie and
// transparently attaches it as the `x-csrf-token` header on every
// state-changing fetch (non-GET/HEAD/OPTIONS). Importing this module is
// enough — it patches window.fetch once at load time.
//
// Because every page (dashboard, login, kiosk live/multi-live) imports a chain
// that reaches ./device.js, importing this from device.js guarantees the patch
// is installed before any user-triggered request.

const CSRF_COOKIE = 'csrf-token'
const CSRF_HEADER = 'x-csrf-token'

/** Read a cookie value by name (URL-decoded). */
export function getCookie(name) {
    const match = document.cookie.match(
        new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
    )
    return match ? decodeURIComponent(match[1]) : ''
}

/** Merge extra headers into an existing headers object or Headers instance. */
function mergeHeaders(existing, extra) {
    if (!existing) return extra
    if (existing instanceof Headers) {
        const merged = new Headers(existing)
        for (const [key, value] of Object.entries(extra)) merged.set(key, value)
        return merged
    }
    return { ...existing, ...extra }
}

/** Attach the CSRF header only to state-changing requests. */
function csrfFetch(input, init = {}) {
    const method = (
        init?.method ||
        (typeof input === 'string' ? 'GET' : input?.method) ||
        'GET'
    ).toUpperCase()

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const cookie = getCookie(CSRF_COOKIE)
        if (cookie) {
            // Cookie berisi "token|hash"; server hanya membandingkan bagian
            // token (sebelum delimiter '|') dengan header. Kirim token saja.
            const token = cookie.split('|')[0]
            if (token) {
                init = { ...init, headers: mergeHeaders(init.headers, { [CSRF_HEADER]: token }) }
            }
        }
    }
    return originalFetch(input, init)
}

const originalFetch = window.fetch.bind(window)
window.fetch = csrfFetch

export default csrfFetch
