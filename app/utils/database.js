import pkg from 'pg'
import { config } from '../config/index.js'
const { Pool } = pkg

// Database pool
export const pool = new Pool({
  user: config.PGUSER,
  host: config.PGHOST,
  database: config.PGDATABASE,
  password: config.PGPASSWORD,
  port: config.PGPORT,
  max: Number(process.env.PG_POOL_MAX || 15),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

// Schema initialization
export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id BIGSERIAL PRIMARY KEY,
      uid BIGINT,
      user_id TEXT,
      "timestamp" TIMESTAMPTZ NOT NULL,
      type INT,
      device_sn TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_user_time
      ON attendance_logs (user_id, "timestamp");
    CREATE INDEX IF NOT EXISTS idx_attlog_ts_desc ON attendance_logs ("timestamp" DESC);
    CREATE INDEX IF NOT EXISTS idx_attlog_user     ON attendance_logs (user_id);
    CREATE INDEX IF NOT EXISTS idx_attlog_type     ON attendance_logs (type);
    CREATE INDEX IF NOT EXISTS idx_attlog_device   ON attendance_logs (device_sn);
    CREATE INDEX IF NOT EXISTS idx_attlog_ts_desc_cover
      ON attendance_logs ("timestamp" DESC)
      INCLUDE (id, user_id, type, device_sn, created_at);
  `)
}

// Batch insert
export async function saveManyLogs(rows, deviceSN = null) {
  if (!rows.length) return
  const flat = []
  for (const r of rows) {
    const uid = r?.uid != null ? Number(r.uid) : null
    const userId = r?.userId != null ? String(r.userId) : null
    const ts = r?.timestamp ? new Date(r.timestamp) : new Date()
    const type = r?.type != null ? Number(r.type) : null
    flat.push(uid, userId, ts, type, deviceSN)
  }
  const valuesSql = rows.map((_, i) =>
    `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`
  ).join(',')
  const query = `
    INSERT INTO attendance_logs (uid, user_id, timestamp, type, device_sn)
    VALUES ${valuesSql}
    ON CONFLICT (user_id, timestamp) DO NOTHING
  `
  await pool.query(query, flat)
}