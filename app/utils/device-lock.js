import crypto from 'node:crypto'
import { pool } from './database.js'

export async function withDeviceLock(deviceId, operation, options = {}) {
    const owner = options.owner || crypto.randomUUID()
    const client = await pool.connect()
    try {
        const { rows } = await client.query(
            'SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS acquired',
            [`zk:device:${deviceId}`]
        )
        if (!rows[0].acquired) throw Object.assign(new Error(`Device ${deviceId} is already locked`), { code: 'DEVICE_LOCKED' })
        await client.query(
            `INSERT INTO device_operation_locks (device_id, lock_type, owner, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'))
       ON CONFLICT (device_id) DO UPDATE SET lock_type = EXCLUDED.lock_type, owner = EXCLUDED.owner,
         acquired_at = now(), expires_at = EXCLUDED.expires_at, heartbeat_at = now()`,
            [deviceId, options.lockType || 'template-sync', owner, options.timeoutMs || 30000]
        )
        try { return await operation({ deviceId, owner }) }
        finally {
            await client.query('DELETE FROM device_operation_locks WHERE device_id = $1 AND owner = $2', [deviceId, owner])
            await client.query('SELECT pg_advisory_unlock(hashtextextended($1::text, 0))', [`zk:device:${deviceId}`])
        }
    } finally { client.release() }
}
