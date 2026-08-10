// Uses vitest globals (globals: true in vitest.config.js) — the same convention
// as the other passing test in this repo. Importing from 'vitest' currently
// fails in this environment, so rely on the injected globals instead.
import { evaluateAttendance, evaluateAttendanceBatch, isDuplicate, SESSION_WINDOW_HOURS, DUPLICATE_WINDOW_MS, MAX_MULTI_BATCH } from '../utils/live-attendance.js'

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

describe('evaluateAttendanceBatch', () => {
    // '12' scanned Masuk 30s ago (duplicate for type 0), '13' scanned 2h ago.
    const latestByFid = new Map([
        ['12', row('12', 0, 30)],
        ['13', row('13', 0, 7200)]
    ])

    it('accepts every employee when none are duplicates', () => {
        const items = [{ fid: '20', type: 0 }, { fid: '21', type: 1 }]
        const decisions = evaluateAttendanceBatch({ items, latestByFid: new Map(), nowMs: NOW_MS })
        expect(decisions).toEqual([
            { fid: '20', type: 0, ok: true },
            { fid: '21', type: 1, ok: true }
        ])
    })

    it('rejects only the duplicate employee and keeps the others accepted', () => {
        const items = [{ fid: '12', type: 0 }, { fid: '13', type: 0 }]
        const decisions = evaluateAttendanceBatch({ items, latestByFid, nowMs: NOW_MS })
        expect(decisions[0]).toMatchObject({ fid: '12', type: 0, ok: false, code: 'DUPLICATE' })
        expect(decisions[1]).toMatchObject({ fid: '13', type: 0, ok: true })
    })

    it('accepts a different type for the same employee within the duplicate window', () => {
        const decisions = evaluateAttendanceBatch({ items: [{ fid: '12', type: 1 }], latestByFid, nowMs: NOW_MS })
        expect(decisions[0]).toMatchObject({ fid: '12', type: 1, ok: true })
    })

    it('stringifies fid keys consistently so numeric fids match the lookup map', () => {
        const decisions = evaluateAttendanceBatch({ items: [{ fid: 12, type: 0 }], latestByFid, nowMs: NOW_MS })
        expect(decisions[0].fid).toBe('12')
        expect(decisions[0].ok).toBe(false)
    })

    it('preserves item order in the returned decisions', () => {
        const items = [{ fid: '30', type: 0 }, { fid: '31', type: 1 }, { fid: '32', type: 0 }]
        const decisions = evaluateAttendanceBatch({ items, latestByFid: new Map(), nowMs: NOW_MS })
        expect(decisions.map((decision) => decision.fid)).toEqual(['30', '31', '32'])
    })

    it('exports a batch cap of 5 employees', () => {
        expect(MAX_MULTI_BATCH).toBe(5)
    })
})
