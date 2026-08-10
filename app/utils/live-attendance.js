/**
 * Live (Face ID) Attendance — Decision Rules
 *
 * Pure, DB-agnostic helpers so the backend can be the single source of truth
 * for attendance decisions (duplicate validation) while the rules stay
 * unit-testable without a database.
 *
 * Clock convention: live-camera rows are stored as UTC values that represent
 * the application's WITA wall-clock time (`now() + interval '8 hours'`). All
 * comparisons here must use a `nowMs` that is also on the WITA clock, i.e.
 * `Date.now() + 8 * 3600 * 1000`, so the offsets cancel out.
 *
 * Attendance ordering (Masuk → Pulang) is intentionally NOT enforced here.
 * A Pulang without a Masuk is accepted at the kiosk so an employee who forgot
 * to clock in is never locked out; the reporting layer (attendance engine)
 * flags it as an anomaly ("Anomali / Masuk") for HR to review — matching the
 * behaviour of fingerprint devices.
 */

export const SESSION_WINDOW_HOURS = 15
// Duplicate window: 5 menit (300.000 ms) — mencegah scan ganda yang tidak disengaja.
export const DUPLICATE_WINDOW_MS = 300_000

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
 *   1. DUPLICATE — same user + type within the last 5 minutes.
 *
 * Everything else (including a Pulang without an open Masuk) is accepted and
 * left to the reporting layer (attendance engine) to flag anomalies.
 *
 * @param {object} args
 * @param {{ user_id: number|string, type: number|string, timestamp: string|Date }|null} args.latestRow
 * @param {string} args.fid - recognized employee id
 * @param {number} args.type - 0 = Masuk, 1 = Pulang
 * @param {number} args.nowMs - WITA wall-clock now in ms
 * @returns {{ ok: true } | { ok: false, code: 'DUPLICATE', message: string }}
 */
export function evaluateAttendance({ latestRow, fid, type, nowMs }) {
    if (isDuplicate(latestRow, fid, type, nowMs)) {
        return {
            ok: false,
            code: 'DUPLICATE',
            message: 'Anda baru saja melakukan absensi yang sama. Silakan coba lagi setelah 5 menit.'
        }
    }

    return { ok: true }
}
