// Konfigurasi aplikasi
import 'dotenv/config'
import path from 'path'
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
