import { pool } from '../utils/database.js'

/**
 * Record an activity log entry.
 * Can be called from any controller or middleware.
 * 
 * @param {object} options
 * @param {string} options.username  - who did the action
 * @param {string} options.action    - e.g. 'login', 'logout', 'add_employee'
 * @param {string} options.category  - 'auth' | 'employee' | 'device' | 'settings' | 'export' | 'import' | 'sync'
 * @param {string} [options.detail]  - human-readable detail, e.g. "Added employee John Doe (ID: 101)"
 * @param {string} [options.ip]      - client IP
 * @param {string} [options.status]  - 'success' | 'failed'
 */
export async function recordActivity({ username, action, category, detail = '', ip = '', status = 'success' }) {
    try {
        await pool.query(
            `INSERT INTO activity_logs (username, action, category, detail, ip_address, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [username || 'system', action, category, detail, ip, status]
        )
    } catch (err) {
        // Jangan sampai gagal log merusak alur utama
        console.error('❌ Failed to record activity log:', err.message)
    }
}

export const activityLogController = {
    async getLogs(req, res) {
        try {
            const {
                limit = 50,
                offset = 0,
                username,
                category,
                action,
                from,
                to,
                status,
                search
            } = req.query

            const lim = Math.min(parseInt(limit) || 50, 500)
            const off = Math.max(parseInt(offset) || 0, 0)

            const where = []
            const params = []
            let i = 1

            if (username) { where.push(`username ILIKE $${i++}`); params.push(`%${username}%`) }
            if (category) { where.push(`category = $${i++}`); params.push(category) }
            if (action) { where.push(`action = $${i++}`); params.push(action) }
            if (status) { where.push(`status = $${i++}`); params.push(status) }
            if (from) { where.push(`created_at >= $${i++}`); params.push(new Date(from)) }
            if (to) { where.push(`created_at <= $${i++}`); params.push(new Date(to)) }
            if (search) {
                where.push(`(username ILIKE $${i} OR detail ILIKE $${i} OR action ILIKE $${i})`)
                params.push(`%${search}%`)
                i++
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

            const [dataRes, countRes] = await Promise.all([
                pool.query(
                    `SELECT * FROM activity_logs ${whereSql} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
                    [...params, lim, off]
                ),
                pool.query(
                    `SELECT COUNT(*)::int as total FROM activity_logs ${whereSql}`,
                    params
                )
            ])

            res.json({
                status: 'success',
                data: {
                    total: countRes.rows[0].total,
                    limit: lim,
                    offset: off,
                    logs: dataRes.rows
                }
            })
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message })
        }
    },

    async clearOldLogs(req, res) {
        try {
            const days = parseInt(req.query.days) || 90
            const { rowCount } = await pool.query(
                `DELETE FROM activity_logs WHERE created_at < NOW() - INTERVAL '${days} days'`
            )
            res.json({ status: 'success', message: `Deleted ${rowCount} old activity logs older than ${days} days` })
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message })
        }
    }
}
