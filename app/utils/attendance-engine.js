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

const SESSION_TIMEOUT_HOURS = 14;

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
  if (!shiftCfg) {
    console.log(`    findMatchingShift: shiftCfg is null, returning null`);
    return null;
  }

  // Single shift (Staff format with start/end)
  if (shiftCfg.start && shiftCfg.end) {
    const [hS, mS] = shiftCfg.start.split(':').map(Number);
    const [hE, mE] = shiftCfg.end.split(':').map(Number);
    const result = { start: hS * 60 + mS, end: hE * 60 + mE };
    console.log(`    findMatchingShift: SINGLE shift → ${JSON.stringify(result)} (${shiftCfg.start}-${shiftCfg.end})`);
    return result;
  }

  // Multi shift (Non-Staff format with shifts array)
  if (shiftCfg.shifts) {
    console.log(`    findMatchingShift: MULTI shift with ${shiftCfg.shifts.length} shifts`);
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

      console.log(`    Step 1 (Rule In Out): type=${type}(${type===0?'checkin':'checkout'}) dayWindow=${JSON.stringify(dayWindow)} nightWindow=${JSON.stringify(nightWindow)}`);

      // Helper: check if totalMinutes falls within a [start, end) window,
      // handling overnight windows (e.g. 23:00-08:00) correctly.
      const isInWindow = (window) => {
        if (!window || window.length < 2) return false;
        const [hS, mS] = window[0].split(':').map(Number);
        const [hE, mE] = window[1].split(':').map(Number);
        const start = hS * 60 + mS;
        const end = hE * 60 + mE;
        let result;
        if (end > start) {
          result = totalMinutes >= start && totalMinutes < end;
          console.log(`      isInWindow([${window[0]}, ${window[1]}]) → start=${start}, end=${end} (normal), totalMinutes=${totalMinutes} → ${result}`);
        } else {
          // Overnight window (e.g. 23:00-08:00)
          result = totalMinutes >= start || totalMinutes < end;
          console.log(`      isInWindow([${window[0]}, ${window[1]}]) → start=${start}, end=${end} (OVERNIGHT), totalMinutes=${totalMinutes} → ${result} (${totalMinutes}>=${start} || ${totalMinutes}<${end})`);
        }
        return result;
      };

      const inDay = dayWindow ? isInWindow(dayWindow) : false;
      const inNight = nightWindow ? isInWindow(nightWindow) : false;

      console.log(`      inDay=${inDay}, inNight=${inNight}`);

      if (inDay || inNight) {
        // Determine which shift index to use based on day/night:
        // - Day shift is typically the first shift (index 0)
        // - Night shift is typically the last shift (index length-1)
        // This works for common 2-shift configs like [day, night]
        const shiftIndex = inDay ? 0 : (shiftCfg.shifts.length - 1);
        const s = shiftCfg.shifts[shiftIndex];
        const [hS, mS] = s[0].split(':').map(Number);
        const [hE, mE] = s[1].split(':').map(Number);
        const result = { start: hS * 60 + mS, end: hE * 60 + mE };
        console.log(`      ✅ Rule In Out MATCH: shiftIndex=${shiftIndex} (${inDay?'DAY':'NIGHT'}) → ${JSON.stringify(result)} (${s[0]}-${s[1]})`);
        return result;
      } else {
        console.log(`      ❌ Rule In Out NO MATCH, proceeding to Step 2 (Range-check)`);
      }
    } else {
      console.log(`    No ruleInOut config, skipping Step 1`);
    }

    // ─── Step 2: Range-check ──────────────────────────────────────────────
    const candidates = [];

    console.log(`    Step 2 (Range-check): totalMinutes=${totalMinutes}`);
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
        console.log(`      Shift ${s[0]}-${s[1]} (normal): [${startVal}, ${endVal}) → ${isInside} (${totalMinutes}>=${startVal} && ${totalMinutes}<${endVal})`);
      } else {
        // Overnight shift (e.g. 19:00-07:00): time in [start, 23:59] OR [00:00, end)
        // end is exclusive, so 07:00 (420) is NOT inside this overnight shift.
        // 07:00 belongs to the day shift (07:00-19:00) via [start, end) rule.
        isInside = totalMinutes >= startVal || totalMinutes < endVal;
        console.log(`      Shift ${s[0]}-${s[1]} (overnight): [${startVal}, ${endVal}) → ${isInside} (${totalMinutes}>=${startVal} || ${totalMinutes}<${endVal})`);
      }

      if (isInside) {
        candidates.push({ start: startVal, end: endVal });
      }
    }

    console.log(`      Candidates found: ${candidates.length}`);

    if (candidates.length === 1) {
      // Exactly one shift contains this time → perfect match
      console.log(`      ✅ Range-check: exact match → ${JSON.stringify(candidates[0])}`);
      return candidates[0];
    }

    if (candidates.length > 1) {
      // Multiple shifts overlap this time (should not happen with [start, end) boundaries)
      // Pick the one with closest start (for check-in) or end (for check-out)
      const key = type === 0 ? 'start' : 'end';
      candidates.sort((a, b) => Math.abs(totalMinutes - a[key]) - Math.abs(totalMinutes - b[key]));
      console.log(`      ⚠️ Range-check: multiple matches (${candidates.length}), picking closest by ${key} → ${JSON.stringify(candidates[0])}`);
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
      console.log(`      Fallback candidate: ${s[0]}-${s[1]} ${key}=${val}, diff=${d}`);
      if (d < minDiff) {
        minDiff = d;
        best = { start: startVal, end: endVal };
      }
    }
    console.log(`      ✅ Fallback: nearest ${key} → ${JSON.stringify(best)}`);
    return best;
  }

  console.log(`    findMatchingShift: No matching format, returning null`);
  return null;

}

// ─── State Machine ───────────────────────────────────────────────────────────

/**
 * Build the state machine for anomaly detection and shift matching.
 *
 * Processes attendance rows chronologically per user, tracking:
 *   - Expected state (waiting_checkin / waiting_checkout)
 *   - Session timeout (14h inactivity resets state)
 *   - Anomaly detection (Masuk when should be Pulang, etc.)
 *   - Matched shift per row (check-in finds shift, check-out reuses it)
 *
 * Each user session follows: Masuk (type=0) → Pulang (type=1) → Masuk → Pulang → ...
 * If a user does Masuk while waiting for Pulang → Anomali / Pulang
 * If a user does Pulang while waiting for Masuk → Anomali / Masuk
 * The 14-hour window acts as a session timeout: if the last activity was >14h ago,
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

  // ─── DEBUG: Log timezone info ──────────────────────────────────────────────
  console.log('\n========== DEBUG buildStateMachine ==========');
  console.log('Server timezone offset (minutes):', new Date().getTimezoneOffset());
  console.log('Intl.DateTimeFormat resolved:', Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('ruleInOut config:', JSON.stringify(ruleInOut, null, 2));
  console.log('shiftTypes keys:', Object.keys(shiftTypes));
  console.log('Total rows to process:', sortedRows.length);
  console.log('=============================================\n');

  for (const r of sortedRows) {
    const uid = r.user_id;
    const rTime = new Date(r.timestamp).getTime();
    let state = userStateMap.get(uid);

    // ─── DEBUG: Raw timestamp info ────────────────────────────────────────────
    const dt = new Date(r.timestamp);
    const localHours = dt.getHours();
    const localMinutes = dt.getMinutes();
    const utcHours = dt.getUTCHours();
    const utcMinutes = dt.getUTCMinutes();
    const totalMinutesUTC = utcHours * 60 + utcMinutes;
    const totalMinutesLocal = localHours * 60 + localMinutes;

    console.log(`\n--- Row id=${r.id} | user_id=${uid} | type=${r.type} (${r.type === 0 ? 'Masuk' : 'Pulang'}) ---`);
    console.log(`  Raw timestamp string: "${r.timestamp}"`);
    console.log(`  Parsed Date: ${dt.toISOString()}`);
    console.log(`  Local time: ${dt.toString()}`);
    console.log(`  getHours()=${localHours} getMinutes()=${localMinutes} → totalMinutes(LOCAL)=${totalMinutesLocal}`);
    console.log(`  getUTCHours()=${utcHours} getUTCMinutes()=${utcMinutes} → totalMinutes(UTC)=${totalMinutesUTC}`);
    console.log(`  emp_type: "${r.emp_type}"`);
    // ─── END DEBUG ────────────────────────────────────────────────────────────

    // Session timeout: if last activity was >14h ago, reset state
    if (state) {
      const hoursSinceLastActivity = (rTime - state.lastTimestamp) / (1000 * 60 * 60);
      console.log(`  Session state: ${state.state}, lastTimestamp: ${new Date(state.lastTimestamp).toISOString()}, hoursSinceLastActivity: ${hoursSinceLastActivity.toFixed(2)}h`);
      if (hoursSinceLastActivity > SESSION_TIMEOUT_HOURS) {
        console.log(`  ⚠️ Session TIMEOUT (>${SESSION_TIMEOUT_HOURS}h), resetting state`);
        state = null; // Session expired, start fresh
      }
    } else {
      console.log(`  No active session (state=null)`);
    }

    // Determine expected type based on state
    let isAnomaly = false;
    let anomalyType = null; // 'pulang' for Masuk-when-should-Pulang, 'masuk' for Pulang-when-should-Masuk

    if (!state) {
      // No active session → expecting Masuk (type=0)
      if (r.type === 0) {
        // Normal: Masuk starts a new session
        isAnomaly = false;
        console.log(`  ✅ Normal: Masuk starts new session`);
      } else {
        // Anomaly: Pulang without Masuk first
        isAnomaly = true;
        anomalyType = 'masuk';
        console.log(`  ❌ Anomaly: Pulang without Masuk first → anomalyType=masuk`);
      }
    } else if (state.state === 'waiting_checkout') {
      // Waiting for Pulang (type=1)
      if (r.type === 1) {
        // Normal: Pulang completes the session
        isAnomaly = false;
        console.log(`  ✅ Normal: Pulang completes session (waiting_checkout → Pulang)`);
      } else {
        // Anomaly: Masuk again when should be Pulang
        isAnomaly = true;
        anomalyType = 'pulang';
        console.log(`  ❌ Anomaly: Masuk when should be Pulang → anomalyType=pulang`);
      }
    } else if (state.state === 'waiting_checkin') {
      // Waiting for Masuk (type=0)
      if (r.type === 0) {
        // Normal: Masuk starts a new session
        isAnomaly = false;
        console.log(`  ✅ Normal: Masuk starts session (waiting_checkin → Masuk)`);
      } else {
        // Anomaly: Pulang again when should be Masuk
        isAnomaly = true;
        anomalyType = 'masuk';
        console.log(`  ❌ Anomaly: Pulang when should be Masuk → anomalyType=masuk`);
      }
    }

    rowAnomalyMap.set(r.id, { isAnomaly, anomalyType });

    // ─── Pre-compute matched shift for this row ───────────────────────────
    // For check-in: find the matching shift and store it in the session state.
    // For check-out: reuse the shift that was matched during check-in, so that
    // a single Masuk-Pulang session evaluates against the SAME shift consistently.
    // This prevents issues like: night shift check-in at 18:30 matches day shift,
    // but check-out at 06:00 would match night shift if computed independently.
    const empType = r.emp_type;
    const shiftCfg = shiftTypes[empType];
    if (shiftCfg) {
      const dt2 = new Date(r.timestamp);
      const hours = dt2.getUTCHours();
      const minutes = dt2.getUTCMinutes();
      const totalMinutes = hours * 60 + minutes;

      console.log(`  Shift config for emp_type="${empType}":`, JSON.stringify(shiftCfg));
      console.log(`  totalMinutes (UTC-based): ${totalMinutes} (${hours}:${String(minutes).padStart(2,'0')} UTC)`);

      if (r.type === 0) {
        // Check-in: find matching shift via rule_in_out → range-check → fallback
        console.log(`  🔍 findMatchingShift(type=0/checkin, totalMinutes=${totalMinutes})`);
        const matched = findMatchingShift(shiftCfg, totalMinutes, 0, ruleInOut);
        console.log(`  → Matched shift:`, matched ? `${JSON.stringify(matched)} (${Math.floor(matched.start/60)}:${String(matched.start%60).padStart(2,'0')}-${Math.floor(matched.end/60)}:${String(matched.end%60).padStart(2,'0')})` : 'null');
        rowShiftMap.set(r.id, matched);
        // Store in session state so check-out can reuse it.
        // Use immutable update: create new state object rather than mutating.
        if (state) {
          state = { ...state, matchedShift: matched };
        }
      } else if (r.type === 1 && state && state.matchedShift) {
        // Check-out: reuse the shift from the corresponding check-in session
        // This ensures Masuk-Pulang are evaluated against the same shift.
        console.log(`  🔄 Check-out: reusing session matchedShift:`, JSON.stringify(state.matchedShift));
        rowShiftMap.set(r.id, state.matchedShift);
      } else if (r.type === 1) {
        // Check-out without a prior check-in session (orphan checkout):
        // fall back to independent shift matching
        console.log(`  🔍 Orphan checkout: findMatchingShift(type=1/checkout, totalMinutes=${totalMinutes})`);
        const matched = findMatchingShift(shiftCfg, totalMinutes, 1, ruleInOut);
        console.log(`  → Matched shift:`, matched ? JSON.stringify(matched) : 'null');
        rowShiftMap.set(r.id, matched);
      }
    } else {
      console.log(`  ⚠️ No shift config found for emp_type="${empType}"`);
    }

    // Update state machine based on what SHOULD happen next:
    // - Normal Masuk (type=0) → now waiting for Pulang (waiting_checkout)
    // - Normal Pulang (type=1) → now waiting for Masuk (waiting_checkin)
    // - Anomaly Masuk (should have been Pulang) → treat as if Pulang was done,
    //   so state becomes waiting_checkin (ready for next Masuk session)
    // - Anomaly Pulang (should have been Masuk) → treat as if Masuk was done,
    //   so state becomes waiting_checkout (ready for next Pulang)
    if (!isAnomaly) {
      // Normal transition based on actual record type
      if (r.type === 0) {
        userStateMap.set(uid, { state: 'waiting_checkout', lastTimestamp: rTime, matchedShift: rowShiftMap.get(r.id) });
        console.log(`  → State transition: waiting_checkout (matchedShift saved)`);
      } else if (r.type === 1) {
        userStateMap.set(uid, { state: 'waiting_checkin', lastTimestamp: rTime, matchedShift: null });
        console.log(`  → State transition: waiting_checkin`);
      }
    } else {
      // Anomaly: transition based on what SHOULD have happened
      // This prevents cascading false anomalies across days
      if (anomalyType === 'pulang') {
        // User did Masuk but should have done Pulang
        // Treat as if Pulang was done → now waiting for Masuk
        userStateMap.set(uid, { state: 'waiting_checkin', lastTimestamp: rTime, matchedShift: null });
        console.log(`  → Anomaly transition: waiting_checkin (treated as Pulang done)`);
      } else if (anomalyType === 'masuk') {
        // User did Pulang but should have done Masuk
        // Treat as if Masuk was done → now waiting for Pulang
        userStateMap.set(uid, { state: 'waiting_checkout', lastTimestamp: rTime, matchedShift: rowShiftMap.get(r.id) });
        console.log(`  → Anomaly transition: waiting_checkout (treated as Masuk done)`);
      }
    }
  }

  console.log('\n========== END DEBUG buildStateMachine ==========\n');

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
  const hours = dt.getUTCHours();
  const minutes = dt.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  console.log(`\n--- detectAttendanceRemark: id=${row.id} type=${row.type}(${row.type===0?'Masuk':'Pulang'}) timestamp="${row.timestamp}" totalMinutes(UTC)=${totalMinutes} ---`);

  let ket = '';
  const empType = row.emp_type;
  const shiftCfg = shiftTypes[empType];

  // Get anomaly info from pre-computed state machine
  const anomalyInfo = rowAnomalyMap.get(row.id);
  const isAnomalyRecord = anomalyInfo?.isAnomaly ?? false;
  const anomalyType = anomalyInfo?.anomalyType ?? null;

  console.log(`  anomalyInfo: isAnomaly=${isAnomalyRecord}, anomalyType=${anomalyType}`);

  // ─── State Machine Anomaly Check (takes priority over shift-based checks) ───
  // If the state machine says this is an anomaly, apply it immediately.
  // This handles:
  //   - Masuk when waiting for Pulang → Anomali / Pulang
  //   - Pulang when waiting for Masuk → Anomali / Masuk
  if (isAnomalyRecord) {
    if (anomalyType === 'pulang') {
      const result = remarks.anomaly_pulang || DEFAULT_REMARKS.anomaly_pulang;
      console.log(`  🚨 STATE MACHINE ANOMALY: returning "${result}" (anomalyType=pulang)`);
      return result;
    } else if (anomalyType === 'masuk') {
      const result = remarks.anomaly_masuk || DEFAULT_REMARKS.anomaly_masuk;
      console.log(`  🚨 STATE MACHINE ANOMALY: returning "${result}" (anomalyType=masuk)`);
      return result;
    }
  }

  if (row.type === 0 && shiftCfg) { // Check-in (only if no anomaly already set)
    // Use pre-computed matched shift from rowShiftMap (computed in state machine loop).
    // This ensures range-check first, fallback to nearest-neighbor.
    const matched = rowShiftMap.get(row.id) || findMatchingShift(shiftCfg, totalMinutes, 0);
    const shiftStart = matched ? matched.start : -1;
    console.log(`  Check-in: matched shift start=${shiftStart} (from rowShiftMap: ${JSON.stringify(matched)})`);

    if (row.is_duplicate) {
      console.log(`  ⚠️ Duplicate detected, returning "${remarks.duplicate}"`);
      return remarks.duplicate || DEFAULT_REMARKS.duplicate;
    } else if (shiftStart !== -1) {
      const diff = totalMinutes - shiftStart;
      console.log(`  diff = ${totalMinutes} - ${shiftStart} = ${diff}, tolerance=${tolerance}`);
      if (diff > tolerance) {
        const result = (remarks.late || DEFAULT_REMARKS.late).replace('{diff}', diff);
        console.log(`  ⏰ Late: returning "${result}"`);
        return result;
      } else if (diff < -60) {
        const result = remarks.early_arrival || DEFAULT_REMARKS.early_arrival;
        console.log(`  ⏰ Early arrival: returning "${result}"`);
        return result;
      }
      console.log(`  ✅ Normal check-in (diff=${diff} within tolerance)`);
    } else {
      console.log(`  ⚠️ No shift matched, returning empty ket`);
    }
  } else if (row.type === 1 && shiftCfg) { // Check-out (only if no anomaly already set)
    // Use pre-computed matched shift from rowShiftMap (computed in state machine loop).
    // For check-out, this reuses the SAME shift that was matched during check-in,
    // ensuring a single Masuk-Pulang session evaluates against the same shift consistently.
    const matched = rowShiftMap.get(row.id) || findMatchingShift(shiftCfg, totalMinutes, 1);
    const shiftEnd = matched ? matched.end : -1;
    console.log(`  Check-out: matched shift end=${shiftEnd} (from rowShiftMap: ${JSON.stringify(matched)})`);

    if (row.is_duplicate) {
      console.log(`  ⚠️ Duplicate detected, returning "${remarks.duplicate}"`);
      return remarks.duplicate || DEFAULT_REMARKS.duplicate;
    } else if (shiftEnd !== -1) {
      const diff = totalMinutes - shiftEnd;
      console.log(`  diff = ${totalMinutes} - ${shiftEnd} = ${diff}`);
      if (diff > 60) {
        const result = remarks.overtime_check || DEFAULT_REMARKS.overtime_check;
        console.log(`  ⏰ Overtime: returning "${result}"`);
        return result;
      } else if (diff < -60) {
        const result = remarks.early_departure || DEFAULT_REMARKS.early_departure;
        console.log(`  ⏰ Early departure: returning "${result}"`);
        return result;
      }
      console.log(`  ✅ Normal check-out (diff=${diff} within tolerance)`);
    } else {
      console.log(`  ⚠️ No shift matched, returning empty ket`);
    }
  } else {
    console.log(`  No shiftCfg or type not handled, returning empty ket`);
  }

  console.log(`  Final ket: "${ket}"`);
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
