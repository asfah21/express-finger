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
            al.created_at
          FROM attendance_logs al
          LEFT JOIN employee e ON al.user_id::text = e.user_id::text
          LEFT JOIN devices d ON al.device_sn = d.sn
          ${whereSql}
          ORDER BY al."timestamp" DESC
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
        "overtime_check": "Perlu Konfirmasi (Lembur?)",
        "early_departure": "Pulang Mendahului / Anomali",
        "duplicate": "Duplikat Absensi / Anomali"
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

          if (shiftStart !== -1) {
            const diff = totalMinutes - shiftStart;
            if (diff > tolerance) {
              if (diff > 90) {
                ket = remarks.duplicate || 'Duplikat Absensi / Anomali';
              } else {
                ket = (remarks.late || 'Terlambat {diff} menit').replace('{diff}', diff);
              }
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

          if (shiftEnd !== -1) {
            const diff = totalMinutes - shiftEnd;
            if (diff > 60) {
              ket = remarks.overtime_check || 'Perlu Konfirmasi (Lembur?)';
            } else if (diff < -60) {
              ket = remarks.early_departure || 'Pulang Mendahului / Anomali';
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
      const dateStr = String(req.query.date || new Date().toISOString().slice(0, 10))
      const from = new Date(`${dateStr}T00:00:00+08:00`)
      const to = new Date(`${dateStr}T23:59:59+08:00`)
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
