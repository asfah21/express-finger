/**
 * Rate Limiter Middleware (hardened)
 * Melindungi endpoint dari brute force, credential stuffing, dan abuse/DoS.
 * Menggunakan express-rate-limit v8 dengan in-memory store (tanpa dependensi
 * eksternal tambahan), standar header draft-8 (RateLimit-*), dan Retry-After.
 *
 * Strategi "defense in depth":
 *  - Global catch-all limiter (setiap request) → menahan banjir ke endpoint
 *    yang tidak dilindungi limiter khusus (/, /health, static, rute tak dikenal).
 *  - Lapisan per-IP DAN per-account (username) pada endpoint sensitif
 *    (login, verify) agar brute force satu akun maupun password spraying
 *    lintas-akun dari satu origin/NAT sama-sama terblokir.
 *  - Limiter per-perangkat (SN / device-id) pada operasi berat (sync, /iclock,
 *    kiosk live) sehingga satu IP tidak bisa menghantam banyak perangkat.
 *  - Semua ambang batas dapat disetel via env (RATE_LIMIT_*), lihat .env.example.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { sendError } from '../utils/response.js'
import { config } from '../config/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve IP klien menjadi kunci rate-limit yang stabil.
 * Memakai generator IPv6-aware dari library sehingga klien IPv6 tidak bisa
 * memutar-mutar alamat dalam subnet /56-nya untuk mem-bypass limit.
 */
const getIpKey = (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || '')

/**
 * Kunci "akun" untuk limit per-account. Prioritas:
 *   1. nilai yang diberikan pemanggil (mis. req.body.username / req.user.username)
 *   2. req.user (setelah auth)
 *   3. fallback per-IP untuk request tanpa identitas akun (malformed/bot).
 */
const getAccountKey = (req, fromRequest) => {
  const candidate = fromRequest?.(req) ?? req.user?.username ?? req.body?.username
  if (candidate) return `acct:${String(candidate).trim().toLowerCase()}`
  return `acct:${getIpKey(req)}`
}

/**
 * Handler 429 konsisten: log kunci yang melanggar + respon JSON.
 * (Header Retry-After & RateLimit-* sudah diset otomatis oleh library.)
 */
const makeHandler = (label, message) => (req, res) => {
  const key = req.rateLimit?.key ?? req.ip ?? 'unknown'
  console.warn(`⚠️ [RATE LIMIT] ${label} exceeded (key: ${key})`)
  return sendError(res, message, 429)
}

/**
 * Bangun limiter dengan opsi umum: header standar draft-8, tanpa legacy header,
 * pesan JSON, dan handler 429 yang konsisten (bisa di-override).
 */
const makeLimiter = ({ label, message, max, windowMs, keyGenerator, handler }) =>
  rateLimit({
    windowMs,
    max,
    message: { status: 'error', message },
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    handler: handler ?? makeHandler(label, message),
  })

// ---------------------------------------------------------------------------
// 1) GLOBAL — setiap request, sebelum body parsing / kompresi / rute.
// Menahan banjir ke endpoint yang tidak punya limiter khusus. Cukup longgar
// agar kantor dengan satu IP NAT bersama tidak terkunci.
// ---------------------------------------------------------------------------
export const globalLimiter = makeLimiter({
  label: 'GLOBAL',
  message: 'Too many requests, please slow down.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_GLOBAL_MAX,
})

// ---------------------------------------------------------------------------
// 2) AUTH — proteksi umum /auth (login punya lapisan khusus di bawah).
// ---------------------------------------------------------------------------
export const authLimiter = makeLimiter({
  label: 'AUTH',
  message: 'Too many requests, please slow down.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_AUTH_MAX,
})

// ---------------------------------------------------------------------------
// 3) LOGIN — dua lapisan bertumpuk (defense in depth):
//    a) per-account (username)  → blokir brute force pada satu akun
//    b) per-IP                  → blokir password spraying lintas-akun
//       dari satu origin/NAT. Aplikasikan BERTURUTAN pada /auth/login.
// ---------------------------------------------------------------------------
export const loginLimiter = makeLimiter({
  label: 'LOGIN-ACCOUNT',
  message: 'Too many login attempts. Please try again later.',
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_LOGIN_ACCOUNT_MAX,
  keyGenerator: (req) => {
    const username = req.body?.username
    if (username) return `login:acct:${String(username).trim().toLowerCase()}`
    // Fallback per-IP untuk request tanpa username (malformed / bot).
    return `login:acct:${getIpKey(req)}`
  },
})

export const loginIpLimiter = makeLimiter({
  label: 'LOGIN-IP',
  message: 'Too many login attempts. Please try again later.',
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_LOGIN_IP_MAX,
})

// ---------------------------------------------------------------------------
// 4) VERIFY (autentikasi ulang password sebelum akses settings)
//    per-IP + per-account, keduanya dipasang pada /auth/verify.
// ---------------------------------------------------------------------------
export const verifyLimiter = makeLimiter({
  label: 'VERIFY-IP',
  message: 'Too many verification attempts. Please try again later.',
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_VERIFY_IP_MAX,
})

export const verifyAccountLimiter = makeLimiter({
  label: 'VERIFY-ACCOUNT',
  message: 'Too many verification attempts. Please try again later.',
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_VERIFY_ACCOUNT_MAX,
  keyGenerator: (req) => `verify:acct:${getAccountKey(req)}`,
})

// ---------------------------------------------------------------------------
// 5) USER MANAGEMENT — operasi superadmin sensitif (buat user, hapus user,
//    reset password, ubah role). Ketat per-IP + per-account agar sesi yang
//    disusupi tidak bisa mengubah database user secara massal/cepat.
// ---------------------------------------------------------------------------
export const userManagementLimiter = makeLimiter({
  label: 'USER-MGMT-IP',
  message: 'Too many user management operations. Please try again later.',
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_USER_MGMT_IP_MAX,
})

export const userManagementAccountLimiter = makeLimiter({
  label: 'USER-MGMT-ACCOUNT',
  message: 'Too many user management operations. Please try again later.',
  windowMs: 15 * 60 * 1000,
  max: config.RATE_LIMIT_USER_MGMT_ACCOUNT_MAX,
  keyGenerator: (req) => `usermgmt:acct:${getAccountKey(req)}`,
})

// ---------------------------------------------------------------------------
// 6) GENERAL API — baseline per menit + cap burst jendela pendek untuk
//    menangkap scraping/abuse cepat tanpa mengganggu pemakaian normal.
// ---------------------------------------------------------------------------
export const apiLimiter = makeLimiter({
  label: 'API',
  message: 'Too many requests, please slow down.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_API_MAX,
})

export const apiBurstLimiter = makeLimiter({
  label: 'API-BURST',
  message: 'Too many requests, please slow down.',
  windowMs: config.RATE_LIMIT_API_BURST_WINDOW_MS,
  max: config.RATE_LIMIT_API_BURST_MAX,
})

// ---------------------------------------------------------------------------
// 7) SYNC / OPERASI BERAT — per-IP moderat + per-perangkat (target sn/ip
//    dari payload) agar satu IP tidak bisa menghantam satu perangkat berulang.
// ---------------------------------------------------------------------------
const getSyncDeviceKey = (req) => {
  const dev = req.body?.sn || req.body?.ip || req.query?.sn || req.query?.ip
  if (dev) return `sync:dev:${String(dev).trim().toLowerCase()}`
  return `sync:dev:${getIpKey(req)}`
}

export const syncLimiter = makeLimiter({
  label: 'SYNC',
  message: 'Too many sync requests. Please wait before trying again.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_SYNC_MAX,
})

export const syncDeviceLimiter = makeLimiter({
  label: 'SYNC-DEVICE',
  message: 'Too many sync requests for this device. Please wait before trying again.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_SYNC_DEVICE_MAX,
  keyGenerator: getSyncDeviceKey,
})

// ---------------------------------------------------------------------------
// 8) ACTIVITY LOG — mengikuti laju polling dashboard (manual refresh).
// ---------------------------------------------------------------------------
export const activityLogLimiter = makeLimiter({
  label: 'ACTIVITY-LOG',
  message: 'Too many requests, please slow down.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_ACTIVITY_LOG_MAX,
})

// ---------------------------------------------------------------------------
// 9) /ICLOCK (protokol perangkat ZK tanpa autentikasi) — per-IP + per-SN.
// Respon 429 teks polos agar perangkat tidak mengira respons JSON.
// ---------------------------------------------------------------------------
const iclockHandler = (label) => (req, res) => {
  console.warn(`⚠️ [RATE LIMIT] /iclock ${label} exceeded (key: ${req.rateLimit?.key ?? req.ip})`)
  return res.status(429).send('Too many device requests')
}

const getIclockDeviceKey = (req) => {
  const sn = req.query?.SN || req.query?.sn
  if (sn) return `iclock:dev:${String(sn).trim().toUpperCase()}`
  return `iclock:dev:${getIpKey(req)}`
}

export const iclockLimiter = makeLimiter({
  label: 'ICLOCK-IP',
  message: 'Too many device requests',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_ICLOCK_IP_MAX,
  handler: iclockHandler('IP'),
})

export const iclockDeviceLimiter = makeLimiter({
  label: 'ICLOCK-DEVICE',
  message: 'Too many device requests',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_ICLOCK_DEVICE_MAX,
  keyGenerator: getIclockDeviceKey,
  handler: iclockHandler('DEVICE'),
})

// ---------------------------------------------------------------------------
// 10) KIOSK LIVE (absensi wajah — mahal secara CPU) — per-perangkat
//     (x-device-id) + per-IP. Melindungi jalur kiosk dari abuse walaupun
//     jalur ini butuh sesi + perangkat terdaftar.
// ---------------------------------------------------------------------------
const getKioskDeviceKey = (req) => {
  const deviceId = req.headers?.[config.KIOSK_DEVICE_HEADER] || req.body?.device_id
  if (deviceId) return `kiosk:dev:${String(deviceId).trim().toLowerCase()}`
  return `kiosk:dev:${getIpKey(req)}`
}

export const kioskLiveLimiter = makeLimiter({
  label: 'KIOSK-LIVE-DEVICE',
  message: 'Too many attendance requests from this device. Please try again later.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_KIOSK_LIVE_DEVICE_MAX,
  keyGenerator: getKioskDeviceKey,
})

export const kioskLiveIpLimiter = makeLimiter({
  label: 'KIOSK-LIVE-IP',
  message: 'Too many attendance requests. Please try again later.',
  windowMs: 60 * 1000,
  max: config.RATE_LIMIT_KIOSK_LIVE_IP_MAX,
})
