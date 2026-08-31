import { pool } from '../utils/database.js'
import { config } from '../config/index.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { recordActivity } from './activity-log.js'
import { evaluateAttendance, evaluateAttendanceBatch, isDuplicate, SESSION_WINDOW_HOURS, MAX_MULTI_BATCH, liveNotFoundMessage } from '../utils/live-attendance.js'
import { invalidateAttendanceFeed } from '../utils/cache.js'
import { attendanceBus } from '../utils/events.js'

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

async function recognize(image, endpoint = 'recognize', opts = {}) {
    let response
    const body = { image }
    try {
        response = await fetch(`${config.FACE_SERVICE_URL}/${endpoint}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(config.FACE_SERVICE_TOKEN ? { 'x-face-service-token': config.FACE_SERVICE_TOKEN } : {}) },
            body: JSON.stringify(body),
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
// The face service only reports whether a face matched and its confidence. The
// human-facing reason is resolved by the pure util so the kiosk can guide the
// employee (and so it stays unit-testable without a database).
function faceNotFoundMessage(recognized) {
    return liveNotFoundMessage(recognized.reason || 'unknown')
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
            //    Focused path: the largest (closest) face in the whole frame — no
            //    on-screen box constraint, so the employee no longer needs to be
            //    perfectly centred inside the guide box.
            const recognized = await recognize(image, 'recognize_focused')
            if (!recognized.matched || !recognized.fid) {
                // `reason` lets the kiosk skip useless retries (e.g. no reference
                // faces) and retry the recoverable ones (no_face / below_threshold).
                return sendLiveError(res, 404, 'FACE_NOT_MATCHED', faceNotFoundMessage(recognized), { reason: recognized.reason || 'unknown' })
            }
            const fid = String(recognized.fid)

            // 2. Attendance decision — the backend validates duplicates before
            //    anything is saved. Ordering (Masuk → Pulang) is intentionally
            //    not enforced here: a Pulang without a Masuk is still recorded
            //    and later flagged as an anomaly by the reporting engine.
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
            const employee = await pool.query('SELECT user_id, nama, nik, department, jabatan FROM employee WHERE user_id = $1 LIMIT 1', [fid])
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
            // Invalidate feed attendance karena ada log baru dari kiosk/kamera
            // (coalesced). Report berat (overview/daily/pair) TIDAK dijatuhkan
            // per event — mereka refresh lewat TTL + job precompute scheduler.
            invalidateAttendanceFeed()
            // Broadcast realtime (SSE) agar dashboard feed terasa live (detik-an).
            // Payload sengaja membawa row lengkap (nik/department/jabatan/absensi)
            // agar klien /logs bisa render baris baru langsung tanpa refetch penuh.
            attendanceBus.emit('attendance:new', {
                id: inserted.rows[0].id,
                user_id: fid,
                nama: name,
                nik: employee.rows[0]?.nik ?? null,
                department: employee.rows[0]?.department ?? null,
                jabatan: position,
                type,
                absensi: type === 0 ? 'Masuk' : 'Pulang',
                timestamp: inserted.rows[0].timestamp,
                device_sn: 'LIVE-CAM',
                device_name: 'LIVE-CAM'
            })
            return sendSuccess(res, { ...inserted.rows[0], nama: name, fid, score: recognized.score, jabatan: position }, 'Absensi berhasil')
        } catch (err) {
            console.error('Live attendance error:', err)
            const unavailable = /Face service|fetch failed|ECONNREFUSED|aborted|timed out/i.test(err.message)
            return sendLiveError(res, 503, 'FACE_SERVICE_UNAVAILABLE', unavailable ? 'Layanan pengenalan wajah tidak tersedia' : 'Gagal menyimpan absensi')
        }
    },

    // Multi-attendance: recognise every face in one frame so the kiosk can build
    // the confirmation list. Returns top-scoring matches (capped at the batch
    // limit) with employee metadata attached, so the popup needs no extra trip.
    async recognizeMulti(req, res) {
        const image = normalizeImage(req.body?.image)
        if (!image) return sendLiveError(res, 400, 'INVALID_IMAGE', 'A valid camera image is required')

        try {
            // 0. Readiness — never fire recognition against a model that is not
            //    loaded yet. The kiosk auto-retries this 503 once models are up.
            if (!(await faceServiceReady())) {
                return sendLiveError(res, 503, 'FACE_MODEL_NOT_READY', 'Layanan AI GSI-Vision sedang dimuat. Silakan coba lagi sebentar.')
            }

            // 1. Multi recognition — face service returns every match above the
            //    similarity threshold, best score first.
            const recognized = await recognize(image, 'recognize_multi')
            if (!recognized.matched || !Array.isArray(recognized.faces)) {
                // Unknown faces are silently ignored by design: the kiosk just
                // restarts the scan when a frame yields no recognised employees.
                return sendLiveError(res, 404, 'FACE_NOT_MATCHED', faceNotFoundMessage(recognized), { reason: recognized.reason || 'unknown' })
            }

            // 2. Dedupe (a frame should never map two faces to the same fid)
            //    and cap the list at the batch limit.
            const seen = new Set()
            const fids = []
            for (const face of recognized.faces) {
                const fid = String(face.fid)
                if (seen.has(fid)) continue
                seen.add(fid)
                fids.push(fid)
                if (fids.length >= MAX_MULTI_BATCH) break
            }

            // 3. Attach employee metadata so the kiosk popup is a single round-trip.
            const employee = await pool.query(
                'SELECT user_id, nama, jabatan FROM employee WHERE user_id = ANY($1)',
                [fids]
            )
            const employeeByFid = new Map(employee.rows.map((row) => [String(row.user_id), row]))
            const scoreByFid = new Map(recognized.faces.map((face) => [String(face.fid), face.score]))

            // 3b. Latest attendance per fid so the confirmation popup can warn
            //     about duplicates before the operator submits. Both types are
            //     evaluated because the action (Masuk/Pulang) is chosen in the
            //     popup, after recognition.
            const attendance = await pool.query(
                `SELECT DISTINCT ON (user_id) user_id, type, "timestamp"
                 FROM attendance_logs
                 WHERE user_id = ANY($1)
                   AND "timestamp" >= (now() + interval '8 hours') - interval '1 hour' * $2
                 ORDER BY user_id, "timestamp" DESC`,
                [fids, SESSION_WINDOW_HOURS]
            )
            const latestByFid = new Map(attendance.rows.map((row) => [String(row.user_id), row]))
            const nowMs = Date.now() + WITA_OFFSET_MS

            const faces = fids.map((fid) => {
                const row = employeeByFid.get(fid)
                const latest = latestByFid.get(fid) || null
                return {
                    fid,
                    score: scoreByFid.get(fid) ?? null,
                    nama: row?.nama || `FID ${fid}`,
                    jabatan: row?.jabatan || null,
                    duplicateIn: isDuplicate(latest, fid, 0, nowMs),
                    duplicateOut: isDuplicate(latest, fid, 1, nowMs)
                }
            })

            return sendSuccess(res, { faces })
        } catch (error) {
            console.error('Multi recognize error:', error)
            const unavailable = /Face service|fetch failed|ECONNREFUSED|aborted|timed out/i.test(error.message)
            return sendLiveError(res, 503, 'FACE_SERVICE_UNAVAILABLE', unavailable ? 'Layanan pengenalan wajah tidak tersedia' : 'Gagal mengenali wajah')
        }
    },

    // Multi-attendance: record one attendance type for a whole batch of employees
    // in a single transaction. Duplicates are validated per person and reported
    // per person — one duplicate never rolls back the others.
    async multiAttendance(req, res) {
        const type = Number(req.body?.type)
        const rawFids = req.body?.fids
        const fids = Array.isArray(rawFids)
            ? [...new Set(rawFids.map((fid) => String(fid).trim()).filter(Boolean))]
            : []
        if (![0, 1].includes(type)) return sendLiveError(res, 400, 'INVALID_TYPE', 'Attendance type must be 0 (Masuk) or 1 (Pulang)')
        if (fids.length === 0) return sendLiveError(res, 400, 'INVALID_FIDS', 'At least one recognized employee id is required')
        if (fids.length > MAX_MULTI_BATCH) return sendLiveError(res, 400, 'TOO_MANY_FACES', `Maksimal ${MAX_MULTI_BATCH} karyawan per batch`)

        try {
            // 1. Latest attendance row per fid in a single query (deduped).
            const { rows } = await pool.query(
                `SELECT DISTINCT ON (user_id) user_id, type, "timestamp"
                 FROM attendance_logs
                 WHERE user_id = ANY($1)
                   AND "timestamp" >= (now() + interval '8 hours') - interval '1 hour' * $2
                 ORDER BY user_id, "timestamp" DESC`,
                [fids, SESSION_WINDOW_HOURS]
            )
            const latestByFid = new Map(rows.map((row) => [String(row.user_id), row]))

            // 2. Per-person duplicate validation — same rule as a single scan.
            const decisions = evaluateAttendanceBatch({
                items: fids.map((fid) => ({ fid, type })),
                latestByFid,
                nowMs: Date.now() + WITA_OFFSET_MS
            })

            const results = decisions.map((decision) => ({
                fid: decision.fid,
                ok: decision.ok,
                code: decision.ok ? 'OK' : decision.code,
                message: decision.ok ? null : decision.message
            }))
            const accepted = decisions.filter((decision) => decision.ok)

            // 3. Persist accepted employees in one transaction.
            if (accepted.length > 0) {
                const employee = await pool.query(
                    'SELECT user_id, nama, jabatan FROM employee WHERE user_id = ANY($1)',
                    [accepted.map((decision) => decision.fid)]
                )
                const employeeByFid = new Map(employee.rows.map((row) => [String(row.user_id), row]))

                const client = await pool.connect()
                try {
                    await client.query('BEGIN')
                    for (const decision of accepted) {
                        const inserted = await client.query(
                            `INSERT INTO attendance_logs (user_id, "timestamp", type, device_sn)
                             VALUES ($1, now() + interval '8 hours', $2, $3) RETURNING id, user_id, "timestamp", type`,
                            [decision.fid, type, 'LIVE-CAM-MULTI']
                        )
                        const row = employeeByFid.get(decision.fid)
                        const name = row?.nama || `FID ${decision.fid}`
                        await recordActivity({
                            username: name,
                            action: 'attendance',
                            category: 'attendance',
                            detail: `Absensi ${type === 0 ? 'Masuk' : 'Pulang'} massal melalui kamera (User ID: ${decision.fid}, device: LIVE-CAM-MULTI)`,
                            ip: req.ip,
                            status: 'success'
                        })
                        const result = results.find((item) => item.fid === decision.fid)
                        if (result) {
                            result.record = { ...inserted.rows[0], fid: decision.fid, nama: name, jabatan: row?.jabatan || null }
                        }
                    }
                    await client.query('COMMIT')
                } catch (error) {
                    await client.query('ROLLBACK')
                    throw error
                } finally {
                    client.release()
                }
                // Invalidate feed attendance karena ada log baru dari kiosk/kamera
                invalidateAttendanceFeed()
                // Broadcast realtime (SSE) untuk batch yang tersimpan
                attendanceBus.emit('attendance:bulk', { count: accepted.length, source: 'live-cam-multi' })
            }

            return sendSuccess(res, { type, results }, 'Absensi massal diproses')
        } catch (error) {
            console.error('Multi live attendance error:', error)
            return sendLiveError(res, 503, 'MULTI_ATTENDANCE_FAILED', 'Gagal memproses absensi massal')
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
