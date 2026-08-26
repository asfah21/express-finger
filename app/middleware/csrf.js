/**
 * CSRF Protection Middleware
 *
 * Menggunakan pola double-submit cookie dari paket `csrf-csrf`:
 * - Server mengeset cookie non-HttpOnly `csrf-token` pada setiap response.
 * - Frontend membaca cookie tsb (lewat js/csrf.js) dan mengirimkannya ulang
 *   sebagai header `x-csrf-token` pada setiap request state-changing.
 * - Middleware memvalidasi bahwa header == cookie DAN token ditandatangani
 *   dengan secret yang sama.
 *
 * Kenapa aman walau cookie tidak HttpOnly?
 * - Cookie tidak bisa ditulis oleh origin lain (per-domain).
 * - SameSite=Lax memblokir kiriman cookie pada request cross-site POST,
 *   jadi situs jahat tidak bisa memaksa browser mengirim token yang valid.
 * - Sekalipun token bocor via XSS, XSS itu sendiri sudah berarti kalah;
 *   lapisan utama tetaplah CSP + sanitasi output (lihat plan poin 2 & 10).
 */

import { doubleCsrf } from 'csrf-csrf'
import crypto from 'node:crypto'
import { config } from '../config/index.js'

const CSRF_COOKIE = 'csrf-token'
const CSRF_HEADER = 'x-csrf-token'

/**
 * Secret diturunkan dari env agar stabil lintas restart server. Jika tidak
 * ada CSRF_SECRET, pakai JWT_SECRET (yang sudah wajib ada) sebagai seed.
 * Token lama tetap valid setelah restart karena secret tidak berubah.
 */
function deriveSecret() {
  const seed = process.env.CSRF_SECRET || process.env.JWT_SECRET || 'insecure-csrf-secret'
  return crypto.createHash('sha256').update(String(seed)).digest('hex')
}

const {
  doubleCsrfProtection,
  generateToken,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => deriveSecret(),
  cookieName: CSRF_COOKIE,
  cookieOptions: {
    httpOnly: false, // harus bisa dibaca JS untuk dikirim sebagai header
    sameSite: 'lax', // blokir kirim cookie pada request cross-site
    // Default false agar kompatibel dengan deployment HTTP di LAN.
    // Set CSRF_SECURE_COOKIE=true bila seluruh trafik sudah HTTPS (Fase 2).
    secure: process.env.CSRF_SECURE_COOKIE === 'true',
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
})

/**
 * Endpoint yang TIDAK boleh dicek CSRF karena bukan browser interaktif atau
 * memang flow tanpa token:
 * - /auth/login        → login CSRF tidak berbahaya (password diminta ulang).
 * - /auth/logout       → logout CSRF dampaknya minimal.
 * - /iclock            → protokol perangkat ZK, tidak membawa cookie.
 * - kiosk register     → auto-register device id, tanpa sesi.
 * - sessions/heartbeat → polling kiosk, tanpa sesi interaktif.
 */
const CSRF_BYPASS_PREFIXES = [
  '/auth/login',
  '/auth/logout',
  '/iclock',
  '/api/kiosk-devices/register',
  '/api/sessions/heartbeat',
]

/**
 * Pastikan cookie CSRF selalu ada di response (di-generate saat belum ada).
 * Dipasang global setelah cookieParser, sebelum routes.
 */
export const csrfTokenProvider = (req, res, next) => {
  try {
    generateToken(req, res)
  } catch (_) {
    // Token sudah ada — abaikan, bukan error fatal.
  }
  next()
}

/**
 * Proteksi CSRF untuk request state-changing, dengan pengecualian:
 * 1. Endpoint di daftar bypass (non-browser / flow tanpa token).
 * 2. Request yang TIDAK membawa cookie sesi `token` — artinya klien API-key
 *    (integrasi non-browser via header X-API-Key) atau anonymous. CSRF hanya
 *    relevan saat browser otomatis melampirkan cookie sesi; tanpa cookie sesi
 *    tidak ada sesi yang bisa dibajak, jadi dilewati agar API-key tidak rusak.
 */
export const csrfProtection = (req, res, next) => {
  const path = req.path || ''
  if (CSRF_BYPASS_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) {
    return next()
  }
  // Nama cookie sesi sama dengan yang dipakai requireApiKey / requireAuth.
  if (!req.cookies?.token) return next()
  return doubleCsrfProtection(req, res, next)
}

export { invalidCsrfTokenError }
export { CSRF_COOKIE, CSRF_HEADER }

// Re-export config agar tidak perlu import ganda di tempat lain.
export const csrfConfig = config
