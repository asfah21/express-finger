// Konfigurasi aplikasi
import 'dotenv/config'
import path from 'path'

/**
 * Parse TRUST_PROXY dengan aman:
 *  - kosong / 'false' → false (tidak mempercayai proxy; req.ip = IP socket)
 *  - 'true'           → true  (mempercayai SEMUA proxy — TIDAK AMAN dan
 *    ditolak express-rate-limit; hanya diperbolehkan bila dipaksa)
 *  - angka (mis. '1') → jumlah hop proxy yang dipercaya (recommended di
 *    belakang satu nginx/Caddy)
 *  - daftar IP (koma) → hanya proxy dengan IP tersebut yang dipercaya
 *
 * PENTING: JANGAN default ke `true`. Dengan `true`, klien bisa memalsukan
 * header X-Forwarded-For untuk mem-bypass rate-limit per-IP (dan library
 * express-rate-limit menolaknya eksplisit dengan ERR_ERL_PERMISSIVE_TRUST_PROXY).
 */
function parseTrustProxy(value) {
  const raw = (value || '').trim().toLowerCase()
  if (!raw || raw === 'false') return false
  if (raw === 'true') {
    console.warn('⚠️ [CONFIG] TRUST_PROXY=true (mempercayai semua proxy) TIDAK aman dan ditolak express-rate-limit. Gunakan hop count (mis. TRUST_PROXY=1) atau IP proxy nyata.')
    return true
  }
  if (/^\d+$/.test(raw)) return Number(raw)
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export const config = {
  PORT: process.env.PORT,
  PGUSER: process.env.PGUSER,
  PGPASSWORD: process.env.PGPASSWORD,
  PGHOST: process.env.PGHOST,
  PGDATABASE: process.env.PGDATABASE,
  PGPORT: process.env.PGPORT,
  API_KEY: process.env.API_KEY,
  RAW_DIR: process.env.RAW_DIR || path.join(path.resolve(), '../data/raw'),
  PULL_DIR: process.env.PULL_DIR || path.join(path.resolve(), '../data/pull'),
  MAX_LIMIT: Number(process.env.MAX_LIMIT || 50000),
  // Origin yang diizinkan untuk request cross-origin ber-credential.
  // Kosong (default) = same-origin LAN saja (paling aman). Isi dengan daftar
  // origin yang dipercaya, mis. 'http://192.168.1.5:8080,http://kiosk.lan'.
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  // IP perangkat ZK yang boleh push data ke /iclock. Kosong (default) = semua
  // IP di LAN diizinkan (backward compatible). Isi untuk pembatasan ketat.
  ICLOCK_ALLOWED_IPS: (process.env.ICLOCK_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean),
  // Nilai app.set('trust proxy'). Kosong (default) = nonaktif (amankah? ya —
  // req.ip = IP socket). Set TRUST_PROXY=1 (atau IP proxy) bila di belakang
  // nginx/Caddy agar req.ip = IP klien asli (lihat parseTrustProxy di atas).
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
  // --- Rate limiting (hardening) -----------------------------------------
  // Semua ambang batas dapat disetel per-environment via env tanpa mengubah
  // kode (lihat app/.env.example). Nilai berikut = default aman.
  RATE_LIMIT_GLOBAL_MAX: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 600), // req/menit per IP (semua request)
  RATE_LIMIT_AUTH_MAX: Number(process.env.RATE_LIMIT_AUTH_MAX || 60), // req/menit per IP (/auth non-login)
  RATE_LIMIT_LOGIN_ACCOUNT_MAX: Number(process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX || 5), // percobaan/15 mnt per akun
  RATE_LIMIT_LOGIN_IP_MAX: Number(process.env.RATE_LIMIT_LOGIN_IP_MAX || 20), // percobaan/15 mnt per IP
  RATE_LIMIT_VERIFY_IP_MAX: Number(process.env.RATE_LIMIT_VERIFY_IP_MAX || 10), // percobaan/15 mnt per IP
  RATE_LIMIT_VERIFY_ACCOUNT_MAX: Number(process.env.RATE_LIMIT_VERIFY_ACCOUNT_MAX || 5), // percobaan/15 mnt per akun
  RATE_LIMIT_USER_MGMT_IP_MAX: Number(process.env.RATE_LIMIT_USER_MGMT_IP_MAX || 20), // operasi/15 mnt per IP
  RATE_LIMIT_USER_MGMT_ACCOUNT_MAX: Number(process.env.RATE_LIMIT_USER_MGMT_ACCOUNT_MAX || 10), // operasi/15 mnt per akun
  RATE_LIMIT_API_MAX: Number(process.env.RATE_LIMIT_API_MAX || 100), // req/menit per IP
  RATE_LIMIT_API_BURST_MAX: Number(process.env.RATE_LIMIT_API_BURST_MAX || 30), // req per jendela burst per IP
  RATE_LIMIT_API_BURST_WINDOW_MS: Number(process.env.RATE_LIMIT_API_BURST_WINDOW_MS || 10_000), // jendela burst (ms)
  RATE_LIMIT_SYNC_MAX: Number(process.env.RATE_LIMIT_SYNC_MAX || 10), // req/menit per IP (operasi berat)
  RATE_LIMIT_SYNC_DEVICE_MAX: Number(process.env.RATE_LIMIT_SYNC_DEVICE_MAX || 5), // req/menit per perangkat target
  RATE_LIMIT_ACTIVITY_LOG_MAX: Number(process.env.RATE_LIMIT_ACTIVITY_LOG_MAX || 30), // req/menit per IP
  RATE_LIMIT_ICLOCK_IP_MAX: Number(process.env.RATE_LIMIT_ICLOCK_IP_MAX || 90), // req/menit per IP (/iclock)
  RATE_LIMIT_ICLOCK_DEVICE_MAX: Number(process.env.RATE_LIMIT_ICLOCK_DEVICE_MAX || 120), // req/menit per SN
  RATE_LIMIT_KIOSK_LIVE_DEVICE_MAX: Number(process.env.RATE_LIMIT_KIOSK_LIVE_DEVICE_MAX || 30), // req/menit per perangkat kiosk
  RATE_LIMIT_KIOSK_LIVE_IP_MAX: Number(process.env.RATE_LIMIT_KIOSK_LIVE_IP_MAX || 60), // req/menit per IP (/api/live)
  CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
  CLEANUP_AGE_DAYS: 7,
  WORKER_ENABLED: process.env.WORKER_ENABLED !== 'false', // Default true
  SYNC_INTERVAL_MS: Number(process.env.SYNC_INTERVAL_MS || 5 * 60 * 1000), // Default 5 menit
  FACE_SERVICE_URL: process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8090',
  FACE_SERVICE_TOKEN: process.env.FACE_SERVICE_TOKEN || '',
  FACE_SERVICE_TIMEOUT_MS: Number(process.env.FACE_SERVICE_TIMEOUT_MS || 15_000),
  BUSINESS_TIME_ZONE: process.env.BUSINESS_TIME_ZONE || 'Asia/Makassar',
  // Sliding session renewal — kiosk attendance devices (role 'public') get
  // their session auto-extended on each heartbeat so an Android WebView kiosk
  // never has to re-login while it stays online.
  SLIDING_SESSION_ROLES: (process.env.SLIDING_SESSION_ROLES || 'public').split(',').map(s => s.trim()),
  SLIDING_SESSION_TTL_MS: Number(process.env.SLIDING_SESSION_TTL_MS || 3 * 24 * 60 * 60 * 1000), // 3 hari per perpanjangan
  SLIDING_SESSION_RENEW_THRESHOLD_MS: Number(process.env.SLIDING_SESSION_RENEW_THRESHOLD_MS || 24 * 60 * 60 * 1000), // renew saat sisa < 1 hari
  // Kiosk 'public' sessions are effectively immortal: the login TTL is very long
  // and the heartbeat re-issues the JWT on EVERY beat (see SLIDING_SESSION_ROLES
  // renewal below), so a kiosk never has to re-login while it stays online.
  PUBLIC_SESSION_TTL_MS: Number(process.env.PUBLIC_SESSION_TTL_MS || 365 * 24 * 60 * 60 * 1000), // 365 hari untuk sesi login public
  // Header name the kiosk uses to identify itself (device whitelist / approval).
  KIOSK_DEVICE_HEADER: process.env.KIOSK_DEVICE_HEADER || 'x-device-id',
}
