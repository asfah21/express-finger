import { readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import { config } from '../config/index.js'
import { pool } from '../utils/database.js'
import { getSettingsData } from './settings.js'
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js'
import { getCache, setCache, delCacheByPattern, CACHE_KEYS, TTL, buildCacheKey } from '../utils/cache.js'

// API controller
export const apiController = {
  async getLogs(req, res) {
    try {
      const { from, to, limit = 100, offset = 0, user_id, type, device_sn, search } = req.query

      // Cek cache untuk GET logs - gunakan key yang lebih ringkas
      // Hanya cache request tanpa filter spesifik (halaman 1, tanpa filter) untuk menghemat memori
      let cacheKey = null
      const shouldCache = !user_id && !type && !device_sn && !search && Number(offset) === 0
      
      if (shouldCache) {
        cacheKey = buildCacheKey(CACHE_KEYS.LOGS_LIST, from || 'all', limit)
        const cached = getCache(cacheKey)
        if (cached) {
          return sendPaginated(res, cached.rows, cached.total, Number(limit), Number(offset))
        }
      }
      const lim = Math.min(Number(limit) || 100, config.MAX_LIMIT)
      const off = Math.max(Number(offset) || 0, 0)
      const where = []
      const params = []
      let i = 1

      if (from) { where.push(`al."timestamp" >= $${i++}`); params.push(new Date(String(from))) }
      if (to) { where.push(`al."timestamp" <= $${i++}`); params.push(new Date(String(to))) }
      if (user_id) { where.push(`al.user_id = $${i++}`); params.push(String(user_id)) }
      if (type !== undefined && type !== '') { where.push(`al.type = $${i++}`); params.push(Number(type)) }
      if (device_sn) { where.push(`al.device_sn = $${i++}`); params.push(String(device_sn)) }

      if (search) {
        where.push(`e.nama ILIKE $${i}`);
        params.push(`%${search}%`);
        i++;
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

      const dataQuery = {
        text: `
          WITH ranked_logs AS (
            SELECT 
              al.id, 
              al.user_id, 
              e.nik,
              e.nama,
              e.jabatan,
              e.department,
              e.divisi,
              e.type as emp_type,
              al.type, 
              al.device_sn,
              d.name as device_name,
              al."timestamp", 
              al.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY al.user_id, al.type, DATE(al."timestamp" AT TIME ZONE 'Asia/Makassar') 
                ORDER BY al."timestamp" ASC, al.id ASC
              ) as row_num
            FROM attendance_logs al
            LEFT JOIN employee e ON al.user_id::text = e.user_id::text
            LEFT JOIN devices d ON al.device_sn = d.sn
            ${whereSql}
          )
          SELECT *, (row_num > 1) as is_duplicate
          FROM ranked_logs
          ORDER BY "timestamp" DESC
          LIMIT $${i++} OFFSET $${i++}
        `,
        values: [...params, lim, off],
      }
      const countQuery = {
        text: `
          SELECT COUNT(*)::bigint AS total 
          FROM attendance_logs al 
          LEFT JOIN employee e ON al.user_id::text = e.user_id::text
          ${whereSql}
        `,
        values: params,
      }

      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery),
        pool.query(countQuery)
      ])

      const paramSettings = await getSettingsData()
      const tolerance = Number(paramSettings?.late_tolerance_mins || 5);
      const shiftTypes = paramSettings?.shift_types || {};
      const remarks = paramSettings?.remarks_config || {
        "late": "Terlambat {diff} menit",
        "early_arrival": "Anomali (Terlalu Awal)",
        "overtime_check": "Anomali (Lembur?)",
        "early_departure": "Pulang Cepat",
        "duplicate": "Duplikat Absensi",
        "anomaly_masuk": "Anomali / Masuk",
        "anomaly_pulang": "Anomali / Pulang"
      };

      const typeMap = paramSettings?.types || {
        0: 'Masuk',
        1: 'Pulang',
        2: 'Break Out',
        3: 'Break In',
        4: 'Lembur Masuk',
        5: 'Lembur Keluar'
      }

      // ─── State Machine for Anomaly Detection ───────────────────────────────
      // Each user session follows: Masuk (type=0) → Pulang (type=1) → Masuk → Pulang → ...
      // If a user does Masuk while waiting for Pulang → Anomali / Pulang
      // If a user does Pulang while waiting for Masuk → Anomali / Masuk
      // The 14-hour window acts as a session timeout: if the last activity was >14h ago,
      // the session is considered expired and a new session begins.
      // This correctly handles:
      //   - Normal: Masuk → Pulang → Masuk → Pulang (all normal)
      //   - Anomali: Masuk → Masuk (second Masuk = anomaly, should be Pulang)
      //   - Anomali: Pulang → Pulang (second Pulang = anomaly, should be Masuk)
      //   - Overshift: Masuk 18:00 → Pulang 02:00 (within 14h, normal)
      //   - Session timeout: Masuk 06:00 → (14h passes) → Masuk 22:00 = new session
      const SESSION_TIMEOUT_HOURS = 14;

      /**
       * Find the matching shift for a given attendance time.
       * Strategy (priority order):
       *   1. Range-check: if attendance time falls INSIDE a shift's [start, end) window,
       *      pick that shift. This correctly handles overnight shifts (e.g. 19:00-07:00)
       *      where the window wraps past midnight.
       *   2. Fallback (no shift contains the time): use nearest-neighbor on start (for
       *      check-in) or end (for check-out). This handles edge cases where someone
       *      clocks in/out far outside any shift window.
       *   3. Tie-breaker (multiple shifts match): pick the one with closest start/end.
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
       * @returns {{ start: number, end: number } | null} - The matched shift's start/end in minutes, or null
       */
      function findMatchingShift(shiftCfg, totalMinutes, type) {
        // Single shift (Staff format with start/end)
        if (shiftCfg.start && shiftCfg.end) {
          const [hS, mS] = shiftCfg.start.split(':').map(Number);
          const [hE, mE] = shiftCfg.end.split(':').map(Number);
          return { start: hS * 60 + mS, end: hE * 60 + mE };
        }

        // Multi shift (Non-Staff format with shifts array)
        if (shiftCfg.shifts) {
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

          // Fallback: time is outside ALL shift ranges.
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

      // Sort rows chronologically for state machine processing
      const sortedRows = [...dataRes.rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Pre-compute expected state for each row using the state machine
      // State: 'waiting_checkin' (expecting Masuk) or 'waiting_checkout' (expecting Pulang)
      const rowAnomalyMap = new Map(); // row.id → { isAnomaly, anomalyType }
      const rowShiftMap = new Map();   // row.id → { start, end } (matched shift, for session consistency)
      const userStateMap = new Map();  // user_id → { state, lastTimestamp, matchedShift }

      for (const r of sortedRows) {

        const uid = r.user_id;
        const rTime = new Date(r.timestamp).getTime();
        let state = userStateMap.get(uid);

        // Session timeout: if last activity was >14h ago, reset state
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
        const empType = r.emp_type;
        const shiftCfg = shiftTypes[empType];
        if (shiftCfg) {
          const dt = new Date(r.timestamp);
          const hours = dt.getUTCHours();
          const minutes = dt.getUTCMinutes();
          const totalMinutes = hours * 60 + minutes;

          if (r.type === 0) {
            // Check-in: find matching shift via range-check (with fallback)
            const matched = findMatchingShift(shiftCfg, totalMinutes, 0);
            rowShiftMap.set(r.id, matched);
            // Store in session state so check-out can reuse it
            if (state) {
              state.matchedShift = matched;
            }
          } else if (r.type === 1 && state && state.matchedShift) {
            // Check-out: reuse the shift from the corresponding check-in session
            // This ensures Masuk-Pulang are evaluated against the same shift.
            rowShiftMap.set(r.id, state.matchedShift);
          } else if (r.type === 1) {
            // Check-out without a prior check-in session (orphan checkout):
            // fall back to independent shift matching
            const matched = findMatchingShift(shiftCfg, totalMinutes, 1);
            rowShiftMap.set(r.id, matched);
          }
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
          } else if (r.type === 1) {
            userStateMap.set(uid, { state: 'waiting_checkin', lastTimestamp: rTime, matchedShift: null });
          }
        } else {
          // Anomaly: transition based on what SHOULD have happened
          // This prevents cascading false anomalies across days
          if (anomalyType === 'pulang') {
            // User did Masuk but should have done Pulang
            // Treat as if Pulang was done → now waiting for Masuk
            userStateMap.set(uid, { state: 'waiting_checkin', lastTimestamp: rTime, matchedShift: null });
          } else if (anomalyType === 'masuk') {
            // User did Pulang but should have done Masuk
            // Treat as if Masuk was done → now waiting for Pulang
            userStateMap.set(uid, { state: 'waiting_checkout', lastTimestamp: rTime, matchedShift: rowShiftMap.get(r.id) });
          }
        }


      }

      const rows = dataRes.rows.map(row => {
        const dt = new Date(row.timestamp);
        const hours = dt.getUTCHours();
        const minutes = dt.getUTCMinutes();
        const totalMinutes = hours * 60 + minutes;

        let ket = '';
        const empType = row.emp_type;
        const shiftCfg = shiftTypes[empType];
        const rowTime = dt.getTime();

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
            ket = remarks.anomaly_pulang || 'Anomali / Pulang';
          } else if (anomalyType === 'masuk') {
            ket = remarks.anomaly_masuk || 'Anomali / Masuk';
          }
        }

        if (row.type === 0 && shiftCfg && !ket) { // Check-in (only if no anomaly already set)
          // Use pre-computed matched shift from rowShiftMap (computed in state machine loop).
          // This ensures range-check first, fallback to nearest-neighbor.
          const matched = rowShiftMap.get(row.id) || findMatchingShift(shiftCfg, totalMinutes, 0);
          const shiftStart = matched ? matched.start : -1;

          if (row.is_duplicate) {
            ket = remarks.duplicate || 'Duplikat Absensi';
          } else if (shiftStart !== -1) {
            const diff = totalMinutes - shiftStart;
            if (diff > tolerance) {
              ket = (remarks.late || 'Terlambat {diff} menit').replace('{diff}', diff);
            } else if (diff < -60) {
              ket = remarks.early_arrival || 'Anomali (Terlalu Awal)';
            }
          }
        } else if (row.type === 1 && shiftCfg && !ket) { // Check-out (only if no anomaly already set)
          // Use pre-computed matched shift from rowShiftMap (computed in state machine loop).
          // For check-out, this reuses the SAME shift that was matched during check-in,
          // ensuring a single Masuk-Pulang session evaluates against the same shift consistently.
          const matched = rowShiftMap.get(row.id) || findMatchingShift(shiftCfg, totalMinutes, 1);
          const shiftEnd = matched ? matched.end : -1;

          if (row.is_duplicate) {
            ket = remarks.duplicate || 'Duplikat Absensi';
          } else if (shiftEnd !== -1) {
            const diff = totalMinutes - shiftEnd;
            if (diff > 60) {
              ket = remarks.overtime_check || 'Anomali (Lembur?)';
            } else if (diff < -60) {
              ket = remarks.early_departure || 'Pulang Cepat';
            }
          }
        }



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
          absensi: typeMap[row.type] || String(row.type),
          device_name: row.device_name || row.device_sn,
          device_sn: row.device_sn,
          timestamp: row.timestamp,
          created_at: row.created_at,
          ket: ket
        }
      })

      const total = Number(countRes.rows[0]?.total || 0)

      // Simpan ke cache untuk request berikutnya (hanya jika shouldCache)
      if (shouldCache && cacheKey) {
        setCache(cacheKey, { rows, total }, TTL.SHORT)
      }

      sendPaginated(res, rows, total, lim, off)

    } catch (e) {
      sendError(res, e.message)
    }
  },

  async getDailyStats(req, res) {
    try {
      const todayWita = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
      const dateStr = String(req.query.date || todayWita)

      // Cek cache
      const cacheKey = buildCacheKey(CACHE_KEYS.LOGS_DAILY_STATS, dateStr)
      const cached = getCache(cacheKey)
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=15')
        return sendSuccess(res, cached)
      }

      const from = new Date(`${dateStr}T00:00:00Z`)
      const to = new Date(`${dateStr}T23:59:59Z`)
      const { rows } = await pool.query({
        text: `
          SELECT user_id,
            COUNT(*) FILTER (WHERE type=0) AS masuk,
            COUNT(*) FILTER (WHERE type=1) AS pulang,
            COUNT(*) FILTER (WHERE type=4) AS lembur_masuk,
            COUNT(*) FILTER (WHERE type=5) AS lembur_keluar,
            MIN("timestamp") AS pertama,
            MAX("timestamp") AS terakhir
          FROM attendance_logs
          WHERE "timestamp" BETWEEN $1 AND $2
          GROUP BY user_id
          ORDER BY user_id;
        `,
        values: [from, to],
      })

      // Simpan ke cache
      const result = { date: dateStr, rows }
      setCache(cacheKey, result, TTL.MEDIUM)

      res.setHeader('Cache-Control', 'public, max-age=15')
      sendSuccess(res, result)
    } catch (e) {
      sendError(res, e.message)
    }
  },

  async getAttendanceSummary(req, res) {
    try {
      const todayWita = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
      const { from_date = todayWita, to_date = todayWita, user_id, limit = 1000, offset = 0 } = req.query;
      
      const from = new Date(`${from_date}T00:00:00Z`);
      const to = new Date(`${to_date}T23:59:59Z`);

      // Expand timestamp search by 1 day backward and forward to catch cross-midnight shifts
      const fetchFrom = new Date(from);
      fetchFrom.setDate(fetchFrom.getDate() - 1);
      const fetchTo = new Date(to);
      fetchTo.setDate(fetchTo.getDate() + 1);

      let whereClause = `al."timestamp" BETWEEN $1 AND $2`;
      let queryParams = [fetchFrom, fetchTo, limit, offset, from.toISOString().split('T')[0], to.toISOString().split('T')[0]];
      
      if (user_id) {
        whereClause += ` AND al.user_id = $7`;
        queryParams.push(String(user_id));
      }

      // Query to pivot Check-In (type 0) and Check-Out (type 1) per day per user
      // We use LEAD to detect if a user accidentally pressed IN (0) then OUT (1) within 5 minutes (300s).
      // We filter out that accidental IN so it doesn't create a ghost check-in.
      const query = `
        WITH raw_logs AS (
          SELECT 
            al.user_id,
            al."timestamp" AT TIME ZONE 'UTC' as ts,
            al.type,
            LEAD(al."timestamp" AT TIME ZONE 'UTC') OVER (PARTITION BY al.user_id ORDER BY al."timestamp") as next_ts,
            LEAD(al.type) OVER (PARTITION BY al.user_id ORDER BY al."timestamp") as next_type
          FROM attendance_logs al
          ${whereClause ? 'WHERE ' + whereClause : ''}
        ),
        cleaned_logs AS (
          SELECT * FROM raw_logs
          WHERE COALESCE(type = 0 AND next_type = 1 AND EXTRACT(EPOCH FROM (next_ts - ts)) <= 300, FALSE) = FALSE
        ),
        daily_logs AS (
          SELECT 
            user_id,
            DATE(
              ts - 
              CASE 
                WHEN type = 1 AND EXTRACT(HOUR FROM ts) < 9 
                THEN INTERVAL '12 hours' 
                ELSE INTERVAL '0 hours' 
              END
            ) as log_date,
            MIN(ts) FILTER (WHERE type = 0) as check_in_time,
            MAX(ts) FILTER (WHERE type = 1) as check_out_time
          FROM cleaned_logs
          GROUP BY user_id, DATE(
              ts - 
              CASE 
                WHEN type = 1 AND EXTRACT(HOUR FROM ts) < 9 
                THEN INTERVAL '12 hours' 
                ELSE INTERVAL '0 hours' 
              END
            )
        )
        SELECT 
          dl.log_date,
          dl.user_id,
          e.nik,
          e.nama,
          e.department,
          e.jabatan,
          TO_CHAR(dl.check_in_time, 'HH24:MI:SS') as check_in,
          TO_CHAR(dl.check_out_time, 'HH24:MI:SS') as check_out,
          EXTRACT(EPOCH FROM (dl.check_out_time - dl.check_in_time)) as diff_seconds
        FROM daily_logs dl
        LEFT JOIN employee e ON dl.user_id::text = e.user_id::text
        WHERE (dl.log_date >= $5::date AND dl.log_date <= $6::date)
           OR (DATE(dl.check_out_time) >= $5::date AND DATE(dl.check_out_time) <= $6::date)
           OR (DATE(dl.check_in_time) >= $5::date AND DATE(dl.check_in_time) <= $6::date)
        ORDER BY dl.log_date DESC, dl.check_in_time DESC NULLS LAST, dl.check_out_time DESC NULLS LAST
        LIMIT $3 OFFSET $4;
      `;

      const { rows } = await pool.query({ text: query, values: queryParams });

      // Format response for external systems
      const formattedData = rows.map(row => {
        let workHoursStr = null;
        if (row.check_out && row.diff_seconds > 0) {
            const diffHrs = Math.floor(row.diff_seconds / 3600);
            const diffMins = Math.floor((row.diff_seconds % 3600) / 60);
            workHoursStr = `${String(diffHrs).padStart(2, '0')}:${String(diffMins).padStart(2, '0')}`;
        }

        return {
          date: new Date(row.log_date).toISOString().split('T')[0],
          user_id: row.user_id,
          nik: row.nik || null,
          nama: row.nama || null,
          department: row.department || null,
          jabatan: row.jabatan || null,
          check_in: row.check_in,
          check_out: row.check_out,
          work_hours: workHoursStr,
          status: row.check_in && row.check_out ? "Hadir Penuh" : (row.check_in ? "Belum Pulang" : "Tidak Hadir")
        };
      });

      sendSuccess(res, { 
        from_date, 
        to_date,
        count: formattedData.length,
        summary: formattedData 
      });

    } catch (e) {
      sendError(res, e.message);
    }
  },

  async getPairSummary(req, res) {
    try {
      const todayWita = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
      const { 
        from_date = todayWita, 
        to_date = todayWita, 
        search, 
        user_id,
        limit = 25, 
        offset = 0 
      } = req.query;

      const lim = Math.min(parseInt(limit) || 25, 500);
      const off = Math.max(parseInt(offset) || 0, 0);

      const from = new Date(`${from_date}T00:00:00Z`);
      const to = new Date(`${to_date}T23:59:59Z`);

      // Expand timestamp search by 1 day backward and forward to catch cross-midnight shifts
      const fetchFrom = new Date(from);
      fetchFrom.setDate(fetchFrom.getDate() - 1);
      const fetchTo = new Date(to);
      fetchTo.setDate(fetchTo.getDate() + 1);

      const params = [];
      let i = 1;

      // Base WHERE for attendance_logs time range
      let whereLogs = `al."timestamp" BETWEEN $${i++} AND $${i++}`;
      params.push(fetchFrom, fetchTo);

      // Search filter (by employee name, nik, or user_id)
      if (search) {
        whereLogs += ` AND (e.nama ILIKE $${i} OR e.nik ILIKE $${i} OR al.user_id::text ILIKE $${i})`;
        params.push(`%${search}%`);
        i++;
      }

      // Filter by specific user_id
      if (user_id) {
        whereLogs += ` AND al.user_id = $${i}`;
        params.push(String(user_id));
        i++;
      }

      const dateFromStr = from.toISOString().split('T')[0];
      const dateToStr = to.toISOString().split('T')[0];

      // Optimized query: single CTE pipeline with accurate COUNT
      const query = `
        WITH raw_logs AS (
          SELECT 
            al.user_id,
            al."timestamp" AT TIME ZONE 'UTC' as ts,
            al.type,
            LEAD(al."timestamp" AT TIME ZONE 'UTC') OVER (
              PARTITION BY al.user_id ORDER BY al."timestamp"
            ) as next_ts,
            LEAD(al.type) OVER (
              PARTITION BY al.user_id ORDER BY al."timestamp"
            ) as next_type
          FROM attendance_logs al
          LEFT JOIN employee e ON al.user_id::text = e.user_id::text
          WHERE ${whereLogs}
        ),
        cleaned_logs AS (
          SELECT * FROM raw_logs
          WHERE COALESCE(
            type = 0 AND next_type = 1 AND EXTRACT(EPOCH FROM (next_ts - ts)) <= 300, 
            FALSE
          ) = FALSE
        ),
        daily_logs AS (
          SELECT 
            user_id,
            DATE(
              ts - 
              CASE 
                WHEN type = 1 AND EXTRACT(HOUR FROM ts) < 9 
                THEN INTERVAL '12 hours' 
                ELSE INTERVAL '0 hours' 
              END
            ) as log_date,
            MIN(ts) FILTER (WHERE type = 0) as check_in_time,
            MAX(ts) FILTER (WHERE type = 1) as check_out_time
          FROM cleaned_logs
          GROUP BY user_id, DATE(
            ts - 
            CASE 
              WHEN type = 1 AND EXTRACT(HOUR FROM ts) < 9 
              THEN INTERVAL '12 hours' 
              ELSE INTERVAL '0 hours' 
            END
          )
        ),
        filtered_daily AS (
          SELECT * FROM daily_logs
          WHERE (log_date >= $${i}::date AND log_date <= $${i+1}::date)
             OR (DATE(check_out_time) >= $${i}::date AND DATE(check_out_time) <= $${i+1}::date)
             OR (DATE(check_in_time) >= $${i}::date AND DATE(check_in_time) <= $${i+1}::date)
        ),
        counted AS (
          SELECT COUNT(*)::bigint AS total FROM filtered_daily
        ),
        paginated AS (
          SELECT * FROM filtered_daily
          ORDER BY log_date DESC, check_in_time DESC NULLS LAST, check_out_time DESC NULLS LAST
          LIMIT $${i+2} OFFSET $${i+3}
        )
        SELECT 
          p.log_date,
          p.user_id,
          e.nik,
          e.nama,
          e.department,
          e.jabatan,
          TO_CHAR(p.check_in_time, 'HH24:MI:SS') as check_in,
          TO_CHAR(p.check_out_time, 'HH24:MI:SS') as check_out,
          EXTRACT(EPOCH FROM (p.check_out_time - p.check_in_time)) as diff_seconds,
          c.total
        FROM paginated p
        LEFT JOIN employee e ON p.user_id::text = e.user_id::text
        CROSS JOIN counted c
        ORDER BY p.log_date DESC, p.check_in_time DESC NULLS LAST, p.check_out_time DESC NULLS LAST;
      `;

      params.push(dateFromStr, dateToStr, lim, off);

      const { rows } = await pool.query({ text: query, values: params });

      const total = rows.length > 0 ? Number(rows[0].total) : 0;

      const formattedData = rows.map(row => {
        let workHoursStr = null;
        if (row.check_out && row.diff_seconds > 0) {
          const diffHrs = Math.floor(row.diff_seconds / 3600);
          const diffMins = Math.floor((row.diff_seconds % 3600) / 60);
          workHoursStr = `${String(diffHrs).padStart(2, '0')}:${String(diffMins).padStart(2, '0')}`;
        }

        const hasCheckIn = !!row.check_in;
        const hasCheckOut = !!row.check_out;
        let status = "Tidak Hadir";
        if (hasCheckIn && hasCheckOut) status = "Hadir Penuh";
        else if (hasCheckIn) status = "Belum Pulang";

        return {
          date: new Date(row.log_date).toISOString().split('T')[0],
          user_id: row.user_id,
          nik: row.nik || null,
          nama: row.nama || null,
          department: row.department || null,
          jabatan: row.jabatan || null,
          check_in: row.check_in,
          check_out: row.check_out,
          work_hours: workHoursStr,
          status
        };
      });

      sendSuccess(res, {
        from_date,
        to_date,
        total,
        limit: lim,
        offset: off,
        has_more: off + formattedData.length < total,
        summary: formattedData
      });
      // Note: getPairSummary tetap menggunakan sendSuccess karena format response berbeda
      // dari sendPaginated (ada from_date, to_date, summary)

    } catch (e) {
      sendError(res, e.message);
    }
  },

  async getRawFiles(_req, res) {
    try {
      const files = await readdir(config.RAW_DIR)
      const data = await Promise.all(files.map(async f => {
        const st = await stat(path.join(config.RAW_DIR, f))
        return { file: f, size: st.size, mtime: st.mtime }
      }))
      sendSuccess(res, { count: data.length, files: data })
    } catch (e) {
      sendError(res, e.message)
    }
  },

  async downloadRawFile(req, res) {
    const name = path.basename(req.params.name)
    const fpath = path.join(config.RAW_DIR, name)
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    createReadStream(fpath, { highWaterMark: 1 << 16 })
      .on('error', () => sendError(res, 'Not found', 404))
      .pipe(res)
  }
}
