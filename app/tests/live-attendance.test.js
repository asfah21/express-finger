// Uses vitest globals (globals: true in vitest.config.js) — the same convention
// as the other passing test in this repo. Importing from 'vitest' currently
// fails in this environment, so rely on the injected globals instead.
import { evaluateAttendance, isDuplicate, SESSION_WINDOW_HOURS, DUPLICATE_WINDOW_MS } from '../utils/live-attendance.js'

// All helpers use the WITA wall-clock convention: `nowMs` and row timestamps
// must be on the same clock. We use a fixed "now" and build rows relative to it.
const NOW_MS = new Date('2026-08-09T10:00:00.000Z').getTime()
const HOUR_MS = 60 * 60 * 1000

const row = (user_id, type, secondsAgo) => ({
    user_id,
    type,
    timestamp: new Date(NOW_MS - secondsAgo * 1000).toISOString()
})

describe('isDuplicate', () => {
    it('blocks the same user + type within the window', () => {
        expect(isDuplicate(row('12', 0, 30), '12', 0, NOW_MS, DUPLICATE_WINDOW_MS)).toBe(true)
    })

    it('allows the same user + type exactly at the window boundary', () => {
        expect(isDuplicate(row('12', 0, DUPLICATE_WINDOW_MS / 1000), '12', 0, NOW_MS, DUPLICATE_WINDOW_MS)).toBe(false)
    })

    it('allows a different attendance type immediately', () => {
        expect(isDuplicate(row('12', 1, 30), '12', 0, NOW_MS, DUPLICATE_WINDOW_MS)).toBe(false)
    })

    it('allows a different employee immediately', () => {
        expect(isDuplicate(row('13', 0, 30), '12', 0, NOW_MS, DUPLICATE_WINDOW_MS)).toBe(false)
    })

    it('ignores future timestamps', () => {
        expect(isDuplicate(row('12', 0, -30), '12', 0, NOW_MS, DUPLICATE_WINDOW_MS)).toBe(false)
    })
})

describe('evaluateAttendance', () => {
    it('accepts Masuk (type 0) with no previous record', () => {
        expect(evaluateAttendance({ latestRow: null, fid: '12', type: 0, nowMs: NOW_MS })).toEqual({ ok: true })
    })

    it('accepts Pulang (type 1) with no previous record', () => {
        expect(evaluateAttendance({ latestRow: null, fid: '12', type: 1, nowMs: NOW_MS })).toEqual({ ok: true })
    })

    it('accepts Pulang even when the previous record was also a Pulang', () => {
        expect(evaluateAttendance({ latestRow: row('12', 1, 3600), fid: '12', type: 1, nowMs: NOW_MS })).toEqual({ ok: true })
    })

    it('accepts Pulang when a Masuk session is open', () => {
        expect(evaluateAttendance({ latestRow: row('12', 0, 3600), fid: '12', type: 1, nowMs: NOW_MS })).toEqual({ ok: true })
    })

    it('accepts Pulang even when the open Masuk session has expired', () => {
        expect(evaluateAttendance({ latestRow: row('12', 0, SESSION_WINDOW_HOURS * 3600 + 60), fid: '12', type: 1, nowMs: NOW_MS })).toEqual({ ok: true })
    })

    it('rejects a duplicate Masuk within the window', () => {
        const decision = evaluateAttendance({ latestRow: row('12', 0, 30), fid: '12', type: 0, nowMs: NOW_MS })
        expect(decision.ok).toBe(false)
        expect(decision.code).toBe('DUPLICATE')
    })

    it('accepts Pulang even when the open Masuk is within the duplicate window (different type)', () => {
        expect(evaluateAttendance({ latestRow: row('12', 0, 30), fid: '12', type: 1, nowMs: NOW_MS })).toEqual({ ok: true })
    })

    it('rejects a duplicate Pulang within the window', () => {
        const decision = evaluateAttendance({ latestRow: row('12', 1, 30), fid: '12', type: 1, nowMs: NOW_MS })
        expect(decision.ok).toBe(false)
        expect(decision.code).toBe('DUPLICATE')
    })
})
