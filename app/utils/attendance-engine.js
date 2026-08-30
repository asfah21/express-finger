/**
 * Attendance Engine — Business Logic for Attendance Processing
 * 
 * Handles state machine anomaly detection, shift matching, remark generation,
 * and session management. Designed to be framework-agnostic and testable.
 * 
 * Architecture:
 *   buildStateMachine()     → processes sorted rows, returns anomaly + shift maps
 *   detectAttendanceRemark() → generates remark for a single row using pre-computed maps
 *   findMatchingShift()     → finds which shift a time belongs to (range-check + fallback)
 *   calculateShiftDiff()    → computes diff from shift boundary and returns remark
 *   buildLogResponse()      → formats a single row into API response shape
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_TIMEOUT_HOURS = 15;

const DEFAULT_REMARKS = {
  late: 'Terlambat {diff} menit',
  early_arrival: 'Anomali (Terlalu Awal)',
  overtime_check: 'Anomali (Lembur?)',
  early_departure: 'Pulang Cepat',
  duplicate: 'Duplikat Absensi',
  anomaly_masuk: 'Anomali / Masuk',
  anomaly_pulang: 'Anomali / Pulang'
};

const DEFAULT_TYPE_MAP = {
  0: 'Masuk',
  1: 'Pulang',
  2: 'Break Out',
  3: 'Break In',
  4: 'Lembur Masuk',
  5: 'Lembur Keluar'
};

// ─── Shift Matching ──────────────────────────────────────────────────────────

/**
 * Find the matching shift for a given attendance time.
 * Strategy (priority order):
 *   1. Rule In Out check: if attendance time falls within a configured rule_in_out
 *      window (day_checkin/night_checkin for check-in, day_checkout/night_checkout
 *      for check-out), pick the corresponding shift type (day/night). This allows
 *      admins to define explicit time windows for shift matching.
 *   2. Range-check: if attendance time falls INSIDE a shift's [start, end) window,
 *      pick that shift. This correctly handles overnight shifts (e.g. 19:00-07:00)
 *      where the window wraps past midnight.
 *   3. Fallback (no shift contains the time): use nearest-neighbor on start (for
 *      check-in) or end (for check-out). This handles edge cases where someone
 *      clocks in/out far outside any shift window.
 *   4. Tie-breaker (multiple shifts match): pick the one with closest start/end.
 *
 * Boundary consistency: We use [start, end) — inclusive start, exclusive end.
 * This ensures adjacent shifts like 07:00-19:00 and 19:00-07:00 do NOT overlap
 * at the boundary: 07:00 belongs to the day shift (07:00-19:00), 19:00 belongs
 * to the night shift (19:00-07:00). Without this, a time exactly at the boundary
 * would match both shifts, causing inconsistent tie-breaker results.
 *
 * @param {object} shiftCfg - A single shift config entry from shift_types
 * @param {number} totalMinutes - Attendance time in minutes since midnight (0-1439)
 * @param {number} type - 0 for check-in (Masuk), 1 for check-out (Pulang)
 * @param {object} [ruleInOut] - Optional rule_in_out config with day/night windows
 * @returns {{ start: number, end: number } | null} - The matched shift's start/end in minutes, or null
 */
export function findMatchingShift(shiftCfg, totalMinutes, type, ruleInOut) {
  // Guard: null/undefined shiftCfg
  if (!shiftCfg) return null;

  // Single shift (Staff format with start/end)
  if (shiftCfg.start && shiftCfg.end) {
    const [hS, mS] = shiftCfg.start.split(':').map(Number);
    const [hE, mE] = shiftCfg.end.split(':').map(Number);
    return { start: hS * 60 + mS, end: hE * 60 + mE };
  }

  // Multi shift (Non-Staff format with shifts array)
  if (shiftCfg.shifts) {
    // ─── Step 1: Rule In Out check ────────────────────────────────────────
    // If rule_in_out is configured, check if the attendance time falls within
    // a day/night window. If it does, pick the shift that corresponds to that
    // window type (day shift = first shift, night shift = last shift).
    // This takes priority over range-check and fallback.
    if (ruleInOut) {
      const ruleKey = type === 0 ? 'checkin' : 'checkout';
      const dayKey = `day_${ruleKey}`;
      const nightKey = `night_${ruleKey}`;

      const dayWindow = ruleInOut[dayKey];
      const nightWindow = ruleInOut[nightKey];

      // Helper: check if totalMinutes falls within a [start, end) window,
      // handling overnight windows (e.g. 23:00-08:00) correctly.
      const isInWindow = (window) => {
        if (!window || window.length < 2) return false;
        const [hS, mS] = window[0].split(':').map(Number);
        const [hE, mE] = window[1].split(':').map(Number);
        const start = hS * 60 + mS;
        const end = hE * 60 + mE;
        if (end > start) {
          return totalMinutes >= start && totalMinutes < end;
        } else {
          // Overnight window (e.g. 23:00-08:00)
          return totalMinutes >= start || totalMinutes < end;
        }
      };

      const inDay = dayWindow ? isInWindow(dayWindow) : false;
      const inNight = nightWindow ? isInWindow(nightWindow) : false;

      if (inDay || inNight) {
        // Determine which shift index to use based on day/night:
        // - Day shift is typically the first shift (index 0)
        // - Night shift is typically the last shift (index length-1)
        // This works for common 2-shift configs like [day, night]
        const shiftIndex = inDay ? 0 : (shiftCfg.shifts.length - 1);
        const s = shiftCfg.shifts[shiftIndex];
        const [hS, mS] = s[0].split(':').map(Number);
        const [hE, mE] = s[1].split(':').map(Number);
        return { start: hS * 60 + mS, end: hE * 60 + mE };
      }
    }

    // ─── Step 2: Range-check ──────────────────────────────────────────────
    const candidates = [];

    for (const s of shiftCfg.shifts) {
      const [hS, mS] = s[0].split(':').map(Number);
      const [hE, mE] = s[1].split(':').map(Number);
      const startVal = hS * 60 + mS;
      const endVal = hE * 60 + mE;

      // Check if attendance time falls INSIDE this shift's range
      // Use [start, end) — inclusive start, exclusive end — to prevent
      // boundary overlap between adjacent shifts (e.g. 07:00 and 19:00).
      let isInside = false;
      if (endVal > startVal) {
        // Normal shift (e.g. 07:00-19:00): time in [start, end)
        isInside = totalMinutes >= startVal && totalMinutes < endVal;
      } else {
        // Overnight shift (e.g. 19:00-07:00): time in [start, 23:59] OR [00:00, end)
        // end is exclusive, so 07:00 (420) is NOT inside this overnight shift.
        // 07:00 belongs to the day shift (07:00-19:00) via [start, end) rule.
        isInside = totalMinutes >= startVal || totalMinutes < endVal;
      }

      if (isInside) {
        candidates.push({ start: startVal, end: endVal });
      }
    }

    if (candidates.length === 1) {
      // Exactly one shift contains this time → perfect match
      return candidates[0];
    }

    if (candidates.length > 1) {
      // Multiple shifts overlap this time (should not happen with [start, end) boundaries)
      // Pick the one with closest start (for check-in) or end (for check-out)
      const key = type === 0 ? 'start' : 'end';
      candidates.sort((a, b) => Math.abs(totalMinutes - a[key]) - Math.abs(totalMinutes - b[key]));
      return candidates[0];
    }

    // ─── Step 3: Fallback to nearest shift ────────────────────────────────
    // Time is outside ALL shift ranges.
    // This happens when attendance time falls in a gap between shifts (e.g. shifts
    // are 07:00-15:00 and 16:00-23:00, and someone clocks in at 15:30).
    // Use nearest-neighbor on start (check-in) or end (check-out).
    // NOTE: For overnight shifts (19:00-07:00), a time like 03:00 IS inside the
    // range (03:00 < 07:00), so it would have matched above. This fallback mainly
    // applies to non-24h coverage gaps.
    const key = type === 0 ? 'start' : 'end';
    let best = null;
    let minDiff = Infinity;
    for (const s of shiftCfg.shifts) {
      const [hS, mS] = s[0].split(':').map(Number);
      const [hE, mE] = s[1].split(':').map(Number);
      const startVal = hS * 60 + mS;
      const endVal = hE * 60 + mE;
      const val = key === 'start' ? startVal : endVal;
      const d = Math.abs(totalMinutes - val);
      if (d < minDiff) {
        minDiff = d;
        best = { start: startVal, end: endVal };
      }
    }
    return best;
  }

  return null;
}

// ─── Per-Row Session Transition ──────────────────────────────────────────────

/**
 * Apply a single attendance row to a session state and compute the transition.
 * Di-extract dari loop `buildStateMachine` agar perilaku per-baris bisa dipakai
 * ulang oleh incremental session-state store (session-state.js) dan oleh
 * buildStateMachine itu sendiri — satu sumber kebenaran untuk transisi state.
 *
 * @param {object|null} state - State sesi saat ini (atau null jika tidak ada)
 * @param {object} row - Baris absensi ({ timestamp, type, ... })
 * @param {object|null} shiftCfg - Konfigurasi shift untuk emp_type karyawan
 * @param {object} [ruleInOut] - Konfigurasi rule_in_out opsional
 * @returns {{ state: object|null, isAnomaly: boolean, anomalyType: string|null, matchedShift: object|null }}
 */
export function applySessionRow(state, row, shiftCfg, ruleInOut) {
  const rTime = new Date(row.timestamp).getTime();

  // Session timeout: jika aktivitas terakhir >15 jam lalu, reset state
  if (state) {
    const hoursSinceLastActivity = (rTime - state.lastTimestamp) / (1000 * 60 * 60);
    if (hoursSinceLastActivity > SESSION_TIMEOUT_HOURS) {
      state = null;
    }
  }

  let isAnomaly = false;
  let anomalyType = null;

  if (!state) {
    if (row.type === 0) {
      isAnomaly = false;
    } else {
      isAnomaly = true;
      anomalyType = 'masuk';
    }
  } else if (state.state === 'waiting_checkout') {
    if (row.type === 1) {
      isAnomaly = false;
    } else {
      isAnomaly = true;
      anomalyType = 'pulang';
    }
  } else if (state.state === 'waiting_checkin') {
    if (row.type === 0) {
      isAnomaly = false;
    } else {
      isAnomaly = true;
      anomalyType = 'masuk';
    }
  }

  let matchedShift = null;

  // Shift matching — check-in menemukan shift, check-out memakai ulang shift
  // dari sesi check-in agar Masuk-Pulang dievaluasi terhadap shift yang sama.
  if (shiftCfg) {
    const dt = new Date(row.timestamp);
    const totalMinutes = dt.getHours() * 60 + dt.getMinutes();

    if (row.type === 0) {
      matchedShift = findMatchingShift(shiftCfg, totalMinutes, 0, ruleInOut);
      if (state) state = { ...state, matchedShift };
    } else if (row.type === 1 && state && state.matchedShift) {
      matchedShift = state.matchedShift;
    } else if (row.type === 1) {
      matchedShift = findMatchingShift(shiftCfg, totalMinutes, 1, ruleInOut);
    }
  }

  // Transisi state — hanya record normal yang menggerakkan sesi. Record anomaly
  // diperlakukan sebagai "noise": tidak mengubah expected next state, hanya
  // memperbarui lastTimestamp (mencegah cascade anomaly).
  let nextState;
  if (!isAnomaly) {
    if (row.type === 0) {
      nextState = { state: 'waiting_checkout', lastTimestamp: rTime, matchedShift };
    } else if (row.type === 1) {
      nextState = { state: 'waiting_checkin', lastTimestamp: rTime, matchedShift: null };
    } else {
      nextState = state;
    }
  } else {
    nextState = { ...state, lastTimestamp: rTime };
  }

  return { state: nextState, isAnomaly, anomalyType, matchedShift };
}

// ─── State Machine ───────────────────────────────────────────────────────────

/**
 * Build the state machine for anomaly detection and shift matching.
 *
 * Processes attendance rows chronologically per user, tracking:
 *   - Expected state (waiting_checkin / waiting_checkout)
 *   - Session timeout (15h inactivity resets state)
 *   - Anomaly detection (Masuk when should be Pulang, etc.)
 *   - Matched shift per row (check-in finds shift, check-out reuses it)
 *
 * Each user session follows: Masuk (type=0) → Pulang (type=1) → Masuk → Pulang → ...
 * If a user does Masuk while waiting for Pulang → Anomali / Pulang
 * If a user does Pulang while waiting for Masuk → Anomali / Masuk
 * The 14-hour window acts as a session timeout: if the last activity was >15h ago,
 * the session is considered expired and a new session begins.
 *
 * @param {Array<object>} sortedRows - Attendance rows sorted chronologically (ascending)
 * @param {object} shiftTypes - Shift configuration from settings (shift_types)
 * @param {object} [ruleInOut] - Optional rule_in_out config for shift matching
 * @param {Map<string, object>} [seedStateMap] - Optional prior session states per
 *   user (dari incremental session-state store). Seed hanya dipakai bila state
 *   tersimpan tidak lebih baru dari row pertama user di batch ini.
 * @returns {{ rowAnomalyMap: Map, rowShiftMap: Map, userStateMap: Map, seedUsage: Map }}
 *   rowAnomalyMap: row.id → { isAnomaly: boolean, anomalyType: 'masuk'|'pulang'|null }
 *   rowShiftMap:   row.id → { start: number, end: number } | null (matched shift)
 *   userStateMap:  user_id → state sesi final setelah batch diproses
 *   seedUsage:     user_id → 'fresh' | 'consumed' | 'ignored' (untuk write-back)
 */
export function buildStateMachine(sortedRows, shiftTypes, ruleInOut, seedStateMap) {
  const rowAnomalyMap = new Map(); // row.id → { isAnomaly, anomalyType }
  const rowShiftMap = new Map();   // row.id → { start, end } (matched shift, for session consistency)
  // userStateMap: user_id → { state, lastTimestamp, matchedShift }
  // Di-seed dari incremental session-state store (bila valid) sehingga anomaly
  // detection tidak perlu menscan ulang seluruh history — cukup melanjutkan
  // dari state terakhir yang sudah diproses sebelumnya.
  const userStateMap = new Map(seedStateMap || []);
  // seedUsage: user_id → 'fresh' | 'consumed' | 'ignored'
  // Dipakai pemanggil untuk memutuskan user mana yang boleh di-tulis-balik ke
  // store (hindari memundurkan store dengan data dari halaman lama).
  const seedUsage = new Map();

  for (const r of sortedRows) {
    const uid = r.user_id;
    const empType = r.emp_type;
    const shiftCfg = shiftTypes[empType];

    // ─── State machine only applies to employees with shift config ─────────
    // If karyawan tidak memiliki shift assignment, skip anomaly detection entirely.
    // No anomaly, no state tracking, no shift matching for this employee.
    if (!shiftCfg) {
      rowAnomalyMap.set(r.id, { isAnomaly: false, anomalyType: null });
      rowShiftMap.set(r.id, undefined);
      continue;
    }

    let state = userStateMap.get(uid);

    // ─── Seed validation (hanya untuk row pertama per user dalam batch) ─────
    if (!seedUsage.has(uid)) {
      if (state) {
        // Seed hanya valid bila state tersimpan TIDAK lebih baru dari row ini.
        // Jika lebih baru (halaman menampilkan data lama), abaikan seed dan
        // mulai fresh — serta tandai 'ignored' agar store tidak di-tulis-balik.
        if (state.lastTimestamp > new Date(r.timestamp).getTime()) {
          seedUsage.set(uid, 'ignored');
          state = null;
        } else {
          seedUsage.set(uid, 'consumed');
        }
      } else {
        seedUsage.set(uid, 'fresh');
      }
    }

    // Transisi per-baris — logika tunggal (applySessionRow) untuk state machine
    // dan untuk incremental store.
    const applied = applySessionRow(state, r, shiftCfg, ruleInOut);

    rowAnomalyMap.set(r.id, { isAnomaly: applied.isAnomaly, anomalyType: applied.anomalyType });
    rowShiftMap.set(r.id, applied.matchedShift);
    userStateMap.set(uid, applied.state);
  }

  return { rowAnomalyMap, rowShiftMap, userStateMap, seedUsage };
}

// ─── Shift Diff Calculation ──────────────────────────────────────────────────

/**
 * Calculate the difference between attendance time and shift boundary,
 * and return the appropriate remark if the diff exceeds thresholds.
 *
 * For check-in (type=0):
 *   - diff > tolerance → late (Terlambat X menit)
 *   - diff < -60 → early arrival anomaly
 *
 * For check-out (type=1):
 *   - diff > 60 → overtime anomaly
 *   - diff < -60 → early departure
 *
 * @param {number} totalMinutes - Attendance time in minutes since midnight
 * @param {number} shiftBoundary - Shift start (for check-in) or end (for check-out) in minutes
 * @param {number} tolerance - Late tolerance in minutes (from late_tolerance_mins setting)
 * @param {number} type - 0 for check-in, 1 for check-out
 * @param {object} remarks - Remarks configuration object
 * @returns {string|null} - Remark string if anomaly detected, null otherwise
 */
export function calculateShiftDiff(totalMinutes, shiftBoundary, tolerance, type, remarks) {
  const diff = totalMinutes - shiftBoundary;

  if (type === 0) { // Check-in
    if (diff > tolerance) {
      return (remarks.late || DEFAULT_REMARKS.late).replace('{diff}', diff);
    }
    if (diff < -60) {
      return remarks.early_arrival || DEFAULT_REMARKS.early_arrival;
    }
  } else if (type === 1) { // Check-out
    if (diff > 60) {
      return remarks.overtime_check || DEFAULT_REMARKS.overtime_check;
    }
    if (diff < -60) {
      return remarks.early_departure || DEFAULT_REMARKS.early_departure;
    }
  }

  return null;
}

// ─── Attendance Remark Detection ─────────────────────────────────────────────

/**
 * Generate the attendance remark (ket) for a single row.
 *
 * Priority order:
 *   1. State machine anomaly (Anomali / Masuk or Anomali / Pulang)
 *   2. Duplicate detection
 *   3. Shift-based diff (late, early arrival, overtime, early departure)
 *
 * @param {object} row - A single attendance row from the database
 * @param {Map} rowAnomalyMap - Pre-computed anomaly map from buildStateMachine()
 * @param {Map} rowShiftMap - Pre-computed shift map from buildStateMachine()
 * @param {object} shiftTypes - Shift configuration from settings
 * @param {object} remarks - Remarks configuration object
 * @param {number} tolerance - Late tolerance in minutes
 * @param {object} [ruleInOut] - Optional rule_in_out config for shift matching
 * @returns {string} - The remark string (empty string if no anomaly)
 */
export function detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, remarks, tolerance, ruleInOut) {
  const dt = new Date(row.timestamp);
  const hours = dt.getHours();
  const minutes = dt.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  let ket = '';
  const empType = row.emp_type;
  const shiftCfg = shiftTypes[empType];

  // Get anomaly info from pre-computed state machine
  const anomalyInfo = rowAnomalyMap.get(row.id);
  const isAnomalyRecord = anomalyInfo?.isAnomaly ?? false;
  const anomalyType = anomalyInfo?.anomalyType ?? null;

  // ─── State Machine Anomaly Check (takes priority over shift-based checks) ───
  // If the state machine says this is an anomaly, apply it immediately.
  // This handles:
  //   - Masuk when waiting for Pulang → Anomali / Pulang
  //   - Pulang when waiting for Masuk → Anomali / Masuk
  if (isAnomalyRecord) {
    if (anomalyType === 'pulang') {
      return remarks.anomaly_pulang || DEFAULT_REMARKS.anomaly_pulang;
    } else if (anomalyType === 'masuk') {
      return remarks.anomaly_masuk || DEFAULT_REMARKS.anomaly_masuk;
    }
  }

  // ─── Duplicate Check (applies to ALL employees regardless of shift config) ───
  // Duplicate detection is independent of shift assignment.
  if (row.is_duplicate) {
    return remarks.duplicate || DEFAULT_REMARKS.duplicate;
  }

  // ─── Shift-Based Checks (only for employees with shift config) ───────────────
  if (row.type === 0 && shiftCfg) { // Check-in
    // Use pre-computed matched shift from rowShiftMap (computed in state machine loop).
    // This is the SINGLE SOURCE OF TRUTH for shift matching — we do NOT recalculate
    // here. The state machine already determined the shift during buildStateMachine().
    // This ensures consistency: check-in and check-out in the same session use the
    // same shift, and anomaly records don't get spurious shift-based remarks.
    const matched = rowShiftMap.get(row.id);
    const shiftStart = matched ? matched.start : -1;

    if (shiftStart !== -1) {
      // Handle overnight shifts: if shift starts in the evening (e.g., 19:00)
      // and attendance time is in the early morning (e.g., 02:00), the attendance
      // is on the "next day" of the overnight shift. We add 1440 to normalize.
      // The key insight: for overnight shifts (end < start), early morning times
      // (0 to shiftEnd) belong to the "next day" and need +1440 adjustment.
      // Times before shiftStart but after shiftEnd (e.g., 18:30 for a 19:00-07:00 shift)
      // are simply early arrivals, NOT next-day arrivals — they should NOT be adjusted.
      const isOvernight = matched && matched.end < matched.start;
      let adjustedTotal = totalMinutes;
      if (isOvernight && adjustedTotal < matched.end) {
        adjustedTotal += 1440;
      }
      const diff = adjustedTotal - shiftStart;
      if (diff > tolerance) {
        return (remarks.late || DEFAULT_REMARKS.late).replace('{diff}', diff);
      } else if (diff < -60) {
        return remarks.early_arrival || DEFAULT_REMARKS.early_arrival;
      }
    }
  } else if (row.type === 1 && shiftCfg) { // Check-out

    // Use pre-computed matched shift from rowShiftMap (computed in state machine loop).
    // For check-out, this reuses the SAME shift that was matched during check-in,
    // ensuring a single Masuk-Pulang session evaluates against the same shift consistently.
    const matched = rowShiftMap.get(row.id);
    const shiftEnd = matched ? matched.end : -1;

    if (shiftEnd !== -1) {
      const diff = totalMinutes - shiftEnd;
      if (diff > 60) {
        return remarks.overtime_check || DEFAULT_REMARKS.overtime_check;
      } else if (diff < -60) {
        return remarks.early_departure || DEFAULT_REMARKS.early_departure;
      }
    }
  }

  return ket;
}

// ─── Response Formatting ─────────────────────────────────────────────────────

/**
 * Build the API response object for a single attendance row.
 *
 * @param {object} row - Raw attendance row from database
 * @param {string} ket - The attendance remark (from detectAttendanceRemark)
 * @param {object} typeMap - Type mapping (type number → label string)
 * @returns {object} - Formatted response object
 */
export function buildLogResponse(row, ket, typeMap) {
  const resolvedTypeMap = typeMap || DEFAULT_TYPE_MAP;

  return {
    id: row.id,
    user_id: row.user_id,
    nik: row.nik || null,
    nama: row.nama || null,
    jabatan: row.jabatan || null,
    department: row.department || null,
    divisi: row.divisi || null,
    emp_type: row.emp_type || null,
    type: row.type,
    absensi: resolvedTypeMap[row.type] || String(row.type),
    device_name: row.device_name || row.device_sn,
    device_sn: row.device_sn,
    timestamp: row.timestamp,
    created_at: row.created_at,
    ket: ket
  };
}

// ─── High-Level Orchestrator ─────────────────────────────────────────────────

/**
 * Process attendance rows through the full pipeline:
 *   1. Sort chronologically
 *   2. Build state machine (anomaly detection + shift matching)
 *   3. Generate remarks per row
 *   4. Format response objects
 *
 * This is the main entry point for processing attendance data.
 *
 * @param {Array<object>} rows - Unsorted attendance rows from database
 * @param {object} shiftTypes - Shift configuration from settings
 * @param {object} remarks - Remarks configuration from settings
 * @param {number} tolerance - Late tolerance in minutes
 * @param {object} typeMap - Type mapping (type number → label string)
 * @param {object} [ruleInOut] - Optional rule_in_out config for shift matching
 * @param {object} [opts] - Opsi incremental processing
 * @param {object} [opts.stateStore] - SessionStateStore untuk seed & write-back
 *   state sesi per user (lihat session-state.js). Tanpa ini, perilaku sama
 *   seperti sebelumnya (state machine fresh per batch).
 * @param {boolean} [opts.updateStore=false] - Bila true dan stateStore ada,
 *   state final di-tulis-balik ke store untuk user dengan seed valid/fresh.
 *   Hati-hati: hanya set true untuk feed yang tidak terfilter (halaman 1 tanpa
 *   filter user/type/device/date), agar store tidak tercemar batch parsial.
 * @returns {Array<object>} - Processed rows with remarks and formatted response
 */
export function processAttendance(rows, shiftTypes, remarks, tolerance, typeMap, ruleInOut, opts = {}) {
  const { stateStore, updateStore = false } = opts;

  // Sort rows chronologically for state machine processing
  const sortedRows = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Seed state sesi per user dari incremental store (read-only). Seed dibuat
  // hanya untuk user yang ada di batch — history lama tidak perlu di-rescan.
  let seedStateMap;
  if (stateStore) {
    seedStateMap = new Map();
    for (const r of rows) {
      const key = String(r.user_id);
      if (!seedStateMap.has(key)) {
        const prior = stateStore.get(r.user_id);
        if (prior) seedStateMap.set(key, prior);
      }
    }
  }

  // Build state machine: anomaly detection + shift matching (+ seed incremental)
  const { rowAnomalyMap, rowShiftMap, userStateMap, seedUsage } =
    buildStateMachine(sortedRows, shiftTypes, ruleInOut, seedStateMap);

  // Tulis-balik state incremental hanya untuk user yang seed-nya valid
  // ('consumed') atau baru ('fresh'). User 'ignored' (store lebih baru dari
  // batch) tidak disentuh agar store tidak mundur ke state yang lebih lama.
  if (stateStore && updateStore) {
    for (const [uid, usage] of seedUsage) {
      if (usage !== 'ignored') {
        const finalState = userStateMap.get(uid);
        if (finalState) stateStore.set(uid, finalState);
      }
    }
  }

  // Generate remarks and format response for each row
  return rows.map(row => {
    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, remarks, tolerance, ruleInOut);
    return buildLogResponse(row, ket, typeMap);
  });
}