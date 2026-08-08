import { readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import { config } from '../config/index.js'
import { pool } from '../utils/database.js'
import { getSettingsData } from './settings.js'
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js'
import { getCache, setCache, delCacheByPattern, CACHE_KEYS, TTL, buildCacheKey } from '../utils/cache.js'
import { processAttendance } from '../utils/attendance-engine.js'
import { BUSINESS_TIME_ZONE, getBusinessDateBounds, getBusinessDateString } from '../utils/timezone.js'

// API controller
export const apiController = {
  async getLateLogs(req, res) {
    try {
      const { from, to, limit = 100, offset = 0, search } = req.query

      const lim = Math.min(Number(limit) || 100, config.MAX_LIMIT)
      const off = Math.max(Number(offset) || 0, 0)
      const where = ['al.type = 0']
      const params = []
      let i = 1

      if (from) { where.push(`al."timestamp" >= $${i++}`); params.push(new Date(String(from))) }
      if (to) { where.push(`al."timestamp" <= $${i++}`); params.push(new Date(String(to))) }

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
              LAG(al."timestamp") OVER (
                PARTITION BY al.user_id, al.type
                ORDER BY al."timestamp" ASC, al.id ASC
              ) as prev_same_type_ts
            FROM attendance_logs al
            LEFT JOIN employee e ON al.user_id::text = e.user_id::text
            LEFT JOIN devices d ON al.device_sn = d.sn
            ${whereSql}
          )
          SELECT *, (
            prev_same_type_ts IS NOT NULL
            AND EXTRACT(EPOCH FROM ("timestamp" - prev_same_type_ts)) <= 300
          ) as is_duplicate
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
      const ruleInOut = paramSettings?.rule_in_out || null;
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

      // Process attendance to get remarks (including late detection)
      const processedRows = processAttendance(dataRes.rows, shiftTypes, remarks, tolerance, typeMap, ruleInOut);

      // Filter only late records (ket contains "Terlambat")
      const lateRows = processedRows.filter(row => row.ket && row.ket.includes('Terlambat'));

      const total = Number(countRes.rows[0]?.total || 0)

      return sendPaginated(res, lateRows, total, Number(limit), Number(offset))
    } catch (err) {
      console.error('Error getLateLogs:', err)
      return sendError(res, 'Gagal mengambil data keterlambatan', 500)
    }
  },

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
              LAG(al."timestamp") OVER (
                PARTITION BY al.user_id, al.type
                ORDER BY al."timestamp" ASC, al.id ASC
              ) as prev_same_type_ts
            FROM attendance_logs al
            LEFT JOIN employee e ON al.user_id::text = e.user_id::text
            LEFT JOIN devices d ON al.device_sn = d.sn
            ${whereSql}
          )
          SELECT *, (
            prev_same_type_ts IS NOT NULL
            AND EXTRACT(EPOCH FROM ("timestamp" - prev_same_type_ts)) <= 300
          ) as is_duplicate
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
      const ruleInOut = paramSettings?.rule_in_out || null;
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

      // ─── Delegate to AttendanceEngine ──────────────────────────────────────
      // All business logic (state machine, shift matching, anomaly detection,
      // remark generation, response formatting) is handled by processAttendance().
      // The controller only fetches data and returns the response.
      const rows = processAttendance(dataRes.rows, shiftTypes, remarks, tolerance, typeMap, ruleInOut);

      const total = Number(countRes.rows[0]?.total || 0)

      // Cache hasil jika memenuhi syarat
      if (shouldCache && cacheKey) {
        setCache(cacheKey, { rows, total }, TTL.LOGS_LIST)
      }

      return sendPaginated(res, rows, total, Number(limit), Number(offset))
    } catch (err) {
      console.error('Error getLogs:', err)
      return sendError(res, 'Gagal mengambil data logs', 500)
    }
  },

  async getDailyStats(req, res) {
    try {
      const todayWita = getBusinessDateString();
      const dateStr = String(req.query.date || todayWita)

      // Cek cache
      const cacheKey = buildCacheKey(CACHE_KEYS.LOGS_DAILY_STATS, dateStr)
      const cached = getCache(cacheKey)
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=15')
        return sendSuccess(res, cached)
      }

      const { from, to } = getBusinessDateBounds(dateStr)
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

  async getOverviewData(req, res) {
    try {
      const today = getBusinessDateString()
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31)
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), config.MAX_LIMIT)
      const offset = Math.max(Number(req.query.offset) || 0, 0)
      const todayBounds = getBusinessDateBounds(today)
      const fromDate = new Date(todayBounds.from)
      fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1))
      const fromDateString = getBusinessDateString(fromDate)
      const from = getBusinessDateBounds(fromDateString).from
      const to = todayBounds.to

      // One lightweight request replaces the N sequential /logs requests used by
      // the Overview chart. Keep the chart aggregation in PostgreSQL so the
      // browser never downloads thousands of rows just to count them.
      const [chartResult, recentResult, totalResult] = await Promise.all([
        pool.query({
          text: `
            SELECT DATE("timestamp" AT TIME ZONE $3) AS date,
              COUNT(*) FILTER (WHERE type = 0)::int AS check_in,
              COUNT(*) FILTER (WHERE type = 1)::int AS check_out
            FROM attendance_logs
            WHERE "timestamp" BETWEEN $1 AND $2
            GROUP BY DATE("timestamp" AT TIME ZONE $3)
            ORDER BY date ASC
          `,
          values: [from, to, BUSINESS_TIME_ZONE]
        }),
        pool.query({
          text: `
            SELECT al.id, al.user_id, al.type, al.device_sn, al."timestamp",
              e.nama, d.name AS device_name
            FROM attendance_logs al
            LEFT JOIN employee e ON al.user_id::text = e.user_id::text
            LEFT JOIN devices d ON al.device_sn = d.sn
            WHERE al."timestamp" BETWEEN $1 AND $2
            ORDER BY al."timestamp" DESC, al.id DESC
            LIMIT $3 OFFSET $4
          `,
          values: [todayBounds.from, todayBounds.to, limit, offset]
        }),
        pool.query({
          text: `SELECT COUNT(*)::int AS total
            FROM attendance_logs
            WHERE "timestamp" BETWEEN $1 AND $2`,
          values: [todayBounds.from, todayBounds.to]
        })
      ])

      const chartByDate = new Map(chartResult.rows.map(row => [
        String(row.date).slice(0, 10),
        { checkIn: Number(row.check_in) || 0, checkOut: Number(row.check_out) || 0 }
      ]))
      const chart = []
      for (let i = 0; i < days; i++) {
        const date = new Date(from)
        date.setUTCDate(date.getUTCDate() + i)
        const dateString = getBusinessDateString(date)
        chart.push({
          date: dateString,
          checkIn: chartByDate.get(dateString)?.checkIn || 0,
          checkOut: chartByDate.get(dateString)?.checkOut || 0
        })
      }

      const recent = recentResult.rows.map(row => ({
        ...row,
        absensi: Number(row.type) === 0 ? 'Masuk' : Number(row.type) === 1 ? 'Pulang' : `Type ${row.type}`
      }))

      res.setHeader('Cache-Control', 'private, max-age=15')
      return sendSuccess(res, {
        today,
        chart,
        recent,
        recentTotal: Number(totalResult.rows[0]?.total) || 0
      })
    } catch (err) {
      console.error('Error getOverviewData:', err)
      return sendError(res, 'Gagal mengambil data overview', 500)
    }
  },

  async getAttendanceSummary(req, res) {
    try {
      const todayWita = getBusinessDateString();
      const { from_date = todayWita, to_date = todayWita, user_id, limit = 1000, offset = 0 } = req.query;

      const from = getBusinessDateBounds(from_date).from;
      const to = getBusinessDateBounds(to_date).to;

      // Expand timestamp search by 1 day backward and forward to catch cross-midnight shifts
      const fetchFrom = new Date(from);
      fetchFrom.setDate(fetchFrom.getDate() - 1);
      const fetchTo = new Date(to);
      fetchTo.setDate(fetchTo.getDate() + 1);

      let whereClause = `al."timestamp" BETWEEN $1 AND $2`;
      let queryParams = [fetchFrom, fetchTo, limit, offset, from_date, to_date];

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
            al."timestamp" AT TIME ZONE $8 as ts,
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
      const todayWita = getBusinessDateString();
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

      const from = getBusinessDateBounds(from_date).from;
      const to = getBusinessDateBounds(to_date).to;

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

      const dateFromStr = from_date;
      const dateToStr = to_date;

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
          WHERE (log_date >= $${i}::date AND log_date <= $${i + 1}::date)
             OR (DATE(check_out_time) >= $${i}::date AND DATE(check_out_time) <= $${i + 1}::date)
             OR (DATE(check_in_time) >= $${i}::date AND DATE(check_in_time) <= $${i + 1}::date)
        ),
        counted AS (
          SELECT COUNT(*)::bigint AS total FROM filtered_daily
        ),
        paginated AS (
          SELECT * FROM filtered_daily
          ORDER BY log_date DESC, check_in_time DESC NULLS LAST, check_out_time DESC NULLS LAST
          LIMIT $${i + 2} OFFSET $${i + 3}
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
