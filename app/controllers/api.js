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
        const empType = row.emp_type; // S75, S77, N77, N99

        if (row.type === 0 && empType) { // Check-in
          let shiftStart = -1;
          if (empType === 'S75' || empType === 'S77') {
            shiftStart = 7 * 60; // 07:00
          } else if (empType === 'N77') {
            // Pick closest to 07:00 or 19:00
            const d1 = Math.abs(totalMinutes - (7 * 60));
            const d2 = Math.abs(totalMinutes - (19 * 60));
            shiftStart = d1 < d2 ? 7 * 60 : 19 * 60;
          } else if (empType === 'N99') {
            // Pick closest to 09:00 or 21:00
            const d1 = Math.abs(totalMinutes - (9 * 60));
            const d2 = Math.abs(totalMinutes - (21 * 60));
            shiftStart = d1 < d2 ? 9 * 60 : 21 * 60;
          }

          if (shiftStart !== -1) {
            const diff = totalMinutes - shiftStart;
            if (diff > tolerance) {
              ket = `Terlambat ${diff} menit`;
            } else if (diff < -60) {
              ket = 'Anomali (Terlalu Awal)';
            }
          }
        } else if (row.type === 1 && empType) { // Check-out
          let shiftEnd = -1;
          if (empType === 'S75') shiftEnd = 17 * 60;
          else if (empType === 'S77') shiftEnd = 19 * 60;
          else if (empType === 'N77') {
            // 19:00 or 07:00
            const d1 = Math.abs(totalMinutes - (19 * 60));
            const d2 = Math.abs(totalMinutes - (7 * 60));
            shiftEnd = d1 < d2 ? 19 * 60 : 7 * 60;
          } else if (empType === 'N99') {
            // 21:00 or 09:00
            const d1 = Math.abs(totalMinutes - (21 * 60));
            const d2 = Math.abs(totalMinutes - (9 * 60));
            shiftEnd = d1 < d2 ? 21 * 60 : 9 * 60;
          }

          if (shiftEnd !== -1) {
            const diff = totalMinutes - shiftEnd;
            if (diff > 60) {
              ket = 'Perlu Konfirmasi (Lembur?)';
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
