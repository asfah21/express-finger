/**
 * Attendance Engine — Unit Tests
 *
 * Tests cover:
 *   - findMatchingShift()   — single shift, multi shift, overnight, fallback, tie-breaker
 *   - buildStateMachine()   — normal flow, anomaly detection, session timeout, shift reuse
 *   - detectAttendanceRemark() — anomaly, duplicate, late, early arrival, overtime, early departure
 *   - processAttendance()   — full pipeline integration
 *   - calculateShiftDiff()  — boundary conditions
 *   - buildLogResponse()    — response shape
 */

import { describe, it, expect } from 'vitest';
import {
  findMatchingShift,
  buildStateMachine,
  detectAttendanceRemark,
  processAttendance,
  calculateShiftDiff,
  buildLogResponse,
} from '../../app/utils/attendance-engine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    id: overrides.id !== undefined ? overrides.id : 1,
    user_id: overrides.user_id !== undefined ? overrides.user_id : 'U001',
    timestamp: overrides.timestamp !== undefined ? overrides.timestamp : '2025-06-01T07:30:00',
    type: overrides.type !== undefined ? overrides.type : 0,
    emp_type: overrides.emp_type !== undefined ? overrides.emp_type : 'Staff',
    is_duplicate: overrides.is_duplicate !== undefined ? overrides.is_duplicate : false,
    nik: overrides.nik !== undefined ? overrides.nik : 'NIK001',
    nama: overrides.nama !== undefined ? overrides.nama : 'John Doe',
    jabatan: overrides.jabatan !== undefined ? overrides.jabatan : 'Staff',
    department: overrides.department !== undefined ? overrides.department : 'IT',
    divisi: overrides.divisi !== undefined ? overrides.divisi : 'Engineering',
    device_name: overrides.device_name !== undefined ? overrides.device_name : 'Device-A',
    device_sn: overrides.device_sn !== undefined ? overrides.device_sn : 'SN001',
    created_at: overrides.created_at !== undefined ? overrides.created_at : '2025-06-01T07:30:05',
  };
}

// Staff shift: single start/end
const staffShift = { start: '07:00', end: '16:00' };

// Non-Staff multi-shift config
const multiShift = {
  shifts: [
    ['07:00', '15:00'],   // Morning
    ['15:00', '23:00'],   // Afternoon
    ['23:00', '07:00'],   // Night (overnight)
  ],
};

// Non-Staff with gaps (non-24h coverage)
const gappedShift = {
  shifts: [
    ['07:00', '12:00'],
    ['13:00', '17:00'],
  ],
};

// Default remarks config (matches engine defaults)
const defaultRemarks = {
  late: 'Terlambat {diff} menit',
  early_arrival: 'Anomali (Terlalu Awal)',
  overtime_check: 'Anomali (Lembur?)',
  early_departure: 'Pulang Cepat',
  duplicate: 'Duplikat Absensi',
  anomaly_masuk: 'Anomali / Masuk',
  anomaly_pulang: 'Anomali / Pulang',
};

// ─── findMatchingShift ───────────────────────────────────────────────────────

describe('findMatchingShift()', () => {
  // ── Single shift (Staff format) ──────────────────────────────────────────

  it('returns start/end for a single shift (Staff format)', () => {
    const result = findMatchingShift(staffShift, 7 * 60 + 30, 0);
    expect(result).toEqual({ start: 7 * 60, end: 16 * 60 });
  });

  it('returns null for null/undefined shiftCfg', () => {
    expect(findMatchingShift(null, 500, 0)).toBeNull();
    expect(findMatchingShift(undefined, 500, 0)).toBeNull();
  });

  // ── Multi shift — exact match inside range ───────────────────────────────

  it('matches morning shift (07:00-15:00) for 07:30 check-in', () => {
    const result = findMatchingShift(multiShift, 7 * 60 + 30, 0);
    expect(result).toEqual({ start: 7 * 60, end: 15 * 60 });
  });

  it('matches afternoon shift (15:00-23:00) for 15:30 check-in', () => {
    const result = findMatchingShift(multiShift, 15 * 60 + 30, 0);
    expect(result).toEqual({ start: 15 * 60, end: 23 * 60 });
  });

  it('matches night shift (23:00-07:00) for 23:30 check-in', () => {
    const result = findMatchingShift(multiShift, 23 * 60 + 30, 0);
    expect(result).toEqual({ start: 23 * 60, end: 7 * 60 });
  });

  it('matches night shift (23:00-07:00) for 03:00 check-in (overnight)', () => {
    const result = findMatchingShift(multiShift, 3 * 60, 0);
    expect(result).toEqual({ start: 23 * 60, end: 7 * 60 });
  });

  // ── Boundary: [start, end) semantics ─────────────────────────────────────

  it('07:00 belongs to morning shift (inclusive start)', () => {
    const result = findMatchingShift(multiShift, 7 * 60, 0);
    expect(result).toEqual({ start: 7 * 60, end: 15 * 60 });
  });

  it('15:00 belongs to afternoon shift (exclusive end of morning)', () => {
    const result = findMatchingShift(multiShift, 15 * 60, 0);
    expect(result).toEqual({ start: 15 * 60, end: 23 * 60 });
  });

  it('23:00 belongs to night shift (exclusive end of afternoon)', () => {
    const result = findMatchingShift(multiShift, 23 * 60, 0);
    expect(result).toEqual({ start: 23 * 60, end: 7 * 60 });
  });

  it('07:00 is NOT inside night shift (exclusive end of overnight)', () => {
    // 07:00 should match morning shift, not night shift
    const result = findMatchingShift(multiShift, 7 * 60, 0);
    expect(result).toEqual({ start: 7 * 60, end: 15 * 60 });
  });

  // ── Fallback: time in gap between shifts ─────────────────────────────────

  it('falls back to nearest-neighbor for time in gap (12:30 check-in, gap 12:00-13:00)', () => {
    // 12:30 is between morning end (12:00) and afternoon start (13:00)
    // For check-in (type=0), nearest start: 07:00 (diff 330) vs 13:00 (diff 30) -> afternoon
    const result = findMatchingShift(gappedShift, 12 * 60 + 30, 0);
    expect(result).toEqual({ start: 13 * 60, end: 17 * 60 });
  });

  it('falls back to nearest-neighbor for time in gap (12:30 check-out, gap 12:00-13:00)', () => {
    // For check-out (type=1), nearest end: 12:00 (diff 30) vs 17:00 (diff 270) -> morning
    const result = findMatchingShift(gappedShift, 12 * 60 + 30, 1);
    expect(result).toEqual({ start: 7 * 60, end: 12 * 60 });
  });

  // ── Tie-breaker: multiple shifts match (should not happen with [start,end) but defensive) --

  it('tie-breaker picks closest start for check-in when multiple shifts match', () => {
    // Create overlapping shifts (edge case)
    const overlappingShift = {
      shifts: [
        ['07:00', '16:00'],
        ['08:00', '17:00'],
      ],
    };
    // 09:00 is inside both ranges
    const result = findMatchingShift(overlappingShift, 9 * 60, 0);
    // For check-in, closest start: 07:00 (diff 120) vs 08:00 (diff 60) -> 08:00
    expect(result).toEqual({ start: 8 * 60, end: 17 * 60 });
  });

  it('tie-breaker picks closest end for check-out when multiple shifts match', () => {
    const overlappingShift = {
      shifts: [
        ['07:00', '16:00'],
        ['08:00', '17:00'],
      ],
    };
    const result = findMatchingShift(overlappingShift, 9 * 60, 1);
    // For check-out, closest end: 16:00 (diff 420) vs 17:00 (diff 480) -> 16:00
    expect(result).toEqual({ start: 7 * 60, end: 16 * 60 });
  });

  // ── Edge: shiftCfg with neither start/end nor shifts ─────────────────────

  it('returns null for shiftCfg without start/end or shifts', () => {
    expect(findMatchingShift({}, 500, 0)).toBeNull();
    expect(findMatchingShift({ foo: 'bar' }, 500, 0)).toBeNull();
  });
});

// ─── buildStateMachine ───────────────────────────────────────────────────────

describe('buildStateMachine()', () => {
  it('returns empty maps for empty rows', () => {
    const { rowAnomalyMap, rowShiftMap } = buildStateMachine([], {});
    expect(rowAnomalyMap.size).toBe(0);
    expect(rowShiftMap.size).toBe(0);
  });

  it('normal Masuk -> Pulang sequence: no anomalies', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }),
      makeRow({ id: 2, timestamp: '2025-06-01T16:30:00', type: 1 }),
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap, rowShiftMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: false, anomalyType: null });
    // Check-in should have a matched shift
    expect(rowShiftMap.get(1)).toEqual({ start: 7 * 60, end: 16 * 60 });
    // Check-out should reuse the same shift
    expect(rowShiftMap.get(2)).toEqual({ start: 7 * 60, end: 16 * 60 });
  });

  it('Masuk when waiting for Pulang -> anomaly (pulang)', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }), // Normal Masuk
      makeRow({ id: 2, timestamp: '2025-06-01T08:00:00', type: 0 }), // Anomaly: Masuk again
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: true, anomalyType: 'pulang' });
  });

  it('Pulang when waiting for Masuk -> anomaly (masuk)', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T16:30:00', type: 1 }), // Pulang without Masuk
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: true, anomalyType: 'masuk' });
  });

  it('Pulang -> Pulang -> anomaly (masuk) on second Pulang', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }), // Normal Masuk
      makeRow({ id: 2, timestamp: '2025-06-01T16:30:00', type: 1 }), // Normal Pulang
      makeRow({ id: 3, timestamp: '2025-06-01T17:00:00', type: 1 }), // Anomaly: Pulang again
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(3)).toEqual({ isAnomaly: true, anomalyType: 'masuk' });
  });

  it('session timeout (>14h) resets state, allowing new Masuk without anomaly', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }), // Masuk
      makeRow({ id: 2, timestamp: '2025-06-02T08:00:00', type: 0 }), // Next day Masuk (>14h later)
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    // Both should be normal because session expired
    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: false, anomalyType: null });
  });

  it('session timeout does NOT reset if within 14h', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }), // Masuk
      makeRow({ id: 2, timestamp: '2025-06-01T20:00:00', type: 0 }), // ~12.5h later -> still within timeout
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: true, anomalyType: 'pulang' });
  });

  it('anomaly Masuk does NOT cascade — next Pulang is normal', () => {
    // Anomaly Masuk (type=0 when waiting for Pulang) should NOT change state.
    // The system still expects Pulang next, so the next Pulang is normal.
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }), // Normal Masuk
      makeRow({ id: 2, timestamp: '2025-06-01T08:00:00', type: 0 }), // Anomaly Masuk (should be Pulang)
      makeRow({ id: 3, timestamp: '2025-06-01T16:30:00', type: 1 }), // Normal Pulang (completes the session)
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: true, anomalyType: 'pulang' });
    // Anomaly Masuk does NOT change state (still waiting_checkout).
    // Pulang is the expected type → normal (no anomaly)
    expect(rowAnomalyMap.get(3)).toEqual({ isAnomaly: false, anomalyType: null });
  });

  it('anomaly Pulang does NOT cascade — next Masuk is normal', () => {
    // Anomaly Pulang (type=1 when waiting for Masuk) should NOT change state.
    // The system still expects Masuk next, so the next Masuk is normal.
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T16:30:00', type: 1 }), // Anomaly Pulang (should be Masuk)
      makeRow({ id: 2, timestamp: '2025-06-01T17:00:00', type: 0 }), // Normal Masuk (starts new session)
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: true, anomalyType: 'masuk' });
    // Anomaly Pulang does NOT change state (still waiting_checkin).
    // Masuk is the expected type → normal (no anomaly)
    expect(rowAnomalyMap.get(2)).toEqual({ isAnomaly: false, anomalyType: null });
  });

  it('check-out reuses the shift matched during check-in (session consistency)', () => {
    // Night shift: check-in at 18:30 matches afternoon shift (15:00-23:00)
    // Check-out at 06:00 would match night shift (23:00-07:00) if computed independently
    // But should reuse the afternoon shift from check-in
    const nightShiftConfig = {
      shifts: [
        ['07:00', '15:00'],
        ['15:00', '23:00'],
        ['23:00', '07:00'],
      ],
    };
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T18:30:00', type: 0, emp_type: 'NonStaff' }),
      makeRow({ id: 2, timestamp: '2025-06-02T06:00:00', type: 1, emp_type: 'NonStaff' }),
    ];
    const shiftTypes = { NonStaff: nightShiftConfig };
    const { rowShiftMap } = buildStateMachine(rows, shiftTypes);

    // Check-in matched afternoon shift
    expect(rowShiftMap.get(1)).toEqual({ start: 15 * 60, end: 23 * 60 });
    // Check-out should reuse the SAME shift (afternoon), NOT independently match night shift
    expect(rowShiftMap.get(2)).toEqual({ start: 15 * 60, end: 23 * 60 });
  });

  it('orphan check-out (no prior session) falls back to independent shift matching', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T16:30:00', type: 1 }), // Pulang without Masuk
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowShiftMap } = buildStateMachine(rows, shiftTypes);

    // Should still get a shift via fallback matching
    expect(rowShiftMap.get(1)).toEqual({ start: 7 * 60, end: 16 * 60 });
  });

  it('handles multiple users independently', () => {
    const rows = [
      makeRow({ id: 1, user_id: 'U001', timestamp: '2025-06-01T07:30:00', type: 0 }),
      makeRow({ id: 2, user_id: 'U002', timestamp: '2025-06-01T07:35:00', type: 0 }),
      makeRow({ id: 3, user_id: 'U001', timestamp: '2025-06-01T16:30:00', type: 1 }),
      makeRow({ id: 4, user_id: 'U002', timestamp: '2025-06-01T16:35:00', type: 1 }),
    ];
    const shiftTypes = { Staff: staffShift };
    const { rowAnomalyMap } = buildStateMachine(rows, shiftTypes);

    // All should be normal
    for (const id of [1, 2, 3, 4]) {
      expect(rowAnomalyMap.get(id)).toEqual({ isAnomaly: false, anomalyType: null });
    }
  });

  it('handles rows without emp_type in shiftTypes gracefully', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0, emp_type: 'Unknown' }),
    ];
    const shiftTypes = { Staff: staffShift }; // 'Unknown' not in shiftTypes
    const { rowAnomalyMap, rowShiftMap } = buildStateMachine(rows, shiftTypes);

    expect(rowAnomalyMap.get(1)).toEqual({ isAnomaly: false, anomalyType: null });
    expect(rowShiftMap.get(1)).toBeUndefined();
  });
});

// ─── detectAttendanceRemark ──────────────────────────────────────────────────

describe('detectAttendanceRemark()', () => {
  it('returns anomaly_pulang when state machine says anomalyType=pulang', () => {
    const row = makeRow({ id: 1, timestamp: '2025-06-01T08:00:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: true, anomalyType: 'pulang' }]]);
    const rowShiftMap = new Map();
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali / Pulang');
  });

  it('returns anomaly_masuk when state machine says anomalyType=masuk', () => {
    const row = makeRow({ id: 1, timestamp: '2025-06-01T16:30:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: true, anomalyType: 'masuk' }]]);
    const rowShiftMap = new Map();
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali / Masuk');
  });

  it('returns duplicate remark for duplicate check-in', () => {
    const row = makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0, is_duplicate: true });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Duplikat Absensi');
  });

  it('returns duplicate remark for duplicate check-out', () => {
    const row = makeRow({ id: 1, timestamp: '2025-06-01T16:30:00', type: 1, is_duplicate: true });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Duplikat Absensi');
  });

  it('returns late remark when check-in exceeds tolerance', () => {
    // Shift starts at 07:00, check-in at 07:10, tolerance=5 -> diff=10 > 5
    const row = makeRow({ id: 1, timestamp: '2025-06-01T07:10:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Terlambat 10 menit');
  });

  it('returns no remark when check-in is within tolerance', () => {
    // Shift starts at 07:00, check-in at 07:03, tolerance=5 -> diff=3 <= 5
    const row = makeRow({ id: 1, timestamp: '2025-06-01T07:03:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('returns early arrival when check-in is >60 min before shift start', () => {
    // Shift starts at 07:00, check-in at 05:30 -> diff=-90 < -60
    const row = makeRow({ id: 1, timestamp: '2025-06-01T05:30:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali (Terlalu Awal)');
  });

  it('returns no remark when check-in is early but within 60 min', () => {
    // Shift starts at 07:00, check-in at 06:35 -> diff=-25, not < -60
    const row = makeRow({ id: 1, timestamp: '2025-06-01T06:35:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('returns overtime remark when check-out exceeds shift end by >60 min', () => {
    // Shift ends at 16:00, check-out at 17:30 -> diff=90 > 60
    const row = makeRow({ id: 1, timestamp: '2025-06-01T17:30:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali (Lembur?)');
  });

  it('returns no remark when check-out overtime is within 60 min', () => {
    // Shift ends at 16:00, check-out at 16:30 -> diff=30, not > 60
    const row = makeRow({ id: 1, timestamp: '2025-06-01T16:30:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('returns early departure when check-out is >60 min before shift end', () => {
    // Shift ends at 16:00, check-out at 14:00 -> diff=-120 < -60
    const row = makeRow({ id: 1, timestamp: '2025-06-01T14:00:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Pulang Cepat');
  });

  it('returns no remark when check-out early but within 60 min', () => {
    // Shift ends at 16:00, check-out at 15:30 -> diff=-30, not < -60
    const row = makeRow({ id: 1, timestamp: '2025-06-01T15:30:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('state machine anomaly takes priority over duplicate', () => {
    // Even if is_duplicate=true, anomaly from state machine should win
    const row = makeRow({ id: 1, timestamp: '2025-06-01T08:00:00', type: 0, is_duplicate: true });
    const rowAnomalyMap = new Map([[1, { isAnomaly: true, anomalyType: 'pulang' }]]);
    const rowShiftMap = new Map();
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali / Pulang');
  });

  it('returns empty string for normal check-in without shift config', () => {
    const row = makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0, emp_type: 'Unknown' });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map();
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('uses custom remarks from config', () => {
    const customRemarks = {
      late: 'Late by {diff} min',
      early_arrival: 'Too Early',
      overtime_check: 'Overtime',
      early_departure: 'Left Early',
      duplicate: 'Duplicate',
      anomaly_masuk: 'Anomaly IN',
      anomaly_pulang: 'Anomaly OUT',
    };
    const row = makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0, is_duplicate: true });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, customRemarks, 5);
    expect(ket).toBe('Duplicate');
  });

  it('falls back to DEFAULT_REMARKS when remarks config is missing a key', () => {
    const partialRemarks = { late: 'Custom Late' };
    const row = makeRow({ id: 1, timestamp: '2025-06-01T05:30:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 7 * 60, end: 16 * 60 }]]);
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, partialRemarks, 5);
    // early_arrival is missing from partialRemarks -> should use default
    expect(ket).toBe('Anomali (Terlalu Awal)');
  });

  // ── Overnight shift (cross-midnight) tests ────────────────────────────────

  it('night shift check-in at 18:30 (before start) is NOT late — early arrival within 60 min', () => {
    // Night shift 19:00-07:00, check-in at 18:30 (1110 min)
    // Before fix: adjustedTotal=1110 < shiftStart=1140 → +1440 → 2550 → diff=1410 → WRONG "Terlambat 1410 menit"
    // After fix: adjustedTotal=1110 < shiftEnd=420? No → no adjustment → diff=1110-1140=-30 → within tolerance → OK
    const row = makeRow({ id: 1, timestamp: '2025-06-01T18:30:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe(''); // 30 min early, within 60 min threshold → no remark
  });

  it('night shift check-in at 18:00 (before start) is early arrival (>60 min before)', () => {
    // Night shift 19:00-07:00, check-in at 18:00 (1080 min)
    // Before fix: adjustedTotal=1080 < shiftStart=1140 → +1440 → 2520 → diff=1380 → WRONG
    // After fix: adjustedTotal=1080 < shiftEnd=420? No → no adjustment → diff=1080-1140=-60 → not < -60 → within threshold
    // Actually -60 is NOT < -60, so no early arrival. Let's use 17:55 for -65.
    const row = makeRow({ id: 1, timestamp: '2025-06-01T17:55:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali (Terlalu Awal)'); // 65 min early → early arrival
  });

  it('night shift check-in at 20:00 (after start) is late by 60 min', () => {
    // Night shift 19:00-07:00, check-in at 20:00 (1200 min)
    // adjustedTotal=1200, shiftStart=1140, diff=60 > tolerance=5 → late
    const row = makeRow({ id: 1, timestamp: '2025-06-01T20:00:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Terlambat 60 menit');
  });

  it('night shift check-in at 05:00 (early morning, next day) is late by 600 min', () => {
    // Night shift 19:00-07:00, check-in at 05:00 (300 min)
    // adjustedTotal=300 < shiftEnd=420 → +1440 → 1740, diff=1740-1140=600 → late
    const row = makeRow({ id: 1, timestamp: '2025-06-02T05:00:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Terlambat 600 menit');
  });

  it('night shift check-in at 06:30 (early morning, next day) is late by 690 min', () => {
    // Night shift 19:00-07:00, check-in at 06:30 (390 min)
    // adjustedTotal=390 < shiftEnd=420 → +1440 → 1830, diff=1830-1140=690 → late
    // This is the scenario the user reported: "Terlambat 699 menit" (close to 690)
    const row = makeRow({ id: 1, timestamp: '2025-06-02T06:30:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Terlambat 690 menit');
  });

  it('night shift check-in at 06:55 (early morning, within tolerance of shift end) is late by 715 min', () => {
    // Night shift 19:00-07:00, check-in at 06:55 (415 min)
    // adjustedTotal=415 < shiftEnd=420 → +1440 → 1855, diff=1855-1140=715 → late
    const row = makeRow({ id: 1, timestamp: '2025-06-02T06:55:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Terlambat 715 menit');
  });

  it('night shift check-in at 07:00 (exactly at shift end) is NOT inside overnight shift', () => {
    // Night shift 19:00-07:00, check-in at 07:00 (420 min)
    // 07:00 is exclusive end of overnight shift → should NOT be matched to night shift
    // This test verifies that the shift matching correctly excludes 07:00 from night shift
    // If matched to night shift: adjustedTotal=420 < shiftEnd=420? No (not <) → no adjustment
    // diff=420-1140=-720 → early arrival
    // But actually 07:00 should match day shift (07:00-19:00), not night shift.
    // This test uses a night shift shiftMap directly to verify the adjustment logic boundary.
    const row = makeRow({ id: 1, timestamp: '2025-06-02T07:00:00', type: 0 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    // 420 is NOT < 420 (end), so no adjustment. diff=420-1140=-720 → early arrival
    expect(ket).toBe('Anomali (Terlalu Awal)');
  });

  it('night shift check-out at 06:00 (within shift) is not early departure', () => {
    // Night shift 19:00-07:00, check-out at 06:00 (360 min)
    // shiftEnd=420, diff=360-420=-60 → not < -60 → no remark
    const row = makeRow({ id: 1, timestamp: '2025-06-02T06:00:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('night shift check-out at 04:00 (early within shift) is early departure', () => {
    // Night shift 19:00-07:00, check-out at 04:00 (240 min)
    // shiftEnd=420, diff=240-420=-180 < -60 → early departure
    const row = makeRow({ id: 1, timestamp: '2025-06-02T04:00:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Pulang Cepat');
  });

  it('night shift check-out at 08:00 (after shift) is overtime within threshold', () => {
    // Night shift 19:00-07:00, check-out at 08:00 (480 min)
    // shiftEnd=420, diff=480-420=60 → not > 60 → no remark
    const row = makeRow({ id: 1, timestamp: '2025-06-02T08:00:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('');
  });

  it('night shift check-out at 09:00 (after shift) is overtime', () => {
    // Night shift 19:00-07:00, check-out at 09:00 (540 min)
    // shiftEnd=420, diff=540-420=120 > 60 → overtime
    const row = makeRow({ id: 1, timestamp: '2025-06-02T09:00:00', type: 1 });
    const rowAnomalyMap = new Map([[1, { isAnomaly: false, anomalyType: null }]]);
    const rowShiftMap = new Map([[1, { start: 19 * 60, end: 7 * 60 }]]); // 19:00-07:00 overnight
    const shiftTypes = { Staff: staffShift };

    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, defaultRemarks, 5);
    expect(ket).toBe('Anomali (Lembur?)');
  });
});

// ─── calculateShiftDiff ──────────────────────────────────────────────────────

describe('calculateShiftDiff()', () => {
  it('returns late remark when diff > tolerance for check-in', () => {
    const result = calculateShiftDiff(7 * 60 + 15, 7 * 60, 5, 0, defaultRemarks);
    expect(result).toBe('Terlambat 15 menit');
  });

  it('returns null when diff <= tolerance for check-in', () => {
    const result = calculateShiftDiff(7 * 60 + 3, 7 * 60, 5, 0, defaultRemarks);
    expect(result).toBeNull();
  });

  it('returns early arrival when diff < -60 for check-in', () => {
    const result = calculateShiftDiff(5 * 60, 7 * 60, 5, 0, defaultRemarks);
    expect(result).toBe('Anomali (Terlalu Awal)');
  });

  it('returns null when diff >= -60 for check-in (early but within threshold)', () => {
    const result = calculateShiftDiff(6 * 60 + 30, 7 * 60, 5, 0, defaultRemarks);
    expect(result).toBeNull();
  });

  it('returns overtime when diff > 60 for check-out', () => {
    const result = calculateShiftDiff(17 * 60 + 30, 16 * 60, 5, 1, defaultRemarks);
    expect(result).toBe('Anomali (Lembur?)');
  });

  it('returns null when diff <= 60 for check-out (overtime within threshold)', () => {
    const result = calculateShiftDiff(16 * 60 + 45, 16 * 60, 5, 1, defaultRemarks);
    expect(result).toBeNull();
  });

  it('returns early departure when diff < -60 for check-out', () => {
    const result = calculateShiftDiff(14 * 60, 16 * 60, 5, 1, defaultRemarks);
    expect(result).toBe('Pulang Cepat');
  });

  it('returns null when diff >= -60 for check-out (early departure within threshold)', () => {
    const result = calculateShiftDiff(15 * 60 + 30, 16 * 60, 5, 1, defaultRemarks);
    expect(result).toBeNull();
  });

  it('uses custom remarks for late', () => {
    const customRemarks = { late: 'Late by {diff} min' };
    const result = calculateShiftDiff(7 * 60 + 15, 7 * 60, 5, 0, customRemarks);
    expect(result).toBe('Late by 15 min');
  });

  it('falls back to DEFAULT_REMARKS when custom remarks missing a key', () => {
    const partialRemarks = { late: 'Custom Late' };
    const result = calculateShiftDiff(5 * 60, 7 * 60, 5, 0, partialRemarks);
    // early_arrival is missing from partialRemarks -> should use default
    expect(result).toBe('Anomali (Terlalu Awal)');
  });
});

// ─── processAttendance ──────────────────────────────────────────────────────

describe('processAttendance()', () => {
  it('processes a normal Masuk -> Pulang sequence correctly', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:03:00', type: 0 }), // within tolerance
      makeRow({ id: 2, timestamp: '2025-06-01T16:30:00', type: 1 }),
    ];
    const shiftTypes = { Staff: staffShift };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 1,
      type: 0,
      absensi: 'Masuk',
      ket: '',
    });
    expect(result[1]).toMatchObject({
      id: 2,
      type: 1,
      absensi: 'Pulang',
      ket: '',
    });
  });

  it('detects anomaly via state machine in full pipeline', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:03:00', type: 0 }), // within tolerance
      makeRow({ id: 2, timestamp: '2025-06-01T08:00:00', type: 0 }), // Masuk again -> anomaly
    ];
    const shiftTypes = { Staff: staffShift };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5);

    expect(result[0].ket).toBe('');
    expect(result[1].ket).toBe('Anomali / Pulang');
  });

  it('detects late check-in in full pipeline', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:20:00', type: 0 }), // 20 min late
    ];
    const shiftTypes = { Staff: staffShift };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5);

    expect(result[0].ket).toBe('Terlambat 20 menit');
  });

  it('detects duplicate in full pipeline', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0, is_duplicate: true }),
    ];
    const shiftTypes = { Staff: staffShift };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5);

    expect(result[0].ket).toBe('Duplikat Absensi');
  });

  it('handles empty rows array', () => {
    const result = processAttendance([], { Staff: staffShift }, defaultRemarks, 5);
    expect(result).toEqual([]);
  });

  it('preserves original row order in output (not sorted order)', () => {
    const rows = [
      makeRow({ id: 2, timestamp: '2025-06-01T16:30:00', type: 1 }),
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }),
    ];
    const shiftTypes = { Staff: staffShift };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5);

    // Output should preserve original order (id: 2 first, then id: 1)
    expect(result[0].id).toBe(2);
    expect(result[1].id).toBe(1);
  });

  it('uses custom typeMap for absensi labels', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 }),
    ];
    const shiftTypes = { Staff: staffShift };
    const customTypeMap = { 0: 'Check-In', 1: 'Check-Out' };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5, customTypeMap);

    expect(result[0].absensi).toBe('Check-In');
  });

  it('handles multi-shift config in full pipeline', () => {
    const rows = [
      makeRow({ id: 1, timestamp: '2025-06-01T07:03:00', type: 0, emp_type: 'NonStaff' }), // within tolerance
      makeRow({ id: 2, timestamp: '2025-06-01T15:30:00', type: 1, emp_type: 'NonStaff' }),
    ];
    const shiftTypes = { NonStaff: multiShift };
    const result = processAttendance(rows, shiftTypes, defaultRemarks, 5);

    expect(result[0].ket).toBe('');
    expect(result[1].ket).toBe('');
  });
});

// ─── buildLogResponse ────────────────────────────────────────────────────────

describe('buildLogResponse()', () => {
  it('returns correct shape for a basic row', () => {
    const row = makeRow({ id: 1, timestamp: '2025-06-01T07:30:00', type: 0 });
    const result = buildLogResponse(row, '', null);

    expect(result).toEqual({
      id: 1,
      user_id: 'U001',
      nik: 'NIK001',
      nama: 'John Doe',
      jabatan: 'Staff',
      department: 'IT',
      divisi: 'Engineering',
      emp_type: 'Staff',
      type: 0,
      absensi: 'Masuk',
      device_name: 'Device-A',
      device_sn: 'SN001',
      timestamp: '2025-06-01T07:30:00',
      created_at: '2025-06-01T07:30:05',
      ket: '',
    });
  });

  it('maps type to absensi label using default typeMap', () => {
    const row = makeRow({ id: 1, type: 2 });
    const result = buildLogResponse(row, '', null);
    expect(result.absensi).toBe('Break Out');
  });

  it('maps type to absensi label using custom typeMap', () => {
    const row = makeRow({ id: 1, type: 0 });
    const customTypeMap = { 0: 'Check-In', 1: 'Check-Out' };
    const result = buildLogResponse(row, '', customTypeMap);
    expect(result.absensi).toBe('Check-In');
  });

  it('falls back to string type when type not in typeMap', () => {
    const row = makeRow({ id: 1, type: 99 });
    const result = buildLogResponse(row, '', null);
    expect(result.absensi).toBe('99');
  });

  it('uses device_name over device_sn when both present', () => {
    const row = makeRow({ device_name: 'Device-B', device_sn: 'SN002' });
    const result = buildLogResponse(row, '', null);
    expect(result.device_name).toBe('Device-B');
  });

  it('falls back to device_sn when device_name is missing', () => {
    const row = { ...makeRow(), device_name: null, device_sn: 'SN003' };
    const result = buildLogResponse(row, '', null);
    expect(result.device_name).toBe('SN003');
  });

  it('includes ket parameter in response', () => {
    const row = makeRow({ id: 1 });
    const result = buildLogResponse(row, 'Terlambat 10 menit', null);
    expect(result.ket).toBe('Terlambat 10 menit');
  });

  it('handles null fields gracefully', () => {
    const row = {
      ...makeRow(),
      nik: null,
      nama: null,
      jabatan: null,
      department: null,
      divisi: null,
      emp_type: null,
      device_name: null,
      device_sn: null,
    };
    const result = buildLogResponse(row, '', null);
    expect(result.nik).toBeNull();
    expect(result.nama).toBeNull();
    expect(result.jabatan).toBeNull();
    expect(result.department).toBeNull();
    expect(result.divisi).toBeNull();
    expect(result.emp_type).toBeNull();
    expect(result.device_name).toBeNull();
    expect(result.device_sn).toBeNull();
  });
});
