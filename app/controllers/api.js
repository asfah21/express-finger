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
      const { from, to, limit = 100, offset = 0, user_id, type, device_sn } = req.query
      const lim = Math.min(Number(limit) || 100, config.MAX_LIMIT)
      const off = Math.max(Number(offset) || 0, 0)
      const where = []
      const params = []
      let i = 1

      if (from) { where.push(`al."timestamp" >= $${i++}`); params.push(new Date(String(from))) }
      if (to) { where.push(`al."timestamp" <= $${i++}`); params.push(new Date(String(to))) }
      if (user_id) { where.push(`al.user_id = $${i++}`); params.push(String(user_id)) }
      if (type !== undefined) { where.push(`al.type = $${i++}`); params.push(Number(type)) }
      if (device_sn) { where.push(`al.device_sn = $${i++}`); params.push(String(device_sn)) }

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
            al.type, 
            al.device_sn, 
            al."timestamp", 
            al.created_at
          FROM attendance_logs al
          LEFT JOIN employee e ON al.user_id::text = e.user_id::text
          ${whereSql}
          ORDER BY al."timestamp" DESC
          LIMIT $${i++} OFFSET $${i++}
        `,
        values: [...params, lim, off],
      }
      const countQuery = {
        text: `SELECT COUNT(*)::bigint AS total FROM attendance_logs al ${whereSql}`,
        values: params,
      }

      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery),
        pool.query(countQuery)
      ])

      const paramSettings = await getSettingsData()
      const typeMap = paramSettings?.types || {
        0: 'Masuk',
        1: 'Pulang',
        2: 'Break Out',
        3: 'Break In',
        4: 'Lembur Masuk',
        5: 'Lembur Keluar'
      }
      const deviceMap = paramSettings?.devices || {}

      const rows = dataRes.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        nik: row.nik || null,
        nama: row.nama || null,
        jabatan: row.jabatan || null,
        department: row.department || null,
        type: row.type,
        absensi: typeMap[row.type] || String(row.type),
        device_name: deviceMap[row.device_sn] || row.device_sn,
        device_sn: row.device_sn,
        timestamp: row.timestamp,
        created_at: row.created_at
      }))

      const total = Number(countRes.rows[0]?.total || 0)
      res.json({ total, limit: lim, offset: off, has_more: off + rows.length < total, rows })
    } catch (e) {
      res.status(500).json({ error: e.message })
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
      res.json({ date: dateStr, rows })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  },

  async getRawFiles(_req, res) {
    try {
      const files = await readdir(config.RAW_DIR)
      const data = await Promise.all(files.map(async f => {
        const st = await stat(path.join(config.RAW_DIR, f))
        return { file: f, size: st.size, mtime: st.mtime }
      }))
      res.json({ count: data.length, files: data })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  },

  async downloadRawFile(req, res) {
    const name = path.basename(req.params.name)
    const fpath = path.join(config.RAW_DIR, name)
    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    createReadStream(fpath, { highWaterMark: 1 << 16 })
      .on('error', () => res.status(404).json({ error: 'Not found' }))
      .pipe(res)
  }
}