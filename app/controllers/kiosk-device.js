import { pool } from '../utils/database.js'
import { config } from '../config/index.js'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { revokeDeviceSessions } from '../utils/sessions.js'
import { getKioskDevice } from '../utils/kiosk-device.js'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

function deviceIdFromReq(req) {
    return (req.headers?.[config.KIOSK_DEVICE_HEADER] || req.body?.device_id || '').toString().trim()
}

export const kioskDeviceController = {
    /**
     * Register (or refresh) a kiosk device. Called by the kiosk client on first
     * contact / every login attempt. Auto-registers unknown devices as 'pending'
     * so a Super Admin can approve them from the dashboard.
     */
    async register(req, res) {
        const deviceId = deviceIdFromReq(req)
        const name = (req.body?.name || '').toString().trim()
        const ip = getClientIp(req)

        if (!deviceId) {
            return sendError(res, 'Device ID is required', 400)
        }
        if (deviceId.length > 64) {
            return sendError(res, 'Device ID is too long', 400)
        }

        try {
            const existing = await getKioskDevice(deviceId)
            if (existing) {
                await pool.query(
                    'UPDATE kiosk_devices SET last_seen = now(), name = COALESCE(NULLIF($2, \'\'), name) WHERE id = $1',
                    [existing.id, name]
                )
                return sendSuccess(res, {
                    device_id: deviceId,
                    status: existing.status,
                    approved: existing.status === 'approved',
                })
            }

            const { rows } = await pool.query(
                `INSERT INTO kiosk_devices (device_id, name, status, last_seen)
                 VALUES ($1, $2, 'pending', now())
                 ON CONFLICT (device_id) DO UPDATE SET last_seen = now(), name = COALESCE(NULLIF(EXCLUDED.name, ''), kiosk_devices.name)
                 RETURNING id, device_id, status`,
                [deviceId, name]
            )

            await recordActivity({
                username: req.user?.username || 'kiosk',
                action: 'register_kiosk_device',
                category: 'auth',
                detail: `Kiosk device registered: ${deviceId}${name ? ` (${name})` : ''} — status pending, awaiting approval`,
                ip,
            })

            sendSuccess(res, {
                device_id: deviceId,
                status: rows[0]?.status || 'pending',
                approved: rows[0]?.status === 'approved',
            }, 'Kiosk device registered, awaiting approval', 201)
        } catch (err) {
            console.error('❌ register kiosk device error:', err.message)
            sendError(res, 'Failed to register kiosk device')
        }
    },

    /**
     * List all registered kiosk devices (Super Admin only).
     */
    async list(req, res) {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500)
            const offset = Math.max(parseInt(req.query.offset) || 0, 0)
            const status = (req.query.status || '').trim()

            const where = []
            const params = []
            let i = 1
            if (status && ['pending', 'approved', 'revoked'].includes(status)) {
                params.push(status)
                where.push(`status = $${i++}`)
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
            const { rows } = await pool.query(
                `SELECT k.id, k.device_id, k.name, k.status, k.user_id, u.username AS bound_username,
                        k.approved_by, k.approved_at, k.revoked_at, k.last_seen, k.first_seen_at, k.created_at
                 FROM kiosk_devices k
                 LEFT JOIN users u ON u.id = k.user_id
                 ${whereSql}
                 ORDER BY (k.status = 'pending') DESC, k.first_seen_at DESC
                 LIMIT $${i++} OFFSET $${i++}`,
                [...params, limit, offset]
            )
            const countRes = await pool.query(
                `SELECT COUNT(*)::int AS total FROM kiosk_devices ${whereSql}`, params
            )
            sendSuccess(res, { total: countRes.rows[0].total, list: rows })
        } catch (err) {
            console.error('❌ list kiosk devices error:', err.message)
            sendError(res, 'Failed to list kiosk devices')
        }
    },

    /**
     * Approve a kiosk device and bind it to a 'public' account (Super Admin only).
     * Revokes any previous sessions of the bound user so the binding is clean.
     */
    async approve(req, res) {
        const id = parseInt(req.params.id, 10)
        const { user_id: userId } = req.body
        const ip = getClientIp(req)

        if (!id) return sendError(res, 'Device id is required', 400)
        if (!userId) return sendError(res, 'user_id (public account) is required', 400)

        try {
            const { rows: devRows } = await pool.query('SELECT * FROM kiosk_devices WHERE id = $1', [id])
            const dev = devRows[0]
            if (!dev) return sendError(res, 'Kiosk device not found', 404)

            const { rows: userRows } = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [userId])
            const targetUser = userRows[0]
            if (!targetUser) return sendError(res, 'User not found', 404)
            if (targetUser.role !== 'public') {
                return sendError(res, 'Only a user with role "public" can be bound to a kiosk device', 400)
            }

            // Revoke sessions of the device and of the newly bound user so the
            // binding is clean and the kiosk must log in fresh after approval.
            await revokeDeviceSessions(dev.device_id, req.user?.username || 'api')
            await pool.query(
                `UPDATE kiosk_devices
                 SET status = 'approved', user_id = $2, approved_by = $3, approved_at = now(), revoked_at = NULL
                 WHERE id = $1
                 RETURNING id, device_id, status, user_id`,
                [id, userId, req.user?.username || 'api']
            )
            await pool.query(
                `UPDATE user_sessions SET revoked_at = now(), revoked_by = $2
                 WHERE user_id = $1 AND revoked_at IS NULL`,
                [userId, req.user?.username || 'api']
            )

            await recordActivity({
                username: req.user?.username || 'api',
                action: 'approve_kiosk_device',
                category: 'auth',
                detail: `Approved kiosk device ${dev.device_id}${dev.name ? ` (${dev.name})` : ''} and bound to "${targetUser.username}"`,
                ip,
            })

            sendSuccess(res, { id, device_id: dev.device_id, status: 'approved', user_id: userId }, 'Kiosk device approved')
        } catch (err) {
            console.error('❌ approve kiosk device error:', err.message)
            sendError(res, 'Failed to approve kiosk device')
        }
    },

    /**
     * Revoke a kiosk device (Super Admin only). All active sessions bound to the
     * device are force-logged-out so the kiosk can no longer record attendance.
     */
    async revoke(req, res) {
        const id = parseInt(req.params.id, 10)
        const ip = getClientIp(req)

        if (!id) return sendError(res, 'Device id is required', 400)

        try {
            const { rows: devRows } = await pool.query('SELECT * FROM kiosk_devices WHERE id = $1', [id])
            const dev = devRows[0]
            if (!dev) return sendError(res, 'Kiosk device not found', 404)

            await pool.query(
                `UPDATE kiosk_devices SET status = 'revoked', revoked_at = now(), user_id = NULL WHERE id = $1`,
                [id]
            )
            const revokedCount = await revokeDeviceSessions(dev.device_id, req.user?.username || 'api')

            await recordActivity({
                username: req.user?.username || 'api',
                action: 'revoke_kiosk_device',
                category: 'auth',
                detail: `Revoked kiosk device ${dev.device_id}${revokedCount > 0 ? ` (${revokedCount} session(s) ended)` : ''}`,
                ip,
            })

            sendSuccess(res, { id, device_id: dev.device_id, status: 'revoked' }, 'Kiosk device revoked')
        } catch (err) {
            console.error('❌ revoke kiosk device error:', err.message)
            sendError(res, 'Failed to revoke kiosk device')
        }
    },

    /**
     * Rename / relabel a kiosk device (Super Admin only).
     */
    async rename(req, res) {
        const id = parseInt(req.params.id, 10)
        const { name } = req.body
        const ip = getClientIp(req)

        if (!id) return sendError(res, 'Device id is required', 400)
        if (!name || !name.toString().trim()) return sendError(res, 'name is required', 400)

        try {
            const { rows } = await pool.query(
                'UPDATE kiosk_devices SET name = $2 WHERE id = $1 RETURNING id, device_id, name, status',
                [id, name.toString().trim()]
            )
            if (rows.length === 0) return sendError(res, 'Kiosk device not found', 404)

            await recordActivity({
                username: req.user?.username || 'api',
                action: 'rename_kiosk_device',
                category: 'auth',
                detail: `Renamed kiosk device ${rows[0].device_id} to "${rows[0].name}"`,
                ip,
            })

            sendSuccess(res, rows[0], 'Kiosk device renamed')
        } catch (err) {
            console.error('❌ rename kiosk device error:', err.message)
            sendError(res, 'Failed to rename kiosk device')
        }
    },

    /**
     * Unbind the bound public account from a kiosk device without revoking the
     * device itself (Super Admin only), e.g. to reassign it to another account.
     */
    async unbind(req, res) {
        const id = parseInt(req.params.id, 10)
        const ip = getClientIp(req)

        if (!id) return sendError(res, 'Device id is required', 400)

        try {
            const { rows: devRows } = await pool.query('SELECT * FROM kiosk_devices WHERE id = $1', [id])
            const dev = devRows[0]
            if (!dev) return sendError(res, 'Kiosk device not found', 404)

            await pool.query(
                `UPDATE kiosk_devices SET user_id = NULL, approved_by = NULL, approved_at = NULL, status = 'pending' WHERE id = $1`,
                [id]
            )
            await revokeDeviceSessions(dev.device_id, req.user?.username || 'api')

            await recordActivity({
                username: req.user?.username || 'api',
                action: 'unbind_kiosk_device',
                category: 'auth',
                detail: `Unbound kiosk device ${dev.device_id}${dev.name ? ` (${dev.name})` : ''} from its public account`,
                ip,
            })

            sendSuccess(res, { id, device_id: dev.device_id, status: 'pending', user_id: null }, 'Kiosk device unbound')
        } catch (err) {
            console.error('❌ unbind kiosk device error:', err.message)
            sendError(res, 'Failed to unbind kiosk device')
        }
    },
}
