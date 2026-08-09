/**
 * Live (Face ID) Attendance — Decision Rules
 *
 * Pure, DB-agnostic helpers so the backend can be the single source of truth
 * for attendance decisions (duplicate + shift/type/order validation) while the
 * rules stay unit-testable without a database.
 *
 * Clock convention: live-camera rows are stored as UTC values that represent
 * the application's WITA wall-clock time (`now() + interval '8 hours'`). All
 * comparisons here must use a `nowMs` that is also on the WITA clock, i.e.
 * `Date.now() + 8 * 3600 * 1000`, so the offsets cancel out.
 */

export const SESSION_WINDOW_HOURS = 15
export const DUPLICATE_WINDOW_MS = 60_000

const HOUR_MS = 60 * 60 * 1000

/**
 * A Masuk (type 0) session is "open" when the employee's most recent record
 * in the session window is a Masuk that has not been closed by a Pulang.
 * Mirrors the attendance engine's 15h session timeout: an open Masuk older
 * than the window is treated as expired.
 *
 * @param {{ type: number|string, timestamp: string|Date }|null} latestRow
 * @param {number} nowMs - WITA wall-clock now in ms
 * @returns {boolean}
 */
export function hasOpenSession(latestRow, nowMs) {
    if (!latestRow) return false
    if (Number(latestRow.type) !== 0) return false
    return nowMs - new Date(latestRow.timestamp).getTime() < SESSION_WINDOW_HOURS * HOUR_MS
}

/**
 * A repeated capture of the same user + type within the duplicate window is a
 * duplicate and must be rejected.
 *
 * @param {{ user_id: number|string, type: number|string, timestamp: string|Date }|null} latestRow
 * @param {string} fid - recognized employee id
 * @param {number} type - 0 = Masuk, 1 = Pulang
 * @param {number} nowMs - WITA wall-clock now in ms
 * @param {number} windowMs - duplicate window length
 * @returns {boolean}
 */
export function isDuplicate(latestRow, fid, type, nowMs, windowMs = DUPLICATE_WINDOW_MS) {
    if (!latestRow) return false
    if (String(latestRow.user_id) !== String(fid)) return false
    if (Number(latestRow.type) !== Number(type)) return false
    const diff = nowMs - new Date(latestRow.timestamp).getTime()
    return diff >= 0 && diff < windowMs
}

/**
 * Decide whether a live attendance attempt should be accepted.
 *
 * Decision order:
 *   1. DUPLICATE    — same user + type within the last minute.
 *   2. NO_OPEN_SESSION — Pulang (type 1) attempted with no open Masuk session;
 *                        the employee cannot clock out before clocking in.
 *
 * Everything else is accepted and left to the reporting layer (attendance
 * engine) to flag anomalies, preserving existing behaviour.
 *
 * @param {object} args
 * @param {{ user_id: number|string, type: number|string, timestamp: string|Date }|null} args.latestRow
 * @param {string} args.fid - recognized employee id
 * @param {number} args.type - 0 = Masuk, 1 = Pulang
 * @param {number} args.nowMs - WITA wall-clock now in ms
 * @returns {{ ok: true } | { ok: false, code: 'DUPLICATE'|'NO_OPEN_SESSION', message: string }}
 */
export function evaluateAttendance({ latestRow, fid, type, nowMs }) {
    if (isDuplicate(latestRow, fid, type, nowMs)) {
        return {
            ok: false,
            code: 'DUPLICATE',
            message: 'Anda baru saja melakukan absensi yang sama. Silakan coba lagi setelah 1 menit.'
        }
    }

    if (Number(type) === 1 && !hasOpenSession(latestRow, nowMs)) {
        return {
            ok: false,
            code: 'NO_OPEN_SESSION',
            message: 'Belum ada absensi Masuk. Silakan lakukan absensi Masuk terlebih dahulu.'
        }
    }

    return { ok: true }
}
