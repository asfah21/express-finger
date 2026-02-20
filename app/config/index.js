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
  MAX_LIMIT: Number(process.env.MAX_LIMIT || 1000),
  CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
  CLEANUP_AGE_DAYS: 7,
}