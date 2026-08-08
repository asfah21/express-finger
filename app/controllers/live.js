import { pool } from '../utils/database.js'
import { config } from '../config/index.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { recordActivity } from './activity-log.js'

const MAX_IMAGE_LENGTH = 7_000_000

function normalizeImage(image) {
    if (typeof image !== 'string' || image.length < 32 || image.length > MAX_IMAGE_LENGTH) return null
    if (image.startsWith('data:image/')) return image
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(image)) return image
    return null
}

async function recognize(image) {
    let response
    try {
        response = await fetch(`${config.FACE_SERVICE_URL}/recognize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(config.FACE_SERVICE_TOKEN ? { 'x-face-service-token': config.FACE_SERVICE_TOKEN } : {}) },
            body: JSON.stringify({ image }),
            signal: AbortSignal.timeout(config.FACE_SERVICE_TIMEOUT_MS)
        })
    } catch (error) {
        throw new Error(`Face service connection failed: ${error.message}`)
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || `Face service returned ${response.status}`)
    return data
}

export const liveController = {
    async pageAccess(req, res, next) {
        if (req.user?.role === 'public' || req.user?.role === 'superadmin') return next()
        return sendError(res, 'Forbidden: Live is available only to public and superadmin users', 403)
    },

    async attendance(req, res) {
        const type = Number(req.body?.type)
        const image = normalizeImage(req.body?.image)
        if (![0, 1].includes(type)) return sendError(res, 'Attendance type must be 0 (Masuk) or 1 (Pulang)', 400)
        if (!image) return sendError(res, 'A valid camera image is required', 400)

        try {
            const recognized = await recognize(image)
            if (!recognized.matched || !recognized.fid) return sendError(res, 'Wajah tidak dikenali', 404)

            const duplicate = await pool.query(
                `SELECT id, "timestamp" FROM attendance_logs
         WHERE user_id = $1 AND type = $2 AND "timestamp" >= now() - interval '1 minute'
         ORDER BY "timestamp" DESC LIMIT 1`,
                [String(recognized.fid), type]
            )
            if (duplicate.rows.length) return sendError(res, 'Anda baru saja melakukan absensi yang sama. Silakan coba lagi setelah 1 menit.', 409, { timestamp: duplicate.rows[0].timestamp })

            const employee = await pool.query('SELECT user_id, nama FROM employee WHERE user_id = $1 LIMIT 1', [String(recognized.fid)])
            const name = employee.rows[0]?.nama || `FID ${recognized.fid}`
            const inserted = await pool.query(
                `INSERT INTO attendance_logs (user_id, "timestamp", type, device_sn)
         VALUES ($1, now(), $2, $3) RETURNING id, user_id, "timestamp", type`,
                [String(recognized.fid), type, 'LIVE-CAM']
            )
            await recordActivity({
                username: name,
                action: 'attendance',
                category: 'attendance',
                detail: `Absensi ${type === 0 ? 'Masuk' : 'Pulang'} melalui kamera (User ID: ${recognized.fid}, device: LIVE-CAM)`,
                ip: req.ip,
                status: 'success'
            })
            return sendSuccess(res, { ...inserted.rows[0], nama: name, fid: String(recognized.fid), score: recognized.score }, 'Absensi berhasil')
        } catch (err) {
            console.error('Live attendance error:', err)
            const unavailable = /Face service|fetch failed|ECONNREFUSED|aborted|timed out/i.test(err.message)
            return sendError(res, unavailable ? 'Layanan pengenalan wajah tidak tersedia' : 'Gagal menyimpan absensi', 503)
        }
    },

    async health(_req, res) {
        try {
            const response = await fetch(`${config.FACE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
            const data = await response.json()
            return sendSuccess(res, data)
        } catch (err) {
            return sendError(res, 'Face service unavailable', 503)
        }
    },

    async reload(req, res) {
        try {
            const response = await fetch(`${config.FACE_SERVICE_URL}/reload`, {
                method: 'POST',
                headers: config.FACE_SERVICE_TOKEN ? { 'x-face-service-token': config.FACE_SERVICE_TOKEN } : {},
                signal: AbortSignal.timeout(config.FACE_SERVICE_TIMEOUT_MS)
            })
            const data = await response.json()
            if (!response.ok) return sendError(res, data.detail || 'Face index reload failed', response.status)
            return sendSuccess(res, data, 'Face index reloaded')
        } catch (err) {
            return sendError(res, 'Face service unavailable', 503)
        }
    }
}
