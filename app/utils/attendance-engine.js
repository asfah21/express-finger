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
 * @returns {{ rowAnomalyMap: Map, rowShiftMap: Map }}
 *   rowAnomalyMap: row.id → { isAnomaly: boolean, anomalyType: 'masuk'|'pulang'|null }
 *   rowShiftMap:   row.id → { start: number, end: number } | null (matched shift)
 */
export function buildStateMachine(sortedRows, shiftTypes, ruleInOut) {
  const rowAnomalyMap = new Map(); // row.id → { isAnomaly, anomalyType }
  const rowShiftMap = new Map();   // row.id → { start, end } (matched shift, for session consistency)
  const userStateMap = new Map();  // user_id → { state, lastTimestamp, matchedShift }

  for (const r of sortedRows) {
    const uid = r.user_id;
    const rTime = new Date(r.timestamp).getTime();
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

    // Session timeout: if last activity was >15h ago, reset state
    if (state) {
      const hoursSinceLastActivity = (rTime - state.lastTimestamp) / (1000 * 60 * 60);
      if (hoursSinceLastActivity > SESSION_TIMEOUT_HOURS) {
        state = null; // Session expired, start fresh
      }
    }

    // Determine expected type based on state
    let isAnomaly = false;
    let anomalyType = null; // 'pulang' for Masuk-when-should-Pulang, 'masuk' for Pulang-when-should-Masuk

    if (!state) {
      // No active session → expecting Masuk (type=0)
      if (r.type === 0) {
        // Normal: Masuk starts a new session
        isAnomaly = false;
      } else {
        // Anomaly: Pulang without Masuk first
        isAnomaly = true;
        anomalyType = 'masuk';
      }
    } else if (state.state === 'waiting_checkout') {
      // Waiting for Pulang (type=1)
      if (r.type === 1) {
        // Normal: Pulang completes the session
        isAnomaly = false;
      } else {
        // Anomaly: Masuk again when should be Pulang
        isAnomaly = true;
        anomalyType = 'pulang';
      }
    } else if (state.state === 'waiting_checkin') {
      // Waiting for Masuk (type=0)
      if (r.type === 0) {
        // Normal: Masuk starts a new session
        isAnomaly = false;
      } else {
        // Anomaly: Pulang again when should be Masuk
        isAnomaly = true;
        anomalyType = 'masuk';
      }
    }

    rowAnomalyMap.set(r.id, { isAnomaly, anomalyType });

    // ─── Pre-compute matched shift for this row ───────────────────────────
    // For check-in: find the matching shift and store it in the session state.
    // For check-out: reuse the shift that was matched during check-in, so that
    // a single Masuk-Pulang session evaluates against the SAME shift consistently.
    // This prevents issues like: night shift check-in at 18:30 matches day shift,
    // but check-out at 06:00 would match night shift if computed independently.
    if (shiftCfg) {
      const dt = new Date(r.timestamp);
      const hours = dt.getHours();
      const minutes = dt.getMinutes();
      const totalMinutes = hours * 60 + minutes;

      if (r.type === 0) {
        // Check-in: find matching shift via rule_in_out → range-check → fallback
        const matched = findMatchingShift(shiftCfg, totalMinutes, 0, ruleInOut);
        rowShiftMap.set(r.id, matched);
        // Store in session state so check-out can reuse it.
        // Use immutable update: create new state object rather than mutating.
        if (state) {
          state = { ...state, matchedShift: matched };
        }
      } else if (r.type === 1 && state && state.matchedShift) {
        // Check-out: reuse the shift from the corresponding check-in session
        // This ensures Masuk-Pulang are evaluated against the same shift.
        rowShiftMap.set(r.id, state.matchedShift);
      } else if (r.type === 1) {
        // Check-out without a prior check-in session (orphan checkout):
        // fall back to independent shift matching
        const matched = findMatchingShift(shiftCfg, totalMinutes, 1, ruleInOut);
        rowShiftMap.set(r.id, matched);
      }
    }

    // Update state machine based on actual record type.
    // IMPORTANT: Only normal (non-anomaly) records transition the session state.
    // Anomaly records are treated as "noise" — they do NOT change the expected
    // next state. This prevents cascade anomalies where one anomaly flips the
    // state and causes subsequent legitimate records to also be flagged.
    //
    // Rationale:
    //   - If the system expects Pulang (waiting_checkout) and a Masuk arrives,
    //     that Masuk is flagged as anomaly 'pulang'. The system should STILL
    //     expect Pulang next — the anomaly didn't fulfill the expected Pulang.
    //   - If the system expects Masuk (waiting_checkin) and a Pulang arrives,
    //     that Pulang is flagged as anomaly 'masuk'. The system should STILL
    //     expect Masuk next.
    //   - This ensures the pairing Masuk→Pulang is the single source of truth
    //     for session state, not individual events.
    if (!isAnomaly) {
      // Normal transition based on actual record type
      if (r.type === 0) {
        userStateMap.set(uid, { state: 'waiting_checkout', lastTimestamp: rTime, matchedShift: rowShiftMap.get(r.id) });
      } else if (r.type === 1) {
        userStateMap.set(uid, { state: 'waiting_checkin', lastTimestamp: rTime, matchedShift: null });
      }
    }
    // Anomaly records: do NOT transition state.
    // Only update lastTimestamp to prevent session timeout from resetting
    // due to stale timestamps.
    if (isAnomaly) {
      userStateMap.set(uid, { ...state, lastTimestamp: rTime });
    }
  }

  return { rowAnomalyMap, rowShiftMap };
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
      const diff = totalMinutes - shiftStart;
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
 * @returns {Array<object>} - Processed rows with remarks and formatted response
 */
export function processAttendance(rows, shiftTypes, remarks, tolerance, typeMap, ruleInOut) {
  // Sort rows chronologically for state machine processing
  const sortedRows = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Build state machine: anomaly detection + shift matching
  const { rowAnomalyMap, rowShiftMap } = buildStateMachine(sortedRows, shiftTypes, ruleInOut);

  // Generate remarks and format response for each row
  return rows.map(row => {
    const ket = detectAttendanceRemark(row, rowAnomalyMap, rowShiftMap, shiftTypes, remarks, tolerance, ruleInOut);
    return buildLogResponse(row, ket, typeMap);
  });
}