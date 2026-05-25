import { pool } from '../utils/database.js'
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js'
import { getCache, setCache, delCacheByPattern, CACHE_KEYS, TTL, buildCacheKey } from '../utils/cache.js'

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

            // Cek cache - hanya cache request tanpa filter (halaman 1) untuk hemat memori
            let cacheKey = null
            const shouldCache = !username && !category && !action && !from && !to && !status && !search && off === 0
            if (shouldCache) {
                cacheKey = buildCacheKey(CACHE_KEYS.ACTIVITY_LOGS_LIST, lim)
                const cached = getCache(cacheKey)
                if (cached) {
                    return sendPaginated(res, cached.rows, cached.total, lim, off)
                }
            }

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

            // Filter: non-superadmin tidak bisa melihat aktivitas superadmin
            const userRole = req.user?.role
            if (userRole !== 'superadmin') {
                // Dapatkan daftar username superadmin
                const superadminRes = await pool.query(
                    `SELECT username FROM users WHERE role = 'superadmin'`
                )
                const superadminUsernames = superadminRes.rows.map(r => r.username)
                if (superadminUsernames.length > 0) {
                    const placeholders = superadminUsernames.map((_, idx) => `$${i++}`).join(', ')
                    where.push(`username NOT IN (${placeholders})`)
                    params.push(...superadminUsernames)
                }
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

            const total = countRes.rows[0].total

            // Simpan ke cache (hanya jika shouldCache)
            if (shouldCache && cacheKey) {
                setCache(cacheKey, { rows: dataRes.rows, total }, TTL.SHORT)
            }

            sendPaginated(res, dataRes.rows, total, lim, off)

        } catch (err) {
            sendError(res, err.message)
        }
    },

    async clearOldLogs(req, res) {
        try {
            const days = parseInt(req.query.days) || 90
            // Gunakan make_interval untuk keamanan dari SQL injection
            const { rowCount } = await pool.query(
                `DELETE FROM activity_logs WHERE created_at < NOW() - make_interval(days => $1)`,
                [days]
            )
            sendSuccess(res, null, `Deleted ${rowCount} old activity logs older than ${days} days`)
        } catch (err) {
            sendError(res, err.message)
        }
    }
}
