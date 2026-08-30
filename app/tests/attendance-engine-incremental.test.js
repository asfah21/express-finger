// Mengikuti konvensi repo: pakai vitest globals (globals: true di vitest.config.js).
// JANGAN import dari 'vitest' — itu gagal di environment ini (lihat komentar di
// tests/live-attendance.test.js).
import { applySessionRow, buildStateMachine, processAttendance } from '../utils/attendance-engine.js'
import { SessionStateStore } from '../utils/session-state.js'

const shiftTypes = {
  staff: { start: '07:00', end: '16:00' },
}
const remarks = {}
const tolerance = 5
const typeMap = { 0: 'Masuk', 1: 'Pulang' }

// Konvensi WITA: 08:00 = 00:00 UTC, 17:00 = 09:00 UTC, dst.
const T = {
  masuk0800: '2026-08-30T00:00:00.000Z',
  pulang0830: '2026-08-30T00:30:00.000Z',
  masuk0900: '2026-08-30T01:00:00.000Z',
  pulang1700: '2026-08-30T09:00:00.000Z',
}

const row = (id, user_id, type, timestamp) => ({ id, user_id: String(user_id), emp_type: 'staff', type, timestamp })

describe('applySessionRow — per-row transition', () => {
  it('Masuk with no session starts waiting_checkout and is not an anomaly', () => {
    const out = applySessionRow(null, row(1, 5, 0, T.masuk0800), shiftTypes.staff)
    expect(out.isAnomaly).toBe(false)
    expect(out.state.state).toBe('waiting_checkout')
  })

  it('Pulang after Masuk completes the session (waiting_checkin)', () => {
    const afterIn = applySessionRow(null, row(1, 5, 0, T.masuk0800), shiftTypes.staff)
    const out = applySessionRow(afterIn.state, row(2, 5, 1, T.pulang1700), shiftTypes.staff)
    expect(out.isAnomaly).toBe(false)
    expect(out.state.state).toBe('waiting_checkin')
  })

  it('Pulang without Masuk is flagged as anomaly "masuk"', () => {
    const out = applySessionRow(null, row(1, 5, 1, T.pulang1700), shiftTypes.staff)
    expect(out.isAnomaly).toBe(true)
    expect(out.anomalyType).toBe('masuk')
  })

  it('Masuk while waiting_checkout is flagged as anomaly "pulang"', () => {
    const afterIn = applySessionRow(null, row(1, 5, 0, T.masuk0800), shiftTypes.staff)
    const out = applySessionRow(afterIn.state, row(2, 5, 0, T.masuk0900), shiftTypes.staff)
    expect(out.isAnomaly).toBe(true)
    expect(out.anomalyType).toBe('pulang')
  })

  it('session timeout (>15h) resets state to fresh', () => {
    const stale = { state: 'waiting_checkout', lastTimestamp: new Date(T.masuk0800).getTime() - 16 * 3600_000, matchedShift: null }
    const out = applySessionRow(stale, row(2, 5, 0, T.masuk0900), shiftTypes.staff)
    // State lama kadaluarsa → diperlakukan seperti tidak ada sesi → Masuk normal
    expect(out.isAnomaly).toBe(false)
    expect(out.state.state).toBe('waiting_checkout')
  })
})

describe('buildStateMachine — regression (tanpa seed, perilaku sama seperti sebelum refactor)', () => {
  it('Masuk→Pulang untuk satu user: keduanya bukan anomaly', () => {
    const rows = [
      row(1, 5, 0, T.masuk0800),
      row(2, 5, 1, T.pulang1700),
    ]
    const sorted = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    const { rowAnomalyMap } = buildStateMachine(sorted, shiftTypes, null)
    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null })
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: false, anomalyType: null })
  })
})

describe('Incremental state machine — seed dari store', () => {
  let store

  beforeEach(() => {
    store = new SessionStateStore()
  })

  afterEach(() => {
    store.stop()
  })

  it('Pulang di halaman berikutnya TIDAK dianggap anomaly karena seed dari Masuk sebelumnya', () => {
    // Batch 1: Masuk diproses → store menyimpan state waiting_checkout
    processAttendance(
      [row(1, 5, 0, T.masuk0800)],
      shiftTypes, remarks, tolerance, typeMap, null,
      { stateStore: store, updateStore: true }
    )
    expect(store.get('5')?.state).toBe('waiting_checkout')

    // Batch 2: halaman berisi Pulang saja (Masuk ada di halaman sebelumnya)
    const processed = processAttendance(
      [row(2, 5, 1, T.pulang1700)],
      shiftTypes, remarks, tolerance, typeMap, null,
      { stateStore: store, updateStore: true }
    )
    expect(processed[0].ket).not.toContain('Anomali')
  })

  it('tanpa store (perilaku lama), Pulang yang terisolasi tetap anomaly "masuk"', () => {
    const processed = processAttendance(
      [row(2, 5, 1, T.pulang1700)],
      shiftTypes, remarks, tolerance, typeMap, null
    )
    expect(processed[0].ket).toContain('Anomali / Masuk')
  })

  it('batch data lama tidak memundurkan store (seed "ignored")', () => {
    // Majukan store ke state 09:00 (setelah Masuk kedua)
    processAttendance(
      [row(1, 5, 0, T.masuk0800)],
      shiftTypes, remarks, tolerance, typeMap, null,
      { stateStore: store, updateStore: true }
    )
    processAttendance(
      [row(2, 5, 0, T.masuk0900)],
      shiftTypes, remarks, tolerance, typeMap, null,
      { stateStore: store, updateStore: true }
    )
    expect(store.get('5')?.lastTimestamp).toBe(new Date(T.masuk0900).getTime())

    // Batch data LAMA (08:30) — seed store (09:00) lebih baru → diabaikan,
    // dan store tidak ditulis-balik (tetap 09:00, bukan mundur ke 08:30)
    processAttendance(
      [row(3, 5, 1, T.pulang0830)],
      shiftTypes, remarks, tolerance, typeMap, null,
      { stateStore: store, updateStore: true }
    )
    expect(store.get('5')?.lastTimestamp).toBe(new Date(T.masuk0900).getTime())
  })
})

describe('SessionStateStore', () => {
  let store

  beforeEach(() => {
    store = new SessionStateStore()
  })

  afterEach(() => {
    store.stop()
  })

  it('set/get round-trip, dan user tak dikenal mengembalikan null', () => {
    expect(store.get('99')).toBeNull()
    store.set('5', { state: 'waiting_checkout', lastTimestamp: 123 })
    expect(store.get('5')).toEqual({ state: 'waiting_checkout', lastTimestamp: 123 })
    expect(store.size).toBe(1)
  })

  it('set(null) tidak menyimpan apa pun', () => {
    store.set('5', null)
    expect(store.size).toBe(0)
  })
})
