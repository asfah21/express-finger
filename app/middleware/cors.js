/**
 * CORS Middleware
 *
 * Sistem ini berjalan di jaringan internal (LAN), dan sebagian besar request
 * adalah same-origin (halaman dashboard & kiosk disajikan dari server yang
 * sama, memakai path relatif). Untuk request cross-origin ber-credential,
 * origin HARUS terdaftar di CORS_ORIGINS — jika tidak, header
 * Access-Control-Allow-Origin tidak diset sehingga browser memblokirnya.
 *
 * Perbaikan keamanan: sebelumnya origin apa pun direfleksikan bersamaan
 * dengan Access-Control-Allow-Credentials: true — kombinasi yang membuat
 * situs jahat bisa mengirim request ber-credential ke API ini. Sekarang
 * hanya origin tepercaya yang diizinkan (lihat plan poin 3).
 */

import { config } from '../config/index.js'

export const corsMiddleware = (req, res, next) => {
  const origin = req.headers.origin

  // Hanya set ACAO untuk origin yang terdaftar. Tanpa ACAO, browser menolak
  // membaca response cross-origin (credentials juga tidak dikirim).
  if (origin) {
    if (config.CORS_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    } else if (config.CORS_ORIGINS.length > 0) {
      console.log(`ℹ️ [CORS] Blocked cross-origin request from unlisted origin: ${origin}`)
    }
    // Jika CORS_ORIGINS kosong → default same-origin; origin lain ditolak.
  } else {
    // Non-browser (curl, server-to-server, perangkat ZK) — tanpa Origin header.
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization, X-CSRF-Token')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Total-Count')
  res.setHeader('Access-Control-Max-Age', '86400') // 24 hours

  // Handle preflight
  if (req.method === 'OPTIONS') return res.sendStatus(204)

  next()
}
