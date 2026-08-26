/**
 * Security Headers Middleware (poin 10 hardening)
 *
 * Menggunakan `helmet` sebagai dasar (COOP, CORP, nosniff, frame-ancestors,
 * hidePoweredBy, dll), dengan kustomisasi:
 * - Permissions-Policy: kamera diizinkan (dibutuhkan kiosk absensi wajah),
 *   mikrofon & geolokasi dimatikan. (helmet v8 TIDAK lagi menyetel
 *   Permissions-Policy, jadi diset manual.)
 * - CSP diperkuat (frame-ancestors 'none', base-uri, form-action,
 *   object-src 'none', frame-src 'none').
 *
 * CATATAN PENTING tentang 'unsafe-inline':
 * Frontend memakai ~121 inline event handler (onclick/onchange/...) dan banyak
 * atribut style inline, sehingga 'unsafe-inline' pada script-src & style-src
 * HARUS dipertahankan agar dashboard tidak rusak. Penghapusan penuh menuntut
 * refactor semua handler inline ke addEventListener — fase terpisah (lihat
 * plan poin 10 / Fase 2 lanjutan).
 */

import helmet from 'helmet'

const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      // 'unsafe-inline' dipertahankan karena inline handlers (lihat catatan di atas).
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'", 'ws:', 'wss:', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      // Hardening tambahan (aman walau 'unsafe-inline' masih ada):
      'frame-ancestors': ["'none'"],   // anti-clickjacking (pengganti X-Frame-Options)
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'object-src': ["'none'"],
      'frame-src': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // jangan blokir pemuatan CDN (jsdelivr/cdnjs)
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  originAgentCluster: true,
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS diset manual di bawah (per-request, hanya saat HTTPS) — backward
  // compatible dengan perilaku asli, tidak bergantung NODE_ENV.
  strictTransportSecurity: false,
  xFrameOptions: { action: 'deny' },
  xXssProtection: false, // deprecated — diganti dependensi pada CSP
  hidePoweredBy: true,
  noSniff: true,
})

export const securityMiddleware = (req, res, next) => {
  securityHeaders(req, res, () => {
    // Permissions-Policy — kamera untuk kiosk absensi wajah; lainnya dimatikan.
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(), geolocation=(), interest-cohort=()'
    )

    // HSTS — hanya saat request HTTPS (perilaku asli): diterapkan baik lewat
    // reverse proxy (X-Forwarded-Proto: https) maupun HTTPS langsung. Aman
    // untuk akses LAN HTTP karena browser mengabaikan HSTS di plain HTTP.
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }

    // Jangan biarkan halaman HTML ter-cache setelah logout.
    if (req.path.endsWith('.html') || req.path === '/' || req.accepts('text/html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }

    next()
  })
}
