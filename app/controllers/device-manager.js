import { pool } from '../utils/database.js'

export const deviceManagerController = {
    async listDevices(req, res) {
        try {
            const { limit = 10, offset = 0 } = req.query
            const lim = parseInt(limit)
            const off = parseInt(offset)

            const { rows } = await pool.query('SELECT *, COUNT(*) OVER()::int as total FROM devices ORDER BY id ASC LIMIT $1 OFFSET $2', [lim, off])
            const total = rows.length > 0 ? rows[0].total : 0
            res.json({ status: 'success', data: { list: rows, total } })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async addDevice(req, res) {
        const { sn, name, ip, port = 4370, is_active = true } = req.body
        if (!ip) return res.status(400).json({ status: 'error', message: 'IP address is required' })
        try {
            const { rows } = await pool.query(
                'INSERT INTO devices (sn, name, ip, port, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [sn, name, ip, port, is_active]
            )
            res.status(201).json({ status: 'success', data: rows[0] })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async updateDevice(req, res) {
        const { id } = req.params
        const { sn, name, ip, port, is_active } = req.body
        try {
            const { rows } = await pool.query(
                `UPDATE devices 
         SET sn = COALESCE($1, sn), 
             name = COALESCE($2, name), 
             ip = COALESCE($3, ip), 
             port = COALESCE($4, port), 
             is_active = COALESCE($5, is_active)
         WHERE id = $6 RETURNING *`,
                [sn, name, ip, port, is_active, id]
            )
            if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Device not found' })
            res.json({ status: 'success', data: rows[0] })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async deleteDevice(req, res) {
        const { id } = req.params
        try {
            const { rowCount } = await pool.query('DELETE FROM devices WHERE id = $1', [id])
            if (rowCount === 0) return res.status(404).json({ status: 'error', message: 'Device not found' })
            res.json({ status: 'success', message: 'Device deleted' })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    }
}
