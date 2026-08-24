import { pool } from './database.js'

/**
 * Resolve a kiosk device by its device_id. Returns the row or null.
 * Lives in utils (not the controller) so both the auth/session flow and the
 * kiosk-device controller can use it without circular imports.
 */
export async function getKioskDevice(deviceId) {
    if (!deviceId) return null
    try {
        const { rows } = await pool.query('SELECT * FROM kiosk_devices WHERE device_id = $1', [deviceId])
        return rows[0] || null
    } catch (err) {
        console.error('❌ getKioskDevice error:', err.message)
        return null
    }
}
