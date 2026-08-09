import { pool } from '../utils/database.js'
import { config } from '../config/index.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { recordActivity } from './activity-log.js'
import { evaluateAttendance, SESSION_WINDOW_HOURS } from '../utils/live-attendance.js'

const MAX_IMAGE_LENGTH = 7_000_000
// Rows are stored as UTC values that represent the app's WITA wall-clock time
// (see the write boundary below), so a "now" on the same clock must carry the
// same +08:00 offset for in-process comparisons.
const WITA_OFFSET_MS = 8 * 60 * 60 * 1000

// Readiness cache: recognition is only fired once the face-service reports its
// models are loaded. Models stay loaded once ready, so this is checked only
// until the first healthy response (re-checked every TTL while it is down).
const FACE_READY_TTL_MS = 3000
let faceReadyCache = { loaded: null, checkedAt: 0 }

/**
 * Structured live error response. Unlike sendError, the `code` is always
 * included so the kiosk can branch on the exact decision, even in production.
 * `extra` is merged into the body so machine-readable context (e.g. the face
 * service `reason`) can drive the kiosk's auto-retry logic.
 */
function sendLiveError(res, statusCode, code, message, extra = {}) {
    return res.status(statusCode).json({ status: 'error', code, message, ...extra })
}

async function faceServiceReady() {
    const now = Date.now()
    if (faceReadyCache.loaded === true) return true
    if (faceReadyCache.loaded === false && now - faceReadyCache.checkedAt < FACE_READY_TTL_MS) return false
    try {
        const response = await fetch(`${config.FACE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) })
        const data = await response.json().catch(() => ({}))
        faceReadyCache = { loaded: response.ok && data.models_loaded !== false, checkedAt: now }
    } catch {
        faceReadyCache = { loaded: false, checkedAt: now }
    }
    return faceReadyCache.loaded
}

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

// The face service only reports whether a face matched and its confidence. The
// human-facing reason is resolved here so the kiosk can guide the employee.
function faceNotFoundMessage(recognized) {
    switch (recognized.reason) {
        case 'no_face':
            return 'Wajah tidak terdeteksi, posisikan wajah di bingkai lalu scan ulang.'
        case 'no_reference_faces':
            return 'Belum ada data wajah karyawan untuk verifikasi. Hubungi IT.'
        case 'below_threshold':
            return 'Wajah tidak dikenali. Pastikan pencahayaan cukup lalu scan ulang.'
        default:
            return 'Wajah tidak dikenali'
    }
}

export const liveController = {
    async pageAccess(req, res, next) {
        if (req.user?.role === 'public' || req.user?.role === 'superadmin') return next()
        return sendError(res, 'Forbidden: Live is available only to public and superadmin users', 403)
    },

    async attendance(req, res) {
        const type = Number(req.body?.type)
        const image = normalizeImage(req.body?.image)
        if (![0, 1].includes(type)) return sendLiveError(res, 400, 'INVALID_TYPE', 'Attendance type must be 0 (Masuk) or 1 (Pulang)')
        if (!image) return sendLiveError(res, 400, 'INVALID_IMAGE', 'A valid camera image is required')

        try {
            // 0. Readiness — never fire recognition against a model that is not
            //    loaded yet. The kiosk auto-retries this 503 once models are up.
            if (!(await faceServiceReady())) {
                return sendLiveError(res, 503, 'FACE_MODEL_NOT_READY', 'Layanan AI GSI-Vision sedang dimuat. Silakan coba lagi sebentar.')
            }

            // 1. Recognition — face service only recognises the face + confidence.
            const recognized = await recognize(image)
            if (!recognized.matched || !recognized.fid) {
                // `reason` lets the kiosk skip useless retries (e.g. no reference
                // faces) and retry the recoverable ones (no_face / below_threshold).
                return sendLiveError(res, 404, 'FACE_NOT_MATCHED', faceNotFoundMessage(recognized), { reason: recognized.reason || 'unknown' })
            }
            const fid = String(recognized.fid)

            // 2. Attendance decision — the backend validates duplicate and
            //    shift/type ordering before anything is saved. The latest record
            //    within the session window is enough to drive both rules.
            const { rows } = await pool.query(
                `SELECT user_id, type, "timestamp" FROM attendance_logs
                 WHERE user_id = $1
                   AND "timestamp" >= (now() + interval '8 hours') - interval '1 hour' * $2
                 ORDER BY "timestamp" DESC LIMIT 1`,
                [fid, SESSION_WINDOW_HOURS]
            )
            const decision = evaluateAttendance({
                latestRow: rows[0] || null,
                fid,
                type,
                nowMs: Date.now() + WITA_OFFSET_MS
            })
            if (!decision.ok) return sendLiveError(res, 409, decision.code, decision.message)

            // 3. Save.
            const employee = await pool.query('SELECT user_id, nama, jabatan FROM employee WHERE user_id = $1 LIMIT 1', [fid])
            const name = employee.rows[0]?.nama || `FID ${fid}`
            const position = employee.rows[0]?.jabatan || null
            const inserted = await pool.query(
                `INSERT INTO attendance_logs (user_id, "timestamp", type, device_sn)
                 VALUES ($1, now() + interval '8 hours', $2, $3) RETURNING id, user_id, "timestamp", type`,
                [fid, type, 'LIVE-CAM']
            )
            await recordActivity({
                username: name,
                action: 'attendance',
                category: 'attendance',
                detail: `Absensi ${type === 0 ? 'Masuk' : 'Pulang'} melalui kamera (User ID: ${fid}, device: LIVE-CAM)`,
                ip: req.ip,
                status: 'success'
            })
            return sendSuccess(res, { ...inserted.rows[0], nama: name, fid, score: recognized.score, jabatan: position }, 'Absensi berhasil')
        } catch (err) {
            console.error('Live attendance error:', err)
            const unavailable = /Face service|fetch failed|ECONNREFUSED|aborted|timed out/i.test(err.message)
            return sendLiveError(res, 503, 'FACE_SERVICE_UNAVAILABLE', unavailable ? 'Layanan pengenalan wajah tidak tersedia' : 'Gagal menyimpan absensi')
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
