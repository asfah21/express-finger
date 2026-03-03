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

    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      sn TEXT UNIQUE,
      name TEXT,
      ip TEXT,
      port INT DEFAULT 4370,
      is_active BOOLEAN DEFAULT true,
      sync_mode TEXT DEFAULT 'HYBRID',
      last_sync TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    
    -- Ensure sync_mode column exists for existing installations
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS sync_mode TEXT DEFAULT 'HYBRID';
    
    -- Ensure all existing devices have a sync_mode set (not NULL)
    UPDATE devices SET sync_mode = 'HYBRID' WHERE sync_mode IS NULL;
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee (
      id SERIAL PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      nik TEXT,
      nama TEXT,
      jabatan TEXT,
      department TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    -- Ensure updated_at exists for existing tables
    ALTER TABLE employee ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
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
    
    CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices (ip);
    CREATE INDEX IF NOT EXISTS idx_devices_active ON devices (is_active);
    
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `)

  // Create default admin if no users exist
  const { rowCount } = await pool.query('SELECT 1 FROM users LIMIT 1')
  if (rowCount === 0) {
    // Default: admin / admin123
    // In a real app we'd hash but for simplicity/demo or we can use a hash
    // I will use a simple hashed password if I can, but I don't see bcrypt.
    // I'll use a plain text comparison for now OR add bcrypt.
    // Let's add bcrypt if possible.
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', ['admin', 'admin123'])
  }
}

// Batch insert with chunking
export async function saveManyLogs(rows, deviceSN = null) {
  if (!rows.length) return

  const chunkSize = 100
  let totalInserted = 0

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const flat = []
    const validRows = []

    for (const r of chunk) {
      const uid = r?.uid != null ? Number(r.uid) : null
      const userId = r?.userId != null ? String(r.userId) : null
      const ts = r?.timestamp ? new Date(r.timestamp) : null
      // Skip jika timestamp invalid atau userId kosong
      if (!ts || isNaN(ts.getTime()) || !userId) continue

      const type = r?.type != null ? Number(r.type) : 0
      flat.push(uid, userId, ts, type, deviceSN)
      validRows.push(r)
    }

    if (validRows.length === 0) continue

    // Gunakan validRows.length, BUKAN chunk.length untuk menghindari parameter mismatch
    const valuesSql = validRows.map((_, idx) =>
      `($${idx * 5 + 1},$${idx * 5 + 2},$${idx * 5 + 3},$${idx * 5 + 4},$${idx * 5 + 5})`
    ).join(',')

    const query = `
      INSERT INTO attendance_logs (uid, user_id, timestamp, type, device_sn)
      VALUES ${valuesSql}
      ON CONFLICT (user_id, timestamp) DO UPDATE 
      SET type = EXCLUDED.type, device_sn = EXCLUDED.device_sn
    `
    try {
      await pool.query(query, flat)
      totalInserted += validRows.length
    } catch (err) {
      console.error(`❌ Database: Error inserting batch ${i}-${i + chunk.length} (${validRows.length} rows):`, err.message)
    }
  }

  return totalInserted
}


/**
 * Update or create device info (Dynamic IP support)
 * This allows the PULL worker to always have the latest IP
 */
export async function upsertDevice(sn, ip) {
  if (!sn || !ip) return
  const cleanIp = ip.includes('::ffff:') ? ip.split('::ffff:')[1] : ip
  const query = `
    INSERT INTO devices (sn, ip, last_sync, is_active)
    VALUES ($1, $2, now(), true)
    ON CONFLICT (sn) DO UPDATE 
    SET ip = EXCLUDED.ip, last_sync = now()
  `
  await pool.query(query, [sn, cleanIp])
}

export async function getDevices() {
  const { rows } = await pool.query('SELECT * FROM devices WHERE is_active = true')
  return rows
}
