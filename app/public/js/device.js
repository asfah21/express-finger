// ─── Kiosk device identity ────────────────────────────────────────────────────
// Each kiosk browser generates a persistent UUID (device_id) on first access and
// keeps it in localStorage. Every kiosk request (login, heartbeat, attendance)
// sends it via the x-device-id header so the server can enforce the device
// whitelist / approval policy for the 'public' role.
//
// NOTE: this module is intentionally dependency-free so it can be imported by
// both the dashboard auth flow and the standalone kiosk pages.

const DEVICE_KEY = 'kiosk_device_id'
const HEADER_NAME = 'x-device-id'

/**
 * Return (and lazily create) the persistent kiosk device id.
 * @returns {string} UUID stored in localStorage.
 */
export function getDeviceId() {
    try {
        let id = localStorage.getItem(DEVICE_KEY)
        if (!id) {
            id = crypto.randomUUID ? crypto.randomUUID() : generateFallbackId()
            localStorage.setItem(DEVICE_KEY, id)
        }
        return id
    } catch (err) {
        // localStorage unavailable (e.g. private mode) — fall back to a session id.
        return sessionFallbackId()
    }
}

/**
 * Headers to attach to kiosk requests. Spread into fetch options.
 * @returns {Record<string, string>}
 */
export function deviceHeaders() {
    const headers = {}
    headers[HEADER_NAME] = getDeviceId()
    return headers
}

/** True when the current user's role is 'public' (kiosk account). */
export function isKioskUser(user) {
    return Boolean(user && user.role === 'public')
}

/**
 * Human-friendly message for a kiosk device error code (from the server),
 * so kiosk pages can guide the operator instead of showing a raw error.
 * @param {string} code e.g. 'DEVICE_PENDING'
 * @returns {string|null} null when the code is not a device-gate code.
 */
export function kioskDeviceErrorMessage(code) {
    switch (code) {
        case 'DEVICE_REQUIRED':
            return 'Perangkat kiosk tidak teridentifikasi. Silakan muat ulang halaman.'
        case 'DEVICE_UNREGISTERED':
            return 'Perangkat ini belum terdaftar. Hubungi administrator untuk mendaftarkannya.'
        case 'DEVICE_PENDING':
            return 'Perangkat ini menunggu persetujuan administrator. Silakan tunggu.'
        case 'DEVICE_REVOKED':
            return 'Akses perangkat kiosk ini telah dicabut oleh administrator.'
        case 'DEVICE_BOUND_OTHER':
            return 'Perangkat kiosk ini terikat ke akun lain. Hubungi administrator.'
        case 'FORBIDDEN_ROLE':
            return 'Akun ini tidak diizinkan mengakses layanan kiosk.'
        default:
            return null
    }
}

/** Deterministic v4-ish fallback (no crypto.randomUUID). */
function generateFallbackId() {
    const bytes = new Uint8Array(16)
    if (globalThis.crypto && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes)
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

let sessionFallback = null
function sessionFallbackId() {
    if (!sessionFallback) sessionFallback = generateFallbackId()
    return sessionFallback
}
