import { readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import { config } from '../config/index.js'
import { pool } from '../utils/database.js'
import { getSettingsData } from './settings.js'

// API controller
export const apiController = {
  async getLogs(req, res) {
    try {
      const { from, to, limit = 100, offset = 0, user_id, type, device_sn, search } = req.query
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
        "duplicate": "Duplikat Absensi"
      };

      const typeMap = paramSettings?.types || {
        0: 'Masuk',
        1: 'Pulang',
        2: 'Break Out',
        3: 'Break In',
        4: 'Lembur Masuk',
        5: 'Lembur Keluar'
      }

      const rows = dataRes.rows.map(row => {
        const dt = new Date(row.timestamp);
        const hours = dt.getUTCHours();
        const minutes = dt.getUTCMinutes();
        const totalMinutes = hours * 60 + minutes;

        let ket = '';
        const empType = row.emp_type;
        const shiftCfg = shiftTypes[empType];

        if (row.type === 0 && shiftCfg) { // Check-in
          let shiftStart = -1;
          if (shiftCfg.start) {
            // Single shift
            const [h, m] = shiftCfg.start.split(':').map(Number);
            shiftStart = h * 60 + m;
          } else if (shiftCfg.shifts) {
            // Multi shift (Closest one)
            let minDiff = Infinity;
            for (const s of shiftCfg.shifts) {
              const [h, m] = s[0].split(':').map(Number);
              const startVal = h * 60 + m;
              const d = Math.abs(totalMinutes - startVal);
              if (d < minDiff) {
                minDiff = d;
                shiftStart = startVal;
              }
            }
          }

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
        } else if (row.type === 1 && shiftCfg) { // Check-out
          let shiftEnd = -1;
          if (shiftCfg.end) {
            const [h, m] = shiftCfg.end.split(':').map(Number);
            shiftEnd = h * 60 + m;
          } else if (shiftCfg.shifts) {
            // Pick shift end based on the closest start shift used above (roughly)
            let minDiff = Infinity;
            for (const s of shiftCfg.shifts) {
              const [hStart, mStart] = s[0].split(':').map(Number);
              const [hEnd, mEnd] = s[1].split(':').map(Number);
              const endVal = hEnd * 60 + mEnd;

              // Simple check: which end is closest?
              const d = Math.abs(totalMinutes - endVal);
              if (d < minDiff) {
                minDiff = d;
                shiftEnd = endVal;
              }
            }
          }

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
      res.json({ status: 'success', data: { total, limit: lim, offset: off, has_more: off + rows.length < total, logs: rows } })
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message })
    }
  },

  async getDailyStats(req, res) {
    try {
      const todayWita = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
      const dateStr = String(req.query.date || todayWita)
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
      res.setHeader('Cache-Control', 'public, max-age=15')
      res.json({ status: 'success', data: { date: dateStr, rows } })
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message })
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
          WHERE NOT (type = 0 AND next_type = 1 AND EXTRACT(EPOCH FROM (next_ts - ts)) <= 300)
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
        WHERE dl.log_date >= $5::date AND dl.log_date <= $6::date
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

      res.json({ 
        status: 'success', 
        data: { 
          from_date, 
          to_date,
          count: formattedData.length,
          summary: formattedData 
        } 
      });

    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message });
    }
  },

  async getRawFiles(_req, res) {
    try {
      const files = await readdir(config.RAW_DIR)
      const data = await Promise.all(files.map(async f => {
        const st = await stat(path.join(config.RAW_DIR, f))
        return { file: f, size: st.size, mtime: st.mtime }
      }))
      res.json({ status: 'success', data: { count: data.length, files: data } })
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message })
    }
  },

  async downloadRawFile(req, res) {
    const name = path.basename(req.params.name)
    const fpath = path.join(config.RAW_DIR, name)
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    createReadStream(fpath, { highWaterMark: 1 << 16 })
      .on('error', () => res.status(404).json({ status: 'error', message: 'Not found' }))
      .pipe(res)
  }
}
