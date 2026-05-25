import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

/**
 * Validates an IPv4 address format
 * @param {string} ip - The IP address to validate
 * @returns {boolean}
 */
function isValidIPv4(ip) {
    if (!ip || typeof ip !== 'string') return false
    const parts = ip.trim().split('.')
    if (parts.length !== 4) return false
    return parts.every(part => {
        const num = Number(part)
        return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part
    })
}

export const deviceManagerController = {
    async listDevices(req, res) {
        try {
            const { limit = 10, offset = 0 } = req.query
            const lim = parseInt(limit)
            const off = parseInt(offset)

            const { rows } = await pool.query('SELECT *, COUNT(*) OVER()::int as total FROM devices ORDER BY id ASC LIMIT $1 OFFSET $2', [lim, off])
            const total = rows.length > 0 ? rows[0].total : 0
            sendPaginated(res, rows, total, lim, off)
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async addDevice(req, res) {
        const { sn, name, ip, port = 4370, is_active = true } = req.body
        if (!ip) return sendError(res, 'IP address is required', 400)
        if (!isValidIPv4(ip)) return sendError(res, 'Invalid IP address format', 400)
        if (port && (port < 1 || port > 65535)) return sendError(res, 'Port must be between 1 and 65535', 400)

        const username = req.user?.username || 'api'
        const clientIp = getClientIp(req)

        try {
            const { rows } = await pool.query(
                'INSERT INTO devices (sn, name, ip, port, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [sn, name, ip, port, is_active]
            )

            await recordActivity({
                username, action: 'add_device', category: 'device',
                detail: `Added device: ${name || 'Unnamed'} (IP: ${ip}, SN: ${sn || 'auto'})`,
                ip: clientIp
            })

            sendSuccess(res, rows[0], '', 201)
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async updateDevice(req, res) {
        const { id } = req.params
        const { sn, name, ip, port, is_active } = req.body
        const username = req.user?.username || 'api'
        const clientIp = getClientIp(req)

        try {
            const { rows } = await pool.query(
                `UPDATE devices 
         SET sn = COALESCE($1, sn), 
             name = COALESCE($2, name), 
             ip = COALESCE($3, ip), 
             port = COALESCE($4, port), 
             is_active = COALESCE($5, is_active)
         WHERE id = $6 RETURNING *`,
                [sn, name, ip, port, is_active, id]
            )
            if (rows.length === 0) return sendError(res, 'Device not found', 404)

            await recordActivity({
                username, action: 'edit_device', category: 'device',
                detail: `Updated device ID ${id}: name="${name || rows[0].name}"`,
                ip: clientIp
            })

            sendSuccess(res, rows[0])
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async deleteDevice(req, res) {
        const { id } = req.params
        const username = req.user?.username || 'api'
        const clientIp = getClientIp(req)

        try {
            // Get info before deleting
            const { rows: devRows } = await pool.query('SELECT name, ip, sn FROM devices WHERE id = $1', [id])
            const dev = devRows[0]

            const { rowCount } = await pool.query('DELETE FROM devices WHERE id = $1', [id])
            if (rowCount === 0) return sendError(res, 'Device not found', 404)

            await recordActivity({
                username, action: 'delete_device', category: 'device',
                detail: `Deleted device: ${dev?.name || 'Unnamed'} (IP: ${dev?.ip || '-'}, SN: ${dev?.sn || '-'})`,
                ip: clientIp
            })

            sendSuccess(res, null, 'Device deleted')
        } catch (error) {
            sendError(res, error.message)
        }
    }
}
