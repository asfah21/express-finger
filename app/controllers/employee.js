import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

export const employeeController = {
    async listEmployees(req, res) {
        try {
            const { limit = 25, offset = 0, search = '' } = req.query
            const lim = parseInt(limit)
            const off = parseInt(offset)

            let query = 'SELECT * FROM employee'
            let countQuery = 'SELECT COUNT(*)::int as total FROM employee'
            let params = [lim, off]
            let countParams = []

            if (search) {
                const searchPattern = `%${search}%`
                query += ' WHERE (nama ILIKE $3 OR user_id ILIKE $3)'
                countQuery += ' WHERE (nama ILIKE $1 OR user_id ILIKE $1)'
                params.push(searchPattern)
                countParams.push(searchPattern)
            }

            query += ' ORDER BY id ASC LIMIT $1 OFFSET $2'

            const { rows } = await pool.query(query, params)
            const { rows: countRes } = await pool.query(countQuery, countParams)

            res.json({
                status: 'success',
                data: {
                    list: rows,
                    total: countRes[0].total,
                    limit: lim,
                    offset: off
                }
            })
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
        const { user_id, nik, nama, jabatan, department, divisi, type } = req.body
        if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id is required' })

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            const { rows } = await pool.query(
                `INSERT INTO employee (user_id, nik, nama, jabatan, department, divisi, type) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [String(user_id), nik, nama, jabatan, department, divisi, type]
            )

            await recordActivity({
                username, action: 'add_employee', category: 'employee',
                detail: `Added employee: ${nama || 'N/A'} (User ID: ${user_id}, NIK: ${nik || '-'})`,
                ip
            })

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
        const { user_id, nik, nama, jabatan, department, divisi, type } = req.body
        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            const { rows } = await pool.query(
                `UPDATE employee 
                 SET user_id = COALESCE($1, user_id), 
                     nik = COALESCE($2, nik), 
                     nama = COALESCE($3, nama), 
                     jabatan = COALESCE($4, jabatan), 
                     department = COALESCE($5, department),
                     divisi = COALESCE($6, divisi),
                     type = COALESCE($7, type)
                 WHERE id = $8 RETURNING *`,
                [user_id ? String(user_id) : null, nik, nama, jabatan, department, divisi, type, id]
            )
            if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })

            await recordActivity({
                username, action: 'edit_employee', category: 'employee',
                detail: `Updated employee: ${nama || rows[0]?.nama || 'N/A'} (ID: ${id})`,
                ip
            })

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
        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            // Get info before deleting
            const { rows: empRows } = await pool.query('SELECT nama, user_id FROM employee WHERE id = $1', [id])
            const emp = empRows[0]

            const { rowCount } = await pool.query('DELETE FROM employee WHERE id = $1', [id])
            if (rowCount === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })

            await recordActivity({
                username, action: 'delete_employee', category: 'employee',
                detail: `Deleted employee: ${emp?.nama || 'N/A'} (User ID: ${emp?.user_id || id})`,
                ip
            })

            res.json({ status: 'success', message: 'Employee deleted' })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async bulkAddEmployees(req, res) {
        const { employees } = req.body
        if (!Array.isArray(employees)) return res.status(400).json({ status: 'error', message: 'Invalid data format' })

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            const results = []
            for (const emp of employees) {
                const { user_id, nik, nama, jabatan, department, divisi, type } = emp
                if (!user_id) continue

                const { rows } = await pool.query(
                    `INSERT INTO employee (user_id, nik, nama, jabatan, department, divisi, type) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7) 
                     ON CONFLICT (user_id) DO UPDATE 
                     SET nik = COALESCE(NULLIF(EXCLUDED.nik, ''), employee.nik),
                         nama = COALESCE(NULLIF(EXCLUDED.nama, ''), employee.nama),
                         jabatan = COALESCE(NULLIF(EXCLUDED.jabatan, ''), employee.jabatan),
                         department = COALESCE(NULLIF(EXCLUDED.department, ''), employee.department),
                         divisi = COALESCE(NULLIF(EXCLUDED.divisi, ''), employee.divisi),
                         type = COALESCE(NULLIF(EXCLUDED.type, ''), employee.type),
                         updated_at = CURRENT_TIMESTAMP
                     RETURNING *`,
                    [String(user_id), nik, nama, jabatan, department, divisi, type]
                )
                results.push(rows[0])
            }

            await recordActivity({
                username, action: 'import_employees', category: 'import',
                detail: `Bulk imported ${results.length} employees from file`,
                ip
            })

            res.json({ status: 'success', message: `Imported ${results.length} employees`, data: results })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    }
}
