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
}
