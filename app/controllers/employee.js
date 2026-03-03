import { pool } from '../utils/database.js'

export const employeeController = {
    async listEmployees(req, res) {
        try {
            const { rows } = await pool.query('SELECT * FROM employee ORDER BY id ASC')
            res.json({ status: 'success', data: { list: rows, total: rows.length } })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async getEmployee(req, res) {
        const { id } = req.params
        try {
            const { rows } = await pool.query('SELECT * FROM employee WHERE id = $1', [id])
            if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })
            res.json({ status: 'success', data: rows[0] })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async addEmployee(req, res) {
        const { user_id, nik, nama, jabatan, department } = req.body
        if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id is required' })

        try {
            const { rows } = await pool.query(
                `INSERT INTO employee (user_id, nik, nama, jabatan, department) 
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [String(user_id), nik, nama, jabatan, department]
            )
            res.status(201).json({ status: 'success', data: rows[0] })
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({ status: 'error', message: 'user_id already exists' })
            }
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async updateEmployee(req, res) {
        const { id } = req.params
        const { user_id, nik, nama, jabatan, department } = req.body
        try {
            const { rows } = await pool.query(
                `UPDATE employee 
                 SET user_id = COALESCE($1, user_id), 
                     nik = COALESCE($2, nik), 
                     nama = COALESCE($3, nama), 
                     jabatan = COALESCE($4, jabatan), 
                     department = COALESCE($5, department)
                 WHERE id = $6 RETURNING *`,
                [user_id ? String(user_id) : null, nik, nama, jabatan, department, id]
            )
            if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })
            res.json({ status: 'success', data: rows[0] })
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({ status: 'error', message: 'user_id already exists' })
            }
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async deleteEmployee(req, res) {
        const { id } = req.params
        try {
            const { rowCount } = await pool.query('DELETE FROM employee WHERE id = $1', [id])
            if (rowCount === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })
            res.json({ status: 'success', message: 'Employee deleted' })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    }
}
