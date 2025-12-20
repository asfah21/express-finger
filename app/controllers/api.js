import { readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import { config } from '../config/index.js'
import { pool } from '../utils/database.js'

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

      if (from) { where.push(`"timestamp" >= $${i++}`); params.push(new Date(String(from))) }
      if (to) { where.push(`"timestamp" <= $${i++}`); params.push(new Date(String(to))) }
      if (user_id) { where.push(`user_id = $${i++}`); params.push(String(user_id)) }
      if (type !== undefined) { where.push(`type = $${i++}`); params.push(Number(type)) }
      if (device_sn) { where.push(`device_sn = $${i++}`); params.push(String(device_sn)) }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

      const dataQuery = {
        text: `
          SELECT id, user_id, type, device_sn, "timestamp", created_at
          FROM attendance_logs
          ${whereSql}
          ORDER BY "timestamp" DESC
          LIMIT $${i++} OFFSET $${i++}
        `,
        values: [...params, lim, off],
      }
      const countQuery = {
        text: `SELECT COUNT(*)::bigint AS total FROM attendance_logs ${whereSql}`,
        values: params,
      }

      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery),
        pool.query(countQuery)
      ])
      const rows = dataRes.rows
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