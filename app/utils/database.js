import pkg from 'pg'
import bcrypt from 'bcryptjs'
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
      is_template_master BOOLEAN NOT NULL DEFAULT false,
      sync_mode TEXT DEFAULT 'HYBRID',
      status TEXT DEFAULT 'offline',
      last_sync TIMESTAMPTZ,
      last_online TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    
    -- Ensure status and last_online columns exist for existing installations
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'offline';
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_online TIMESTAMPTZ;
    
    -- Ensure sync_mode column exists for existing installations
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS sync_mode TEXT DEFAULT 'HYBRID';
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_template_master BOOLEAN NOT NULL DEFAULT false;
    
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
      divisi TEXT,
      type TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    -- Ensure updated_at exists for existing tables
    ALTER TABLE employee ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
    -- Add divisi and type columns to existing employee table
    ALTER TABLE employee ADD COLUMN IF NOT EXISTS divisi TEXT;
    ALTER TABLE employee ADD COLUMN IF NOT EXISTS type TEXT;
    -- Add fingerprint_count column for existing installations
    ALTER TABLE employee ADD COLUMN IF NOT EXISTS fingerprint_count INT DEFAULT 0;
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
    CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_single_template_master
      ON devices ((is_template_master)) WHERE is_template_master = true;

    CREATE TABLE IF NOT EXISTS employee_templates (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      template_type TEXT NOT NULL CHECK (template_type IN ('fingerprint', 'face')),
      template_index INT NOT NULL,
      template_data BYTEA NOT NULL,
      size INT NOT NULL CHECK (size >= 0),
      checksum TEXT NOT NULL,
      source_device_id BIGINT REFERENCES devices(id) ON DELETE SET NULL,
      source_device_sn TEXT,
      template_version INT NOT NULL,
      payload_format TEXT NOT NULL,
      source_model TEXT,
      source_firmware TEXT,
      source_firmware_family TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      captured_at TIMESTAMPTZ,
      last_verified_at TIMESTAMPTZ,
      created_by TEXT,
      valid BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT employee_templates_size_matches_data CHECK (octet_length(template_data) = size)
    );

    CREATE TABLE IF NOT EXISTS template_sync_logs (
      id BIGSERIAL PRIMARY KEY,
      operation TEXT NOT NULL CHECK (operation IN ('pull', 'dry_run', 'write', 'delete', 'reconcile', 'error')),
      status TEXT NOT NULL,
      device_id BIGINT REFERENCES devices(id) ON DELETE SET NULL,
      source_device_id BIGINT REFERENCES devices(id) ON DELETE SET NULL,
      user_id TEXT,
      template_type TEXT CHECK (template_type IS NULL OR template_type IN ('fingerprint', 'face')),
      template_index INT,
      before_checksum TEXT,
      after_checksum TEXT,
      template_version INT,
      payload_format TEXT,
      action TEXT CHECK (action IS NULL OR action IN ('ADD', 'UPDATE', 'DELETE', 'SKIP', 'ERROR')),
      error_code TEXT,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS device_operation_locks (
      device_id BIGINT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
      lock_type TEXT NOT NULL,
      owner TEXT NOT NULL,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_templates_current
      ON employee_templates (user_id, template_type, template_index, template_version, payload_format)
      WHERE valid = true;
    CREATE INDEX IF NOT EXISTS idx_employee_templates_user ON employee_templates (user_id);
    CREATE INDEX IF NOT EXISTS idx_employee_templates_source_device ON employee_templates (source_device_id);
    CREATE INDEX IF NOT EXISTS idx_employee_templates_checksum ON employee_templates (checksum);
    CREATE INDEX IF NOT EXISTS idx_template_sync_logs_device_time ON template_sync_logs (device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_template_sync_logs_source_device ON template_sync_logs (source_device_id);
    CREATE INDEX IF NOT EXISTS idx_template_sync_logs_checksum ON template_sync_logs (before_checksum, after_checksum);
    
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'superadmin',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS page_permissions (
      id SERIAL PRIMARY KEY,
      page_id TEXT NOT NULL,
      page_label TEXT NOT NULL,
      allowed_roles TEXT[] NOT NULL DEFAULT '{superadmin}',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(page_id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL DEFAULT 'system',
      action TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      detail TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      status TEXT DEFAULT 'success',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Ensure status column exists for existing installations
    ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';

    CREATE INDEX IF NOT EXISTS idx_actlog_created ON activity_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_actlog_username ON activity_logs (username);
    CREATE INDEX IF NOT EXISTS idx_actlog_category ON activity_logs (category);
  `)

  // Create default superadmin if no users exist
  const { rowCount } = await pool.query('SELECT 1 FROM users LIMIT 1')
  if (rowCount === 0) {
    // Default: superadmin / admin123 (bcrypt hashed)
    const hashedPassword = await bcrypt.hash('admin123', 10)
    await pool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['superadmin', hashedPassword, 'superadmin'])
    console.log('✅ Default superadmin user created (username: superadmin, password: admin123)')
  }

  // Seed default page permissions if table is empty
  const { rowCount: permCount } = await pool.query('SELECT 1 FROM page_permissions LIMIT 1')
  if (permCount === 0) {
    const defaultPermissions = [
      { page_id: 'overview', page_label: 'Overview', roles: '{superadmin,admin,viewer}' },
      { page_id: 'devices', page_label: 'Devices', roles: '{superadmin,admin,viewer}' },
      { page_id: 'employees', page_label: 'Employees', roles: '{superadmin,admin,viewer}' },
      { page_id: 'pull-employee', page_label: 'Pull Employee', roles: '{superadmin,admin}' },
      { page_id: 'logs', page_label: 'Attendance Log', roles: '{superadmin,admin,viewer}' },
      { page_id: 'pair', page_label: 'Attendance Pair', roles: '{superadmin,admin,viewer}' },
      { page_id: 'pull', page_label: 'Pull Data', roles: '{superadmin,admin}' },

      { page_id: 'activity', page_label: 'Activity Log', roles: '{superadmin,admin,viewer}' },
      { page_id: 'account', page_label: 'My Account', roles: '{superadmin,admin,viewer}' },
      { page_id: 'settings', page_label: 'System Settings', roles: '{superadmin}' },
      { page_id: 'hr', page_label: 'HR Settings', roles: '{superadmin,admin}' },
      { page_id: 'late', page_label: 'Attendance Late', roles: '{superadmin,admin,viewer}' },
      { page_id: 'metric', page_label: 'Cache Metrics', roles: '{superadmin}' }

    ]
    for (const perm of defaultPermissions) {
      await pool.query(
        'INSERT INTO page_permissions (page_id, page_label, allowed_roles) VALUES ($1, $2, $3) ON CONFLICT (page_id) DO NOTHING',
        [perm.page_id, perm.page_label, perm.roles]
      )
    }
    console.log('✅ Default page permissions seeded')
  }

  // Update existing installations: remove 'viewer' from pull and pull-employee if they have it
  await pool.query(
    `UPDATE page_permissions SET allowed_roles = array_remove(allowed_roles, 'viewer') WHERE page_id IN ('pull', 'pull-employee') AND 'viewer' = ANY(allowed_roles)`
  )

  // Ensure hr page exists in page_permissions for existing installations
  // Insert if not exists, update roles to include admin if currently only superadmin
  const { rows: hrRows } = await pool.query(`SELECT allowed_roles FROM page_permissions WHERE page_id = 'hr'`)
  if (hrRows.length === 0) {
    await pool.query(
      `INSERT INTO page_permissions (page_id, page_label, allowed_roles) VALUES ('hr', 'HR Settings', '{superadmin,admin}')`
    )
    console.log('✅ HR Settings page permission added')
  } else if (!hrRows[0].allowed_roles.includes('admin')) {
    await pool.query(
      `UPDATE page_permissions SET allowed_roles = ARRAY['superadmin','admin'], updated_at = now() WHERE page_id = 'hr'`
    )
    console.log('✅ HR Settings page permission updated to include admin')
  }

  const { rows: biometricRows } = await pool.query(`SELECT allowed_roles FROM page_permissions WHERE page_id = 'biometrics'`)
  if (biometricRows.length === 0) {
    await pool.query(
      `INSERT INTO page_permissions (page_id, page_label, allowed_roles) VALUES ('biometrics', 'Biometrics', '{superadmin,admin}')`
    )
    console.log('✅ Biometrics page permission added')
  } else if (!biometricRows[0].allowed_roles.includes('admin')) {
    await pool.query(
      `UPDATE page_permissions SET allowed_roles = ARRAY['superadmin','admin'], updated_at = now() WHERE page_id = 'biometrics'`
    )
    console.log('✅ Biometrics page permission updated to include admin')
  }

  // Ensure late page exists in page_permissions for existing installations
  const { rows: lateRows } = await pool.query(`SELECT allowed_roles FROM page_permissions WHERE page_id = 'late'`)
  if (lateRows.length === 0) {
    await pool.query(
      `INSERT INTO page_permissions (page_id, page_label, allowed_roles) VALUES ('late', 'Attendance Late', '{superadmin,admin,viewer}')`
    )
    console.log('✅ Attendance Late page permission added')
  }

}


// Batch insert with chunking
export async function saveManyLogs(rows, deviceSN = null) {
  if (!rows.length) return

  const chunkSize = 500
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
  // Jangan simpan SN palsu (PULL-{IP}) ke database
  if (sn.startsWith('PULL-')) return
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
